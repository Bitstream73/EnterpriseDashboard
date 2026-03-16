import { Router } from 'express';
import { get } from '../cache/store.js';

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
      openai:    !!process.env.OPENAI_API_KEY,
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

// Canonical paths
router.get('/usage/anthropic', (req, res) => {
  res.json(get('usage:anthropic') ?? { available: false, reason: 'not yet polled', buckets: [] });
});

router.get('/usage/openai', (req, res) => {
  res.json(get('usage:openai') ?? { available: false, reason: 'not yet polled', buckets: [] });
});

router.get('/usage/combined', (req, res) => {
  const anthropic = get('usage:anthropic') ?? { available: false, buckets: [] };
  const openai    = get('usage:openai')    ?? { available: false, buckets: [] };
  res.json({ anthropic, openai });
});

// Alias paths (what the frontend was calling — kept for backwards compat)
router.get('/anthropic/usage', (req, res) => {
  res.json(get('usage:anthropic') ?? { available: false, reason: 'not yet polled', buckets: [] });
});

router.get('/openai/usage', (req, res) => {
  res.json(get('usage:openai') ?? { available: false, reason: 'not yet polled', buckets: [] });
});

// ─── OpenAI History (last N days from cached buckets) ────────────────────────

router.get('/openai/history', (req, res) => {
  const days = Math.min(30, Math.max(1, parseInt(req.query.days) || 7));
  const data = get('usage:openai');

  if (!data?.available) {
    return res.json({
      available: false,
      reason: data?.reason ?? 'not yet polled',
      days: [],
    });
  }

  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

  // Build ordered day slots
  const byDay = {};
  for (let i = 0; i < days; i++) {
    const d   = new Date(Date.now() - i * 86400000);
    const key = d.toISOString().slice(0, 10);
    byDay[key] = { date: key, input_tokens: 0, output_tokens: 0, total_tokens: 0 };
  }

  for (const bucket of (data.buckets ?? [])) {
    // OpenAI returns start_time as Unix seconds
    const ts = (bucket.start_time ?? 0) * 1000;
    if (ts < cutoff) continue;
    const key = new Date(ts).toISOString().slice(0, 10);
    if (!byDay[key]) continue;

    const results = bucket.results ?? [bucket];
    for (const r of results) {
      const inp = r.input_tokens ?? 0;
      const out = r.output_tokens ?? 0;
      byDay[key].input_tokens  += inp;
      byDay[key].output_tokens += out;
      byDay[key].total_tokens  += inp + out;
    }
  }

  const result = Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date));
  res.json({ available: true, days: result, fetchedAt: data.fetchedAt });
});

// ─── Pinecone ────────────────────────────────────────────────────────────────

router.get('/pinecone/stats', (req, res) => {
  res.json(get('pinecone:stats') ?? { available: false, reason: 'not yet polled' });
});
