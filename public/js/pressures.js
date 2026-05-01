'use strict';
// Earth pressure profile builder.
// Sign convention used throughout:
//   z      = depth below the wall top, positive downwards (m)
//   side   = 'active' / 'passive'
//   σ'_h   = effective horizontal stress on the wall from that side (kPa)
//   u      = pore water pressure on that side (kPa)
//   σ_h    = σ'_h + u  =  total horizontal stress on the wall from that side
//   net    = σ_h_active − σ_h_passive  (positive ≡ wall pushed towards passive)

const GAMMA_W = 9.81;        // kN/m³, water unit weight

// ─── Coulomb / Rankine earth pressure coefficients ───────────────────────────

function coulombKa(phi_deg, delta_deg) {
  if (phi_deg <= 0) return 1;
  const phi = phi_deg * Math.PI / 180;
  const dlt = delta_deg * Math.PI / 180;
  const num = Math.cos(phi) ** 2;
  const inner = Math.sin(phi + dlt) * Math.sin(phi) / Math.cos(dlt);
  if (inner < 0) return Math.cos(phi) ** 2 / Math.cos(dlt);   // δ too large; fallback
  const den = Math.cos(dlt) * (1 + Math.sqrt(inner)) ** 2;
  return num / den;
}

// Earth pressure + cohesion coefficients for a soil layer, returned as a single
// object suitable for read-only display on the soil card.
//   Drained:  Ka, Kp via Coulomb;  Kac = 2·√Ka,  Kpc = 2·√Kp  (cohesion factors)
//   Undrained: Ka = Kp = 1, Kac = Kpc = 2 (matches σh = σv ± 2cu form)
function earthPressureCoefficients(layer) {
  if (!layer) return null;
  if (layer.type === 'undrained') {
    return { Ka: 1, Kp: 1, Kac: 2, Kpc: 2, delta_a_deg: 0, delta_p_deg: 0 };
  }
  const phi = layer.phi || 0;
  const delta_a = phi * (layer.delta_active  ?? 0.667);
  const delta_p = phi * (layer.delta_passive ?? 0.5);
  const Ka = coulombKa(phi, delta_a);
  const Kp = coulombKp(phi, delta_p);
  return {
    Ka, Kp,
    Kac: 2 * Math.sqrt(Ka),
    Kpc: 2 * Math.sqrt(Kp),
    delta_a_deg: delta_a,
    delta_p_deg: delta_p
  };
}

function coulombKp(phi_deg, delta_deg) {
  if (phi_deg <= 0) return 1;
  const phi = phi_deg * Math.PI / 180;
  const dlt = delta_deg * Math.PI / 180;
  const num = Math.cos(phi) ** 2;
  const inner = Math.sin(phi + dlt) * Math.sin(phi) / Math.cos(dlt);
  if (inner < 0) return Math.cos(phi) ** 2 / Math.cos(dlt);
  const den = Math.cos(dlt) * (1 - Math.sqrt(inner)) ** 2;
  return num / den;
}

// ─── Soil at depth (returns the layer governing depth z relative to ground) ──

function soilAtLevel(layers, level_m) {
  // layers sorted by topLevel descending (top first)
  const sorted = [...layers].sort((a, b) => b.topLevel_m - a.topLevel_m);
  let here = sorted[0];
  for (const s of sorted) {
    if (level_m <= s.topLevel_m + 1e-6) here = s;   // we're below this layer top → use it
  }
  return here;
}

