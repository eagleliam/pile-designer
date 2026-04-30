'use strict';
// Top-level "Run Design Check" entry point + results panel renderer.

function runAllDesigns() {
  const state = collectStateFromForm();
  const results = runDesign(state);

  // Run rotational stability for the active combination
  let stab = null;
  try {
    stab = runStabilityCheck(state, state.designControl.activeCombination || 'C1');
  } catch (e) {
    console.warn('Stability check failed:', e);
  }

  renderResultsPanel(results, stab, state);
  refreshDiagram();
}

function renderResultsPanel(results, stab, state) {
  const host = document.getElementById('resultsBody');
  const sec  = document.getElementById('resultsSection');
  if (!host || !sec) return;
  sec.style.display = '';

  const grade = state.wall.steelGrade;
  const sec_pl = Catalogue.byId[state.wall.sectionId];
  const html = [];

  html.push(`<div class="info-box">Sheet pile: <strong>${sec_pl?.designation || '—'}</strong> &middot; Steel grade: <strong>${grade}</strong> &middot; Mass: <strong>${(sec_pl?.mass_kg_per_m2 ?? 0).toFixed(0)} kg/m²</strong> &middot; W_el = <strong>${(sec_pl?.W_el_cm3_per_m ?? 0).toFixed(0)} cm³/m</strong> &middot; I = <strong>${(sec_pl?.I_cm4_per_m ?? 0).toFixed(0)} cm⁴/m</strong></div>`);

  for (const combo of Object.keys(results)) {
    const r = results[combo];
    if (!r) continue;
    const f      = state.designControl.factors[combo] || PRESETS[combo];
    const M_Rd   = bendingResistance_kNm_per_m(state.wall.sectionId, grade, f.gM0);
    const V_Rd   = shearResistance_kN_per_m(state.wall.sectionId, grade, f.gM0);
    const utilM  = M_Rd > 0 ? r.M_max_kNm_per_m / M_Rd : Infinity;
    const utilV  = V_Rd > 0 ? r.V_max_kN_per_m  / V_Rd : Infinity;
    const passM  = utilM <= 1 ? 'pass' : 'fail';
    const passV  = utilV <= 1 ? 'pass' : 'fail';
    const passEmb = r.status === 'OK' ? 'pass' : 'fail';

    html.push(`<h3 class="sub-heading">${combo} — ${r.wallType}</h3>
      <div class="results-grid">
        <div class="result-card"><div class="label">Required embedment</div><div class="value">${r.d_required_m.toFixed(2)} <span class="unit">m</span></div></div>
        <div class="result-card"><div class="label">Design embedment</div><div class="value">${r.d_design_m.toFixed(2)} <span class="unit">m</span></div></div>
        <div class="result-card"><div class="label">Embedment status</div><div class="value ${passEmb}">${r.status}</div></div>
        <div class="result-card"><div class="label">M_max (Ed)</div><div class="value">${r.M_max_kNm_per_m.toFixed(0)} <span class="unit">kNm/m</span></div></div>
        <div class="result-card"><div class="label">M_Rd</div><div class="value">${M_Rd.toFixed(0)} <span class="unit">kNm/m</span></div></div>
        <div class="result-card"><div class="label">M-utilisation</div><div class="value ${passM}">${(utilM*100).toFixed(0)}%</div></div>
        <div class="result-card"><div class="label">V_max (Ed)</div><div class="value">${r.V_max_kN_per_m.toFixed(0)} <span class="unit">kN/m</span></div></div>
        <div class="result-card"><div class="label">V_Rd</div><div class="value">${V_Rd.toFixed(0)} <span class="unit">kN/m</span></div></div>
        <div class="result-card"><div class="label">V-utilisation</div><div class="value ${passV}">${(utilV*100).toFixed(0)}%</div></div>
        <div class="result-card"><div class="label">δ_max</div><div class="value">${r.deflection_max_mm.toFixed(1)} <span class="unit">mm</span></div></div>
        ${(r.propForces_kN_per_m || []).map((F, i) => `<div class="result-card"><div class="label">Prop ${i+1} force</div><div class="value">${F.toFixed(0)} <span class="unit">kN/m</span></div></div>`).join('')}
      </div>`);
  }

  if (stab && stab.r) {
    const target = state.rotational.targetFoS || 1.0;
    const passS  = stab.FoS >= target ? 'pass' : 'fail';
    html.push(`<h3 class="sub-heading">Rotational stability — Bishop simplified</h3>
      <div class="results-grid">
        <div class="result-card"><div class="label">Critical FoS</div><div class="value ${passS}">${stab.FoS.toFixed(2)}</div></div>
        <div class="result-card"><div class="label">Target FoS</div><div class="value">${target.toFixed(2)}</div></div>
        <div class="result-card"><div class="label">Centre (x, y)</div><div class="value" style="font-size:14px">(${stab.cx.toFixed(1)}, ${stab.cy.toFixed(1)}) m</div></div>
        <div class="result-card"><div class="label">Radius</div><div class="value">${stab.r.toFixed(1)} <span class="unit">m</span></div></div>
        <div class="result-card"><div class="label">Slices</div><div class="value">${stab.slices.length}</div></div>
      </div>`);
  } else if (stab !== null) {
    html.push(`<div class="info-box">No critical slip surface found inside the search grid. Try expanding the centre grid or radius range in the Rotational Stability section.</div>`);
  }

  host.innerHTML = html.join('');
}

function exportPDF() {
  if (AppState.currentRevisionCode) {
    const r = document.getElementById('projRev');
    if (r) r.value = AppState.currentRevisionCode;
  }
  runAllDesigns();
  syncProjectMeta();
  setTimeout(() => window.print(), 400);
}
