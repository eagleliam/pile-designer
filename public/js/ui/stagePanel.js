'use strict';
// Design stages: tab strip + add / remove / rename / switch active.

function renderStages() {
  const host = document.getElementById('stageStrip');
  if (!host) return;
  const active = AppState.activeStageId;
  host.innerHTML = AppState.stages.map(s =>
    `<div class="stage-tab ${s.id === active ? 'active' : ''}" data-id="${s.id}" onclick="switchStage('${s.id}')" ondblclick="renameStage('${s.id}')" title="Click to switch · Double-click to rename">${escHtml(s.name)}</div>`
  ).join('') + `
    <button class="lc-add-btn btn-add" onclick="addStage()">+ Add stage</button>
    ${AppState.stages.length > 1 ? `<button class="btn-remove" onclick="removeStage('${active}')" style="margin-left:auto">Remove ${escHtml(activeStage().name)}</button>` : ''}
  `;
}

function switchStage(stageId) {
  AppState.activeStageId = stageId;
  populateActiveStageInputs();
  renderStages();
  renderSurcharges();
  renderProps();
  refreshDiagram();
  triggerRecalc();
  markDirty(); scheduleAutoSave();
}

function addStage() {
  const cur = activeStage();
  // Clone the active stage; user can then edit
  const id = 'stage-' + Math.random().toString(36).slice(2, 7);
  const newStage = {
    id,
    name: 'Stage ' + (AppState.stages.length + 1),
    passiveGroundLevel_m: cur.passiveGroundLevel_m,
    activeWaterLevel_m:   cur.activeWaterLevel_m,
    passiveWaterLevel_m:  cur.passiveWaterLevel_m,
    seepage:              cur.seepage,
    surcharges:           (cur.surcharges || []).map(x => ({ ...x, id: 'sc-' + Math.random().toString(36).slice(2, 6) })),
    props:                (cur.props      || []).map(x => ({ ...x, id: 'pr-' + Math.random().toString(36).slice(2, 6) }))
  };
  AppState.stages.push(newStage);
  AppState.activeStageId = id;
  populateActiveStageInputs();
  renderStages();
  renderSurcharges(); renderProps();
  refreshDiagram();
  triggerRecalc();
  markDirty(); scheduleAutoSave();
}

function removeStage(stageId) {
  if (AppState.stages.length <= 1) return;     // keep at least one
  const idx = AppState.stages.findIndex(s => s.id === stageId);
  if (idx < 0) return;
  if (!confirm(`Remove stage "${AppState.stages[idx].name}"?`)) return;
  AppState.stages.splice(idx, 1);
  AppState.activeStageId = AppState.stages[Math.min(idx, AppState.stages.length - 1)].id;
  populateActiveStageInputs();
  renderStages();
  renderSurcharges(); renderProps();
  refreshDiagram();
  triggerRecalc();
  markDirty(); scheduleAutoSave();
}

function renameStage(stageId) {
  const s = AppState.stages.find(st => st.id === stageId);
  if (!s) return;
  const name = prompt('Rename stage:', s.name);
  if (!name) return;
  s.name = name;
  renderStages();
  markDirty(); scheduleAutoSave();
}
