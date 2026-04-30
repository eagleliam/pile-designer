'use strict';
// EC7 partial factor handling. The three default factor sets are seeded by the
// server (see routes/designs.js) and live in AppState.designControl.factors.
// This module renders the editable table and pulls user overrides back in.

const FACTOR_DEFINITIONS = [
  { key: 'gG',     label: 'γG (perm. unfav.)' },
  { key: 'gGfav',  label: 'γG,fav (perm. fav.)' },
  { key: 'gQ',     label: 'γQ (var. unfav.)' },
  { key: 'gPhi',   label: "γφ' (tan φ')" },
  { key: 'gCeff',  label: "γc' (effective cohesion)" },
  { key: 'gCu',    label: 'γcu (undrained)' },
  { key: 'gGamma', label: 'γγ (unit weight)' },
  { key: 'gRe',    label: 'γRe (passive resistance)' },
  { key: 'gM0',    label: 'γM0 (steel — EC3)' }
];

const PRESETS = {
  C1:  { gG: 1.35, gGfav: 1.00, gQ: 1.50, gPhi: 1.00, gCeff: 1.00, gCu: 1.00, gGamma: 1.00, gRe: 1.00, gM0: 1.00 },
  C2:  { gG: 1.00, gGfav: 1.00, gQ: 1.30, gPhi: 1.25, gCeff: 1.25, gCu: 1.40, gGamma: 1.00, gRe: 1.00, gM0: 1.00 },
  SLS: { gG: 1.00, gGfav: 1.00, gQ: 1.00, gPhi: 1.00, gCeff: 1.00, gCu: 1.00, gGamma: 1.00, gRe: 1.00, gM0: 1.00 }
};

function currentFactors() {
  const combo = AppState.designControl.activeCombination || 'C1';
  return AppState.designControl.factors[combo] || PRESETS[combo] || PRESETS.C1;
}

function renderFactorsTable() {
  const host = document.getElementById('factorsTable');
  if (!host) return;
  const factors = AppState.designControl.factors;

  const head = `<thead><tr>
      <th>Factor</th>
      <th class="fcol-c1">DA1-C1</th>
      <th class="fcol-c2">DA1-C2</th>
      <th class="fcol-sls">SLS</th>
    </tr></thead>`;

  const rows = FACTOR_DEFINITIONS.map(def => {
    const c1  = factors.C1  ? (factors.C1[def.key]  ?? '') : '';
    const c2  = factors.C2  ? (factors.C2[def.key]  ?? '') : '';
    const sls = factors.SLS ? (factors.SLS[def.key] ?? '') : '';
    return `<tr>
      <td>${def.label}</td>
      <td><input type="number" step="0.05" value="${c1}"  class="factor-input" data-combo="C1"  data-key="${def.key}" oninput="onFactorChange(this)"></td>
      <td><input type="number" step="0.05" value="${c2}"  class="factor-input" data-combo="C2"  data-key="${def.key}" oninput="onFactorChange(this)"></td>
      <td><input type="number" step="0.05" value="${sls}" class="factor-input" data-combo="SLS" data-key="${def.key}" oninput="onFactorChange(this)"></td>
    </tr>`;
  }).join('');

  host.innerHTML = `<table class="factors-table">${head}<tbody>${rows}</tbody></table>
    <div class="factors-actions">
      <button class="btn-add" onclick="resetFactorsToEC7()">Reset to EC7 defaults</button>
    </div>`;
}

function onFactorChange(input) {
  const combo = input.dataset.combo;
  const key   = input.dataset.key;
  const v     = parseFloat(input.value);
  if (!AppState.designControl.factors[combo]) AppState.designControl.factors[combo] = { ...PRESETS[combo] };
  AppState.designControl.factors[combo][key] = isNaN(v) ? PRESETS[combo][key] : v;
  markDirty();
  scheduleAutoSave();
}

function flushFactorsToState() {
  document.querySelectorAll('.factor-input').forEach(inp => {
    const combo = inp.dataset.combo;
    const key   = inp.dataset.key;
    const v     = parseFloat(inp.value);
    if (!AppState.designControl.factors[combo]) AppState.designControl.factors[combo] = { ...PRESETS[combo] };
    AppState.designControl.factors[combo][key] = isNaN(v) ? PRESETS[combo][key] : v;
  });
}

function resetFactorsToEC7() {
  AppState.designControl.factors = JSON.parse(JSON.stringify(PRESETS));
  renderFactorsTable();
  markDirty();
  scheduleAutoSave();
}

// Apply factors to a soil layer (returns a copy with factored strengths)
function factorSoil(soil, factors) {
  const out = { ...soil };
  if (soil.type === 'undrained') {
    out.cu = soil.cu / (factors.gCu || 1);
  } else {
    const tanPhi = Math.tan(soil.phi * Math.PI / 180);
    out.phi   = Math.atan(tanPhi / (factors.gPhi || 1)) * 180 / Math.PI;
    out.c_eff = soil.c_eff / (factors.gCeff || 1);
  }
  out.gamma     = soil.gamma     * (factors.gGamma || 1);
  out.gamma_sat = soil.gamma_sat * (factors.gGamma || 1);
  return out;
}

// Apply load factor to a surcharge (γG or γQ depending on permanent/variable)
function factorSurcharge(sc, factors) {
  const f = sc.loadType === 'variable' ? (factors.gQ || 1) : (factors.gG || 1);
  return { ...sc, q: sc.q * f };
}
