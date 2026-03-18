/**
 * Crew activity log — JSON file-backed store.
 *
 * Consistent with the dashboard's stateless design: in-memory array with
 * periodic flush to a JSON file for persistence across restarts.
 * No native dependencies — no build-time Python/node-gyp required.
 *
 * Keeps the last MAX_ROWS entries (auto-prunes on insert).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR  = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const FILE_PATH = path.join(DATA_DIR, 'activity.json');
const MAX_ROWS  = 500;

// ── Valid events ───────────────────────────────────────────────────────────
const VALID_EVENTS = new Set(['TASK_START', 'STEP', 'ISSUE', 'BLOCKED', 'TASK_DONE', 'TASK_FAILED']);

// ── In-memory store ────────────────────────────────────────────────────────
// Loaded once from disk on first access, written on insert.
let _activities = null;

function load() {
  if (_activities !== null) return;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const raw = fs.readFileSync(FILE_PATH, 'utf8');
    _activities = JSON.parse(raw);
  } catch {
    _activities = [];
  }
}

function flush() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE_PATH, JSON.stringify(_activities, null, 2));
  } catch (err) {
    console.warn('[activity-db] Failed to flush to disk:', err.message);
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

let _nextId = null;

function nextId() {
  if (_nextId === null) {
    _nextId = _activities.length > 0
      ? Math.max(..._activities.map(a => a.id)) + 1
      : 1;
  }
  return _nextId++;
}

/**
 * Insert a new activity entry and prune older entries beyond MAX_ROWS.
 * @param {{ agent: string, event: string, message: string, task?: string }} entry
 * @returns {{ id: number, timestamp: string }}
 */
export function insertActivity({ agent, event, message, task = null }) {
  load();

  if (!agent || !message) throw new Error('agent and message are required');
  const normalizedEvent = (event || 'STEP').toUpperCase();
  if (!VALID_EVENTS.has(normalizedEvent)) {
    throw new Error(`Invalid event. Must be one of: ${[...VALID_EVENTS].join(', ')}`);
  }

  const timestamp = new Date().toISOString();
  const id = nextId();

  const entry = {
    id,
    agent: agent.toLowerCase(),
    event: normalizedEvent,
    message,
    task: task || null,
    timestamp,
  };

  // Prepend (newest-first in memory)
  _activities.unshift(entry);

  // Prune
  if (_activities.length > MAX_ROWS) {
    _activities = _activities.slice(0, MAX_ROWS);
  }

  flush();
  return { id, timestamp };
}

/**
 * Retrieve recent activity entries (newest-first).
 * @param {{ limit?: number, agent?: string }} opts
 * @returns {Array}
 */
export function getActivities({ limit = 100, agent = null } = {}) {
  load();

  const cap = Math.min(Math.max(1, parseInt(limit) || 100), MAX_ROWS);
  const agentFilter = agent ? agent.toLowerCase() : null;

  const results = agentFilter
    ? _activities.filter(a => a.agent === agentFilter)
    : _activities;

  return results.slice(0, cap);
}
