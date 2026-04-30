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
  if (d_required === null) d_required = maxD;     // didn't converge — wall would need >25 m embedment

  const embFactor   = state.designControl.embedmentSafetyFactor || 1.20;
  const d_design    = d_required * embFactor;
  // Build the canonical design profile at d_required (the point where passive is just
  // fully mobilised). d_design is reported to the user; the BMD/SFD use d_required.
  const calcLength  = (wallTop - pGround) + d_required;
  const calcState   = { ...state, wall: { ...state.wall, length_m: calcLength } };
  const profile     = buildPressureProfile(calcState, combo);

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
    status:             userEmbedment >= d_design ? 'OK' : 'EMBEDMENT INSUFFICIENT'
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
  // The toe should have V=0 in equilibrium. Apply a corrective point load R at the toe.
  const R_toe = V[n-1];
  // Recompute V with toe correction: V*(z) = V(z) for z < toe, V(toe⁺) = V(toe) - R_toe = 0
  // BMD: M(z) = ∫₀^z V dz, with M(toe) closing to 0
  for (let i = 1; i < n; i++) {
    const dz = profile.z[i] - profile.z[i-1];
    M[i] = M[i-1] + 0.5 * (V[i] + V[i-1]) * dz;
  }
  // Close M at toe to 0 by linear correction (small numerical drift)
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
  if (d_required === null) d_required = 25;

  const embFactor   = state.designControl.embedmentSafetyFactor || 1.20;
  const d_design    = d_required * embFactor;
  // BMD/SFD/F_prop computed at d_required (where passive is mobilised to balance the
  // active about the prop). d_design is reported as the recommended pile length.
  const calcLength  = (wallTop - pGround) + d_required;
  const calcState   = { ...state, wall: { ...state.wall, length_m: calcLength } };
  const profile     = buildPressureProfile(calcState, combo);

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
    status:             userEmbedment >= d_design ? 'OK' : 'EMBEDMENT INSUFFICIENT'
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
  const profile = buildPressureProfile(state, combo);
  const wallTop = state.geometry.wallTopLevel_m;
  const aGround = state.geometry.activeGroundLevel_m;
  const pGround = state.geometry.passiveGroundLevel_m;
  const H       = aGround - pGround;          // excavation height

  // Terzaghi-Peck envelope for active side. Pick by dominant active soil type:
  const dominantSoil = soilAtLevel(state.activeSoils, (aGround + pGround) / 2);
  const factors      = state.designControl.factors[combo];
  const fSoil        = factorSoil(dominantSoil, factors);
  let envelopePeak;
  if (fSoil.type === 'undrained') {
    // Soft to medium clay: σ = γH × (1 - 4cu/(γH))   bounded ≥ 0.3γH
    const m = 4 * fSoil.cu / (fSoil.gamma * H);
    envelopePeak = fSoil.gamma * H * Math.max(0.3, 1 - m);
  } else {
    // Sand: σ = 0.65 × Ka × γ × H
    const phi_d = fSoil.phi;
    const delta = phi_d * (fSoil.delta_active ?? 0.667);
    const Ka    = coulombKa(phi_d, delta);
    envelopePeak = 0.65 * Ka * fSoil.gamma * H;
  }

  // Build envelope load along the wall (rectangular profile from aGround to pGround)
  const props = [...state.props].sort((a, b) => b.level_m - a.level_m);   // top first
  const propLevels = props.map(p => p.level_m);

  // Tributary load on each prop: each prop carries the envelope between half-distances to neighbours.
  const propForces = propLevels.map((lvl, i) => {
    const above = i === 0 ? aGround : (propLevels[i-1] + lvl) / 2;
    const below = i === propLevels.length - 1 ? pGround : (lvl + propLevels[i+1]) / 2;
    const tribH = above - below;                     // metres of wall the prop carries
    return envelopePeak * tribH;                     // kN/m
  });

  // BMD between props (continuous beam approximation: M_max ≈ w·L²/10)
  // Embedment below lowest prop = single-prop FES sub-problem
  const lowestProp = propLevels[propLevels.length - 1];
  const trial   = { ...state, props: [{ level_m: lowestProp }], wall: { ...state.wall, type: 'singleprop' } };
  const subRes  = solveSingleProp(trial, combo);

  // For BMD on the propped portion, use envelope
  const n = profile.z.length;
  const SF = new Array(n).fill(0);
  const BM = new Array(n).fill(0);
  let pIdx = 0;
  for (let i = 1; i < n; i++) {
    const dz = profile.z[i] - profile.z[i-1];
    const lvl = wallTop - profile.z[i];
    const w_envelope = (lvl <= aGround && lvl >= pGround) ? envelopePeak : 0;
    SF[i] = SF[i-1] + 0.5 * (w_envelope + (lvl <= aGround && lvl >= pGround ? envelopePeak : 0)) * dz;
    // Apply prop reactions when crossing prop level (top to bottom)
    while (pIdx < propLevels.length && lvl <= propLevels[pIdx]) {
      SF[i] -= propForces[pIdx];
      pIdx++;
    }
    BM[i] = BM[i-1] + 0.5 * (SF[i] + SF[i-1]) * dz;
  }
  // Below lowest prop, blend in solver result
  for (let i = 0; i < n; i++) {
    const lvl = wallTop - profile.z[i];
    if (lvl < lowestProp) BM[i] = subRes.BMD[i];
  }

  const EI = flexuralStiffness_kNm2_per_m(state.wall.sectionId);
  const defl = deflectionByDoubleIntegration(profile.z, BM, EI, { topFree: true, toeClamped: false });

  return {
    combo,
    wallType: 'multiprop',
    d_required_m: subRes.d_required_m,
    d_design_m:   subRes.d_design_m,
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
    status:             subRes.status
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
