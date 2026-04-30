'use strict';
// SVG cross-section diagram with view switcher.
//
// Coordinate system:
//  - real-world y in metres, positive upwards
//  - real-world x = 0 at wall centreline, positive towards passive side
//  - SVG: top-left origin; y increases downwards. Diagram fits a viewBox.

const SVG_W = 1000;
const SVG_H = 720;
const PAD_TOP = 40;
const PAD_BOT = 60;
const PAD_LR  = 40;

function setActiveView(view) {
  AppState.view = view;
  document.querySelectorAll('.view-tab').forEach(t => t.classList.toggle('active', t.dataset.view === view));
  refreshDiagram();
}

function refreshDiagram() {
  const host = document.getElementById('sectionDiagram');
  if (!host) return;
  host.innerHTML = renderDiagramSVG(AppState);
}

function renderDiagramSVG(state) {
  const g = state.geometry;
  const wallTop = g.wallTopLevel_m;
  const wallToe = wallTop - state.wall.length_m;

  // Real-world extents
  const yMax = Math.max(wallTop, g.activeGroundLevel_m, g.passiveGroundLevel_m) + 1.5;
  const yMin = Math.min(wallToe, g.passiveGroundLevel_m - 1.5);
  const yReal = yMax - yMin;
  const xReal = 16;                                  // total horizontal extent in metres (-8 to +8)
  const xLeft  = -xReal / 2;
  const xRight =  xReal / 2;
  const sx = (SVG_W - 2 * PAD_LR) / xReal;
  const sy = (SVG_H - PAD_TOP - PAD_BOT) / yReal;
  const xWall = SVG_W / 2;

  const X = (xr) => PAD_LR + (xr - xLeft) * sx;
  const Y = (yr) => SVG_H - PAD_BOT - (yr - yMin) * sy;

  let svg = `<svg viewBox="0 0 ${SVG_W} ${SVG_H}" xmlns="http://www.w3.org/2000/svg" class="cross-section-svg">`;

  svg += `<defs>
    <pattern id="hatchDrained"   patternUnits="userSpaceOnUse" width="6" height="6"  patternTransform="rotate(45)"><rect width="6"  height="6"  fill="#e8d8b0"/><line x1="0" y1="0" x2="0" y2="6" stroke="#a08056" stroke-width="0.7"/></pattern>
    <pattern id="hatchUndrained" patternUnits="userSpaceOnUse" width="8" height="8"  patternTransform="rotate(0)"><rect width="8"  height="8"  fill="#c9d6c0"/><circle cx="4" cy="4" r="0.8" fill="#5a7350"/></pattern>
    <pattern id="hatchWater"     patternUnits="userSpaceOnUse" width="14" height="6"><rect width="14" height="6" fill="#cce0f5" opacity="0.55"/><path d="M0 3 Q3.5 0 7 3 T14 3" stroke="#3974b8" stroke-width="0.6" fill="none"/></pattern>
  </defs>`;

  // ── Air / sky background ─────────────────────────────────────────────────
  svg += `<rect x="0" y="0" width="${SVG_W}" height="${SVG_H}" fill="#f7f5f3"/>`;

  // ── Soils (active = left, passive = right) ───────────────────────────────
  svg += renderSoilSide(state.activeSoils,  g.activeGroundLevel_m,  X(xLeft), X(0), Y, yMin);
  svg += renderSoilSide(state.passiveSoils, g.passiveGroundLevel_m, X(0),     X(xRight), Y, yMin);

  // ── Water levels ─────────────────────────────────────────────────────────
  svg += `<rect x="${X(xLeft)}" y="${Y(g.activeWaterLevel_m)}" width="${X(0) - X(xLeft)}" height="${Y(yMin) - Y(g.activeWaterLevel_m)}" fill="url(#hatchWater)" pointer-events="none"/>`;
  svg += `<line x1="${X(xLeft)}" y1="${Y(g.activeWaterLevel_m)}" x2="${X(0)}" y2="${Y(g.activeWaterLevel_m)}" stroke="#1f5fa5" stroke-width="1.2" stroke-dasharray="6,3"/>`;
  svg += `<text x="${X(xLeft) + 6}" y="${Y(g.activeWaterLevel_m) - 4}" font-size="10" fill="#1f5fa5">WL ${g.activeWaterLevel_m.toFixed(2)} m</text>`;

  svg += `<rect x="${X(0)}" y="${Y(g.passiveWaterLevel_m)}" width="${X(xRight) - X(0)}" height="${Y(yMin) - Y(g.passiveWaterLevel_m)}" fill="url(#hatchWater)" pointer-events="none"/>`;
  svg += `<line x1="${X(0)}" y1="${Y(g.passiveWaterLevel_m)}" x2="${X(xRight)}" y2="${Y(g.passiveWaterLevel_m)}" stroke="#1f5fa5" stroke-width="1.2" stroke-dasharray="6,3"/>`;
  svg += `<text x="${X(xRight) - 80}" y="${Y(g.passiveWaterLevel_m) - 4}" font-size="10" fill="#1f5fa5">WL ${g.passiveWaterLevel_m.toFixed(2)} m</text>`;

  // ── Ground surfaces ──────────────────────────────────────────────────────
  svg += `<line x1="${X(xLeft)}" y1="${Y(g.activeGroundLevel_m)}" x2="${X(0)}"   y2="${Y(g.activeGroundLevel_m)}" stroke="#5a3a1a" stroke-width="2"/>`;
  svg += `<line x1="${X(0)}"     y1="${Y(g.passiveGroundLevel_m)}" x2="${X(xRight)}" y2="${Y(g.passiveGroundLevel_m)}" stroke="#5a3a1a" stroke-width="2"/>`;
  svg += `<text x="${X(xLeft) + 6}" y="${Y(g.activeGroundLevel_m) - 6}" font-size="10" fill="#5a3a1a" font-weight="600">Active GL ${g.activeGroundLevel_m.toFixed(2)} m</text>`;
  svg += `<text x="${X(xRight) - 110}" y="${Y(g.passiveGroundLevel_m) - 6}" font-size="10" fill="#5a3a1a" font-weight="600">Passive GL ${g.passiveGroundLevel_m.toFixed(2)} m</text>`;

  // ── Surcharges (uniform arrows, strip rectangles) ────────────────────────
  for (const sc of state.surcharges) {
    const groundY = sc.side === 'active' ? Y(g.activeGroundLevel_m) : Y(g.passiveGroundLevel_m);
    const xStart  = sc.side === 'active' ? X(xLeft) + 4 : X(0) + 4;
    const xEnd    = sc.side === 'active' ? X(0) - 4    : X(xRight) - 4;
    if (sc.kind === 'uniform') {
      const arrowY = groundY - 22;
      for (let xx = xStart + 10; xx < xEnd; xx += 24) {
        svg += `<path d="M${xx} ${arrowY} L${xx} ${groundY - 2} M${xx-3} ${groundY-7} L${xx} ${groundY-2} L${xx+3} ${groundY-7}" stroke="#B22234" stroke-width="1.2" fill="none"/>`;
      }
      svg += `<text x="${(xStart + xEnd)/2}" y="${arrowY - 4}" text-anchor="middle" font-size="10" fill="#B22234" font-weight="700">q = ${sc.q.toFixed(0)} kPa (${sc.loadType[0].toUpperCase()})</text>`;
    } else if (sc.kind === 'strip') {
      const sign = sc.side === 'active' ? -1 : 1;
      const xN = X(0) + sign * (sc.offset || 0) * sx;
      const xF = X(0) + sign * ((sc.offset || 0) + (sc.width || 0)) * sx;
      const x1 = Math.min(xN, xF);
      const x2 = Math.max(xN, xF);
      svg += `<rect x="${x1}" y="${groundY - 14}" width="${x2 - x1}" height="14" fill="#B22234" opacity="0.5"/>`;
      svg += `<text x="${(x1+x2)/2}" y="${groundY - 18}" text-anchor="middle" font-size="10" fill="#B22234" font-weight="700">${sc.q.toFixed(0)} kPa strip</text>`;
    }
  }

  // ── Props ────────────────────────────────────────────────────────────────
  for (const p of state.props) {
    const yp = Y(p.level_m);
    svg += `<polygon points="${xWall - 12},${yp - 8} ${xWall - 12},${yp + 8} ${xWall - 24},${yp}" fill="#444" stroke="#222" stroke-width="0.8"/>`;
    svg += `<polygon points="${xWall + 12},${yp - 8} ${xWall + 12},${yp + 8} ${xWall + 24},${yp}" fill="#444" stroke="#222" stroke-width="0.8"/>`;
    svg += `<line x1="${xWall - 36}" y1="${yp}" x2="${xWall + 36}" y2="${yp}" stroke="#222" stroke-width="2"/>`;
    svg += `<text x="${xWall + 30}" y="${yp - 4}" font-size="10" fill="#222">Prop @ ${p.level_m.toFixed(2)} m</text>`;
  }

  // ── Wall (sheet pile centreline) ─────────────────────────────────────────
  svg += `<line x1="${xWall}" y1="${Y(wallTop)}" x2="${xWall}" y2="${Y(wallToe)}" stroke="#222" stroke-width="5"/>`;
  svg += `<text x="${xWall - 4}" y="${Y(wallTop) - 6}" font-size="10" fill="#222" text-anchor="end">Top ${wallTop.toFixed(2)} m</text>`;
  svg += `<text x="${xWall + 6}" y="${Y(wallToe) + 12}" font-size="10" fill="#222">Toe ${wallToe.toFixed(2)} m</text>`;

  // ── View overlay ─────────────────────────────────────────────────────────
  const view = AppState.view || 'outline';
  const r    = AppState.lastResults && AppState.lastResults[AppState.designControl.activeCombination || 'C1'];
  if (view === 'gross' && r) {
    svg += renderPressureOverlay(r, X, Y, xWall, 'gross', 'left-active');
  } else if (view === 'net' && r) {
    svg += renderNetOverlay(r, X, Y, xWall);
  } else if (view === 'factored' && r) {
    svg += renderNetOverlay(r, X, Y, xWall, true);
  } else if (view === 'BMD' && r) {
    svg += renderCurveOverlay(r.z, r.BMD, wallTop, X, Y, xWall, '#B22234', 'BM (kNm/m)');
  } else if (view === 'SFD' && r) {
    svg += renderCurveOverlay(r.z, r.SFD, wallTop, X, Y, xWall, '#1f6c8a', 'V (kN/m)');
  } else if (view === 'deflection' && r) {
    svg += renderCurveOverlay(r.z, r.deflection_mm, wallTop, X, Y, xWall, '#2d6b3f', 'δ (mm)', /*horizontal=*/true);
  } else if (view === 'rotational') {
    const stab = AppState.lastStabilityResult;
    if (stab && stab.r) svg += renderRotationalOverlay(stab, X, Y);
  }

  // ── Combination label ────────────────────────────────────────────────────
  const combo = AppState.designControl.activeCombination || 'C1';
  svg += `<rect x="${SVG_W - 130}" y="12" width="118" height="22" fill="#B22234" rx="3"/>`;
  svg += `<text x="${SVG_W - 71}"  y="27" font-size="11" fill="#fff" font-weight="700" text-anchor="middle">${AppState.designControl.mode}: ${combo}</text>`;

  svg += `</svg>`;
  return svg;
}

