'use strict';
// Active/passive soil layer arrays + surcharges + props management.

function _newId(prefix) { return prefix + '-' + Math.random().toString(36).slice(2, 8); }

// ─── Soils ───────────────────────────────────────────────────────────────────

function addSoilLayer(side, presetId) {
  const arr = side === 'active' ? AppState.activeSoils : AppState.passiveSoils;
  const last = arr[arr.length - 1];
  const newTop = last ? last.topLevel_m - 2.0 : (side === 'active' ? AppState.geometry.activeGroundLevel_m : AppState.geometry.passiveGroundLevel_m);
  const base = presetId ? AppState.soilLibrary.find(s => s.id === presetId) : null;
  arr.push({
    id: _newId(side === 'active' ? 'as' : 'ps'),
    name: base ? base.name : 'New layer',
    topLevel_m: newTop,
    gamma:        base ? base.gamma        : 18,
    gamma_sat:    base ? base.gamma_sat    : 19,
    phi:          base ? base.phi          : 30,
    c_eff:        base ? base.c_eff        : 0,
    cu:           base ? base.cu           : 0,
    E_MPa:        base ? (base.E_MPa ?? 30) : 30,
    type:         base ? base.type         : 'drained',
    delta_active: base ? (base.delta_active  ?? 0.667) : 0.667,
    delta_passive:base ? (base.delta_passive ?? 0.5)   : 0.5
  });
  renderSoils();
  markDirty(); scheduleAutoSave();
  refreshDiagram();
  triggerRecalc();
}

function applyPresetToLayer(side, layerId, presetId) {
  if (!presetId) return;
  const arr = side === 'active' ? AppState.activeSoils : AppState.passiveSoils;
  const layer = arr.find(s => s.id === layerId);
  const preset = AppState.soilLibrary.find(s => s.id === presetId);
  if (!layer || !preset) return;
  // Preserve id + topLevel_m; copy everything else from the preset
  const { id, topLevel_m } = layer;
  Object.assign(layer, { ...preset, id, topLevel_m });
  renderSoils();
  markDirty(); scheduleAutoSave();
  refreshDiagram();
  triggerRecalc();
}

function removeSoilLayer(side, id) {
  const arr = side === 'active' ? AppState.activeSoils : AppState.passiveSoils;
  const idx = arr.findIndex(s => s.id === id);
  if (idx >= 0) arr.splice(idx, 1);
  renderSoils();
  markDirty(); scheduleAutoSave();
  refreshDiagram();
  triggerRecalc();
}

function updateSoilField(side, id, field, raw) {
  const arr = side === 'active' ? AppState.activeSoils : AppState.passiveSoils;
  const layer = arr.find(s => s.id === id);
  if (!layer) return;
  if (field === 'name' || field === 'type') {
    layer[field] = raw;
  } else {
    const v = parseFloat(raw);
    if (!isNaN(v)) layer[field] = v;
  }
  refreshSoilCoeffs(id);
  markDirty(); scheduleAutoSave();
  refreshDiagram();
  triggerRecalc();
}

// Patch the coefficient read-out for one layer in place — avoids re-rendering
// the whole card and stealing focus from the input the user is editing.
function refreshSoilCoeffs(layerId) {
  const layer = [...(AppState.activeSoils || []), ...(AppState.passiveSoils || [])]
    .find(s => s.id === layerId);
  if (!layer) return;
  const row = document.querySelector(`.soil-coeffs[data-layer-id="${layerId}"]`);
  if (!row) return;
  row.innerHTML = _soilCoeffInner(layer);
}