// ─── Effective vertical stress integrator ────────────────────────────────────
// Returns σ'_v at the given level (m, downward depth measured from groundLevel).
// Walks down through layers (sorted top-first) and integrates effective γ.
function sigmaVertEffective(level_m, groundLevel_m, layers, waterLevel_m) {
  if (level_m >= groundLevel_m) return 0;     // above ground
  const sorted = [...layers].sort((a, b) => b.topLevel_m - a.topLevel_m);
  let z = groundLevel_m;          // current "running level" descending
  let sv = 0;                     // running σ'_v
  for (let i = 0; i < sorted.length; i++) {
    const layer  = sorted[i];
    const top    = Math.min(z, layer.topLevel_m);
    const bottom = (i === sorted.length - 1) ? level_m : Math.max(level_m, sorted[i + 1].topLevel_m);
    if (bottom >= top) continue;                  // empty slice
    const layerTop    = Math.min(top, level_m + (layer.topLevel_m - level_m));   // really just `top`
    const sliceTop    = top;
    const sliceBottom = Math.max(bottom, level_m);
    const t           = sliceTop - sliceBottom;   // positive thickness
    if (t <= 0) continue;

    // Integrate γ' over this slice — split at water level if needed
    let aboveWater = 0, belowWater = 0;
    if (waterLevel_m >= sliceTop) {
      aboveWater = 0;          // entire slice below water
      belowWater = t;
    } else if (waterLevel_m <= sliceBottom) {
      aboveWater = t;          // entire slice above water
      belowWater = 0;
    } else {
      aboveWater = sliceTop - waterLevel_m;
      belowWater = waterLevel_m - sliceBottom;
    }
    sv += aboveWater * layer.gamma + belowWater * (layer.gamma_sat - GAMMA_W);
    z = sliceBottom;
    if (z <= level_m + 1e-9) break;
  }
  return sv;
}

function porePressure(level_m, waterLevel_m) {
  if (level_m >= waterLevel_m) return 0;
  return GAMMA_W * (waterLevel_m - level_m);
}

// ─── Active / passive horizontal stress at a level ───────────────────────────

function effectiveHorizActive(layer, sigma_v_eff, factors) {
  if (layer.type === 'undrained') {
    const cu = layer.cu / (factors.gCu || 1);
    return Math.max(0, sigma_v_eff - 2 * cu);
  } else {
    const tanPhi = Math.tan(layer.phi * Math.PI / 180) / (factors.gPhi || 1);
    const phi_d  = Math.atan(tanPhi) * 180 / Math.PI;
    const delta  = phi_d * (layer.delta_active ?? 0.667);
    const Ka     = coulombKa(phi_d, delta);
    const c_d    = layer.c_eff / (factors.gCeff || 1);
    return Math.max(0, Ka * sigma_v_eff - 2 * c_d * Math.sqrt(Ka));
  }
}

function effectiveHorizPassive(layer, sigma_v_eff, factors) {
  if (layer.type === 'undrained') {
    const cu = layer.cu / (factors.gCu || 1);
    return Math.max(0, sigma_v_eff + 2 * cu);
  } else {
    const tanPhi = Math.tan(layer.phi * Math.PI / 180) / (factors.gPhi || 1);
    const phi_d  = Math.atan(tanPhi) * 180 / Math.PI;
    const delta  = phi_d * (layer.delta_passive ?? 0.5);
    const Kp     = coulombKp(phi_d, delta);
    const c_d    = layer.c_eff / (factors.gCeff || 1);
    return Math.max(0, Kp * sigma_v_eff + 2 * c_d * Math.sqrt(Kp));
  }
}

// ─── Surcharge contributions ────────────────────────────────────────────────

// Uniform: adds q to σ'_v at the depth below the loaded surface.
//   For drained: extra σ'_h = Ka · q   (added at every depth)
//   For undrained: extra σ_h = q  (no factoring by Ka because Ka = 1 for φ=0)
//   This is handled elsewhere by adding q to σ'_v BEFORE calling effectiveHoriz*().
function uniformSurchargeAt(level_m, side, surcharges, groundLevel_m) {
  if (level_m >= groundLevel_m) return 0;
  let q = 0;
  for (const sc of surcharges) {
    if (sc.kind !== 'uniform') continue;
    if (sc.side !== side) continue;
    q += sc.q;
  }
  return q;
}

