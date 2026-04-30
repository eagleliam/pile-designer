'use strict';

function runMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS designs (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      project_name  TEXT NOT NULL,
      project_ref   TEXT NOT NULL DEFAULT '',
      client        TEXT NOT NULL DEFAULT '',
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS revisions (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      design_id       INTEGER NOT NULL REFERENCES designs(id) ON DELETE CASCADE,
      revision_code   TEXT NOT NULL,
      revision_number INTEGER NOT NULL,
      description     TEXT NOT NULL DEFAULT '',
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      created_by      TEXT NOT NULL DEFAULT '',
      state           TEXT NOT NULL,
      UNIQUE(design_id, revision_number)
    );

    CREATE INDEX IF NOT EXISTS idx_revisions_design
      ON revisions(design_id, revision_number);
  `);
}

module.exports = { runMigrations };
