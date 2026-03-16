/**
 * Shared Railway API Client — Node.js ESM
 *
 * Usage:
 *   import { createRailwayClient } from '/home/jakek/.openclaw/workspace/shared/railway-client/railway.js';
 *   const railway = createRailwayClient(process.env.RAILWAY_API_TOKEN);
 *   const projects = await railway.getProjects();
 */

const GQL_ENDPOINT = 'https://backboard.railway.com/graphql/v2';

// ─── Queries ────────────────────────────────────────────────────────────────

const PROJECTS_QUERY = `
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

const DEPLOYMENTS_QUERY = `
  query deployments($input: DeploymentListInput!, $first: Int!) {
    deployments(input: $input, first: $first) {
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

const DEPLOYMENT_STATUS_QUERY = `
  query deploymentStatus($input: DeploymentListInput!) {
    deployments(input: $input, first: 1) {
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

const TRIGGER_DEPLOY_MUTATION = `
  mutation serviceInstanceDeploy($serviceId: String!, $environmentId: String!) {
    serviceInstanceDeploy(serviceId: $serviceId, environmentId: $environmentId)
  }
`;

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Creates a Railway API client bound to the given token.
 *
 * @param {string} token - Railway API token. Obtain from the Railway dashboard.
 * @returns {RailwayClient} A client object with methods for querying Railway.
 */
export function createRailwayClient(token) {
  if (!token) throw new Error('createRailwayClient: token is required');

  /**
   * Low-level GraphQL executor. Handles 429 rate limits (logs, does not crash).
   *
   * @param {string} query - GraphQL query or mutation string.
   * @param {object} [variables={}] - Variables for the query.
   * @returns {Promise<object>} The `data` field of the GraphQL response.
   * @throws {Error} On HTTP errors (excluding 429, which is logged and rethrown),
   *   or GraphQL-level errors.
   */
  async function gql(query, variables = {}) {
    let res;
    try {
      res = await fetch(GQL_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query, variables }),
      });
    } catch (networkErr) {
      throw new Error(`[railway-client] network error: ${networkErr.message}`);
    }

    if (res.status === 429) {
      const retryAfter = res.headers.get('Retry-After') ?? '(unknown)';
      console.warn(`[railway-client] rate limited (429). Retry-After: ${retryAfter}s. Not retrying automatically.`);
      throw new Error(`[railway-client] rate limited (429). Retry-After: ${retryAfter}s`);
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`[railway-client] HTTP ${res.status}: ${body}`);
    }

    const json = await res.json();
    if (json.errors) {
      throw new Error(`[railway-client] GraphQL errors: ${JSON.stringify(json.errors)}`);
    }
    return json.data;
  }

  return {
    /**
     * Fetches all projects visible to the token, including their services
     * and environments.
     *
     * @returns {Promise<object>} Raw GraphQL `projects` connection object.
     *   Shape: `{ edges: [ { node: { id, name, services, environments, ... } } ] }`
     */
    async getProjects() {
      const data = await gql(PROJECTS_QUERY);
      return data.projects;
    },

    /**
     * Fetches recent deployments for a specific service + environment.
     *
     * @param {string} serviceId - Railway service ID.
     * @param {string} envId - Railway environment ID.
     * @param {number} [limit=10] - Number of deployments to return (most recent first).
     * @returns {Promise<object>} Raw GraphQL `deployments` connection object.
     *   Shape: `{ edges: [ { node: { id, status, createdAt, url, meta, ... } } ] }`
     */
    async getDeployments(serviceId, envId, limit = 10) {
      if (!serviceId) throw new Error('getDeployments: serviceId is required');
      if (!envId) throw new Error('getDeployments: envId is required');

      const data = await gql(DEPLOYMENTS_QUERY, {
        input: { serviceId, environmentId: envId },
        first: limit,
      });
      return data.deployments;
    },

    /**
     * Fetches metrics (CPU, memory, network, disk) for a service over the
     * last hour, sampled at 5-minute intervals.
     *
     * @param {string} serviceId - Railway service ID.
     * @param {string} envId - Railway environment ID.
     * @returns {Promise<{ cpu: number|null, memoryGB: number|null, networkRxGB: number|null, networkTxGB: number|null, diskGB: number|null }>}
     *   The most recent value for each metric. Null if no data is available.
     */
    async getMetrics(serviceId, envId) {
      if (!serviceId) throw new Error('getMetrics: serviceId is required');
      if (!envId) throw new Error('getMetrics: envId is required');

      const endDate = new Date().toISOString();
      const startDate = new Date(Date.now() - 60 * 60 * 1000).toISOString();

      const data = await gql(METRICS_QUERY, {
        environmentId: envId,
        serviceId,
        startDate,
        endDate,
        sampleRateSeconds: 300,
        averagingWindowSeconds: 300,
      });

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
      return result;
    },

    /**
     * Triggers a new deployment for the specified service + environment.
     *
     * @param {string} serviceId - Railway service ID.
     * @param {string} envId - Railway environment ID.
     * @returns {Promise<boolean>} True if the mutation succeeded (Railway returns boolean).
     */
    async triggerDeploy(serviceId, envId) {
      if (!serviceId) throw new Error('triggerDeploy: serviceId is required');
      if (!envId) throw new Error('triggerDeploy: envId is required');

      const data = await gql(TRIGGER_DEPLOY_MUTATION, { serviceId, environmentId: envId });
      return data.serviceInstanceDeploy;
    },

    /**
     * Returns the most recent deployment's status for a service + environment.
     *
     * @param {string} serviceId - Railway service ID.
     * @param {string} envId - Railway environment ID.
     * @returns {Promise<object|null>} The latest deployment node, or null if none exists.
     *   Shape: `{ id, status, createdAt, updatedAt, url, staticUrl, meta }`
     *   Common status values: SUCCESS, FAILED, DEPLOYING, BUILDING, CRASHED, REMOVED
     */
    async getDeploymentStatus(serviceId, envId) {
      if (!serviceId) throw new Error('getDeploymentStatus: serviceId is required');
      if (!envId) throw new Error('getDeploymentStatus: envId is required');

      const data = await gql(DEPLOYMENT_STATUS_QUERY, {
        input: { serviceId, environmentId: envId },
      });
      return data?.deployments?.edges?.[0]?.node ?? null;
    },
  };
}
