# Wisp

Drop-in, self-hosted analytics engine backed by Convex. Tracks sessions, pageviews, interactions, and errors with a single machine/session identity model.

- **Client SDK** (3 KB gzip) — drops into any web app, SPA or MPA
- **Convex backend** — handles ingestion, geo-IP, aggregation, and serves dashboard queries
- **Dashboard** — Vite + React app with recharts charts, session explorer, error viewer, page analytics, and machine detail view

## Architecture

```
Browser (SDK)
  │
  │ POST /ingest  (batched events, every 5s or 20 events)
  ▼
Convex HTTP Action (convex.site/ingest)
  │
  ├── resolveGeo()    — Cloudflare cf-* headers → ip-api.com fallback
  │
  ▼
recordBatchWithGeo (internal mutation)
  │
  ├── upsertMachine()  — stores browser meta + geo on first visit
  ├── upsertSession()  — creates/updates session counters
  ├── events.insert()  — raw event log
  │
  ▼
closeStaleSessions (cron, every 10 min)
computeDailyStats    (cron, 00:15 UTC)
  │
  ▼
dailyStats table  ──►  Dashboard queries
```

## Contents

| Doc | What it covers |
|-----|----------------|
| [Quickstart](quickstart.md) | Set up Convex, install the SDK, see your first event |
| [Architecture](architecture.md) | Data model, identity model, event lifecycle |
| [Client SDK](sdk.md) | `init()`, `track()`, `trackError()`, plugins, config |
| [Backend](backend.md) | Schema, mutations, queries, HTTP Action, crons |
| [Dashboard](dashboard.md) | Charts, sessions table, error viewer, machine view |
| [Deployment](deployment.md) | Production Convex deploy, building the SDK, dashboard |
| [Testing](testing.md) | Running tests, writing integration tests, CI |

## Packages

| Directory | Package |
|-----------|---------|
| `src/` | `@yourorg/wisp` — client SDK (npm package) |
| `convex/` | Convex backend functions (deployed alongside your app) |
| `dashboard/` | Self-hosted analytics dashboard (Vite + React + recharts) |
| `tests/` | Vitest test suite (81 unit + 27 integration) |
