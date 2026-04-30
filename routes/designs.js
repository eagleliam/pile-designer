'use strict';

const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');

function defaultState() {
  return JSON.stringify({
    project: { name: '', ref: '', client: '', designer: '', date: '' },
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
      wallTopLevel_m: 0.50,
      trialEmbedment_m: 4.00
    },
    activeSoils: [
      { id: 'as-1', name: 'Made Ground',     topLevel_m:  0.00, gamma: 18, gamma_sat: 19, phi: 28, c_eff: 0,  cu: 0,  E_MPa: 10, type: 'drained',   delta_active: 0.667, delta_passive: 0.500 },
      { id: 'as-2', name: 'Soft Clay',       topLevel_m: -2.00, gamma: 17, gamma_sat: 18, phi: 0,  c_eff: 0,  cu: 30, E_MPa: 5,  type: 'undrained', delta_active: 0.667, delta_passive: 0.500 },
      { id: 'as-3', name: 'Dense Sand',      topLevel_m: -5.00, gamma: 19, gamma_sat: 20, phi: 36, c_eff: 0,  cu: 0,  E_MPa: 60, type: 'drained',   delta_active: 0.667, delta_passive: 0.500 }
    ],
    passiveSoils: [
      { id: 'ps-1', name: 'Soft Clay',       topLevel_m: -4.00, gamma: 17, gamma_sat: 18, phi: 0,  c_eff: 0,  cu: 30, E_MPa: 5,  type: 'undrained', delta_active: 0.667, delta_passive: 0.500 },
      { id: 'ps-2', name: 'Dense Sand',      topLevel_m: -5.00, gamma: 19, gamma_sat: 20, phi: 36, c_eff: 0,  cu: 0,  E_MPa: 60, type: 'drained',   delta_active: 0.667, delta_passive: 0.500 }
    ],
    soilLibrary: [],
    stages: [
      {
        id: 'stage-1', name: 'Final excavation',
        passiveGroundLevel_m: -4.00,
        activeWaterLevel_m:   -2.00,
        passiveWaterLevel_m:  -4.00,
        seepage: 'hydrostatic',
        surcharges: [ { id: 'sc-1', kind: 'uniform', q: 10, side: 'active', loadType: 'permanent' } ],
        props: []
      }
    ],
    activeStageId: 'stage-1',
    wall: { type: 'cantilever', sectionId: 'AZ-26-700', steelGrade: 'S355GP', length_m: 8.50 },
    view: 'outline',
    rotational: {
      method: 'bishop',
      gridExtents: { xMin: -8, xMax: 4, yMin: 1, yMax: 12, step: 0.5 },
      radiusRange: { rMin: 4, rMax: 16, step: 0.5 },
      includeWallShear: true,
      targetFoS: 1.0
    }
  });
}

router.get('/', (req, res) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT
        d.id, d.project_name, d.project_ref, d.client, d.created_at, d.updated_at,
        r.revision_code AS latest_revision,
        COUNT(r2.id) AS revision_count
      FROM designs d
      LEFT JOIN revisions r ON r.design_id = d.id
        AND r.revision_number = (
          SELECT MAX(revision_number) FROM revisions WHERE design_id = d.id
        )
      LEFT JOIN revisions r2 ON r2.design_id = d.id
      GROUP BY d.id
      ORDER BY d.updated_at DESC
    `).all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', (req, res) => {
  try {
    const db = getDb();
    const { projectName, projectRef = '', client = '', createdBy = '', initialState } = req.body;
    if (!projectName) return res.status(400).json({ error: 'projectName is required' });

    const stateBlob = initialState ? JSON.stringify(initialState) : defaultState();

    const insertDesign   = db.prepare(`INSERT INTO designs (project_name, project_ref, client) VALUES (?, ?, ?)`);
    const insertRevision = db.prepare(`INSERT INTO revisions (design_id, revision_code, revision_number, description, created_by, state)
                                       VALUES (?, 'P01', 1, 'Initial design', ?, ?)`);

    let designId, revisionId;
    db.exec('BEGIN');
    try {
      const designResult = insertDesign.run(projectName, projectRef, client);
      designId = designResult.lastInsertRowid;
      const revResult    = insertRevision.run(designId, createdBy, stateBlob);
      revisionId = revResult.lastInsertRowid;
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    res.status(201).json({ designId, revisionId, revisionCode: 'P01' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', (req, res) => {
  try {
    const db = getDb();
    const design = db.prepare(`SELECT * FROM designs WHERE id = ?`).get(req.params.id);
    if (!design) return res.status(404).json({ error: 'Design not found' });
    res.json(design);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id', (req, res) => {
  try {
    const db = getDb();
    const { projectName, projectRef, client } = req.body;
    const design = db.prepare(`SELECT * FROM designs WHERE id = ?`).get(req.params.id);
    if (!design) return res.status(404).json({ error: 'Design not found' });

    db.prepare(`
      UPDATE designs SET
        project_name = ?,
        project_ref  = ?,
        client       = ?,
        updated_at   = datetime('now')
      WHERE id = ?
    `).run(
      projectName ?? design.project_name,
      projectRef  ?? design.project_ref,
      client      ?? design.client,
      req.params.id
    );

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', (req, res) => {
  try {
    const db = getDb();
    const result = db.prepare(`DELETE FROM designs WHERE id = ?`).run(req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: 'Design not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