function renderSoilSide(soils, groundLevel, xL, xR, Y, yMin) {
  const sorted = [...soils].sort((a, b) => b.topLevel_m - a.topLevel_m);
  let s = '';
  for (let i = 0; i < sorted.length; i++) {
    const top = Math.min(sorted[i].topLevel_m, groundLevel);
    const bot = i + 1 < sorted.length ? sorted[i+1].topLevel_m : yMin - 1;
    if (top <= yMin) continue;
    const fill = sorted[i].type === 'undrained' ? 'url(#hatchUndrained)' : 'url(#hatchDrained)';
    s += `<rect x="${xL}" y="${Y(top)}" width="${xR - xL}" height="${Y(bot) - Y(top)}" fill="${fill}" opacity="0.85"/>`;
    s += `<text x="${xL + 8}" y="${Y(top) + 14}" font-size="9" fill="#5a3a1a" font-weight="600">${sorted[i].name} (${sorted[i].type === 'undrained' ? 'cu='+sorted[i].cu : "φ'="+sorted[i].phi+'°'})</text>`;
  }
  return s;
}

function renderPressureOverlay(r, X, Y, xWall, kind, mode) {
  // Mirror axis: active polygon on the left (extending leftward from wall),
  //              passive polygon on the right (extending rightward).
  const scaleP = 1.6;          // pixels per kPa
  let pa = `${xWall},${Y(r.levels[0])} `;
  let pp = `${xWall},${Y(r.levels[0])} `;
  for (let i = 0; i < r.levels.length; i++) {
    pa += `${xWall - r.pActive[i]  * scaleP},${Y(r.levels[i])} `;
    pp += `${xWall + r.pPassive[i] * scaleP},${Y(r.levels[i])} `;
  }
  pa += `${xWall},${Y(r.levels[r.levels.length - 1])} `;
  pp += `${xWall},${Y(r.levels[r.levels.length - 1])} `;
  return `<polygon points="${pa}" fill="rgba(178,34,52,0.30)" stroke="#B22234" stroke-width="1.2"/>
          <polygon points="${pp}" fill="rgba(45,107,63,0.30)" stroke="#2d6b3f" stroke-width="1.2"/>
          <text x="${xWall - 10}" y="20" text-anchor="end" font-size="10" fill="#B22234" font-weight="700">σa (kPa)</text>
          <text x="${xWall + 10}" y="20" font-size="10" fill="#2d6b3f" font-weight="700">σp (kPa)</text>`;
}