function _soilCoeffInner(s) {
  const k = earthPressureCoefficients(s);
  if (!k) return '';
  return `
    <span class="sc-pair"><strong>Ka</strong> = ${k.Ka.toFixed(3)}</span>
    <span class="sc-pair"><strong>Kac</strong> = ${k.Kac.toFixed(3)}</span>
    <span class="sc-sep">|</span>
    <span class="sc-pair"><strong>Kp</strong> = ${k.Kp.toFixed(3)}</span>
    <span class="sc-pair"><strong>Kpc</strong> = ${k.Kpc.toFixed(3)}</span>
    ${s.type === 'drained'
      ? `<span class="sc-meta">δa = ${k.delta_a_deg.toFixed(1)}° &middot; δp = ${k.delta_p_deg.toFixed(1)}° &middot; cw/cu = ${WALL_ADHESION_RATIO}</span>`
      : `<span class="sc-meta">undrained &middot; cw/cu = ${WALL_ADHESION_RATIO} (Padfield-Mair)</span>`}`;
}

function saveSoilToLibrary(side, layerId) {
  const arr = side === 'active' ? AppState.activeSoils : AppState.passiveSoils;
  const layer = arr.find(s => s.id === layerId);
  if (!layer) return;
  const name = prompt('Save this soil to the library as:', layer.name);
  if (!name) return;
  AppState.soilLibrary.push({
    id: 'usr-' + Math.random().toString(36).slice(2, 8),
    name,
    type: layer.type,
    gamma: layer.gamma, gamma_sat: layer.gamma_sat,
    phi: layer.phi, c_eff: layer.c_eff, cu: layer.cu, E_MPa: layer.E_MPa,
    delta_active: layer.delta_active, delta_passive: layer.delta_passive,
    builtin: false
  });
  renderSoils();             // refresh dropdowns
  renderSoilLibrary();
  markDirty(); scheduleAutoSave();
}

function renderSoils() {
  renderSoilSide('active');
  renderSoilSide('passive');
}

