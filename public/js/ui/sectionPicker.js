'use strict';
// Sheet pile section picker modal.

function openSectionPicker() {
  let modal = document.getElementById('sectionPickerModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'sectionPickerModal';
    modal.className = 'sp-modal';
    modal.innerHTML = `
      <div class="sp-modal-inner">
        <div class="sp-modal-header">
          <span class="sp-modal-title">Sheet Pile Section</span>
          <button class="btn-icon" onclick="closeSectionPicker()" style="font-size:18px;color:#fff;">&times;</button>
        </div>
        <div class="sp-modal-controls">
          <label>Family
            <select id="spFamily" onchange="renderSectionPicker()">
              <option value="">All</option>
              <option value="AZ">AZ</option>
              <option value="GU">GU</option>
              <option value="AU">AU</option>
              <option value="PU">PU</option>
              <option value="AS500">AS 500</option>
              <option value="LX">LX (Larssen)</option>
            </select>
          </label>
          <label>Min W_el (cm³/m)
            <input id="spMinW" type="number" value="0" oninput="renderSectionPicker()">
          </label>
          <label>Search
            <input id="spSearch" placeholder="e.g. 26-700" oninput="renderSectionPicker()">
          </label>
          <button class="btn-add" onclick="autoPickSection()" title="Pick lightest section that satisfies M_Ed">Auto-pick</button>
        </div>
        <div class="sp-modal-body">
          <table class="sp-table">
            <thead>
              <tr>
                <th>Designation</th><th>Family</th>
                <th>h (mm)</th><th>Mass (kg/m²)</th>
                <th>W_el (cm³/m)</th><th>I (cm⁴/m)</th>
                <th>M_Rd (kNm/m)</th><th></th>
              </tr>
            </thead>
            <tbody id="spTableBody"></tbody>
          </table>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }
  modal.style.display = 'flex';
  renderSectionPicker();
}

function closeSectionPicker() {
  const m = document.getElementById('sectionPickerModal');
  if (m) m.style.display = 'none';
}

function renderSectionPicker() {
  const family = document.getElementById('spFamily')?.value || '';
  const minW   = parseFloat(document.getElementById('spMinW')?.value) || 0;
  const search = (document.getElementById('spSearch')?.value || '').toLowerCase();
  const grade  = AppState.wall.steelGrade || 'S355GP';
  const gM0    = currentFactors().gM0 || 1.0;

  const rows = Catalogue.sections.filter(s => {
    if (family && s.family !== family) return false;
    if (s.W_el_cm3_per_m < minW) return false;
    if (search && !s.designation.toLowerCase().includes(search)) return false;
    return true;
  });

  const tbody = document.getElementById('spTableBody');
  if (!tbody) return;
  tbody.innerHTML = rows.map(s => {
    const M_Rd = bendingResistance_kNm_per_m(s.id, grade, gM0);
    const isCurrent = AppState.wall.sectionId === s.id ? 'sp-row-active' : '';
    return `<tr class="${isCurrent}">
      <td><strong>${s.designation}</strong></td>
      <td>${s.family}</td>
      <td>${s.height_mm}</td>
      <td>${s.mass_kg_per_m2.toFixed(1)}</td>
      <td>${s.W_el_cm3_per_m.toFixed(0)}</td>
      <td>${s.I_cm4_per_m.toFixed(0)}</td>
      <td>${M_Rd.toFixed(0)}</td>
      <td><button class="btn-add" onclick="selectSection('${s.id}')">Select</button></td>
    </tr>`;
  }).join('') || `<tr><td colspan="8" style="text-align:center;color:#888">No sections match</td></tr>`;
}

function selectSection(id) {
  AppState.wall.sectionId = id;
  document.getElementById('wallSectionLabel').textContent = Catalogue.byId[id]?.designation || id;
  closeSectionPicker();
  markDirty();
  scheduleAutoSave();
  if (typeof refreshDiagram === 'function') refreshDiagram();
}

function autoPickSection() {
  if (!AppState.lastResults) {
    alert('Run a design check first so Auto-pick has an M_Ed to work against.');
    return;
  }
  const M_Ed = Math.max(...Object.values(AppState.lastResults).map(r => Math.abs(r?.M_max_kNm_per_m ?? 0)));
  const grade = AppState.wall.steelGrade || 'S355GP';
  const gM0   = currentFactors().gM0 || 1.0;
  // Sort ascending by mass per m²; pick the first that has M_Rd >= M_Ed
  const sorted = [...Catalogue.sections].sort((a, b) => a.mass_kg_per_m2 - b.mass_kg_per_m2);
  const pick = sorted.find(s => bendingResistance_kNm_per_m(s.id, grade, gM0) >= M_Ed);
  if (!pick) {
    alert(`No section in catalogue has M_Rd ≥ ${M_Ed.toFixed(0)} kNm/m at ${grade}. Try a higher steel grade.`);
    return;
  }
  selectSection(pick.id);
  alert(`Auto-pick: ${pick.designation} (${pick.mass_kg_per_m2.toFixed(0)} kg/m², M_Rd = ${bendingResistance_kNm_per_m(pick.id, grade, gM0).toFixed(0)} kNm/m vs M_Ed = ${M_Ed.toFixed(0)} kNm/m)`);
}
