/**
 * Railway polling module — EnterpriseDashboard
 *
 * All Railway API calls are delegated to the shared client.
 * Canonical source: /home/jakek/.openclaw/workspace/shared/railway-client/railway.js
 * Repo copy:        lib/railway-client.js (kept in-repo so Railway deploy has access)
 */

import { set, get } from '../cache/store.js';
import { createRailwayClient } from '../lib/railway-client.js';

const TTL_TOPOLOGY    = 5 * 60 * 1000;   // 5 min
const TTL_DEPLOYMENTS = 60 * 1000;        // 60 sec
const TTL_METRICS     = 5 * 60 * 1000;   // 5 min

function getClient() {
  const token = process.env.RAILWAY_API_TOKEN;
  if (!token) return null;
  return createRailwayClient(token);
}

// ─── Topology: all projects + services + environments ─────────────────────────

export async function pollTopology() {
  const client = getClient();
  if (!client) {
    set('railway:topology', { error: 'RAILWAY_API_TOKEN not configured', projects: { edges: [] } }, TTL_TOPOLOGY);
    return;
  }
  try {
    const projects = await client.getProjects();
    set('railway:topology', { projects }, TTL_TOPOLOGY);
    console.log(`[railway] topology cached: ${projects?.edges?.length ?? 0} projects`);
  } catch (err) {
    console.error('[railway] topology poll failed:', err.message);
    const existing = get('railway:topology');
    if (!existing) {
      set('railway:topology', { error: err.message, projects: { edges: [] } }, TTL_TOPOLOGY);
    }
  }
}

// ─── Deployments: latest deployment per service ───────────────────────────────

export async function pollDeployments() {
  const client = getClient();
  if (!client) {
    set('railway:deployments', {}, TTL_DEPLOYMENTS);
    return;
  }
  try {
    const topology = get('railway:topology');
    if (!topology?.projects?.edges?.length) {
      console.log('[railway] no topology yet, skipping deployments poll');
      return;
    }

    const deploymentMap = {};

    const deployTasks = topology.projects.edges.flatMap(({ node: project }) =>
      (project.services?.edges ?? []).map(({ node: service }) => {
        const envId = project.environments?.edges?.[0]?.node?.id;
        if (!envId) return Promise.resolve();

        return client.getDeployments(service.id, envId, 10)
          .then(deployments => {
            const edges = deployments?.edges ?? [];
            if (edges.length > 0) {
              const latest = edges[0].node;
              deploymentMap[service.id] = {
                ...latest,
                projectId: project.id,
                projectName: project.name,
                serviceName: service.name,
                recentDeploys: edges.map(e => e.node),
              };
            }
          })
          .catch(err => {
            console.warn(`[railway] deployments failed for service ${service.id}:`, err.message);
          });
      })
    );

    await Promise.allSettled(deployTasks);

    set('railway:deployments', deploymentMap, TTL_DEPLOYMENTS);
    console.log(`[railway] deployments cached: ${Object.keys(deploymentMap).length} services`);
  } catch (err) {
    console.error('[railway] deployments poll failed:', err.message);
  }
}

// ─── Metrics: CPU, memory, network per service ───────────────────────────────

export async function pollMetrics() {
  const client = getClient();
  if (!client) {
    set('railway:metrics', {}, TTL_METRICS);
    return;
  }
  try {
    const topology = get('railway:topology');
    if (!topology?.projects?.edges?.length) {
      console.log('[railway] no topology yet, skipping metrics poll');
      return;
    }

    const metricsMap = {};

    const metricsTasks = topology.projects.edges.flatMap(({ node: project }) => {
      const envId = project.environments?.edges?.[0]?.node?.id;
      if (!envId) return [];

      return (project.services?.edges ?? []).map(({ node: service }) =>
        client.getMetrics(service.id, envId)
          .then(result => {
            metricsMap[service.id] = result;
          })
          .catch(err => {
            console.warn(`[railway] metrics failed for service ${service.id}:`, err.message);
          })
      );
    });

    await Promise.allSettled(metricsTasks);

    set('railway:metrics', metricsMap, TTL_METRICS);
    console.log(`[railway] metrics cached: ${Object.keys(metricsMap).length} services`);
  } catch (err) {
    console.error('[railway] metrics poll failed:', err.message);
  }
}