function renderSoilSide(side) {
  const host = document.getElementById(side === 'active' ? 'activeSoilsList' : 'passiveSoilsList');
  if (!host) return;
  const arr = side === 'active' ? AppState.activeSoils : AppState.passiveSoils;
  if (!arr.length) {
    host.innerHTML = `<div class="info-box">No ${side}-side soil layers. Add one below.</div>`;
    return;
  }
  const presetOptions = AppState.soilLibrary
    .map(p => `<option value="${p.id}">${escHtml(p.name)}${p.builtin ? '' : ' ★'}</option>`)
    .join('');

  host.innerHTML = arr.map((s, i) => {
    const coeffsRow = `<div class="soil-coeffs" data-layer-id="${s.id}">${_soilCoeffInner(s)}</div>`;
    // Warn the user if the soil parameters they've entered don't actually drive
    // the analysis for the selected drained / undrained type.
    const warnUndrainedNoCu = s.type === 'undrained' && (!s.cu || s.cu <= 0);
    const warnDrainedNoStrength = s.type === 'drained' && (!s.phi || s.phi <= 0) && (!s.c_eff || s.c_eff <= 0);
    const warning = warnUndrainedNoCu
      ? `<div class="soil-warning">⚠ Undrained type with cu = 0 — no shear strength. The wall will not converge. Set cu, or switch to Drained if you want φ'/c' to apply.</div>`
      : warnDrainedNoStrength
      ? `<div class="soil-warning">⚠ Drained type with φ' = 0 and c' = 0 — no shear strength. Set φ' (and/or c'), or switch to Undrained if you want cu to apply.</div>`
      : '';
    // Grey out the parameters that the chosen type doesn't use.
    const undrainedIrrelevant = s.type === 'undrained' ? ' class="soil-input-disabled"' : '';
    const drainedIrrelevant   = s.type === 'drained'   ? ' class="soil-input-disabled"' : '';
    return `
    <div class="layer-card">
      <div class="layer-card-header">
        <h3>Layer ${i+1}: ${escHtml(s.name)}</h3>
        <div style="display:flex;gap:6px">
          <button class="btn-edit-rev" onclick="saveSoilToLibrary('${side}','${s.id}')" title="Save these parameters as a named soil in the library">+ Save to library</button>
          <button class="btn-remove" onclick="removeSoilLayer('${side}','${s.id}')">Remove</button>
        </div>
      </div>${coeffsRow}${warning}
      <div class="form-grid">
        <div class="form-group"><label>Name</label><input value="${escAttr(s.name)}" oninput="updateSoilField('${side}','${s.id}','name',this.value)"></div>
        <div class="form-group"><label>Apply preset</label>
          <select onchange="applyPresetToLayer('${side}','${s.id}',this.value); this.value=''">
            <option value="">— pick a preset —</option>
            ${presetOptions}
          </select>
        </div>
        <div class="form-group"><label>Top level (m)</label><input type="number" step="0.1" value="${s.topLevel_m}" oninput="updateSoilField('${side}','${s.id}','topLevel_m',this.value)"></div>
        <div class="form-group"><label>Type</label>
          <select onchange="updateSoilField('${side}','${s.id}','type',this.value)">
            <option value="drained"   ${s.type === 'drained'   ? 'selected' : ''}>Drained (effective)</option>
            <option value="undrained" ${s.type === 'undrained' ? 'selected' : ''}>Undrained (total)</option>
          </select>
        </div>
        <div class="form-group"><label>γ (kN/m³)</label><input type="number" step="0.1" value="${s.gamma}" oninput="updateSoilField('${side}','${s.id}','gamma',this.value)"></div>
        <div class="form-group"><label>γ_sat (kN/m³)</label><input type="number" step="0.1" value="${s.gamma_sat}" oninput="updateSoilField('${side}','${s.id}','gamma_sat',this.value)"></div>
        <div class="form-group"${undrainedIrrelevant}><label>φ' (°) <span class="param-tag">drained</span></label><input type="number" step="0.5" value="${s.phi}" oninput="updateSoilField('${side}','${s.id}','phi',this.value)"></div>
        <div class="form-group"${undrainedIrrelevant}><label>c' (kPa) <span class="param-tag">drained</span></label><input type="number" step="0.5" value="${s.c_eff}" oninput="updateSoilField('${side}','${s.id}','c_eff',this.value)"></div>
        <div class="form-group"${drainedIrrelevant}><label>cu (kPa) <span class="param-tag">undrained</span></label><input type="number" step="1"   value="${s.cu}"    oninput="updateSoilField('${side}','${s.id}','cu',this.value)"></div>
        <div class="form-group"><label>E (MPa)</label><input type="number" step="1"   value="${s.E_MPa ?? 30}" oninput="updateSoilField('${side}','${s.id}','E_MPa',this.value)"></div>
        <div class="form-group"${undrainedIrrelevant}><label>δ_a / φ' <span class="param-tag">drained</span></label><input type="number" step="0.05" value="${s.delta_active}"  oninput="updateSoilField('${side}','${s.id}','delta_active',this.value)"></div>
        <div class="form-group"${undrainedIrrelevant}><label>δ_p / φ' <span class="param-tag">drained</span></label><input type="number" step="0.05" value="${s.delta_passive}" oninput="updateSoilField('${side}','${s.id}','delta_passive',this.value)"></div>
      </div>
    </div>`;
  }).join('');
}

// ─── Soil Library section ─────────────────────────────────────────────────────

function renderSoilLibrary() {
  const host = document.getElementById('soilLibraryList');
  if (!host) return;
  if (!AppState.soilLibrary.length) {
    host.innerHTML = `<div class="info-box">No soils in library yet. Add layers below and click "+ Save to library" on any layer to reuse it.</div>`;
    return;
  }
  host.innerHTML = `<table class="rev-history-table">
    <thead><tr><th>Name</th><th>Type</th><th>γ / γsat</th><th>φ'</th><th>c'</th><th>cu</th><th>E</th><th></th></tr></thead>
    <tbody>${AppState.soilLibrary.map(s => `
      <tr>
        <td><strong>${escHtml(s.name)}</strong>${s.builtin ? '' : ' <span style="color:var(--red)">★</span>'}</td>
        <td>${s.type === 'undrained' ? 'Undrained' : 'Drained'}</td>
        <td>${s.gamma} / ${s.gamma_sat}</td>
        <td>${s.phi}°</td>
        <td>${s.c_eff}</td>
        <td>${s.cu}</td>
        <td>${s.E_MPa ?? '—'}</td>
        <td>${s.builtin ? '' : `<button class="btn-edit-rev" onclick="removeFromSoilLibrary('${s.id}')">Remove</button>`}</td>
      </tr>`).join('')}</tbody></table>
    <div style="font-size:11px;color:var(--text-dim);font-family:var(--mono);margin-top:6px">
      ★ = user-added soil (saved with this design). Built-in presets are loaded from <code>/data/soil-presets.json</code>.
    </div>`;
}

