'use strict';
// Limit-equilibrium solver for embedded sheet pile walls.
//
// Outputs (per combination):
//   { d_required_m, d_design_m, propForces_kN_per_m, M_max_kNm_per_m, V_max_kN_per_m,
//     deflection_max_mm, BMD: {z[], M[]}, SFD: {z[], V[]}, deflection: {z[], y[]},
//     pGross_active[], pGross_passive[], pNet[], pFactored[], levels[], status }

function runDesign(state) {
  const combos = state.designControl.mode === 'TRAD'
    ? ['C1']                                    // single combination, traditional FoS
    : ['C1', 'C2', 'SLS'];

  const results = {};
  for (const combo of combos) {
    results[combo] = runSingleCombination(state, combo);
  }
  AppState.lastResults = results;
  return results;
}

function runSingleCombination(state, combo) {
  const wallType = state.wall.type;
  if (wallType === 'cantilever')   return solveCantilever(state, combo);
  if (wallType === 'singleprop')   return solveSingleProp(state, combo);
  if (wallType === 'multiprop')    return solveMultiProp(state, combo);
  return null;
}

// ─── Cantilever ──────────────────────────────────────────────────────────────

function solveCantilever(state, combo) {
  const wallTop = state.geometry.wallTopLevel_m;
  const wallLen = state.wall.length_m;
  const pGround = state.geometry.passiveGroundLevel_m;
  const maxD    = 25.0;                   // 25 m max embedment to search
  const dz_search = 0.05;

  // Iterate trial embedment from small (toe just below dredge) to large.
  // M-about-toe is positive when active drives the wall, negative when passive resists.
  // Required embedment is where M transitions from + to ≤ 0.
  let d_required = null;
  let prevMoment = null;
  let prevToe    = null;
  for (let toeLevel = pGround - dz_search; toeLevel >= pGround - maxD; toeLevel -= dz_search) {
    const trial = { ...state, wall: { ...state.wall, length_m: wallTop - toeLevel } };
    const profile = buildPressureProfile(trial, combo);
    const M = momentAboutToe(profile, toeLevel);
    if (M <= 0) {
      if (prevMoment !== null && prevMoment > 0) {
        const f = prevMoment / (prevMoment - M);
        const interpToe = prevToe + f * (toeLevel - prevToe);
        d_required = pGround - interpToe;
      } else {
        // First iteration already stable (passive dominates immediately, e.g. soft-clay
        // toe in a stiff-clay base) — minimal embedment suffices.
        d_required = pGround - toeLevel;
      }
      break;
    }
    prevMoment = M; prevToe = toeLevel;
  }
  let convergenceFailed = false;
  if (d_required === null) {
    d_required = maxD;
    convergenceFailed = true;
  }

  const embFactor   = state.designControl.embedmentSafetyFactor || 1.20;
  const d_design    = d_required * embFactor;
  // BMD calc length: by default use d_design (BSC / CADS convention — gives a
  // conservative M_max with the linear close-to-zero correction). User can
  // switch to d_required for the equilibrium answer (smaller M_max, no
  // over-embedment artefact).
  const useDesignLen = state.designControl.bmdAtDesignLength !== false;
  const d_calc       = useDesignLen ? d_design : d_required;
  const calcLength   = (wallTop - pGround) + d_calc;
  const calcState    = { ...state, wall: { ...state.wall, length_m: calcLength } };
  const profile      = buildPressureProfile(calcState, combo);

  const { SF, BM, R_toe } = integrateCantileverBM(profile);
  const EI   = flexuralStiffness_kNm2_per_m(state.wall.sectionId);
  const defl = deflectionByDoubleIntegration(profile.z, BM, EI, { topFree: true, toeClamped: true });

  const userEmbedment = wallLen - (wallTop - pGround);
  return {
    combo,
    wallType: 'cantilever',
    d_required_m: d_required,
    d_design_m:   d_design,
    user_embedment_m: userEmbedment,
    propForces_kN_per_m: [],
    levels:    profile.levels,
    z:         profile.z,
    pActive:   profile.sigmaA,
    pPassive:  profile.sigmaP,
    pNet:      profile.net,
    SFD:       SF,
    BMD:       BM,
    deflection_mm: defl.map(d => d * 1000),
    M_max_kNm_per_m:    Math.max(...BM.map(Math.abs)),
    V_max_kN_per_m:     Math.max(...SF.map(Math.abs)),
    deflection_max_mm:  Math.max(...defl.map(d => Math.abs(d))) * 1000,
    R_toe_kN_per_m:     R_toe,
    status:             convergenceFailed
                          ? 'NON-CONVERGENT'
                          : (userEmbedment >= d_design ? 'OK' : 'EMBEDMENT INSUFFICIENT'),
    convergenceFailed
  };
}

