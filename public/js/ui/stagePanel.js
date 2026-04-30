'use strict';
// Design stages: tab strip + add / remove / rename / switch active / drag-reorder.

function renderStages() {
  const host = document.getElementById('stageStrip');
  if (!host) return;
  const active = AppState.activeStageId;
  host.innerHTML = AppState.stages.map((s, i) =>
    `<div class="stage-tab ${s.id === active ? 'active' : ''}"
          draggable="true"
          data-id="${s.id}" data-index="${i}"
          onclick="switchStage('${s.id}')"
          ondblclick="renameStage('${s.id}')"
          ondragstart="onStageDragStart(event,'${s.id}')"
          ondragover="onStageDragOver(event,'${s.id}')"
          ondragleave="onStageDragLeave(event,'${s.id}')"
          ondrop="onStageDrop(event,'${s.id}')"
          ondragend="onStageDragEnd(event)"
          title="Click to switch · Double-click to rename · Drag to reorder">${escHtml(s.name)}</div>`
  ).join('') + `
    <button class="lc-add-btn btn-add" onclick="addStage()">+ Add stage</button>
    ${AppState.stages.length > 1 ? `<button class="btn-remove" onclick="removeStage('${active}')" style="margin-left:auto">Remove ${escHtml(activeStage().name)}</button>` : ''}
  `;
}

// Flush any pending form edits into the CURRENTLY active stage before doing
// anything that will change the active stage. Without this, debounced edits
// to the geometry/water inputs get lost (or worse, applied to the new active
// stage) when switching tabs.
function flushFormToActiveStage() {
  if (typeof collectStateFromForm === 'function') {
    try { collectStateFromForm(); } catch (e) { /* defensive */ }
  }
}

function switchStage(stageId) {
  if (stageId === AppState.activeStageId) return;
  flushFormToActiveStage();
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
  flushFormToActiveStage();
  const cur = activeStage();
  // Clone the active stage; user can then edit. New stages append rightmost,
  // matching construction order: Stage 1 (leftmost) → final stage (rightmost).
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
  flushFormToActiveStage();
  AppState.stages.splice(idx, 1);
  AppState.activeStageId = AppState.stages[Math.min(idx, AppState.stages.length - 1)].id;
  populateActiveStageInputs();
  renderStages();
  renderSurcharges(); renderProps();
  refreshDiagram();
  triggerRecalc();
  markDirty(); scheduleAutoSave();
}

// ─── Drag and drop reordering ───────────────────────────────────────────────
let _dragSourceId = null;

function onStageDragStart(ev, id) {
  _dragSourceId = id;
  ev.dataTransfer.effectAllowed = 'move';
  ev.dataTransfer.setData('text/plain', id);   // Firefox needs SOME data
  ev.currentTarget.classList.add('stage-tab-dragging');
}

function onStageDragOver(ev, id) {
  if (!_dragSourceId || _dragSourceId === id) return;
  ev.preventDefault();
  ev.dataTransfer.dropEffect = 'move';
  ev.currentTarget.classList.add('stage-tab-drop-target');
}

function onStageDragLeave(ev, id) {
  ev.currentTarget.classList.remove('stage-tab-drop-target');
}

function onStageDrop(ev, targetId) {
  ev.preventDefault();
  ev.currentTarget.classList.remove('stage-tab-drop-target');
  if (!_dragSourceId || _dragSourceId === targetId) return;
  const fromIdx = AppState.stages.findIndex(s => s.id === _dragSourceId);
  const toIdx   = AppState.stages.findIndex(s => s.id === targetId);
  if (fromIdx < 0 || toIdx < 0) return;
  flushFormToActiveStage();
  const [moved] = AppState.stages.splice(fromIdx, 1);
  AppState.stages.splice(toIdx, 0, moved);
  _dragSourceId = null;
  renderStages();
  refreshDiagram();
  triggerRecalc();
  markDirty(); scheduleAutoSave();
}

function onStageDragEnd(ev) {
  document.querySelectorAll('.stage-tab-dragging, .stage-tab-drop-target').forEach(el => {
    el.classList.remove('stage-tab-dragging');
    el.classList.remove('stage-tab-drop-target');
  });
  _dragSourceId = null;
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
