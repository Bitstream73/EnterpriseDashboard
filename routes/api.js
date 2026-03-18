import { Router } from 'express';
import { get } from '../cache/store.js';
import { insertActivity, getActivities } from '../lib/activity-db.js';

export const router = Router();

// ─── Health ──────────────────────────────────────────────────────────────────

router.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    ts: Date.now(),
    uptime: process.uptime(),
    version: '1.0.0',
  });
});

// ─── Config ──────────────────────────────────────────────────────────────────

router.get('/config', (req, res) => {
  const title = process.env.DASHBOARD_TITLE || 'ENTERPRISE OPS CENTER';
  res.json({
    title,
    features: {
      railway:   !!process.env.RAILWAY_API_TOKEN,
      anthropic: !!process.env.ANTHROPIC_ADMIN_API_KEY,
      pinecone:  !!(process.env.PINECONE_API_KEY && process.env.PINECONE_INDEX_HOST),
    },
  });
});

// ─── Railway ─────────────────────────────────────────────────────────────────

router.get('/railway/topology', (req, res) => {
  res.json(get('railway:topology') ?? { projects: { edges: [] } });
});

router.get('/railway/deployments', (req, res) => {
  res.json(get('railway:deployments') ?? {});
});

router.get('/railway/metrics', (req, res) => {
  res.json(get('railway:metrics') ?? {});
});

// History per service — we store recent deploys inside the deployments cache
router.get('/railway/history/:serviceId', (req, res) => {
  const deployments = get('railway:deployments') ?? {};
  const serviceData = deployments[req.params.serviceId];
  if (!serviceData) return res.json([]);
  res.json(serviceData.recentDeploys ?? []);
});

// ─── Railway: Aggregated History (last N days, grouped by day) ────────────────

router.get('/railway/history', (req, res) => {
  const days  = Math.min(30, Math.max(1, parseInt(req.query.days) || 7));
  const deployments = get('railway:deployments') ?? {};

  // Build a map: dateKey → { total, byProject: { name → count }, statuses: [] }
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const byDay  = {};

  for (let i = 0; i < days; i++) {
    const d   = new Date(Date.now() - i * 86400000);
    const key = d.toISOString().slice(0, 10); // YYYY-MM-DD
    byDay[key] = { date: key, total: 0, byProject: {}, statuses: {} };
  }

  for (const [, svcData] of Object.entries(deployments)) {
    const recentDeploys = svcData.recentDeploys ?? [svcData];
    const projectName   = svcData.projectName ?? 'Unknown';

    for (const dep of recentDeploys) {
      if (!dep.createdAt) continue;
      const ts = new Date(dep.createdAt).getTime();
      if (ts < cutoff) continue;

      const key = new Date(dep.createdAt).toISOString().slice(0, 10);
      if (!byDay[key]) continue;

      byDay[key].total++;
      byDay[key].byProject[projectName] = (byDay[key].byProject[projectName] ?? 0) + 1;
      const status = dep.status ?? 'UNKNOWN';
      byDay[key].statuses[status] = (byDay[key].statuses[status] ?? 0) + 1;
    }
  }

  // Return sorted chronologically
  const result = Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date));
  res.json(result);
});

// ─── AI Usage ────────────────────────────────────────────────────────────────

router.get('/usage/anthropic', (req, res) => {
  res.json(get('usage:anthropic') ?? { available: false, reason: 'not yet polled', buckets: [] });
});

router.get('/usage/combined', (req, res) => {
  const anthropic = get('usage:anthropic') ?? { available: false, buckets: [] };
  res.json({ anthropic });
});

router.get('/anthropic/usage', (req, res) => {
  res.json(get('usage:anthropic') ?? { available: false, reason: 'not yet polled', buckets: [] });
});

// ─── Pinecone ────────────────────────────────────────────────────────────────

router.get('/pinecone/stats', (req, res) => {
  res.json(get('pinecone:stats') ?? { available: false, reason: 'not yet polled' });
});

// ─── Crew Status ─────────────────────────────────────────────────────────────

router.get('/crew/status', (req, res) => {
  res.json(get('crew:status') ?? { available: false, reason: 'not yet polled', members: [] });
});

// ─── Crew Activity Log ───────────────────────────────────────────────────────

/**
 * POST /api/crew/activity
 * Body: { agent, event, message, task? }
 * Agents post status updates here. No auth required.
 */
router.post('/crew/activity', (req, res) => {
  const { agent, event, message, task } = req.body || {};

  if (!agent || !message) {
    return res.status(400).json({ error: 'agent and message are required' });
  }

  try {
    const { id, timestamp } = insertActivity({ agent, event, message, task });
    res.status(201).json({ ok: true, id, timestamp });
  } catch (err) {
    if (err.message.includes('Invalid event')) {
      return res.status(400).json({ error: err.message });
    }
    console.error('[api/crew/activity] insert error:', err);
    res.status(500).json({ error: 'Failed to store activity' });
  }
});

/**
 * GET /api/crew/activity
 * Query params: limit (default 100, max 500), agent (filter by agent id)
 * Returns last N activity entries, newest first.
 */
router.get('/crew/activity', (req, res) => {
  const { limit, agent } = req.query;

  try {
    const activities = getActivities({ limit, agent });
    res.json({ activities, count: activities.length });
  } catch (err) {
    console.error('[api/crew/activity] query error:', err);
    res.status(500).json({ error: 'Failed to retrieve activity' });
  }
});