function renderNetOverlay(r, X, Y, xWall, factored) {
  const scaleP = 1.6;
  let pn = `${xWall},${Y(r.levels[0])} `;
  for (let i = 0; i < r.levels.length; i++) {
    const v = r.pNet[i];
    pn += `${xWall + v * scaleP},${Y(r.levels[i])} `;
  }
  pn += `${xWall},${Y(r.levels[r.levels.length - 1])} `;
  return `<polygon points="${pn}" fill="${factored ? 'rgba(178,34,52,0.45)' : 'rgba(178,34,52,0.30)'}" stroke="#B22234" stroke-width="1.4"/>
          <text x="${xWall + 10}" y="20" font-size="10" fill="#B22234" font-weight="700">${factored ? 'Factored net (kPa)' : 'Net σh (kPa)'}</text>`;
}

function renderCurveOverlay(zArr, vals, wallTop, X, Y, xWall, colour, label, horizontal) {
  if (!zArr || !vals) return '';
  const maxAbs = Math.max(...vals.map(Math.abs)) || 1;
  const ampPx  = 110;
  const path = [];
  for (let i = 0; i < zArr.length; i++) {
    const yReal = wallTop - zArr[i];
    const dx    = (vals[i] / maxAbs) * ampPx;
    path.push(`${i === 0 ? 'M' : 'L'} ${xWall + dx} ${Y(yReal)}`);
  }
  const peakIdx = vals.reduce((m, v, i, a) => Math.abs(v) > Math.abs(a[m]) ? i : m, 0);
  return `<path d="${path.join(' ')}" stroke="${colour}" stroke-width="2" fill="none"/>
          <line x1="${xWall}" y1="${Y(wallTop)}" x2="${xWall}" y2="${Y(wallTop - zArr[zArr.length-1])}" stroke="#bbb" stroke-width="0.6" stroke-dasharray="3,3"/>
          <text x="${xWall + (vals[peakIdx]/maxAbs)*ampPx + 6}" y="${Y(wallTop - zArr[peakIdx])}" font-size="10" fill="${colour}" font-weight="700">${vals[peakIdx].toFixed(1)}</text>
          <text x="${xWall + ampPx + 12}" y="20" font-size="10" fill="${colour}" font-weight="700">${label}, max = ${maxAbs.toFixed(1)}</text>`;
}

