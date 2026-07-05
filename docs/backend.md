# Convex backend

## Files

| File | Purpose |
|------|---------|
| `convex/schema.ts` | Table definitions, indexes, search indexes |
| `convex/events.ts` | `recordBatch`, `recordBatchWithGeo`, `getSessionEvents`, `getTopErrors` |
| `convex/stats.ts` | `closeStaleSessions`, `computeDailyStats`, `getDailyStats` |
| `convex/http.ts` | HTTP Action at `/ingest` — IP detection, geo-resolution, CORS |
| `convex/dashboard.ts` | Dashboard queries — `listSessions`, `listEvents`, `getOverview`, `getErrorBreakdown`, `getErrorDetails`, `getMachineStats`, `searchMachines`, `recomputeStats`, `getTopPages`, `getPageVisitors`, `getPageViewsOverTime` |
| `convex/crons.ts` | Cron job definitions (10-min session sweep, daily stats at 00:15 UTC) |

## Mutations

### `events:recordBatch` (public mutation)

Primary ingestion path. Accepts an array of events and processes them oldest-first:

```typescript
const result = await ctx.runMutation("events:recordBatch", {
  events: [{
    sessionId: "uuid",
    machineId: "uuid",
    userId?: "user-42",
    type: "pageview" | "interaction" | "error" | "custom",
    name: "signup_completed",
    payload?: { plan: "pro" },
    url: "https://mysite.com/checkout",
    timestamp: Date.now(),
  }],
});
// → { inserted: 1 }
```

For each event it:
1. Upserts the machine (creates or bumps `lastSeenAt`)
2. Upserts the session (creates or increments counters)
3. Inserts the event row

If the event `name === "session_start"`, the payload is passed to `upsertMachine` as `meta` to populate `userAgent`, `platform`, `referrer`, and `screen` on the machine row.

> **Note**: This mutation does not accept geo data. Events that need IP/geo resolution must go through the HTTP Action.

### `events:recordBatchWithGeo` (internal mutation)

Same as `recordBatch` but also accepts a `geo` object:

```typescript
ctx.runMutation(internal.events.recordBatchWithGeo, {
  events: [...],
  geo: { ip: "1.2.3.4", country: "US", region: "California", city: "San Francisco" },
});
```

Only called by the HTTP Action. The geo data is stored on the machine row at creation time.

### `events:getSessionEvents` (query)

Returns all events for a session, ascending by timestamp:

```typescript
const events = await ctx.runQuery("events:getSessionEvents", {
  sessionId: "uuid",
});
```

### `events:getTopErrors` (query)

Returns the most frequent error names in a time range:

```typescript
const errors = await ctx.runQuery("events:getTopErrors", {
  since: Date.now() - 86400000, // last 24h
});
// → [{ name: "TypeError", count: 42 }, ...]
```

## HTTP Action

`POST https://{deployment}.convex.site/ingest`

The SDK's `ConvexTransport` sends all events here. The HTTP Action:

1. Parses the JSON body (`{ events: [...] }`)
2. Resolves geo data:
   - Extracts IP from `cf-connecting-ip` → `x-forwarded-for` → `x-real-ip`
   - Reads Cloudflare geo headers (`cf-ipcountry`, `cf-region`, `cf-ipcity`)
   - If Cloudflare data is incomplete, falls back to `ip-api.com` (free, 45 req/min)
3. Calls `recordBatchWithGeo` with the events and geo data
4. Returns `204 No Content` with CORS headers

CORS is fully open (`Access-Control-Allow-Origin: *`) to support browser-based SDK usage from any origin.

## Crons

### `closeStaleSessions`

Runs every 10 minutes. Finds sessions where `lastActivityAt` is more than 30 minutes ago and `endedAt` is not set. Closes them by setting `endedAt = lastActivityAt` and `durationMs = lastActivityAt - startedAt`.

### `computeDailyStats`

Runs at 00:15 UTC. Computes daily rollups for the previous day:
- Counts new machines (by `firstSeenDate`)
- Counts returning users (unique machineIds with isReturning sessions)
- Sums sessions, errors, events
- Computes average session duration

Uses upsert — if the day's row already exists, it's replaced.

## Dashboard queries

### `dashboard:getOverview`

Returns aggregated stats and a time-series for the chart:

```typescript
const overview = await ctx.runQuery("dashboard:getOverview", {
  startDate: "2026-06-01",
  endDate: "2026-07-04",
});
// {
//   totals: { newUsers, returningUsers, totalSessions, totalErrors, totalEvents, totalPageViews },
//   avgSessionDurationMs: 152000,
//   series: [{ date: "2026-07-04", newUsers, returningUsers, totalSessions, ... }, ...]
// }
```

