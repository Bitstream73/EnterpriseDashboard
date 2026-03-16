# EnterpriseDashboard — LCARS Ops Center

A Star Trek LCARS-inspired personal ops dashboard for monitoring Railway deployments and AI service usage. No persistence layer — all data lives in a TTL in-memory cache, populated by background pollers.

## Stack
- **Runtime:** Node.js 20+ (ESM modules, `"type": "module"`)
- **Framework:** Express 4 (minimal — only serves static files and a thin API)
- **Scheduling:** node-cron (background pollers only — no user-facing jobs)
- **Cache:** Custom in-memory TTL store (`cache/store.js`) — no Redis, no SQLite
- **Frontend:** Vanilla JS (`public/app.js`) — no framework, no bundler
- **Deploy:** Railway (Nixpacks, auto-detected Node.js)

## Project Structure

```
├── server.js            Entry point — Express setup, graceful shutdown, stardate
├── routes/
│   └── api.js           All API routes — serves from cache, never hits external APIs directly
├── pollers/
│   ├── index.js         Poller orchestration — cron scheduling, start/stop lifecycle
│   ├── railway.js       Railway GraphQL API poller (topology, deployments, metrics)
│   ├── anthropic.js     Anthropic Admin API usage poller
│   ├── pinecone.js      Pinecone index stats poller
│   └── openai.js        OpenAI usage poller
├── cache/
│   └── store.js         In-memory TTL cache (Map-based, key/value/expiresAt)
└── public/
    ├── index.html        Single-page app shell
    ├── app.js            Frontend — all rendering, polling loops, chart rendering
    └── styles.css        LCARS-themed CSS (dark, orange/gold color palette)
```

## Architecture

The design is deliberately simple:

1. **Server starts** → calls `startPollers()` which immediately fetches all data, then schedules cron jobs
2. **Pollers write** to the in-memory cache via `cache/store.js` with per-data-type TTLs
3. **API routes read** from cache only — they never call external APIs themselves
4. **Frontend polls** the local API every N seconds and re-renders widgets

No database. No auth. No sessions. This is a personal tool intended for single-user trusted environments.

## Key Commands

```bash
# Start (production)
npm start

# Start (dev with file watching)
npm run dev

# No tests currently
```

## Environment Variables

### Required
```
RAILWAY_API_TOKEN          Railway account token (not project token — account-level for all projects)
```

### Optional (enables dashboard sections when provided)
```
ANTHROPIC_ADMIN_KEY        sk-ant-admin... (NOT the regular ANTHROPIC_API_KEY)
                           Only org accounts have Admin API access — individual accounts do NOT
OPENAI_API_KEY             sk-...
PINECONE_API_KEY           pcsk_...
PINECONE_INDEX_HOST        https://your-index.svc.pinecone.io
PINECONE_INDEX_NAME        your-index-name
```

### Dashboard Config (all have defaults)
```
PORT=3000
DASHBOARD_TITLE=ENTERPRISE OPS CENTER
POLL_INTERVAL_RAILWAY_SECONDS=60       (default: 60)
POLL_INTERVAL_AI_USAGE_SECONDS=300     (default: 300)
POLL_INTERVAL_PINECONE_SECONDS=600     (default: 600)
```

## Coding Conventions

- ESM throughout — `import/export` only, no `require()`
- All routes return JSON from cache; if cache miss returns null, route returns a default empty shape (`??` operator pattern)
- Pollers call `set(key, value, ttlMs)` from `cache/store.js`; routes call `get(key)`
- Cache key naming: `namespace:subkey` (e.g., `railway:topology`, `usage:anthropic`)
- Frontend uses `fetchJSON('/api/path')` wrapper — never raw `fetch()`
- All frontend state in the `state` object (not scattered globals)
- LCARS color constants defined in `COLORS` and `STATUS_COLORS` objects at top of `app.js`

## Railway Deployment

```toml
# railway.toml
[build]
builder = "NIXPACKS"

[deploy]
startCommand = "node server.js"
restartPolicyType = "ON_FAILURE"
```

Railway Project ID: `3fa82112-7ebb-498b-8b75-2e7ac607ab4d`

## Known Gotchas

- **No data persistence.** Cache is in-memory. Server restart = all cached data gone until pollers run on startup.
- **Anthropic Admin API** requires an organization account. Individual Anthropic accounts don't have Admin API access. The `ANTHROPIC_ADMIN_KEY` starts with `sk-ant-admin...`, not `sk-ant-api...`.
- **Railway token scope.** The dashboard uses an *account-level* Railway token to see all projects. Project-scoped tokens won't work for the topology query.
- **Stardate calculation** uses a fan-standard formula: `(year - 2000) * 1000 + fractionalDayOfYear`. It's implemented in both `server.js` (startup log) and `app.js` (frontend display) — keep them in sync.
- **No auth on the API.** This is intentional for a local/private deployment. Do not expose this dashboard publicly without adding authentication.
- **poll interval < 60s** is handled in `secsToCron()` — it uses the `*/<N> * * * * *` (6-field) cron syntax for sub-minute intervals.

## What NOT To Do

- Don't add a database. The whole point is stateless in-memory caching. Add a DB only if the scope fundamentally changes.
- Don't call external APIs directly from route handlers. Pollers write to cache; routes read from cache. Keep that separation.
- Don't hardcode Railway project/service IDs. The dashboard reads all projects dynamically via the topology query.
- Don't add React or another framework to the frontend. Vanilla JS is deliberate — the app is simple enough.
- Don't use `process.env.RAILWAY_API_TOKEN` outside `pollers/railway.js` — keep API access centralized in pollers.
