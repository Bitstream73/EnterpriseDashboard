import { set, get } from '../cache/store.js';

const GQL = 'https://backboard.railway.com/graphql/v2';

const TTL_TOPOLOGY    = 5 * 60 * 1000;   // 5 min
const TTL_DEPLOYMENTS = 60 * 1000;        // 60 sec
const TTL_METRICS     = 5 * 60 * 1000;   // 5 min

function getToken() {
  return process.env.RAILWAY_API_TOKEN;
}

async function gql(query, variables = {}) {
  const token = getToken();
  if (!token) throw new Error('RAILWAY_API_TOKEN not set');

  const res = await fetch(GQL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    throw new Error(`Railway GQL HTTP ${res.status}: ${await res.text()}`);
  }

  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

// ─── Topology: all projects + services + environments ─────────────────────────

const TOPOLOGY_QUERY = `
  query {
    projects {
      edges {
        node {
          id
          name
          description
          createdAt
          updatedAt
          services {
            edges {
              node {
                id
                name
                createdAt
              }
            }
          }
          environments {
            edges {
              node {
                id
                name
              }
            }
          }
        }
      }
    }
  }
`;

export async function pollTopology() {
  if (!getToken()) {
    set('railway:topology', { error: 'RAILWAY_API_TOKEN not configured', projects: { edges: [] } }, TTL_TOPOLOGY);
    return;
  }
  try {
    const data = await gql(TOPOLOGY_QUERY);
    set('railway:topology', data, TTL_TOPOLOGY);
    console.log(`[railway] topology cached: ${data?.projects?.edges?.length ?? 0} projects`);
  } catch (err) {
    console.error('[railway] topology poll failed:', err.message);
    const existing = get('railway:topology');
    if (!existing) {
      set('railway:topology', { error: err.message, projects: { edges: [] } }, TTL_TOPOLOGY);
    }
  }
}

// ─── Deployments: latest deployment per service ───────────────────────────────

const DEPLOYMENTS_QUERY = `
  query deployments($input: DeploymentListInput!) {
    deployments(input: $input, first: 10) {
      edges {
        node {
          id
          status
          createdAt
          updatedAt
          url
          staticUrl
          meta
        }
      }
    }
  }
`;

export async function pollDeployments() {
  if (!getToken()) {
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
      (project.services?.edges ?? []).map(({ node: service }) =>
        gql(DEPLOYMENTS_QUERY, {
          input: { projectId: project.id, serviceId: service.id },
        }).then(data => {
          const edges = data?.deployments?.edges ?? [];
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
        }).catch(err => {
          console.warn(`[railway] deployments failed for service ${service.id}:`, err.message);
        })
      )
    );

    await Promise.allSettled(deployTasks);

    set('railway:deployments', deploymentMap, TTL_DEPLOYMENTS);
    console.log(`[railway] deployments cached: ${Object.keys(deploymentMap).length} services`);
  } catch (err) {
    console.error('[railway] deployments poll failed:', err.message);
  }
}

// ─── Metrics: CPU, memory, network per service ───────────────────────────────

const METRICS_QUERY = `
  query ServiceMetrics(
    $environmentId: String!
    $serviceId: String
    $startDate: DateTime!
    $endDate: DateTime!
    $sampleRateSeconds: Float
    $averagingWindowSeconds: Float
  ) {
    metrics(
      environmentId: $environmentId
      serviceId: $serviceId
      startDate: $startDate
      endDate: $endDate
      sampleRateSeconds: $sampleRateSeconds
      averagingWindowSeconds: $averagingWindowSeconds
      groupBy: SERVICE_ID
      measurements: [CPU_USAGE, MEMORY_USAGE_GB, NETWORK_RX_GB, NETWORK_TX_GB, DISK_USAGE_GB]
    ) {
      measurement
      tags {
        serviceId
      }
      values {
        ts
        value
      }
    }
  }
`;

export async function pollMetrics() {
  if (!getToken()) {
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
    const endDate = new Date().toISOString();
    const startDate = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // last 1 hour

    const metricsTasks = topology.projects.edges.flatMap(({ node: project }) => {
      const envId = project.environments?.edges?.[0]?.node?.id;
      if (!envId) return [];

      return (project.services?.edges ?? []).map(({ node: service }) =>
        gql(METRICS_QUERY, {
          environmentId: envId,
          serviceId: service.id,
          startDate,
          endDate,
          sampleRateSeconds: 300,
          averagingWindowSeconds: 300,
        }).then(data => {
          const result = { cpu: null, memoryGB: null, networkRxGB: null, networkTxGB: null, diskGB: null };

          for (const metric of (data?.metrics ?? [])) {
            const lastVal = metric.values?.[metric.values.length - 1]?.value ?? null;
            switch (metric.measurement) {
              case 'CPU_USAGE':       result.cpu = lastVal; break;
              case 'MEMORY_USAGE_GB': result.memoryGB = lastVal; break;
              case 'NETWORK_RX_GB':   result.networkRxGB = lastVal; break;
              case 'NETWORK_TX_GB':   result.networkTxGB = lastVal; break;
              case 'DISK_USAGE_GB':   result.diskGB = lastVal; break;
            }
          }

          metricsMap[service.id] = result;
        }).catch(err => {
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
