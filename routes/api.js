import { Router } from 'express';
import { get } from '../cache/store.js';
import { insertActivity, getActivities } from '../lib/activity-db.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { createRailwayClient } from '../lib/railway-client.js';

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

// ─── Project Detail ──────────────────────────────────────────────────────────

/**
 * GET /api/project-detail/:projectId
 * Returns Railway metrics (from cache), latest deployment logs (live from Railway API),
 * and recent deployments for a specific project.
 * GitHub commits are intentionally omitted — all repos are private.
 */
router.get('/project-detail/:projectId', async (req, res) => {
  const { projectId } = req.params;

  // ── Find project in cached topology ──────────────────────────────────────
  const topology = get('railway:topology') ?? { projects: { edges: [] } };
  const projectEdge = topology.projects?.edges?.find(e => e.node.id === projectId);

  if (!projectEdge) {
    return res.status(404).json({ error: 'Project not found in topology cache. Cache may not be ready yet.' });
  }

  const project = projectEdge.node;
  const services = project.services?.edges?.map(e => e.node) ?? [];
  const envId = project.environments?.edges?.[0]?.node?.id ?? null;

  // ── Gather cached metrics and deployments for all services ───────────────
  const deploymentCache = get('railway:deployments') ?? {};
  const metricsCache    = get('railway:metrics') ?? {};

  const serviceDetails = services.map(svc => {
    const dep = deploymentCache[svc.id] ?? null;
    const met = metricsCache[svc.id] ?? null;
    return {
      id:          svc.id,
      name:        svc.name,
      status:      dep?.status ?? 'UNKNOWN',
      lastDeploy:  dep?.createdAt ?? null,
      deployUrl:   dep?.url ?? dep?.staticUrl ?? null,
      commitHash:  dep?.meta?.commitHash ?? null,
      commitMsg:   dep?.meta?.commitMessage ?? null,
      branch:      dep?.meta?.branch ?? null,
      githubRepo:  dep?.meta?.repo ?? null,
      recentDeploys: (dep?.recentDeploys ?? []).slice(0, 20),
      metrics: met ? {
        cpu:       met.cpu,
        memoryGB:  met.memoryGB,
        networkRx: met.networkRxGB,
        networkTx: met.networkTxGB,
        diskGB:    met.diskGB,
      } : null,
      latestDeploymentId: dep?.id ?? null,
    };
  });

  // ── Fetch deployment logs for the most recent deployment (live) ───────────
  const token = process.env.RAILWAY_API_TOKEN;
  const logsPerService = {};

  if (token && envId) {
    const client = createRailwayClient(token);
    await Promise.allSettled(
      serviceDetails.map(async svc => {
        if (!svc.latestDeploymentId) return;
        try {
          const GQL = `query { deploymentLogs(deploymentId: "${svc.latestDeploymentId}") { message timestamp } }`;
          const resp = await fetch('https://backboard.railway.com/graphql/v2', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ query: GQL }),
          });
          if (!resp.ok) return;
          const json = await resp.json();
          const logs = json?.data?.deploymentLogs ?? [];
          // Return last 30 lines
          logsPerService[svc.id] = logs.slice(-30).map(l => ({
            ts:      l.timestamp ? l.timestamp.slice(0, 19).replace('T', ' ') : '',
            message: l.message ?? '',
          }));
        } catch {
          // Non-fatal — log fetch failure
        }
      })
    );
  }

  res.json({
    project: {
      id:   project.id,
      name: project.name,
    },
    services: serviceDetails,
    logs: logsPerService,
    // GitHub commits not available — repos are private and no GitHub token is configured
    githubAvailable: false,
    githubNote: 'GitHub commit history unavailable — repositories are private.',
  });
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

// ─── Docs ─────────────────────────────────────────────────────────────────────

/**
 * GET /api/docs
 * Lists files in the /docs directory at project root (if present).
 * Returns { files: [{ name, size, modified }] }
 */
router.get('/docs', (req, res) => {
  const docsDir = path.join(__dirname, '..', 'docs');
  if (!fs.existsSync(docsDir)) {
    return res.json({ files: [] });
  }

  try {
    const entries = fs.readdirSync(docsDir);
    const files = entries
      .filter(name => !name.startsWith('.'))
      .map(name => {
        const fpath = path.join(docsDir, name);
        let stat;
        try { stat = fs.statSync(fpath); } catch { return null; }
        if (!stat.isFile()) return null;
        const kb = (stat.size / 1024).toFixed(1);
        return {
          name,
          size:     `${kb} KB`,
          modified: stat.mtime.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase(),
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name));

    res.json({ files });
  } catch (err) {
    console.error('[api/docs] error:', err);
    res.status(500).json({ files: [], error: err.message });
  }
});

// ─── Cron Schedule ────────────────────────────────────────────────────────────

/**
 * GET /api/crons
 * Returns cron jobs from the cache (populated by the OpenClaw gateway if configured)
 * or a static list from the node-cron pollers.
 */
router.get('/crons', (req, res) => {
  // Check cache first (if an external source populates this)
  const cached = get('crons:jobs');
  if (cached) return res.json({ jobs: cached });

  // Fall back: describe the built-in pollers
  const POLL_RAILWAY_SEC  = parseInt(process.env.POLL_INTERVAL_RAILWAY_SECONDS)  || 60;
  const POLL_AI_SEC       = parseInt(process.env.POLL_INTERVAL_AI_USAGE_SECONDS) || 300;
  const POLL_PINECONE_SEC = parseInt(process.env.POLL_INTERVAL_PINECONE_SECONDS) || 600;

  const jobs = [
    {
      id:          'railway-poller',
      name:        'Railway Topology + Deployments',
      schedule:    `Every ${POLL_RAILWAY_SEC}s`,
      description: 'Polls Railway GraphQL API for project topology, deployment status, and metrics.',
      enabled:     true,
    },
    {
      id:          'ai-usage-poller',
      name:        'AI Usage (Anthropic)',
      schedule:    `Every ${POLL_AI_SEC}s`,
      description: 'Fetches Anthropic Admin API token usage and cost data for the past 30 days.',
      enabled:     !!process.env.ANTHROPIC_ADMIN_API_KEY,
    },
    {
      id:          'pinecone-poller',
      name:        'Pinecone Index Stats',
      schedule:    `Every ${POLL_PINECONE_SEC}s`,
      description: 'Fetches Pinecone vector index statistics, namespace counts, and fullness.',
      enabled:     !!(process.env.PINECONE_API_KEY && process.env.PINECONE_INDEX_HOST),
    },
    {
      id:          'crew-poller',
      name:        'Crew Status',
      schedule:    `Every ${POLL_AI_SEC}s`,
      description: 'Checks OpenClaw crew agent session activity and last message timestamps.',
      enabled:     true,
    },
  ];

  res.json({ jobs });
});

// ─── Investments ──────────────────────────────────────────────────────────────

/**
 * GET /api/investments
 * Returns investment proposals from cache (populated externally).
 * Returns empty list if none loaded.
 */
router.get('/investments', (req, res) => {
  const cached = get('investments:proposals');
  if (cached) return res.json({ proposals: cached });
  res.json({ proposals: [] });
});
