'use strict';
// Application state. Single source of truth — collected to and populated from
// form inputs and the soils/surcharges/props arrays.

window.AppState = {
  // Persistence context
  currentDesignId:     null,
  currentRevisionId:   null,
  currentRevisionCode: null,
  isDirty:             false,

  // Design data — initial defaults match what routes/designs.js seeds
  designControl: {
    mode: 'EC7',
    activeCombination: 'C1',
    factors: {
      C1:  { gG: 1.35, gGfav: 1.00, gQ: 1.50, gPhi: 1.00, gCeff: 1.00, gCu: 1.00, gGamma: 1.00, gRe: 1.00, gM0: 1.00 },
      C2:  { gG: 1.00, gGfav: 1.00, gQ: 1.30, gPhi: 1.25, gCeff: 1.25, gCu: 1.40, gGamma: 1.00, gRe: 1.00, gM0: 1.00 },
      SLS: { gG: 1.00, gGfav: 1.00, gQ: 1.00, gPhi: 1.00, gCeff: 1.00, gCu: 1.00, gGamma: 1.00, gRe: 1.00, gM0: 1.00 }
    },
    globalFoS_passive: 2.0,
    embedmentSafetyFactor: 1.20
  },
  geometry: {
    activeGroundLevel_m: 0.00,
    passiveGroundLevel_m: -4.00,
    wallTopLevel_m: 0.50,
    trialEmbedment_m: 4.00,
    activeWaterLevel_m: -2.00,
    passiveWaterLevel_m: -4.00,
    seepage: 'hydrostatic'
  },
  activeSoils:  [],
  passiveSoils: [],
  surcharges:   [],
  props:        [],
  wall: { type: 'cantilever', sectionId: 'AZ-26-700', steelGrade: 'S355GP', length_m: 8.50 },
  view: 'outline',
  rotational: {
    method: 'bishop',
    gridExtents: { xMin: -8, xMax: 4, yMin: 1, yMax: 12, step: 0.5 },
    radiusRange: { rMin: 4, rMax: 16, step: 0.5 },
    includeWallShear: true,
    targetFoS: 1.0
  },

  // Runtime (not persisted)
  lastResults:        null,
  lastStabilityResult: null
};

let _autoSaveTimer = null;

function markDirty() {
  AppState.isDirty = true;
  const btn = document.getElementById('saveBtn');
  if (btn) { btn.classList.add('btn-dirty'); btn.textContent = 'Save*'; }
}

function markClean() {
  AppState.isDirty = false;
  const btn = document.getElementById('saveBtn');
  if (btn) { btn.classList.remove('btn-dirty'); btn.textContent = 'Save'; }
  const status = document.getElementById('saveStatus');
  if (status) { status.textContent = 'Saved ✓'; setTimeout(() => { status.textContent = ''; }, 3000); }
}

function scheduleAutoSave() {
  if (!AppState.currentRevisionId) return;
  clearTimeout(_autoSaveTimer);
  _autoSaveTimer = setTimeout(() => { if (AppState.isDirty) saveCurrentRevision(); }, 3000);
}

// ─── Collect / populate ──────────────────────────────────────────────────────

function collectStateFromForm() {
  // Geometry
  const g = AppState.geometry;
  g.activeGroundLevel_m  = numVal('geomActiveGround');
  g.passiveGroundLevel_m = numVal('geomPassiveGround');
  g.wallTopLevel_m       = numVal('geomWallTop');
  g.trialEmbedment_m     = numVal('geomEmbedment');
  g.activeWaterLevel_m   = numVal('geomActiveWater');
  g.passiveWaterLevel_m  = numVal('geomPassiveWater');
  g.seepage              = document.getElementById('geomSeepage')?.value || 'hydrostatic';

  // Wall
  AppState.wall.type        = document.getElementById('wallType')?.value || 'cantilever';
  AppState.wall.steelGrade  = document.getElementById('wallSteelGrade')?.value || 'S355GP';
  AppState.wall.length_m    = numVal('wallLength');

  // Design control
  AppState.designControl.mode              = document.getElementById('dcMode')?.value || 'EC7';
  AppState.designControl.activeCombination = document.getElementById('dcCombo')?.value || 'C1';
  AppState.designControl.globalFoS_passive  = numVal('dcGlobalFoS');
  AppState.designControl.embedmentSafetyFactor = numVal('dcEmbFactor');
  // factor inputs are pulled by factors.js
  if (typeof flushFactorsToState === 'function') flushFactorsToState();

  // Rotational stability params
  AppState.rotational.method            = document.getElementById('rotMethod')?.value || 'bishop';
  AppState.rotational.includeWallShear  = !!document.getElementById('rotIncludeWall')?.checked;
  AppState.rotational.targetFoS         = numVal('rotTargetFoS') || 1.0;

  return JSON.parse(JSON.stringify({
    project:       collectProjectMeta(),
    designControl: AppState.designControl,
    geometry:      AppState.geometry,
    activeSoils:   AppState.activeSoils,
    passiveSoils:  AppState.passiveSoils,
    surcharges:    AppState.surcharges,
    props:         AppState.props,
    wall:          AppState.wall,
    view:          AppState.view,
    rotational:    { ...AppState.rotational, lastResult: undefined }   // never persist big results
  }));
}