function momentAboutToe(profile, toeLevel) {
  // Moment of net pressure about the trial toe.
  // p positive = active side dominates (wall pushed toward passive) → driving moment.
  // We define moment positive if it tends to rotate the wall about toe in the active→passive direction;
  // resisting passive moments are negative. Required embedment is where ΣM = 0.
  let M = 0;
  for (let i = 0; i < profile.levels.length - 1; i++) {
    const L1 = profile.levels[i],     L2 = profile.levels[i+1];
    const p1 = profile.net[i],        p2 = profile.net[i+1];
    if (L1 < toeLevel) break;                       // gone past toe
    const p   = (p1 + p2) / 2;
    const dL  = L1 - L2;                            // positive
    const arm = (L1 + L2) / 2 - toeLevel;           // moment arm about toe (m)
    M += p * dL * arm;
  }
  return M;
}

function integrateCantileverBM(profile) {
  // Top-down trapezoidal integration of net pressure → V(z), then V → M.
  const n = profile.z.length;
  const V = new Array(n).fill(0);
  const M = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const dz = profile.z[i] - profile.z[i-1];
    V[i] = V[i-1] + 0.5 * (profile.net[i] + profile.net[i-1]) * dz;
  }
  // For limit-equilibrium at d_required, V[toe] ≈ 0 naturally. For BMD-at-
  // d_design (the default CADS/BSC convention), the wall is over-embedded so
  // passive over-mobilises in the integration, leaving a non-zero residual at
  // the toe. Distribute that residual linearly along the wall so SF closes to
  // zero at the toe — represents the implicit R_toe correction smeared along
  // the pile (the true R is a point load at the toe in Burland-Potts simplified).
  const R_toe   = V[n-1];
  const SFclose = V[n-1];
  for (let i = 0; i < n; i++) V[i] -= SFclose * (profile.z[i] / profile.z[n-1]);
  // BM from the corrected SF
  for (let i = 1; i < n; i++) {
    const dz = profile.z[i] - profile.z[i-1];
    M[i] = M[i-1] + 0.5 * (V[i] + V[i-1]) * dz;
  }
  // Close M at toe to 0 (residual from numerical integration)
  const Mclose = M[n-1];
  for (let i = 0; i < n; i++) M[i] -= Mclose * (profile.z[i] / profile.z[n-1]);
  return { SF: V, BM: M, R_toe };
}

// ─── Single prop (free earth support) ────────────────────────────────────────