function renderRotationalOverlay(stab, X, Y) {
  // Slip circle
  const cx = X(stab.cx);
  const cy = Y(stab.cy);
  const rs = stab.r * (X(1) - X(0));
  let s = `<circle cx="${cx}" cy="${cy}" r="${rs}" fill="none" stroke="#B22234" stroke-width="1.4" stroke-dasharray="6,4"/>`;
  s += `<circle cx="${cx}" cy="${cy}" r="3" fill="#B22234"/>`;
  s += `<text x="${cx + 6}" y="${cy - 6}" font-size="11" fill="#B22234" font-weight="700">FoS = ${stab.FoS.toFixed(2)}</text>`;
  // Slice colouring
  for (const sl of stab.slices) {
    const x1 = X(sl.xMid - sl.b/2);
    const x2 = X(sl.xMid + sl.b/2);
    const y1 = Y(sl.ySlipM + sl.h);
    const y2 = Y(sl.ySlipM);
    const driving = sl.W * Math.sin(sl.alpha) > 0;
    s += `<rect x="${x1}" y="${y1}" width="${x2 - x1}" height="${y2 - y1}" fill="${driving ? 'rgba(178,34,52,0.18)' : 'rgba(45,107,63,0.18)'}" stroke="none"/>`;
  }
  return s;
}
