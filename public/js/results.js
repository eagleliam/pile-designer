'use strict';
// Top-level "Run Design Check" entry point + results panel renderer.

function runAllDesigns(opts = {}) {
  // Sync the form back into AppState for the active stage
  collectStateFromForm();

  // Run every stage and store all results on AppState. Wrap in try/catch so one
  // bad stage doesn't poison the whole results pipeline — bad stage shows an
  // error in the table, others render normally.
  const allStageResults = AppState.stages.map(stage => {
    try {
      const stageState = snapshotForStage(stage);
      return { stageId: stage.id, stageName: stage.name, results: runDesign(stageState) };
    } catch (e) {
      console.error(`Stage "${stage.name}" failed:`, e);
      return { stageId: stage.id, stageName: stage.name, results: {}, error: e.message };
    }
  });
  AppState.allStageResults = allStageResults;
  // Active stage results = the canonical lastResults used by the diagram + view overlays
  const active = allStageResults.find(r => r.stageId === AppState.activeStageId) || allStageResults[0];
  AppState.lastResults = active.results;

  // Bishop only runs against the active stage and only when explicitly requested
  let stab = AppState.lastStabilityResult || null;
  if (!opts.skipStability) {
    try {
      stab = runStabilityCheck(snapshotForStage(activeStage()), AppState.designControl.activeCombination || 'C1');
    } catch (e) {
      console.warn('Stability check failed:', e);
    }
  }

  renderResultsPanel(allStageResults, stab);
  if (typeof renderPilePropertiesPanel === 'function') renderPilePropertiesPanel();
  refreshDiagram();
}

// Explicit entry point for the rotational section's "Run stability search" button
function runStabilityOnly() {
  const state = collectStateFromForm();
  try {
    runStabilityCheck(state, state.designControl.activeCombination || 'C1');
  } catch (e) {
    alert('Stability search failed: ' + e.message);
    return;
  }
  // Re-render results + diagram with the new stability result
  renderResultsPanel(AppState.lastResults || {}, AppState.lastStabilityResult, state);
  refreshDiagram();
}

