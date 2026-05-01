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
  // Shared geometry — wall top + active GL + trial embedment apply across stages.
  geometry: { activeGroundLevel_m: 0.00, wallTopLevel_m: 0.50, trialEmbedment_m: 4.00 },
  // Shared stratigraphy
  activeSoils:  [],
  passiveSoils: [],
  soilLibrary:  [],
  // Per-stage data: each stage carries its own dredge level, water levels, surcharges, props
  stages: [{
    id: 'stage-1', name: 'Stage 1',
    passiveGroundLevel_m: -4.00, activeWaterLevel_m: -2.00, passiveWaterLevel_m: -4.00, seepage: 'hydrostatic',
    surcharges: [], props: []
  }],
  activeStageId: 'stage-1',
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
let _recalcTimer   = null;

// Debounced live recalc — called from every input that affects results.
// Skips Bishop rotational stability (slower) unless the rotational view is active.
function triggerRecalc() {
  clearTimeout(_recalcTimer);
  _recalcTimer = setTimeout(() => {
    if (typeof runAllDesigns === 'function') {
      runAllDesigns({ skipStability: AppState.view !== 'rotational' });
    }
  }, 250);
}

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
  // Shared geometry
  const g = AppState.geometry;
  g.activeGroundLevel_m = numVal('geomActiveGround');
  g.wallTopLevel_m      = numVal('geomWallTop');
  g.trialEmbedment_m    = numVal('geomEmbedment');

  // Active stage's per-stage data (geometry + water + seepage)
  const stage = activeStage();
  if (stage) {
    stage.passiveGroundLevel_m = numVal('geomPassiveGround');
    stage.activeWaterLevel_m   = numVal('geomActiveWater');
    stage.passiveWaterLevel_m  = numVal('geomPassiveWater');
    stage.seepage              = document.getElementById('geomSeepage')?.value || 'hydrostatic';
  }

  // Wall is shared
  AppState.wall.steelGrade  = document.getElementById('wallSteelGrade')?.value || 'S355GP';
  AppState.wall.length_m    = computeWallLength();
  AppState.wall.type        = deriveWallTypeFromProps(stage?.props || []);

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
    soilLibrary:   AppState.soilLibrary,
    stages:        AppState.stages,
    activeStageId: AppState.activeStageId,
    wall:          AppState.wall,
    view:          AppState.view,
    rotational:    { ...AppState.rotational, lastResult: undefined }
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
  // Shared geometry
  Object.assign(AppState.geometry, state.geometry || {});
  setVal('geomActiveGround',  AppState.geometry.activeGroundLevel_m);
  setVal('geomWallTop',       AppState.geometry.wallTopLevel_m);
  setVal('geomEmbedment',     AppState.geometry.trialEmbedment_m);

  // Stages — back-compat: legacy designs may have no stages but a top-level
  // surcharges/props/passive-ground. Wrap them in a single stage on load.
  if (Array.isArray(state.stages) && state.stages.length) {
    AppState.stages = state.stages.map(s => ({ ...s, surcharges: (s.surcharges || []).map(x => ({...x})), props: (s.props || []).map(x => ({...x})) }));
    AppState.activeStageId = state.activeStageId && AppState.stages.some(s => s.id === state.activeStageId)
      ? state.activeStageId : AppState.stages[0].id;
  } else {
    AppState.stages = [{
      id: 'stage-1', name: 'Stage 1',
      passiveGroundLevel_m: state.geometry?.passiveGroundLevel_m ?? -4,
      activeWaterLevel_m:   state.geometry?.activeWaterLevel_m   ?? -2,
      passiveWaterLevel_m:  state.geometry?.passiveWaterLevel_m  ?? -4,
      seepage:              state.geometry?.seepage              ?? 'hydrostatic',
      surcharges:           (state.surcharges || []).map(x => ({...x})),
      props:                (state.props      || []).map(x => ({...x}))
    }];
    AppState.activeStageId = 'stage-1';
  }
  populateActiveStageInputs();

  // Wall
  Object.assign(AppState.wall, state.wall || {});
  setVal('wallType',       AppState.wall.type);
  setVal('wallSteelGrade', AppState.wall.steelGrade);
  // Back-compat: legacy designs may have wall.length_m but no trialEmbedment_m.
  // Derive embedment from the saved length so the input field is non-zero.
  if (!AppState.geometry.trialEmbedment_m && AppState.wall.length_m > 0) {
    const derived = AppState.wall.length_m - (AppState.geometry.wallTopLevel_m - AppState.geometry.passiveGroundLevel_m);
    if (derived > 0) {
      AppState.geometry.trialEmbedment_m = derived;
      setVal('geomEmbedment', derived);
    }
  }
  recomputeWallLength();
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

  // Soils (stratigraphy is shared)
  AppState.activeSoils  = (state.activeSoils  || []).map(s => ({ ...s }));
  AppState.passiveSoils = (state.passiveSoils || []).map(s => ({ ...s }));
  // Soil library: use what was saved, otherwise seed from built-in presets
  if (Array.isArray(state.soilLibrary) && state.soilLibrary.length) {
    AppState.soilLibrary = state.soilLibrary.map(s => ({ ...s }));
  } else if (typeof window !== 'undefined' && window.SOIL_PRESETS) {
    AppState.soilLibrary = window.SOIL_PRESETS.map(s => ({ ...s, builtin: true }));
  }
  if (typeof renderStages              === 'function') renderStages();
  if (typeof renderSoils               === 'function') renderSoils();
  if (typeof renderSurcharges          === 'function') renderSurcharges();
  if (typeof renderProps               === 'function') renderProps();
  if (typeof renderSoilLibrary         === 'function') renderSoilLibrary();
  if (typeof renderPilePropertiesPanel === 'function') renderPilePropertiesPanel();

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