// Boussinesq strip load (adds horizontal stress directly).
//  Δσ_h(z) = (2 q / π) [ β − sin β · cos 2α ]
//  with β = angle subtended by the strip at depth z, α = angle to centre.
// `offset` = horizontal distance from wall to near edge of strip (m)
// `width`  = strip width (m)
// `z`      = depth below ground level on the side carrying the strip
function boussinesqStripAt(level_m, side, surcharges, groundLevel_m) {
  const z = groundLevel_m - level_m;       // depth below ground on this side
  if (z <= 0) return 0;
  let dsh = 0;
  for (const sc of surcharges) {
    if (sc.kind !== 'strip') continue;
    if (sc.side !== side) continue;
    const a    = Math.max(0, sc.offset || 0);
    const b    = Math.max(0, sc.width  || 0);
    if (b <= 0) continue;
    const x1   = a;
    const x2   = a + b;
    const t1   = Math.atan2(x2, z);
    const t2   = Math.atan2(x1, z);
    const beta = t1 - t2;
    const alpha = (t1 + t2) / 2;
    dsh += (2 * sc.q / Math.PI) * (beta - Math.sin(beta) * Math.cos(2 * alpha));
  }
  return Math.max(0, dsh);
}

// ─── Build full pressure profile ────────────────────────────────────────────

function buildPressureProfile(state, combinationKey) {
  const g       = state.geometry;
  const factors = state.designControl.factors[combinationKey] || PRESETS[combinationKey];
  const dz      = 0.05;     // 5 cm step is plenty for design accuracy
  const wallTop = g.wallTopLevel_m;
  const wallBot = wallTop - state.wall.length_m;     // bottom level (m, AOD-style)

  const profile = {
    levels: [],          // m, AOD-like elevation, descending
    z:      [],          // m, depth below wall top
    sigmaA: [],          // total σ_h on the active side (kPa)
    sigmaP: [],          // total σ_h on the passive side (kPa)
    net:    []           // σ_a - σ_p (kPa)
  };

  // Pre-factor surcharges
  const factoredSurcharges = state.surcharges.map(sc => factorSurcharge(sc, factors));

  for (let level = wallTop; level >= wallBot - 1e-9; level -= dz) {
    // ── Active side
    const aGround = g.activeGroundLevel_m;
    let sigmaA = 0;
    if (level <= aGround) {
      const aLayer  = soilAtLevel(state.activeSoils, level);
      const aWater  = g.activeWaterLevel_m;
      const sv_eff  = sigmaVertEffective(level, aGround, state.activeSoils, aWater)
                      + uniformSurchargeAt(level, 'active', factoredSurcharges, aGround);
      const sigmaH_eff = aLayer ? effectiveHorizActive(aLayer, sv_eff, factors) : 0;
      const u          = porePressure(level, aWater);
      const stripDsh   = boussinesqStripAt(level, 'active', factoredSurcharges, aGround);
      sigmaA = sigmaH_eff + u + stripDsh;
    }

    // ── Passive side
    const pGround = g.passiveGroundLevel_m;
    let sigmaP = 0;
    if (level <= pGround) {
      const pLayer = soilAtLevel(state.passiveSoils, level);
      const pWater = g.passiveWaterLevel_m;
      const sv_eff = sigmaVertEffective(level, pGround, state.passiveSoils, pWater)
                     + uniformSurchargeAt(level, 'passive', factoredSurcharges, pGround);
      const sigmaH_eff = pLayer ? effectiveHorizPassive(pLayer, sv_eff, factors) : 0;
      const u          = porePressure(level, pWater);
      const passDivisor = state.designControl.mode === 'TRAD'
        ? (state.designControl.globalFoS_passive || 1)
        : (factors.gRe || 1);
      sigmaP = (sigmaH_eff / passDivisor) + u;
    }

    profile.levels.push(level);
    profile.z.push(wallTop - level);
    profile.sigmaA.push(sigmaA);
    profile.sigmaP.push(sigmaP);
    profile.net.push(sigmaA - sigmaP);
  }
  return profile;
}
