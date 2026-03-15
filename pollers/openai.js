import { set, get } from '../cache/store.js';

const BASE = 'https://api.openai.com';
const TTL = 60 * 60 * 1000; // 1 hour

function getKey() {
  return process.env.OPENAI_API_KEY;
}

function getLast30DaysRange() {
  const now = Math.floor(Date.now() / 1000);
  const start = now - 30 * 24 * 60 * 60;
  return { start, end: now };
}

async function apiGet(path, params = {}) {
  const key = getKey();
  const url = new URL(`${BASE}${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${key}`,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI API ${res.status}: ${text}`);
  }
  return res.json();
}

export async function pollOpenAIUsage() {
  const key = getKey();

  if (!key) {
    set('usage:openai', {
      available: false,
      reason: 'OPENAI_API_KEY not configured',
      buckets: [],
    }, TTL);
    console.log('[openai] API key not configured — skipping');
    return;
  }

  try {
    const { start, end } = getLast30DaysRange();

    // Fetch completion token usage
    const completionData = await apiGet('/v1/organization/usage/completions', {
      start_time: start,
      end_time: end,
      bucket_width: '1d',
      'group_by[]': 'model',
    });

    // Fetch cost data
    let costData = null;
    try {
      costData = await apiGet('/v1/organization/costs', {
        start_time: start,
        end_time: end,
        bucket_width: '1d',
      });
    } catch (e) {
      console.warn('[openai] cost data failed (non-fatal):', e.message);
    }

    const result = {
      available: true,
      buckets: completionData?.data ?? [],
      costs: costData?.data ?? [],
      fetchedAt: new Date().toISOString(),
    };

    set('usage:openai', result, TTL);
    console.log(`[openai] usage cached: ${result.buckets.length} buckets`);
  } catch (err) {
    console.error('[openai] usage poll failed:', err.message);
    const existing = get('usage:openai');
    if (!existing) {
      set('usage:openai', {
        available: false,
        reason: err.message,
        buckets: [],
      }, TTL);
    }
  }
}