function toggleSoilLibrary() {
  const body  = document.getElementById('soilLibraryBody');
  const caret = document.getElementById('soilLibraryCaret');
  if (!body) return;
  const open = body.style.display !== 'none';
  body.style.display = open ? 'none' : '';
  if (caret) caret.textContent = open ? '▶' : '▼';
}

function removeFromSoilLibrary(id) {
  const idx = AppState.soilLibrary.findIndex(s => s.id === id);
  if (idx < 0) return;
  if (AppState.soilLibrary[idx].builtin) return;     // built-ins cannot be removed
  AppState.soilLibrary.splice(idx, 1);
  renderSoils();
  renderSoilLibrary();
  markDirty(); scheduleAutoSave();
}

// ─── Surcharges ──────────────────────────────────────────────────────────────

function _activeSurcharges() { return activeStage()?.surcharges || []; }
function _activeProps()      { return activeStage()?.props      || []; }

function addSurcharge(kind) {
  const sc = { id: _newId('sc'), kind: kind || 'uniform', q: 10, side: 'active', loadType: 'permanent' };
  if (kind === 'strip') Object.assign(sc, { width: 2, offset: 1 });
  _activeSurcharges().push(sc);
  renderSurcharges();
  markDirty(); scheduleAutoSave();
  refreshDiagram();
  triggerRecalc();
}

function removeSurcharge(id) {
  const arr = _activeSurcharges();
  const idx = arr.findIndex(s => s.id === id);
  if (idx >= 0) arr.splice(idx, 1);
  renderSurcharges();
  markDirty(); scheduleAutoSave();
  refreshDiagram();
  triggerRecalc();
}

function updateSurchargeField(id, field, raw) {
  const sc = _activeSurcharges().find(s => s.id === id);
  if (!sc) return;
  if (field === 'kind' || field === 'side' || field === 'loadType') {
    sc[field] = raw;
    if (field === 'kind' && raw === 'strip' && sc.width === undefined) {
      sc.width = 2; sc.offset = 1;
    }
  } else {
    const v = parseFloat(raw);
    if (!isNaN(v)) sc[field] = v;
  }
  renderSurcharges();
  markDirty(); scheduleAutoSave();
  refreshDiagram();
  triggerRecalc();
}

function renderSurcharges() {
  const host = document.getElementById('surchargesList');
  if (!host) return;
  const arr = _activeSurcharges();
  if (!arr.length) {
    host.innerHTML = `<div class="info-box">No surcharges defined for this stage. Add a uniform or strip load below.</div>`;
    return;
  }
  host.innerHTML = arr.map((sc, i) => {
    const stripFields = sc.kind === 'strip' ? `
      <div class="form-group"><label>Width b (m)</label><input type="number" step="0.1" value="${sc.width}" oninput="updateSurchargeField('${sc.id}','width',this.value)"></div>
      <div class="form-group"><label>Offset a (m)</label><input type="number" step="0.1" value="${sc.offset}" oninput="updateSurchargeField('${sc.id}','offset',this.value)"></div>
    ` : '';
    return `
    <div class="layer-card">
      <div class="layer-card-header">
        <h3>Surcharge ${i+1}: ${sc.kind === 'strip' ? 'Strip load' : 'Uniform'}</h3>
        <button class="btn-remove" onclick="removeSurcharge('${sc.id}')">Remove</button>
      </div>
      <div class="form-grid">
        <div class="form-group"><label>Kind</label>
          <select onchange="updateSurchargeField('${sc.id}','kind',this.value)">
            <option value="uniform" ${sc.kind === 'uniform' ? 'selected' : ''}>Uniform (kPa)</option>
            <option value="strip"   ${sc.kind === 'strip'   ? 'selected' : ''}>Strip load (kPa)</option>
          </select>
        </div>
        <div class="form-group"><label>Side</label>
          <select onchange="updateSurchargeField('${sc.id}','side',this.value)">
            <option value="active"  ${sc.side === 'active'  ? 'selected' : ''}>Active</option>
            <option value="passive" ${sc.side === 'passive' ? 'selected' : ''}>Passive</option>
          </select>
        </div>
        <div class="form-group"><label>q (kPa)</label><input type="number" step="1" value="${sc.q}" oninput="updateSurchargeField('${sc.id}','q',this.value)"></div>
        ${stripFields}
        <div class="form-group"><label>Load type</label>
          <select onchange="updateSurchargeField('${sc.id}','loadType',this.value)">
            <option value="permanent" ${sc.loadType === 'permanent' ? 'selected' : ''}>Permanent (γG)</option>
            <option value="variable"  ${sc.loadType === 'variable'  ? 'selected' : ''}>Variable (γQ)</option>
          </select>
        </div>
      </div>
    </div>`;
  }).join('');
}

