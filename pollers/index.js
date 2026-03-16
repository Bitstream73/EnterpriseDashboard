import cron from 'node-cron';
import { pollTopology, pollDeployments, pollMetrics } from './railway.js';
import { pollAnthropicUsage } from './anthropic.js';
import { pollPineconeStats } from './pinecone.js';
import { pollCrewStatus } from './crew.js';

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
  await pollAnthropicUsage();
}

async function runCrewPoll() {
  await pollCrewStatus();
}

export async function startPollers() {
  console.log('[pollers] Starting initial data fetch...');

  // Initial fetch on startup
  await runRailwayPoll();
  await runAIUsagePoll();
  await pollPineconeStats();
  await runCrewPoll();

  console.log('[pollers] Initial fetch complete. Scheduling periodic polls...');

  // Schedule periodic polls — store task refs for graceful shutdown
  const railwayTask   = cron.schedule(secsToCron(POLL_RAILWAY_SEC),  runRailwayPoll);
  const aiTask        = cron.schedule(secsToCron(POLL_AI_SEC),        runAIUsagePoll);
  const pineconeTask  = cron.schedule(secsToCron(POLL_PINECONE_SEC), pollPineconeStats);
  // Crew status: poll every 5 minutes (same as AI usage)
  const crewTask      = cron.schedule(secsToCron(POLL_AI_SEC),        runCrewPoll);

  pollerTasks.push(railwayTask, aiTask, pineconeTask, crewTask);

  console.log(`[pollers] Railway: every ${POLL_RAILWAY_SEC}s | AI Usage: every ${POLL_AI_SEC}s | Pinecone: every ${POLL_PINECONE_SEC}s | Crew: every ${POLL_AI_SEC}s`);
}

// Track cron task handles so stopPollers() can clean up
const pollerTasks = [];

export function stopPollers() {
  pollerTasks.forEach(task => task.stop());
  console.log('[pollers] All cron tasks stopped.');
}
