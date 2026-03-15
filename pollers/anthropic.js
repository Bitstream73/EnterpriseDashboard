import { set, get } from '../cache/store.js';

const BASE = 'https://api.anthropic.com';
const TTL = 60 * 60 * 1000; // 1 hour

function getAdminKey() {
  return process.env.ANTHROPIC_ADMIN_API_KEY;
}

function getLast30DaysRange() {
  const now = new Date();
  const end = now.toISOString();
  const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  return { start, end };
}

async function apiGet(path, params = {}) {
  const adminKey = getAdminKey();
  const url = new URL(`${BASE}${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const res = await fetch(url.toString(), {
    headers: {
      'anthropic-version': '2023-06-01',
      'x-api-key': adminKey,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${text}`);
  }
  return res.json();
}

export async function pollAnthropicUsage() {
  const adminKey = getAdminKey();

  if (!adminKey) {
    set('usage:anthropic', {
      available: false,
      reason: 'ANTHROPIC_ADMIN_API_KEY not configured',
      buckets: [],
    }, TTL);
    console.log('[anthropic] admin key not configured — skipping');
    return;
  }

  try {
    const { start, end } = getLast30DaysRange();

    // Fetch usage data
    const usageData = await apiGet('/v1/organizations/usage_report/messages', {
      starting_at: start,
      ending_at: end,
      'group_by[]': 'model',
      bucket_width: '1d',
    });

    // Fetch cost data
    let costData = null;
    try {
      costData = await apiGet('/v1/organizations/cost_report', {
        starting_at: start,
        ending_at: end,
        bucket_width: '1d',
      });
    } catch (e) {
      console.warn('[anthropic] cost report failed (non-fatal):', e.message);
    }

    const result = {
      available: true,
      buckets: usageData?.data ?? [],
      costs: costData?.data ?? [],
      fetchedAt: new Date().toISOString(),
    };

    set('usage:anthropic', result, TTL);
    console.log(`[anthropic] usage cached: ${result.buckets.length} buckets`);
  } catch (err) {
    console.error('[anthropic] usage poll failed:', err.message);
    const existing = get('usage:anthropic');
    if (!existing) {
      set('usage:anthropic', {
        available: false,
        reason: err.message,
        buckets: [],
      }, TTL);
    }
  }
}
