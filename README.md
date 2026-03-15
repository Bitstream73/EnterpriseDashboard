# LCARS Ops Dashboard

**Stardate 103615.18** — A Star Trek TNG LCARS-aesthetic personal ops dashboard.

Monitors Railway deployments, AI token usage (Anthropic + OpenAI), and Pinecone index health — all from a single browser tab.

![LCARS Dashboard](https://img.shields.io/badge/LCARS-OPS%20CENTER-ff8800?style=flat-square&labelColor=000000)

---

## Features

- **Railway Deployments** — live service status, CPU/memory metrics, deploy timeline across all projects
- **AI Token Usage** — 30-day Chart.js line chart for Anthropic (org accounts) and OpenAI
- **Pinecone Index** — vector count, dimensions, index fullness, namespace breakdown
- **LCARS aesthetic** — Antonio font, orange/amber color palette, asymmetric panel layout
- **No build step** — vanilla HTML/CSS/JS frontend, `node server.js` and done
- **Railway-deployable** — `railway.toml` included, `$PORT` respected

---

## Quick Start

```bash
# 1. Clone and install
cd "EnterpriseDashboard"
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env with your API keys (see below)

# 3. Start
npm start
# → http://localhost:3000
```

---

## Environment Variables

### Pre-populated (Captain already has these)

| Variable | Source | Notes |
|---|---|---|
| `RAILWAY_API_TOKEN` | `VabaBackgammon/.env` as `RAILWAY_TOKEN` | Same UUID value — just renamed |
| `OPENAI_API_KEY` | `VabaBackgammon/.env` | Standard key, works for Usage API |
| `PINECONE_API_KEY` | `VabaBackgammon/.env` | Points to `vababackgammon` index |
| `PINECONE_INDEX_HOST` | `VabaBackgammon/.env` | `vababackgammon-t63tas7.svc...` |
| `PINECONE_INDEX_NAME` | — | Set to `vababackgammon` |

A ready `.env` file is already written at project root with these values.

### Not yet configured

| Variable | Why | How to get it |
|---|---|---|
| `ANTHROPIC_ADMIN_API_KEY` | Usage Report API requires org account + Admin key | [console.anthropic.com/settings/admin-keys](https://console.anthropic.com/settings/admin-keys) — **only if you have an org account** |

> **Note on Anthropic:** The standard `ANTHROPIC_API_KEY` in VabaBackgammon (`sk-ant-api03-...`) will **not** work for the Usage API. That endpoint requires an Admin key (`sk-ant-admin-...`) and an organization account. If you're on an individual account, the Anthropic panel will display "not configured" — this is expected.

### Full variable reference

```env
RAILWAY_API_TOKEN=         # Required — Railway account token
ANTHROPIC_ADMIN_API_KEY=   # Optional — org accounts only
OPENAI_API_KEY=            # Optional — standard key with read:usage
PINECONE_API_KEY=          # Optional
PINECONE_INDEX_HOST=       # Optional — data plane URL from Pinecone Console
PINECONE_INDEX_NAME=       # Optional — index name for metadata lookup

PORT=3000                  # Default: 3000 (Railway injects this automatically)
DASHBOARD_TITLE=ENTERPRISE OPS CENTER

POLL_INTERVAL_RAILWAY_SECONDS=60
POLL_INTERVAL_AI_USAGE_SECONDS=300
POLL_INTERVAL_PINECONE_SECONDS=600
```

---

## Project Structure

```
EnterpriseDashboard/
├── server.js              # Express app, static serve, poller startup
├── cache/
│   └── store.js           # In-memory TTL cache
├── pollers/
│   ├── index.js           # node-cron scheduler, startPollers()
│   ├── railway.js         # Railway GraphQL: topology + deployments + metrics
│   ├── anthropic.js       # Anthropic Usage API (org accounts)
│   ├── openai.js          # OpenAI Usage API
│   └── pinecone.js        # Pinecone index stats
├── routes/
│   └── api.js             # GET /api/* endpoints
├── public/
│   ├── index.html         # Single-page dashboard
│   ├── styles.css         # LCARS CSS (colors, layout, components)
│   └── app.js             # Frontend: polling, rendering, Chart.js
├── .env.example           # All env vars documented
├── railway.toml           # Railway deployment config
└── package.json
```

---

## Deploy to Railway

```bash
# 1. Create a new Railway project
railway login
railway init

# 2. Add environment variables in Railway dashboard
#    Settings → Variables → paste from your .env

# 3. Deploy
railway up
```

Railway auto-detects Node.js via `package.json`. The `railway.toml` configures:
- Start command: `node server.js`
- Health check: `GET /api/health`
- Restart on failure (max 3 retries)

**Security note:** The dashboard has no authentication. Railway-generated domains (`*.up.railway.app`) are not publicly guessable, so this is acceptable for personal use. Do not expose it publicly without adding HTTP Basic Auth.

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/health` | Server health + uptime |
| `GET` | `/api/railway/topology` | All projects + services |
| `GET` | `/api/railway/deployments` | Latest deployment per service |
| `GET` | `/api/railway/metrics` | CPU/memory/network per service |
| `GET` | `/api/railway/history/:serviceId` | Last 10 deploys for a service |
| `GET` | `/api/usage/anthropic` | Anthropic 30-day token usage |
| `GET` | `/api/usage/openai` | OpenAI 30-day token usage |
| `GET` | `/api/usage/combined` | Merged AI usage for charts |
| `GET` | `/api/pinecone/stats` | Pinecone index stats |
| `GET` | `/config` | Dashboard feature flags (no secrets) |

---

## Known Limitations

- **Anthropic Usage API** requires org account + Admin key. Individual accounts not supported.
- **Gemini** has no historical usage API via AI Studio key. Dashboard shows "View in AI Studio" link.
- **Pinecone** shows index health only — query/write operation counts are Console-only.
- **Railway metrics** require valid `environmentId` — auto-discovered from topology on startup.

---

*Built by Data, Chief Engineer. Stardate 103615.18.*