function solveSingleProp(state, combo) {
  const wallTop = state.geometry.wallTopLevel_m;
  const wallLen = state.wall.length_m;
  const prop    = state.props[0] || { level_m: wallTop - 0.5 };
  const pGround = state.geometry.passiveGroundLevel_m;

  // Iterate embedment until ΣM about prop = 0 (free earth support).
  // M-about-prop is negative for shallow embedment (active dominates) and crosses to
  // positive once passive resistance below dredge develops enough.
  let d_required = null, prevM = null, prevToe = null;
  for (let toeLevel = pGround - 0.05; toeLevel >= pGround - 25; toeLevel -= 0.05) {
    const trial = { ...state, wall: { ...state.wall, length_m: wallTop - toeLevel } };
    const tp    = buildPressureProfile(trial, combo);
    const M     = momentAboutLevel(tp, prop.level_m);
    if (M >= 0) {
      if (prevM !== null && prevM < 0) {
        const f = -prevM / (M - prevM);
        const interpToe = prevToe + f * (toeLevel - prevToe);
        d_required = pGround - interpToe;
      } else {
        // First iteration already balanced — minimal embedment suffices.
        d_required = pGround - toeLevel;
      }
      break;
    }
    prevM = M; prevToe = toeLevel;
  }
  let convergenceFailed = false;
  if (d_required === null) { d_required = 25; convergenceFailed = true; }

  const embFactor   = state.designControl.embedmentSafetyFactor || 1.20;
  const d_design    = d_required * embFactor;
  // Same toggle as the cantilever path. For tied walls the choice matters
  // less because M_max is dominated by the propped span (above the embedment),
  // but staying consistent with the cantilever convention.
  const useDesignLen = state.designControl.bmdAtDesignLength !== false;
  const d_calc       = useDesignLen ? d_design : d_required;
  const calcLength   = (wallTop - pGround) + d_calc;
  const calcState    = { ...state, wall: { ...state.wall, length_m: calcLength } };
  const profile      = buildPressureProfile(calcState, combo);

  // Prop reaction = ΣH at the design embedment (positive = wall pushed toward passive,
  // taken by the prop pulling back).
  let SH = 0;
  for (let i = 0; i < profile.z.length - 1; i++) {
    SH += 0.5 * (profile.net[i] + profile.net[i+1]) * (profile.z[i+1] - profile.z[i]);
  }
  const F_prop = SH;

  const { SF, BM } = integrateProppedBM(profile, prop.level_m, wallTop, F_prop);
  const EI   = flexuralStiffness_kNm2_per_m(state.wall.sectionId);
  const defl = deflectionByDoubleIntegration(profile.z, BM, EI, { topFree: true, toeClamped: false, propLevel_z: wallTop - prop.level_m });

  const userEmbedment = wallLen - (wallTop - pGround);
  return {
    combo,
    wallType: 'singleprop',
    d_required_m: d_required,
    d_design_m:   d_design,
    user_embedment_m: userEmbedment,
    propForces_kN_per_m: [F_prop],
    levels:    profile.levels,
    z:         profile.z,
    pActive:   profile.sigmaA,
    pPassive:  profile.sigmaP,
    pNet:      profile.net,
    SFD:       SF,
    BMD:       BM,
    deflection_mm: defl.map(d => d * 1000),
    M_max_kNm_per_m:    Math.max(...BM.map(Math.abs)),
    V_max_kN_per_m:     Math.max(...SF.map(Math.abs)),
    deflection_max_mm:  Math.max(...defl.map(d => Math.abs(d))) * 1000,
    status:             convergenceFailed
                          ? 'NON-CONVERGENT'
                          : (userEmbedment >= d_design ? 'OK' : 'EMBEDMENT INSUFFICIENT'),
    convergenceFailed
  };
}

function momentAboutLevel(profile, level_m) {
  let M = 0;
  for (let i = 0; i < profile.levels.length - 1; i++) {
    const L1 = profile.levels[i], L2 = profile.levels[i+1];
    const p  = (profile.net[i] + profile.net[i+1]) / 2;
    const dL = L1 - L2;
    const arm = (L1 + L2) / 2 - level_m;            // positive if below the pivot
    M += p * dL * arm;
  }
  return M;
}

function integrateProppedBM(profile, propLevel_m, wallTop_m, F_prop) {
  const n = profile.z.length;
  const V = new Array(n).fill(0);
  const M = new Array(n).fill(0);
  const z_prop = wallTop_m - propLevel_m;
  let propApplied = false;
  for (let i = 1; i < n; i++) {
    const dz = profile.z[i] - profile.z[i-1];
    V[i] = V[i-1] + 0.5 * (profile.net[i] + profile.net[i-1]) * dz;
    if (!propApplied && profile.z[i] >= z_prop) {
      V[i] -= F_prop;
      propApplied = true;
    }
  }
  for (let i = 1; i < n; i++) {
    const dz = profile.z[i] - profile.z[i-1];
    M[i] = M[i-1] + 0.5 * (V[i] + V[i-1]) * dz;
  }
  // Close M at toe to 0
  const Mclose = M[n-1];
  for (let i = 0; i < n; i++) M[i] -= Mclose * (profile.z[i] / profile.z[n-1]);
  return { SF: V, BM: M };
}

// ─── Multi-prop (Terzaghi-Peck apparent earth pressure envelope) ─────────────