If `dailyStats` has data for the range, it's used (fast, pre-aggregated). Otherwise, falls back to scanning raw sessions (slower but always correct).

### `dashboard:listSessions`

Paginated, sortable, filterable session list. Supports:
- Search by URL (using the `search_entryUrl` search index)
- Sort by `startedAt`, `durationMs`, `eventCount`, `errorCount`
- Filter: `onlyReturning`, `onlyWithErrors`

```typescript
const result = await ctx.runQuery("dashboard:listSessions", {
  paginationOpts: { numItems: 25, cursor: null },
  sortBy: "startedAt",
  sortDir: "desc",
  onlyReturning: false,
  onlyWithErrors: false,
  search: "checkout", // optional
});
// { page: [...], continueCursor: "...", isDone: false }
```

### `dashboard:listEvents`

Paginated event list. Filters by typename:

```typescript
const result = await ctx.runQuery("dashboard:listEvents", {
  paginationOpts: { numItems: 25, cursor: null },
  type: "error", // optional
  search: "TypeError", // optional
});
```

### `dashboard:getErrorBreakdown`

Top 8 error names by frequency in a time range:

```typescript
const errors = await ctx.runQuery("dashboard:getErrorBreakdown", {
  since: Date.now() - 7 * 86400000,
});
// [{ name: "TypeError", value: 42 }, ...]
```

### `dashboard:getErrorDetails`

Full event rows for a specific error name:

```typescript
const details = await ctx.runQuery("dashboard:getErrorDetails", {
  errorName: "TypeError",
  since: Date.now() - 86400000,
  limit: 20, // optional
});
// [{ id, name, payload, url, timestamp, sessionId, machineId }, ...]
```

### `dashboard:getMachineStats`

Comprehensive stats for a single machine. This is what the machine detail view uses:

```typescript
const stats = await ctx.runQuery("dashboard:getMachineStats", {
  machineId: "uuid",
});
// {
//   machine: { id, userId, firstSeenAt, lastSeenAt, visitCount, userAgent, platform, referrer, ip, country, region, city, screen },
//   stats: { totalSessions, totalErrors, totalEvents, returningSessions, avgSessionDurationMs, returningRate },
//   topErrors: [{ name, count }, ...],
//   topPages: [{ url, count }, ...],
//   lastSession: { id, startedAt, entryUrl, exitUrl, durationMs, errorCount },
// }
```

Returns `null` if the machineId doesn't exist.

### `dashboard:getTopPages`

Top pages by view count in a date range:

```typescript
const pages = await ctx.runQuery("dashboard:getTopPages", {
  startDate: "2026-06-01",
  endDate: "2026-07-04",
  limit: 10, // optional, defaults to 20
});
// [{ url: "https://mysite.com/landing", viewCount: 142, uniqueMachines: 89 }, ...]
```

### `dashboard:getPageVisitors`

Machines that visited a specific page:

```typescript
const visitors = await ctx.runQuery("dashboard:getPageVisitors", {
  url: "https://mysite.com/pricing",
  startDate: "2026-06-01",
  endDate: "2026-07-04",
});
// [{ machineId, visitCount, firstVisitedAt, lastVisitedAt, country, platform, userAgent }, ...]
```

### `dashboard:getPageViewsOverTime`

Daily time series of page views for charting:

```typescript
const series = await ctx.runQuery("dashboard:getPageViewsOverTime", {
  startDate: "2026-06-01",
  endDate: "2026-07-04",
});
// [{ date: "2026-07-04", pageViews: 42, uniqueMachines: 28 }, ...]
```

### `dashboard:searchMachines`

Autocomplete-style machine search by machineId prefix:

```typescript
const results = await ctx.runQuery("dashboard:searchMachines", {
  prefix: "6ed8805",
});
// [{ id, label, country, platform, lastSeenAt }, ...]
```

Returns empty array for empty prefix or no matches.

### `dashboard:recomputeStats` (action)

Manually runs the daily stats computation for yesterday and today. Useful after deploying or when you want dashboard data without waiting for the 00:15 UTC cron:

```typescript
const result = await ctx.runAction("dashboard:recomputeStats", {});
// { done: true }
```

This action also calls `closeStaleSessions` first to ensure session data is up to date.

## Settings

No environment variables or secrets are needed for the Convex backend itself. The ip-api.com fallback in `http.ts` works without an API key. If you need higher rate limits or prefer a different geo-IP provider, modify `resolveGeo` in `convex/http.ts`.
