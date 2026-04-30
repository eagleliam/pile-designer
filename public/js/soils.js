'use strict';
// Active/passive soil layer arrays + surcharges + props management.

function _newId(prefix) { return prefix + '-' + Math.random().toString(36).slice(2, 8); }

// ─── Soils ───────────────────────────────────────────────────────────────────

function addSoilLayer(side) {
  const arr = side === 'active' ? AppState.activeSoils : AppState.passiveSoils;
  const last = arr[arr.length - 1];
  const newTop = last ? last.topLevel_m - 2.0 : (side === 'active' ? AppState.geometry.activeGroundLevel_m : AppState.geometry.passiveGroundLevel_m);
  arr.push({
    id: _newId(side === 'active' ? 'as' : 'ps'),
    name: 'New layer',
    topLevel_m: newTop,
    gamma: 18, gamma_sat: 19,
    phi: 30, c_eff: 0, cu: 0,
    type: 'drained',
    delta_active: 0.667, delta_passive: 0.5
  });
  renderSoils();
  markDirty(); scheduleAutoSave();
  refreshDiagram();
}

function removeSoilLayer(side, id) {
  const arr = side === 'active' ? AppState.activeSoils : AppState.passiveSoils;
  const idx = arr.findIndex(s => s.id === id);
  if (idx >= 0) arr.splice(idx, 1);
  renderSoils();
  markDirty(); scheduleAutoSave();
  refreshDiagram();
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
  markDirty(); scheduleAutoSave();
  refreshDiagram();
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
  host.innerHTML = arr.map((s, i) => `
    <div class="layer-card">
      <div class="layer-card-header">
        <h3>Layer ${i+1}: ${escHtml(s.name)}</h3>
        <button class="btn-remove" onclick="removeSoilLayer('${side}','${s.id}')">Remove</button>
      </div>
      <div class="form-grid">
        <div class="form-group"><label>Name</label><input value="${escAttr(s.name)}" oninput="updateSoilField('${side}','${s.id}','name',this.value)"></div>
        <div class="form-group"><label>Top level (m)</label><input type="number" step="0.1" value="${s.topLevel_m}" oninput="updateSoilField('${side}','${s.id}','topLevel_m',this.value)"></div>
        <div class="form-group"><label>γ (kN/m³)</label><input type="number" step="0.1" value="${s.gamma}" oninput="updateSoilField('${side}','${s.id}','gamma',this.value)"></div>
        <div class="form-group"><label>γ_sat (kN/m³)</label><input type="number" step="0.1" value="${s.gamma_sat}" oninput="updateSoilField('${side}','${s.id}','gamma_sat',this.value)"></div>
        <div class="form-group"><label>Type</label>
          <select onchange="updateSoilField('${side}','${s.id}','type',this.value)">
            <option value="drained"   ${s.type === 'drained'   ? 'selected' : ''}>Drained (effective)</option>
            <option value="undrained" ${s.type === 'undrained' ? 'selected' : ''}>Undrained (total)</option>
          </select>
        </div>
        <div class="form-group"><label>φ' (°)</label><input type="number" step="0.5" value="${s.phi}" oninput="updateSoilField('${side}','${s.id}','phi',this.value)"></div>
        <div class="form-group"><label>c' (kPa)</label><input type="number" step="0.5" value="${s.c_eff}" oninput="updateSoilField('${side}','${s.id}','c_eff',this.value)"></div>
        <div class="form-group"><label>cu (kPa)</label><input type="number" step="1"   value="${s.cu}"    oninput="updateSoilField('${side}','${s.id}','cu',this.value)"></div>
        <div class="form-group"><label>δ_a / φ'</label><input type="number" step="0.05" value="${s.delta_active}"  oninput="updateSoilField('${side}','${s.id}','delta_active',this.value)"></div>
        <div class="form-group"><label>δ_p / φ'</label><input type="number" step="0.05" value="${s.delta_passive}" oninput="updateSoilField('${side}','${s.id}','delta_passive',this.value)"></div>
      </div>
    </div>
  `).join('');
}

// ─── Surcharges ──────────────────────────────────────────────────────────────

function addSurcharge(kind) {
  const sc = { id: _newId('sc'), kind: kind || 'uniform', q: 10, side: 'active', loadType: 'permanent' };
  if (kind === 'strip') Object.assign(sc, { width: 2, offset: 1 });
  AppState.surcharges.push(sc);
  renderSurcharges();
  markDirty(); scheduleAutoSave();
  refreshDiagram();
}

function removeSurcharge(id) {
  const idx = AppState.surcharges.findIndex(s => s.id === id);
  if (idx >= 0) AppState.surcharges.splice(idx, 1);
  renderSurcharges();
  markDirty(); scheduleAutoSave();
  refreshDiagram();
}

function updateSurchargeField(id, field, raw) {
  const sc = AppState.surcharges.find(s => s.id === id);
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
}

function renderSurcharges() {
  const host = document.getElementById('surchargesList');
  if (!host) return;
  if (!AppState.surcharges.length) {
    host.innerHTML = `<div class="info-box">No surcharges defined. Add a uniform or strip load below.</div>`;
    return;
  }
  host.innerHTML = AppState.surcharges.map((sc, i) => {
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
  const last = AppState.props[AppState.props.length - 1];
  const lvl  = last ? last.level_m - 2.0 : (AppState.geometry.wallTopLevel_m - 0.5);
  AppState.props.push({ id: _newId('pr'), level_m: lvl, stiffness: 'rigid', type: 'permanent' });
  renderProps();
  syncWallTypeFromProps();
  markDirty(); scheduleAutoSave();
  refreshDiagram();
}

function removeProp(id) {
  const idx = AppState.props.findIndex(p => p.id === id);
  if (idx >= 0) AppState.props.splice(idx, 1);
  renderProps();
  syncWallTypeFromProps();
  markDirty(); scheduleAutoSave();
  refreshDiagram();
}

function updatePropField(id, field, raw) {
  const p = AppState.props.find(pp => pp.id === id);
  if (!p) return;
  if (field === 'stiffness' || field === 'type') p[field] = raw;
  else { const v = parseFloat(raw); if (!isNaN(v)) p[field] = v; }
  markDirty(); scheduleAutoSave();
  refreshDiagram();
}

function syncWallTypeFromProps() {
  // Auto-select wall type if user adds props (but don't override an explicit choice if they pick differently)
  const sel = document.getElementById('wallType');
  if (!sel) return;
  if (AppState.props.length === 0 && AppState.wall.type !== 'cantilever') {
    AppState.wall.type = 'cantilever'; sel.value = 'cantilever';
  } else if (AppState.props.length === 1 && AppState.wall.type === 'cantilever') {
    AppState.wall.type = 'singleprop'; sel.value = 'singleprop';
  } else if (AppState.props.length >= 2 && AppState.wall.type !== 'multiprop') {
    AppState.wall.type = 'multiprop'; sel.value = 'multiprop';
  }
}

function renderProps() {
  const host = document.getElementById('propsList');
  if (!host) return;
  if (!AppState.props.length) {
    host.innerHTML = `<div class="info-box">No props. Cantilever wall — fixity provided entirely by the embedded passive zone.</div>`;
    return;
  }
  host.innerHTML = AppState.props.map((p, i) => `
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