function renderResultsPanel(allStageResults, stab) {
  const host = document.getElementById('resultsBody');
  const sec  = document.getElementById('resultsSection');
  if (!host || !sec) return;
  sec.style.display = '';

  const grade  = AppState.wall.steelGrade;
  const sec_pl = Catalogue.byId[AppState.wall.sectionId];
  const combo  = AppState.designControl.activeCombination || 'C1';
  const f      = AppState.designControl.factors[combo] || PRESETS[combo];
  const M_Rd   = bendingResistance_kNm_per_m(AppState.wall.sectionId, grade, f.gM0);
  const V_Rd   = shearResistance_kN_per_m(AppState.wall.sectionId, grade, f.gM0);
  const html   = [];

  // Warn about any stage where the solver failed to converge — typically caused
  // by misconfigured soils (zero shear strength) rather than a numerical issue.
  const nonConvergent = allStageResults.filter(sr => sr.results[combo]?.convergenceFailed);
  if (nonConvergent.length) {
    html.push(`<div class="info-box" style="background:#fef3e6;border-left-color:var(--orange);color:#7a3f10">
      <strong>⚠ Solver did not converge for ${nonConvergent.length} stage(s):</strong>
      ${nonConvergent.map(sr => escHtml(sr.stageName)).join(', ')}.
      The wall cannot reach moment equilibrium with the chosen soil parameters — typically because a soil layer has no effective shear strength.
      Check that:
      <ul style="margin:6px 0 0 22px;padding:0">
        <li>Undrained layers have <strong>cu &gt; 0</strong></li>
        <li>Drained layers have <strong>φ' &gt; 0</strong> or c' &gt; 0</li>
        <li>Pile length is sufficient for the worst stage's dredge level</li>
      </ul>
      The numbers below are computed at the 25 m embedment cap and are <strong>not engineering values</strong>.
    </div>`);
  }

  html.push(`<div class="info-box">Sheet pile: <strong>${sec_pl?.designation || '—'}</strong> &middot; ${grade} &middot; W_el = ${(sec_pl?.W_el_cm3_per_m ?? 0).toFixed(0)} cm³/m &middot; M_Rd = <strong>${M_Rd.toFixed(0)} kNm/m</strong> &middot; V_Rd = ${V_Rd.toFixed(0)} kN/m &middot; Showing combination: <strong>${combo}</strong></div>`);

  // ── Envelope across stages ──────────────────────────────────────────────
  const env = computeEnvelope(allStageResults, combo);
  if (env) {
    const utilM = M_Rd > 0 ? env.M_max / M_Rd : Infinity;
    const utilV = V_Rd > 0 ? env.V_max / V_Rd : Infinity;
    html.push(`<h3 class="sub-heading">Envelope across all stages (${combo})</h3>
      <div class="results-grid">
        <div class="result-card"><div class="label">Critical M_max</div><div class="value">${env.M_max.toFixed(0)} <span class="unit">kNm/m</span></div><div class="label" style="color:var(--red);font-size:9px">${escHtml(env.M_stageName)}</div></div>
        <div class="result-card"><div class="label">M-utilisation</div><div class="value ${utilM <= 1 ? 'pass' : 'fail'}">${(utilM*100).toFixed(0)}%</div></div>
        <div class="result-card"><div class="label">Critical V_max</div><div class="value">${env.V_max.toFixed(0)} <span class="unit">kN/m</span></div><div class="label" style="color:var(--red);font-size:9px">${escHtml(env.V_stageName)}</div></div>
        <div class="result-card"><div class="label">V-utilisation</div><div class="value ${utilV <= 1 ? 'pass' : 'fail'}">${(utilV*100).toFixed(0)}%</div></div>
        <div class="result-card"><div class="label">Max embedment required</div><div class="value">${env.d_required_max.toFixed(2)} <span class="unit">m</span></div><div class="label" style="color:var(--red);font-size:9px">${escHtml(env.d_stageName)}</div></div>
        <div class="result-card"><div class="label">Worst δ_max</div><div class="value">${env.defl_max.toFixed(1)} <span class="unit">mm</span></div><div class="label" style="color:var(--red);font-size:9px">${escHtml(env.defl_stageName)}</div></div>
        <div class="result-card"><div class="label">Stages run</div><div class="value">${allStageResults.length}</div></div>
        <div class="result-card"><div class="label">Embedment OK</div><div class="value ${env.embedmentOK === allStageResults.length ? 'pass' : 'fail'}">${env.embedmentOK} / ${allStageResults.length}</div></div>
      </div>`);
  }

  // ── Per-stage breakdown table ──────────────────────────────────────────
  html.push(`<h3 class="sub-heading">Per stage — ${combo}</h3>
    <table>
      <thead><tr>
        <th>Stage</th><th>Wall</th>
        <th>d_req (m)</th><th>d_design (m)</th>
        <th>M_max (kNm/m)</th><th>V_max (kN/m)</th><th>δ_max (mm)</th>
        <th>Prop forces (kN/m)</th><th>Embedment</th>
      </tr></thead>
      <tbody>
        ${allStageResults.map(sr => {
          const r = sr.results[combo];
          if (!r) return `<tr><td colspan="9">${escHtml(sr.stageName)} — no result</td></tr>`;
          const isActive = sr.stageId === AppState.activeStageId ? ' style="background:var(--red-soft)"' : '';
          return `<tr${isActive}>
            <td>${sr.stageId === AppState.activeStageId ? '<strong>' : ''}${escHtml(sr.stageName)}${sr.stageId === AppState.activeStageId ? '</strong>' : ''}</td>
            <td>${r.wallType}</td>
            <td>${r.d_required_m.toFixed(2)}</td>
            <td>${r.d_design_m.toFixed(2)}</td>
            <td>${r.M_max_kNm_per_m.toFixed(0)}</td>
            <td>${r.V_max_kN_per_m.toFixed(0)}</td>
            <td>${r.deflection_max_mm.toFixed(1)}</td>
            <td>${(r.propForces_kN_per_m || []).map(F => F.toFixed(0)).join(', ') || '—'}</td>
            <td class="${r.status === 'OK' ? 'pass' : 'fail'}">${r.status}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`);

  // ── Rotational stability for active stage ──────────────────────────────
  if (stab && stab.r) {
    const target = AppState.rotational.targetFoS || 1.0;
    const passS  = stab.FoS >= target ? 'pass' : 'fail';
    html.push(`<h3 class="sub-heading">Rotational stability — Bishop simplified (active stage)</h3>
      <div class="results-grid">
        <div class="result-card"><div class="label">Critical FoS</div><div class="value ${passS}">${stab.FoS.toFixed(2)}</div></div>
        <div class="result-card"><div class="label">Target FoS</div><div class="value">${target.toFixed(2)}</div></div>
        <div class="result-card"><div class="label">Centre (x, y)</div><div class="value" style="font-size:14px">(${stab.cx.toFixed(1)}, ${stab.cy.toFixed(1)}) m</div></div>
        <div class="result-card"><div class="label">Radius</div><div class="value">${stab.r.toFixed(1)} <span class="unit">m</span></div></div>
        <div class="result-card"><div class="label">Slices</div><div class="value">${stab.slices.length}</div></div>
      </div>`);
  }

  host.innerHTML = html.join('');
  return;

  // ─── Legacy code below (unreachable; kept for reference during refactor) ──
  /*
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
    html.push(`<div class="info-box">No critical slip surface found inside the search grid.</div>`);
  }

  host.innerHTML = html.join('');
  */
}

function computeEnvelope(allStageResults, combo) {
  let env = { M_max: 0, V_max: 0, d_required_max: 0, defl_max: 0, embedmentOK: 0,
              M_stageName: '', V_stageName: '', d_stageName: '', defl_stageName: '' };
  let any = false;
  for (const sr of allStageResults) {
    const r = sr.results[combo];
    if (!r) continue; any = true;
    if (Math.abs(r.M_max_kNm_per_m)    > env.M_max)         { env.M_max = Math.abs(r.M_max_kNm_per_m); env.M_stageName = sr.stageName; }
    if (Math.abs(r.V_max_kN_per_m)     > env.V_max)         { env.V_max = Math.abs(r.V_max_kN_per_m);  env.V_stageName = sr.stageName; }
    if (r.d_required_m                 > env.d_required_max){ env.d_required_max = r.d_required_m;     env.d_stageName = sr.stageName; }
    if (Math.abs(r.deflection_max_mm)  > env.defl_max)      { env.defl_max = Math.abs(r.deflection_max_mm); env.defl_stageName = sr.stageName; }
    if (r.status === 'OK') env.embedmentOK++;
  }
  return any ? env : null;
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
