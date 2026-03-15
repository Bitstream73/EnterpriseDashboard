import cron from 'node-cron';
import { pollTopology, pollDeployments, pollMetrics } from './railway.js';
import { pollAnthropicUsage } from './anthropic.js';
import { pollOpenAIUsage } from './openai.js';
import { pollPineconeStats } from './pinecone.js';

const POLL_RAILWAY_SEC  = parseInt(process.env.POLL_INTERVAL_RAILWAY_SECONDS)  || 60;
const POLL_AI_SEC       = parseInt(process.env.POLL_INTERVAL_AI_USAGE_SECONDS) || 300;
const POLL_PINECONE_SEC = parseInt(process.env.POLL_INTERVAL_PINECONE_SECONDS) || 600;

// Convert seconds to node-cron expression
function secsToCron(secs) {
  if (secs < 60) return `*/${secs} * * * * *`;          // every N seconds
  const mins = Math.max(1, Math.round(secs / 60));
  return `*/${mins} * * * *`;                            // every N minutes
}

async function runRailwayPoll() {
  await pollTopology();
  await pollDeployments();
  await pollMetrics();
}

async function runAIUsagePoll() {
  await Promise.all([
    pollAnthropicUsage(),
    pollOpenAIUsage(),
  ]);
}

export async function startPollers() {
  console.log('[pollers] Starting initial data fetch...');

  // Initial fetch on startup
  await runRailwayPoll();
  await runAIUsagePoll();
  await pollPineconeStats();

  console.log('[pollers] Initial fetch complete. Scheduling periodic polls...');

  // Schedule periodic polls
  cron.schedule(secsToCron(POLL_RAILWAY_SEC), runRailwayPoll);
  cron.schedule(secsToCron(POLL_AI_SEC), runAIUsagePoll);
  cron.schedule(secsToCron(POLL_PINECONE_SEC), pollPineconeStats);

  console.log(`[pollers] Railway: every ${POLL_RAILWAY_SEC}s | AI Usage: every ${POLL_AI_SEC}s | Pinecone: every ${POLL_PINECONE_SEC}s`);
}
