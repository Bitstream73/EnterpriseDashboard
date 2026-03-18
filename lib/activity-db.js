/**
 * Crew activity log — SQLite-backed store.
 * Keeps the last MAX_ROWS entries; auto-prunes on insert.
 */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_PATH  = path.join(DATA_DIR, 'activity.db');
const MAX_ROWS = 500;

// Ensure data directory exists
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS crew_activity (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    agent     TEXT    NOT NULL,
    event     TEXT    NOT NULL,
    message   TEXT    NOT NULL,
    task      TEXT,
    timestamp TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )
`);

const VALID_EVENTS = new Set(['TASK_START', 'STEP', 'ISSUE', 'BLOCKED', 'TASK_DONE', 'TASK_FAILED']);

/**
 * Insert a new activity entry and prune old rows.
 * @param {{ agent: string, event: string, message: string, task?: string }} entry
 * @returns {{ id: number, timestamp: string }}
 */
export function insertActivity({ agent, event, message, task = null }) {
  if (!agent || !message) throw new Error('agent and message are required');
  const normalizedEvent = (event || 'STEP').toUpperCase();
  if (!VALID_EVENTS.has(normalizedEvent)) throw new Error(`Invalid event. Must be one of: ${[...VALID_EVENTS].join(', ')}`);

  const insert = db.prepare(`
    INSERT INTO crew_activity (agent, event, message, task)
    VALUES (?, ?, ?, ?)
  `);

  const prune = db.prepare(`
    DELETE FROM crew_activity
    WHERE id NOT IN (
      SELECT id FROM crew_activity ORDER BY id DESC LIMIT ${MAX_ROWS}
    )
  `);

  const run = db.transaction(() => {
    const result = insert.run(agent.toLowerCase(), normalizedEvent, message, task || null);
    prune.run();
    return result;
  });

  const result = run();
  const row = db.prepare('SELECT timestamp FROM crew_activity WHERE id = ?').get(result.lastInsertRowid);
  return { id: result.lastInsertRowid, timestamp: row.timestamp };
}

/**
 * Retrieve recent activity entries.
 * @param {number} limit Max entries to return (default 100, max 500)
 * @param {string|null} agent Filter by agent id (optional)
 * @returns {Array}
 */
export function getActivities({ limit = 100, agent = null } = {}) {
  const cap = Math.min(Math.max(1, parseInt(limit) || 100), MAX_ROWS);

  if (agent) {
    return db.prepare(`
      SELECT id, agent, event, message, task, timestamp
      FROM crew_activity
      WHERE agent = ?
      ORDER BY id DESC LIMIT ?
    `).all(agent.toLowerCase(), cap);
  }

  return db.prepare(`
    SELECT id, agent, event, message, task, timestamp
    FROM crew_activity
    ORDER BY id DESC LIMIT ?
  `).all(cap);
}