function solveMultiProp(state, combo) {
  const wallTop = state.geometry.wallTopLevel_m;
  const aGround = state.geometry.activeGroundLevel_m;
  const pGround = state.geometry.passiveGroundLevel_m;
  const H       = aGround - pGround;          // excavation height
  const factors = state.designControl.factors[combo] || PRESETS[combo];

  // 1. Apparent earth pressure envelope peak (Terzaghi-Peck, used to size props)
  const dominantSoil = soilAtLevel(state.activeSoils, (aGround + pGround) / 2);
  let envelopePeak = 0;
  if (dominantSoil) {
    if (dominantSoil.type === 'undrained') {
      const cu_d = dominantSoil.cu / (factors.gCu || 1);
      const m    = (dominantSoil.gamma * H > 0) ? 4 * cu_d / (dominantSoil.gamma * H) : 1;
      envelopePeak = dominantSoil.gamma * H * Math.max(0.3, 1 - m);
    } else {
      const tphi  = Math.tan(dominantSoil.phi * Math.PI / 180) / (factors.gPhi || 1);
      const phi_d = Math.atan(tphi) * 180 / Math.PI;
      const delta = phi_d * (dominantSoil.delta_active ?? 0.667);
      const Ka    = coulombKa(phi_d, delta);
      envelopePeak = 0.65 * Ka * dominantSoil.gamma * H;
    }
  }

  // 2. Solve embedment as a single-prop sub-problem with the lowest prop only
  const sortedProps = [...state.props].sort((a, b) => b.level_m - a.level_m);   // top first
  const propLevels  = sortedProps.map(p => p.level_m);
  const lowestProp  = propLevels[propLevels.length - 1];
  const subState    = {
    ...state,
    props: [{ id:'mp-bottom', level_m: lowestProp, stiffness:'rigid', type:'permanent' }],
    wall:  { ...state.wall, type: 'singleprop' }
  };
  const subRes      = solveSingleProp(subState, combo);
  const d_required  = subRes.d_required_m;
  const d_design    = d_required * (state.designControl.embedmentSafetyFactor || 1.20);

  // 3. Build the canonical pressure profile at the chosen calc length
  const useDesignLen = state.designControl.bmdAtDesignLength !== false;
  const d_calc       = useDesignLen ? d_design : d_required;
  const calcLength   = (wallTop - pGround) + d_calc;
  const calcState    = { ...state, wall: { ...state.wall, length_m: calcLength } };
  const profile      = buildPressureProfile(calcState, combo);

  // 4. Distribute the envelope load to props by tributary area
  const propForces = propLevels.map((lvl, i) => {
    const above = i === 0 ? aGround : (propLevels[i-1] + lvl) / 2;
    const below = i === propLevels.length - 1 ? pGround : (lvl + propLevels[i+1]) / 2;
    return envelopePeak * (above - below);
  });

  // 5. Integrate SF + BM. Use envelope load above dredge (matches the source of
  // the prop forces) and LE pressure below dredge (captures the embedment
  // passive resistance). With this mixed loading + envelope-tributary props,
  // ΣH balances above dredge so SF closes to zero at the dredge level after all
  // props apply, then accumulates again below dredge with the LE pressure.
  // A small linear correction zeroes out residual ΣH at the toe (from
  // envelope/LE methodology mismatch + over-embedment over-mobilising passive).
  const n  = profile.z.length;
  const SF = new Array(n).fill(0);
  const BM = new Array(n).fill(0);
  const applied = new Array(propLevels.length).fill(false);

  function loadAtIndex(i) {
    const lvl = profile.levels[i];
    if (lvl <= aGround && lvl >= pGround) return envelopePeak;   // above dredge: envelope
    if (lvl < pGround) return profile.net[i];                     // below dredge: LE pressure
    return 0;                                                      // above active GL: free
  }

  for (let i = 1; i < n; i++) {
    const dz       = profile.z[i] - profile.z[i-1];
    const lvl_bot  = wallTop - profile.z[i];
    SF[i] = SF[i-1] + 0.5 * (loadAtIndex(i) + loadAtIndex(i-1)) * dz;
    for (let j = 0; j < propLevels.length; j++) {
      if (!applied[j] && lvl_bot <= propLevels[j]) {
        SF[i] -= propForces[j];
        applied[j] = true;
      }
    }
  }
  // Close SF at toe (linear correction along wall). Magnitude of correction is
  // small if the FES sub-problem found a sensible d_required; gets larger when
  // the wall is over-embedded (BMD-at-d_design mode) since LE passive is over-
  // mobilised in the integration.
  const SFclose = SF[n-1];
  for (let i = 0; i < n; i++) SF[i] -= SFclose * (profile.z[i] / profile.z[n-1]);

  for (let i = 1; i < n; i++) {
    const dz = profile.z[i] - profile.z[i-1];
    BM[i] = BM[i-1] + 0.5 * (SF[i] + SF[i-1]) * dz;
  }
  // Close BM at toe to 0 (residual from numerical integration)
  const Mclose = BM[n-1];
  for (let i = 0; i < n; i++) BM[i] -= Mclose * (profile.z[i] / profile.z[n-1]);

  const EI   = flexuralStiffness_kNm2_per_m(state.wall.sectionId);
  const defl = deflectionByDoubleIntegration(profile.z, BM, EI, { topFree: true, toeClamped: false });

  const userEmbedment = state.wall.length_m - (wallTop - pGround);
  return {
    combo,
    wallType: 'multiprop',
    d_required_m: d_required,
    d_design_m:   d_design,
    user_embedment_m: userEmbedment,
    propForces_kN_per_m: propForces,
    envelopePeak_kPa:    envelopePeak,
    levels:    profile.levels,
    z:         profile.z,
    pActive:   profile.sigmaA,
    pPassive:  profile.sigmaP,
    pNet:      profile.net,
    SFD:       SF,
    BMD:       BM,
    deflection_mm: defl.map(d => d * 1000),
    M_max_kNm_per_m:    Math.max(...BM.map(Math.abs)),
    V_max_kN_per_m:     Math.max(...SF.map(Math.abs)),
    deflection_max_mm:  Math.max(...defl.map(d => Math.abs(d))) * 1000,
    status:             subRes.convergenceFailed
                          ? 'NON-CONVERGENT'
                          : (userEmbedment >= d_design ? 'OK' : 'EMBEDMENT INSUFFICIENT'),
    convergenceFailed:  subRes.convergenceFailed
  };
}