function collectProjectMeta() {
  return {
    name:     document.getElementById('projName')?.value     || '',
    ref:      document.getElementById('projRef')?.value      || '',
    client:   document.getElementById('projClient')?.value   || '',
    designer: document.getElementById('projDesigner')?.value || '',
    date:     document.getElementById('projDate')?.value     || ''
  };
}

function populateFormFromState(state) {
  // Geometry
  Object.assign(AppState.geometry, state.geometry || {});
  setVal('geomActiveGround',  AppState.geometry.activeGroundLevel_m);
  setVal('geomPassiveGround', AppState.geometry.passiveGroundLevel_m);
  setVal('geomWallTop',       AppState.geometry.wallTopLevel_m);
  setVal('geomEmbedment',     AppState.geometry.trialEmbedment_m);
  setVal('geomActiveWater',   AppState.geometry.activeWaterLevel_m);
  setVal('geomPassiveWater',  AppState.geometry.passiveWaterLevel_m);
  setVal('geomSeepage',       AppState.geometry.seepage || 'hydrostatic');

  // Wall
  Object.assign(AppState.wall, state.wall || {});
  setVal('wallType',       AppState.wall.type);
  setVal('wallSteelGrade', AppState.wall.steelGrade);
  setVal('wallLength',     AppState.wall.length_m);
  const lbl = document.getElementById('wallSectionLabel');
  if (lbl) lbl.textContent = (Catalogue.byId[AppState.wall.sectionId]?.designation) || AppState.wall.sectionId || '—';

  // Design control
  if (state.designControl) {
    Object.assign(AppState.designControl, state.designControl);
    if (state.designControl.factors) AppState.designControl.factors = state.designControl.factors;
  }
  setVal('dcMode',        AppState.designControl.mode);
  setVal('dcCombo',       AppState.designControl.activeCombination);
  setVal('dcGlobalFoS',   AppState.designControl.globalFoS_passive);
  setVal('dcEmbFactor',   AppState.designControl.embedmentSafetyFactor);
  if (typeof renderFactorsTable === 'function') renderFactorsTable();

  // Soils + surcharges + props
  AppState.activeSoils  = (state.activeSoils  || []).map(s => ({ ...s }));
  AppState.passiveSoils = (state.passiveSoils || []).map(s => ({ ...s }));
  AppState.surcharges   = (state.surcharges   || []).map(s => ({ ...s }));
  AppState.props        = (state.props        || []).map(p => ({ ...p }));
  if (typeof renderSoils       === 'function') renderSoils();
  if (typeof renderSurcharges  === 'function') renderSurcharges();
  if (typeof renderProps       === 'function') renderProps();

  // Rotational
  if (state.rotational) Object.assign(AppState.rotational, state.rotational);
  setVal('rotMethod',     AppState.rotational.method || 'bishop');
  setVal('rotTargetFoS',  AppState.rotational.targetFoS ?? 1.0);
  const rwc = document.getElementById('rotIncludeWall');
  if (rwc) rwc.checked = AppState.rotational.includeWallShear !== false;

  // View
  AppState.view = state.view || 'outline';
  if (typeof setActiveView === 'function') setActiveView(AppState.view);

  // Project meta
  const p = state.project || {};
  setVal('projName',     p.name     || '');
  setVal('projRef',      p.ref      || '');
  setVal('projClient',   p.client   || '');
  setVal('projDesigner', p.designer || '');
  setVal('projDate',     p.date     || '');
  syncProjectMeta();

  if (typeof refreshDiagram === 'function') refreshDiagram();
}

function syncProjectMeta() {
  const name = document.getElementById('projName')?.value || '';
  const ref  = document.getElementById('projRef')?.value  || '';
  const date = document.getElementById('projDate')?.value || '';
  document.body.dataset.project = name;
  document.body.dataset.date    = date;
  setText('coverProjName',     name || '—');
  setText('coverProjRef',      ref  || '—');
  setText('coverProjClient',   document.getElementById('projClient')?.value   || '—');
  setText('coverProjDesigner', document.getElementById('projDesigner')?.value || '—');
  setText('coverProjDate',     date || '—');
  setText('coverProjRev',      AppState.currentRevisionCode || document.getElementById('projRev')?.value || 'P01');
}

function setVal(id, v)  { const el = document.getElementById(id);  if (el) el.value = v ?? ''; }
function setText(id, v) { const el = document.getElementById(id);  if (el) el.textContent = v ?? ''; }
function numVal(id)     { return parseFloat(document.getElementById(id)?.value); }
