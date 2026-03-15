import { set, get } from '../cache/store.js';

const TTL = 10 * 60 * 1000; // 10 min

function getConfig() {
  return {
    apiKey: process.env.PINECONE_API_KEY,
    indexHost: process.env.PINECONE_INDEX_HOST,
    indexName: process.env.PINECONE_INDEX_NAME,
  };
}

export async function pollPineconeStats() {
  const { apiKey, indexHost, indexName } = getConfig();

  if (!apiKey || !indexHost) {
    set('pinecone:stats', {
      available: false,
      reason: 'PINECONE_API_KEY or PINECONE_INDEX_HOST not configured',
    }, TTL);
    console.log('[pinecone] not configured — skipping');
    return;
  }

  try {
    // Fetch index stats (data plane — goes to index host)
    const statsRes = await fetch(`${indexHost}/describe_index_stats`, {
      method: 'POST',
      headers: {
        'Api-Key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    if (!statsRes.ok) {
      throw new Error(`Pinecone stats HTTP ${statsRes.status}: ${await statsRes.text()}`);
    }

    const stats = await statsRes.json();

    // Fetch index metadata (control plane)
    let indexMeta = null;
    if (indexName) {
      try {
        const metaRes = await fetch(`https://api.pinecone.io/indexes/${indexName}`, {
          headers: { 'Api-Key': apiKey },
        });
        if (metaRes.ok) {
          indexMeta = await metaRes.json();
        }
      } catch (e) {
        console.warn('[pinecone] index metadata fetch failed (non-fatal):', e.message);
      }
    }

    const result = {
      available: true,
      indexName: indexName ?? 'unknown',
      totalVectorCount: stats.totalVectorCount ?? 0,
      dimension: stats.dimension ?? null,
      indexFullness: stats.indexFullness ?? 0,
      namespaces: stats.namespaces ?? {},
      status: indexMeta?.status?.ready ? 'ready' : (indexMeta ? 'initializing' : 'unknown'),
      indexMeta,
      fetchedAt: new Date().toISOString(),
    };

    set('pinecone:stats', result, TTL);
    console.log(`[pinecone] stats cached: ${result.totalVectorCount} vectors`);
  } catch (err) {
    console.error('[pinecone] stats poll failed:', err.message);
    const existing = get('pinecone:stats');
    if (!existing) {
      set('pinecone:stats', {
        available: false,
        reason: err.message,
      }, TTL);
    }
  }
}
