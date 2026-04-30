'use strict';
// Uses the built-in node:sqlite module (Node v22.5+ / v24+).

const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const { runMigrations } = require('./migrations');

const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH
  || path.join(__dirname, '..', 'data');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'pile-designer.db');

let db;

function getDb() {
  if (!db) {
    db = new DatabaseSync(DB_PATH);
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
  }
  return db;
}

function initDb() {
  runMigrations(getDb());
  console.log(`Database ready at: ${DB_PATH}`);
}

module.exports = { getDb, initDb };
