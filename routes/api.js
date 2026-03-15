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

// ─── AI Usage ────────────────────────────────────────────────────────────────

router.get('/usage/anthropic', (req, res) => {
  res.json(get('usage:anthropic') ?? { available: false, reason: 'not yet polled', buckets: [] });
});

router.get('/usage/openai', (req, res) => {
  res.json(get('usage:openai') ?? { available: false, reason: 'not yet polled', buckets: [] });
});

router.get('/usage/combined', (req, res) => {
  const anthropic = get('usage:anthropic') ?? { available: false, buckets: [] };
  const openai = get('usage:openai') ?? { available: false, buckets: [] };
  res.json({ anthropic, openai });
});

// ─── Pinecone ────────────────────────────────────────────────────────────────

router.get('/pinecone/stats', (req, res) => {
  res.json(get('pinecone:stats') ?? { available: false, reason: 'not yet polled' });
});
