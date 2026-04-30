'use strict';
// Rotational (overall) stability — Bishop simplified circular slip analysis.
// Coordinate system: x horizontal (positive towards passive side, wall at x = 0);
//                    y vertical (positive upwards, matching the level convention used elsewhere).
//
// Active soils sit on the LEFT  (x ≤ 0), passive soils on the RIGHT (x ≥ 0).
// Active ground level y = state.geometry.activeGroundLevel_m.
// Passive ground level y = state.geometry.passiveGroundLevel_m.
// Wall toe   y = wallTop − wall.length_m.

function runStabilityCheck(state, combo) {
  const factors = state.designControl.factors[combo] || PRESETS[combo];
  const opts    = state.rotational;
  const grid    = opts.gridExtents;
  const radii   = opts.radiusRange;
  const wallTop = state.geometry.wallTopLevel_m;
  const wallToe = wallTop - state.wall.length_m;

  let best = { FoS: Infinity, cx: null, cy: null, r: null, slices: [] };
  for (let cx = grid.xMin; cx <= grid.xMax + 1e-9; cx += grid.step) {
    for (let cy = grid.yMin; cy <= grid.yMax + 1e-9; cy += grid.step) {
      for (let r = radii.rMin; r <= radii.rMax + 1e-9; r += radii.step) {
        const result = bishopForCircle(state, factors, cx, cy, r, opts.includeWallShear, wallToe);
        if (!result) continue;
        if (result.FoS < best.FoS) {
          best = { FoS: result.FoS, cx, cy, r, slices: result.slices };
        }
      }
    }
  }
  AppState.lastStabilityResult = best;
  return best;
}

