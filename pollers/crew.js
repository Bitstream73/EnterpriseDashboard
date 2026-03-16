/**
 * Crew Status Poller
 *
 * Fetches the last message from each AI crew member's Discord reporting channel
 * to determine last known activity. This is the only data source accessible
 * from Railway (OpenClaw CLI is not available in Railway's runtime).
 *
 * Schedule metadata is hardcoded here and kept in sync with openclaw cron jobs.
 */

import { set } from '../cache/store.js';

// ─── Crew Roster ─────────────────────────────────────────────────────────────
// channelId = Discord channel where this crew member posts their reports
const CREW_MEMBERS = [
  {
    id: 'crusher',
    name: 'DR. CRUSHER',
    role: 'Medical Officer — Deployment Health',
    schedule: 'Daily 08:00 ET',
    scheduleHourET: 8,
    channelId: '1482839839706579025',
    accentColor: 'ice',
  },
  {
    id: 'worf',
    name: 'WORF',
    role: 'Security Officer — Vulnerability Sweep',
    schedule: 'Daily 09:00 ET',
    scheduleHourET: 9,
    channelId: '1482839624417022042',
    accentColor: 'tomato',
  },
  {
    id: 'value-discovery',
    name: 'VALUE DISCOVERY',
    role: 'Nightly Analysis — Proposal Generation',
    schedule: 'Daily 02:00 ET',
    scheduleHourET: 2,
    channelId: '1482847561269121187', // posts to Riker's channel
    accentColor: 'violet',
  },
];

const DISCORD_API = 'https://discord.com/api/v10';

/**
 * Compute status from last message timestamp relative to expected schedule.
 * Returns 'ok', 'stale', or 'pending'.
 *
 * 'ok'      — last message is within 24h
 * 'stale'   — last message is 24-48h old (missed a run)
 * 'pending' — no message found or message is >48h old
 */
function computeStatus(lastTimestamp) {
  if (!lastTimestamp) return 'pending';
  const ageMs = Date.now() - new Date(lastTimestamp).getTime();
  const h24 = 24 * 60 * 60 * 1000;
  if (ageMs < h24) return 'ok';
  if (ageMs < 2 * h24) return 'stale';
  return 'pending';
}

/** Fetch last N messages from a Discord channel. Returns [] on error. */
async function fetchLastMessages(channelId, token, limit = 3) {
  const url = `${DISCORD_API}/channels/${channelId}/messages?limit=${limit}`;
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bot ${token}`,
        'User-Agent': 'EnterpriseDashboard/1.0 (+https://enterprise-dashboard-production.up.railway.app)',
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn(`[pollers/crew] Discord API ${res.status} for channel ${channelId}: ${body}`);
      return [];
    }
    return await res.json();
  } catch (err) {
    console.warn(`[pollers/crew] Fetch error for channel ${channelId}:`, err.message);
    return [];
  }
}

/** Truncate a Discord message to a short preview. */
function msgPreview(content, maxLen = 120) {
  if (!content) return '';
  // Strip markdown headers, bold, etc. for cleaner display
  const cleaned = content
    .replace(/#{1,6}\s+/g, '')
    .replace(/\*\*/g, '')
    .replace(/\n+/g, ' ')
    .trim();
  return cleaned.length > maxLen ? cleaned.slice(0, maxLen) + '…' : cleaned;
}

// ─── Main Poll ────────────────────────────────────────────────────────────────

export async function pollCrewStatus() {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    set('crew:status', {
      available: false,
      reason: 'DISCORD_BOT_TOKEN not configured',
      members: [],
      updatedAt: new Date().toISOString(),
    }, 300_000);
    return;
  }

  const members = await Promise.all(CREW_MEMBERS.map(async (member) => {
    const messages = await fetchLastMessages(member.channelId, token, 3);
    const lastMsg = messages[0] ?? null;

    return {
      id:          member.id,
      name:        member.name,
      role:        member.role,
      schedule:    member.schedule,
      accentColor: member.accentColor,
      status:      computeStatus(lastMsg?.timestamp ?? null),
      lastMessage: lastMsg ? {
        content:   msgPreview(lastMsg.content),
        timestamp: lastMsg.timestamp,
        author:    lastMsg.author?.global_name ?? lastMsg.author?.username ?? '?',
      } : null,
    };
  }));

  set('crew:status', {
    available:  true,
    members,
    updatedAt:  new Date().toISOString(),
  }, 300_000); // 5-min TTL

  console.log('[pollers] Crew status updated:', members.map(m => `${m.name}:${m.status}`).join(' | '));
}
