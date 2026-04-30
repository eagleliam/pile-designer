'use strict';

const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');

// GET /api/designs/:designId/revisions — list all revisions (metadata only, no state blob)
router.get('/:designId/revisions', (req, res) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT id, design_id, revision_code, revision_number, description, created_at, created_by
      FROM revisions
      WHERE design_id = ?
      ORDER BY revision_number ASC
    `).all(req.params.designId);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/designs/:designId/revisions — create new revision inheriting from latest
router.post('/:designId/revisions', (req, res) => {
  try {
    const db = getDb();
    const { designId } = req.params;
    const { description = '', createdBy = '' } = req.body;

    // Verify design exists
    const design = db.prepare(`SELECT id FROM designs WHERE id = ?`).get(designId);
    if (!design) return res.status(404).json({ error: 'Design not found' });

    // Find latest revision to inherit from
    const latest = db.prepare(`
      SELECT * FROM revisions WHERE design_id = ? ORDER BY revision_number DESC LIMIT 1
    `).get(designId);
    if (!latest) return res.status(404).json({ error: 'No existing revision to inherit from' });

    const newNumber = latest.revision_number + 1;
    const newCode = 'P' + String(newNumber).padStart(2, '0');

    const result = db.prepare(`
      INSERT INTO revisions (design_id, revision_code, revision_number, description, created_by, state)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(designId, newCode, newNumber, description, createdBy, latest.state);
    // latest.state is copied verbatim — full JSON blob from previous revision

    // Touch parent design updated_at
    db.prepare(`UPDATE designs SET updated_at = datetime('now') WHERE id = ?`).run(designId);

    res.status(201).json({
      revisionId: result.lastInsertRowid,
      revisionCode: newCode,
      inheritedFromRevisionCode: latest.revision_code
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/designs/:designId/revisions/:revId — get full revision including state blob
router.get('/:designId/revisions/:revId', (req, res) => {
  try {
    const db = getDb();
    const rev = db.prepare(`
      SELECT * FROM revisions WHERE id = ? AND design_id = ?
    `).get(req.params.revId, req.params.designId);
    if (!rev) return res.status(404).json({ error: 'Revision not found' });

    // Parse state blob before sending
    res.json({ ...rev, state: JSON.parse(rev.state) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/designs/:designId/revisions/:revId — update state and/or description
router.patch('/:designId/revisions/:revId', (req, res) => {
  try {
    const db = getDb();
    const { designId, revId } = req.params;
    const { state, description, createdBy } = req.body;

    const rev = db.prepare(`SELECT * FROM revisions WHERE id = ? AND design_id = ?`).get(revId, designId);
    if (!rev) return res.status(404).json({ error: 'Revision not found' });

    const newState = state ? JSON.stringify(state) : rev.state;
    const newDesc  = description !== undefined ? description : rev.description;
    const newBy    = createdBy   !== undefined ? createdBy   : rev.created_by;

    db.prepare(`
      UPDATE revisions SET state = ?, description = ?, created_by = ? WHERE id = ?
    `).run(newState, newDesc, newBy, revId);

    // Touch parent design updated_at
    db.prepare(`UPDATE designs SET updated_at = datetime('now') WHERE id = ?`).run(designId);

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/designs/:designId/revisions/:revId — delete revision (blocked if only one)
router.delete('/:designId/revisions/:revId', (req, res) => {
  try {
    const db = getDb();
    const { designId, revId } = req.params;

    const count = db.prepare(`SELECT COUNT(*) as c FROM revisions WHERE design_id = ?`).get(designId);
    if (count.c <= 1) {
      return res.status(400).json({ error: 'Cannot delete the only revision. Delete the whole design instead.' });
    }

    const result = db.prepare(`DELETE FROM revisions WHERE id = ? AND design_id = ?`).run(revId, designId);
    if (result.changes === 0) return res.status(404).json({ error: 'Revision not found' });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