// Push the active stage's per-stage data into the geometry input fields so the
// user sees the right values when they switch stages.
function populateActiveStageInputs() {
  const s = activeStage();
  if (!s) return;
  setVal('geomPassiveGround', s.passiveGroundLevel_m);
  setVal('geomActiveWater',   s.activeWaterLevel_m);
  setVal('geomPassiveWater',  s.passiveWaterLevel_m);
  setVal('geomSeepage',       s.seepage || 'hydrostatic');
}

function setVal(id, v)  { const el = document.getElementById(id);  if (el) el.value = v ?? ''; }
function setText(id, v) { const el = document.getElementById(id);  if (el) el.textContent = v ?? ''; }
function numVal(id)     { return parseFloat(document.getElementById(id)?.value); }

// ─── Stage helpers ───────────────────────────────────────────────────────────

function activeStage() {
  return AppState.stages.find(s => s.id === AppState.activeStageId) || AppState.stages[0];
}

function deepestPassiveGround() {
  // The wall must be embedded below the worst-case (deepest) dredge across all
  // stages. For the ACTIVE stage we read the live form input (not the stored
  // stage value) so the wall length stays accurate while the user is typing —
  // otherwise we'd be 250 ms behind on the debounced auto-save.
  const live = numVal('geomPassiveGround');
  const stages = AppState.stages || [];
  if (!stages.length) return -4;     // pre-init fallback
  return Math.min(...stages.map(s =>
    (s.id === AppState.activeStageId && !isNaN(live)) ? live : s.passiveGroundLevel_m
  ));
}

// Wall length sized off the deepest dredge across all stages so the same pile
// is long enough for every stage.
function computeWallLength() {
  const top   = numVal('geomWallTop');
  const emb   = numVal('geomEmbedment');
  if ([top, emb].some(v => isNaN(v))) return AppState.wall.length_m || 0;
  const deepest = deepestPassiveGround();
  return (top - deepest) + emb;
}

function recomputeWallLength() {
  const L = computeWallLength();
  AppState.wall.length_m = L;
  setVal('wallLength', L.toFixed(2));
}

// Build the snapshot of state representing a single stage as it should look to
// the solver — flattens shared + per-stage data into the legacy schema.
function snapshotForStage(stage) {
  const g = AppState.geometry;
  return {
    project:       collectProjectMeta(),
    designControl: AppState.designControl,
    geometry: {
      activeGroundLevel_m:  g.activeGroundLevel_m,
      passiveGroundLevel_m: stage.passiveGroundLevel_m,
      wallTopLevel_m:       g.wallTopLevel_m,
      trialEmbedment_m:     g.trialEmbedment_m,
      activeWaterLevel_m:   stage.activeWaterLevel_m,
      passiveWaterLevel_m:  stage.passiveWaterLevel_m,
      seepage:              stage.seepage || 'hydrostatic'
    },
    activeSoils:  AppState.activeSoils,
    passiveSoils: AppState.passiveSoils,
    surcharges:   stage.surcharges || [],
    props:        stage.props      || [],
    wall:         { ...AppState.wall, type: deriveWallTypeFromProps(stage.props || []) },
    rotational:   AppState.rotational,
    view:         AppState.view
  };
}

function deriveWallTypeFromProps(props) {
  if (!props || props.length === 0) return 'cantilever';
  if (props.length === 1)            return 'singleprop';
  return 'multiprop';
}