// ─── Props ───────────────────────────────────────────────────────────────────

function addProp() {
  const arr  = _activeProps();
  const last = arr[arr.length - 1];
  const lvl  = last ? last.level_m - 2.0 : (AppState.geometry.wallTopLevel_m - 0.5);
  arr.push({ id: _newId('pr'), level_m: lvl, stiffness: 'rigid', type: 'permanent' });
  renderProps();
  markDirty(); scheduleAutoSave();
  refreshDiagram();
  triggerRecalc();
}

function removeProp(id) {
  const arr = _activeProps();
  const idx = arr.findIndex(p => p.id === id);
  if (idx >= 0) arr.splice(idx, 1);
  renderProps();
  markDirty(); scheduleAutoSave();
  refreshDiagram();
  triggerRecalc();
}

function updatePropField(id, field, raw) {
  const p = _activeProps().find(pp => pp.id === id);
  if (!p) return;
  if (field === 'stiffness' || field === 'type') p[field] = raw;
  else { const v = parseFloat(raw); if (!isNaN(v)) p[field] = v; }
  markDirty(); scheduleAutoSave();
  refreshDiagram();
  triggerRecalc();
}

function renderProps() {
  const host = document.getElementById('propsList');
  if (!host) return;
  const arr = _activeProps();
  if (!arr.length) {
    host.innerHTML = `<div class="info-box">No props installed at this stage. Cantilever wall — fixity from passive zone only.</div>`;
    return;
  }
  host.innerHTML = arr.map((p, i) => `
    <div class="layer-card">
      <div class="layer-card-header">
        <h3>Prop ${i+1}</h3>
        <button class="btn-remove" onclick="removeProp('${p.id}')">Remove</button>
      </div>
      <div class="form-grid">
        <div class="form-group"><label>Level (m)</label><input type="number" step="0.1" value="${p.level_m}" oninput="updatePropField('${p.id}','level_m',this.value)"></div>
        <div class="form-group"><label>Stiffness</label>
          <select onchange="updatePropField('${p.id}','stiffness',this.value)">
            <option value="rigid"  ${p.stiffness === 'rigid'  ? 'selected' : ''}>Rigid</option>
            <option value="elastic" ${p.stiffness === 'elastic' ? 'selected' : ''}>Elastic (k_h, kN/m/m)</option>
          </select>
        </div>
        <div class="form-group"><label>Type</label>
          <select onchange="updatePropField('${p.id}','type',this.value)">
            <option value="permanent" ${p.type === 'permanent' ? 'selected' : ''}>Permanent (γG)</option>
            <option value="variable"  ${p.type === 'variable'  ? 'selected' : ''}>Variable (γQ)</option>
          </select>
        </div>
      </div>
    </div>
  `).join('');
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
// escHtml is defined globally in ui/designPanel.js
function escAttr(s) { return escHtml(s); }