// ─── Deflection by double integration of M/EI ────────────────────────────────

function deflectionByDoubleIntegration(z, M, EI, opts) {
  if (!EI || EI <= 0) return z.map(_ => 0);
  const n = z.length;
  // First integration: rotation θ(z) = ∫₀^z M/EI dz
  const theta = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const dz = z[i] - z[i-1];
    theta[i] = theta[i-1] + 0.5 * (M[i] + M[i-1]) / EI * dz;
  }
  // Second integration: y(z) = ∫₀^z θ dz
  const y = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const dz = z[i] - z[i-1];
    y[i] = y[i-1] + 0.5 * (theta[i] + theta[i-1]) * dz;
  }
  // Apply boundary conditions:
  if (opts.toeClamped) {
    // y(toe) = 0 and θ(toe) = 0  → apply linear correction on y, drop θ correction (single integral with rotation reset)
    const yToe = y[n-1];
    for (let i = 0; i < n; i++) y[i] -= yToe;
  } else if (opts.propLevel_z !== undefined) {
    // y(prop) = 0 and y(toe) = 0
    const z_prop = opts.propLevel_z;
    const zT     = z[n-1];
    // Find prop index
    let pIdx = 0;
    while (pIdx < n - 1 && z[pIdx] < z_prop) pIdx++;
    const yp = y[pIdx];
    const yT = y[n-1];
    // Subtract a linear function so y(prop) = 0 and y(toe) = 0 (interpolation through both endpoints)
    for (let i = 0; i < n; i++) {
      // Two-point linear correction over (z_prop, zT)
      const t = (z[i] - z_prop) / (zT - z_prop);
      const correction = yp + t * (yT - yp);
      y[i] -= correction;
    }
  } else {
    // Cantilever/fallback: just zero at toe
    const yToe = y[n-1];
    for (let i = 0; i < n; i++) y[i] -= yToe * (z[i] / z[n-1]);
  }
  return y;
}