function bishopForCircle(state, factors, cx, cy, r, includeWall, wallToe) {
  const aGround = state.geometry.activeGroundLevel_m;
  const pGround = state.geometry.passiveGroundLevel_m;
  const aWater  = state.geometry.activeWaterLevel_m;
  const pWater  = state.geometry.passiveWaterLevel_m;

  // Constraint: circle must dip BELOW passive ground (otherwise it's a near-surface failure already covered)
  if (cy - r >= pGround) return null;
  // Constraint: circle must reach above the active ground surface (entry point exists)
  if (cy - r >= aGround) return null;

  // Find x-range where slip surface lies below ground.
  // Slip surface (lower hemisphere): y = cy - sqrt(r² - (x - cx)²)
  // For ground varying with x (step at x=0), find x_left where y_slip = y_ground (active),
  // and x_right where y_slip = y_ground (passive).
  // Discriminant: y_slip ≤ y_ground  →  sqrt(r² - (x - cx)²) ≥ cy - y_ground
  //   → (x - cx)² ≤ r² - (cy - y_ground)²

  const dxA = (cy - aGround) <= r ? Math.sqrt(r * r - (cy - aGround) ** 2) : 0;
  const dxP = (cy - pGround) <= r ? Math.sqrt(r * r - (cy - pGround) ** 2) : 0;

  let xLeft  = cx - dxA;
  let xRight = cx + dxP;
  // For the right end use passive ground; for left end use active ground
  // But the ground surface is split at x=0:
  //   x < 0  →  ground = aGround
  //   x ≥ 0  →  ground = pGround
  // So xLeft must satisfy y_slip(xLeft) = aGround (and xLeft < 0)
  //                 xRight     y_slip(xRight) = pGround (and xRight > 0)
  // If xLeft > 0 or xRight < 0 the circle does not span the wall — skip.
  if (xLeft >= 0 || xRight <= 0) return null;

  const sliceWidth = 0.4;             // m
  const nSlices = Math.max(8, Math.ceil((xRight - xLeft) / sliceWidth));
  const dx = (xRight - xLeft) / nSlices;

  // Build slice data
  const slices = [];
  for (let i = 0; i < nSlices; i++) {
    const xL  = xLeft + i * dx;
    const xR  = xL + dx;
    const xMid = (xL + xR) / 2;

    const yGroundL = xL  < 0 ? aGround : pGround;
    const yGroundR = xR  < 0 ? aGround : pGround;
    const yGroundM = xMid < 0 ? aGround : pGround;

    const inside = r * r - (xMid - cx) ** 2;
    if (inside <= 0) continue;
    const ySlipM = cy - Math.sqrt(inside);
    const insideL = r * r - (xL - cx) ** 2;
    const insideR = r * r - (xR - cx) ** 2;
    if (insideL <= 0 || insideR <= 0) continue;
    const ySlipL = cy - Math.sqrt(insideL);
    const ySlipR = cy - Math.sqrt(insideR);

    const h = yGroundM - ySlipM;
    if (h <= 0) continue;

    const alpha = Math.atan2(ySlipR - ySlipL, dx);   // base angle, +ve when surface dips toward +x

    // Soil at slice base: pick side and find layer at ySlipM
    const sideLayers = xMid < 0 ? state.activeSoils : state.passiveSoils;
    const layer = soilAtLevel(sideLayers, ySlipM);
    if (!layer) continue;

    // Weight (using soil's unit weight; γ_sat below water)
    // Water level varies by side
    const waterLvl = xMid < 0 ? aWater : pWater;
    const yWater = Math.min(yGroundM, waterLvl);

    let aboveWater = 0, belowWater = 0;
    if (ySlipM >= yWater) {
      aboveWater = h;
    } else if (yGroundM <= yWater) {
      belowWater = h;
    } else {
      aboveWater = yGroundM - yWater;
      belowWater = yWater - ySlipM;
    }
    // Use bulk γ above WT, γ_sat below WT (representative of slice average)
    const W = (aboveWater * layer.gamma + belowWater * layer.gamma_sat) * dx;       // kN/m of wall

    // Pore pressure at slice base
    const u = ySlipM < yWater ? GAMMA_W * (yWater - ySlipM) : 0;

    // Effective base length
    const b = dx;
    const bL = b / Math.cos(alpha);

    slices.push({ xMid, ySlipM, h, alpha, W, u, layer, b, bL, side: xMid < 0 ? 'a' : 'p' });
  }
  if (slices.length < 4) return null;

  // Iterative Bishop FoS
  let FoS = 1.0;
  for (let iter = 0; iter < 30; iter++) {
    let num = 0, den = 0;
    for (const s of slices) {
      let cd, tanPhi_d;
      if (s.layer.type === 'undrained') {
        const cu = s.layer.cu / (factors.gCu || 1);
        cd = cu;
        tanPhi_d = 0;
      } else {
        cd = s.layer.c_eff / (factors.gCeff || 1);
        const tphi = Math.tan(s.layer.phi * Math.PI / 180) / (factors.gPhi || 1);
        tanPhi_d = tphi;
      }
      const m_alpha = Math.cos(s.alpha) + (Math.sin(s.alpha) * tanPhi_d) / FoS;
      if (m_alpha < 0.01) return null;            // unrealistic geometry
      const numerator = (cd * s.b + Math.max(0, s.W - s.u * s.b) * tanPhi_d) / m_alpha;
      num += numerator;
      den += s.W * Math.sin(s.alpha);
    }
    if (Math.abs(den) < 0.01) return null;

    // Wall contribution
    let M_wall = 0;
    if (includeWall) {
      const insideAtWall = r * r - (0 - cx) ** 2;
      if (insideAtWall > 0) {
        const yIntersect = cy - Math.sqrt(insideAtWall);    // where slip surface meets the wall
        if (yIntersect > wallToe) {
          // Slip cuts the wall above the toe — wall provides a horizontal shear V_pl
          const V_wall = shearResistance_kN_per_m(state.wall.sectionId, state.wall.steelGrade, factors.gM0 || 1);
          // Moment about circle centre: lever = horizontal distance from centre to wall x=0
          M_wall = V_wall * Math.abs(cx);
        }
      }
    }

    const FoS_new = (num * r + M_wall) / (den * r);
    if (Math.abs(FoS_new - FoS) < 0.001) { FoS = FoS_new; break; }
    FoS = FoS_new;
  }
  if (!isFinite(FoS) || FoS <= 0) return null;
  return { FoS, slices };
}
