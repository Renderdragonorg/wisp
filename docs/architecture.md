# Architecture

## Identity model

Two persistent identifiers, both generated client-side and stored in the browser:

| ID | Storage | Scope | Purpose |
|----|---------|-------|---------|
| **machineId** | `localStorage` + `cookie` | Permanent, survives clears | Unique browser/device identity. Created once via `crypto.randomUUID()` with a fallback for older browsers. Written to both `wisp_machine_id` (localStorage) and `wisp_mid` (cookie, 400-day max-age). |
| **sessionId** | `localStorage` | 30-minute window | A visit window. New session created when `lastActivityAt` exceeds 30 minutes. Shared across tabs on the same origin via `wisp_session_state`. |

### `wisp_session_state` format

```json
{
  "sessionId": "uuid",
  "startedAt": 1700000000000,
  "lastActivityAt": 1700000030000,
  "entryUrl": "https://mysite.com/"
}
```

The source of truth for session closure is the **server-side cron** (`closeStaleSessions`), not the client. The client session manager exists solely to decide when to generate a new session ID on the next event.

## Data model (Convex schema)

### `machines` table

One row per unique browser/device. Created on the first event seen from a machineId.

| Field | Type | Source | Notes |
|-------|------|--------|-------|
| `machineId` | `string` | SDK | Primary identifier |
| `userId` | `string?` | SDK (`identify()`) | Set after auth resolution |
| `firstSeenAt` | `number` | Backend | Timestamp of first event |
| `lastSeenAt` | `number` | Backend | Timestamp of most recent event |
| `firstSeenDate` | `string` | Backend | "YYYY-MM-DD", drives new-vs-returning |
| `visitCount` | `number` | Backend | Incremented each new session on existing machine |
| `userAgent` | `string?` | SDK (`session_start` payload) | Set on first event only |
| `platform` | `string?` | SDK (`session_start` payload) | Set on first event only |
| `referrer` | `string?` | SDK (`session_start` payload) | Set on first event only |
| `screen` | `string?` | SDK (`session_start` payload) | e.g. "1920x1080" |
| `ip` | `string?` | HTTP Action (Cloudflare / geo-IP) | Set on first event via HTTP Action |
| `country` | `string?` | HTTP Action | 2-letter code from Cloudflare, fallback to full name |
| `region` | `string?` | HTTP Action | Region name from geo-IP fallback |
| `city` | `string?` | HTTP Action | City name from geo-IP fallback |

**Important**: Browser metadata fields (userAgent, platform, referrer, screen) are written **only once** — when the machine row is first created. Geo fields (ip, country, region, city) are also set at creation via the HTTP Action path only.

### `sessions` table

One row per visit session.

| Field | Type | Notes |
|-------|------|-------|
| `sessionId` | `string` | UUID generated client-side |
| `machineId` | `string` | FK to machines |
| `startedAt` | `number` | First event timestamp |
| `lastActivityAt` | `number` | Most recent event timestamp |
| `endedAt` | `number?` | Set by cron sweep when session is stale |
| `durationMs` | `number?` | Computed by cron: `lastActivityAt - startedAt` |
| `eventCount` | `number` | Incremented per event |
| `errorCount` | `number` | Incremented per error-type event |
| `isReturning` | `boolean` | `true` if machine had any prior session |
| `entryUrl` | `string?` | First page URL |
| `exitUrl` | `string?` | Last page URL |

### `events` table

Immutable event log. One row per tracked event.

| Field | Type | Notes |
|-------|------|-------|
| `sessionId` | `string` | FK to sessions |
| `machineId` | `string` | FK to machines |
| `type` | `"pageview" \| "interaction" \| "error" \| "custom"` | Event category |
| `name` | `string` | Event name (e.g. "click:signup", "TypeError: x is null") |
| `payload` | `any?` | Arbitrary JSON context |
| `url` | `string` | Page URL at time of event |
| `timestamp` | `number` | Epoch ms |

### `dailyStats` table

Pre-aggregated rollups for fast dashboard queries. Updated by the `computeDailyStats` cron or manually via `recomputeStats` action.

| Field | Type | Notes |
|-------|------|-------|
| `date` | `string` | "YYYY-MM-DD" |
| `newUsers` | `number` | Machines whose `firstSeenDate` matches this date |
| `returningUsers` | `number` | Unique machineIds with `isReturning` sessions on this date |
| `totalSessions` | `number` | Sessions started on this date |
| `totalErrors` | `number` | Sum of session errorCounts |
| `totalEvents` | `number` | Sum of session eventCounts |
| `avgSessionDurationMs` | `number` | Average duration of sessions on this date |

## Event lifecycle

```
1. Browser event occurs (click, pageview, error, manual track())
         │
2. SDK queues event in EventQueue (in-memory buffer)
         │
3. Queue flushes (timer / maxSize / pagehide):
   └─► ConvexTransport.send([event, ...], { beacon? })
         │
         │  POST https://{deployment}.convex.site/ingest
         │  Content-Type: application/json
         │  { events: [...] }
         ▼
4. Convex HTTP Action (http.ts):
   a. Parse request body
   b. resolveGeo(request):
      - Extract IP (cf-connecting-ip → x-forwarded-for → x-real-ip)
      - Check Cloudflare cf-ipcountry / cf-region / cf-ipcity headers
      - If Cloudflare geo is incomplete, fall back to ip-api.com
   c. Call recordBatchWithGeo(events, geo)
         │
         ▼
5. recordBatchWithGeo (events.ts):
   For each event (sorted oldest-first):
   a. upsertMachine():
      - If new: insert with meta + geo (first-seen data)
      - If existing: update lastSeenAt, userId
   b. upsertSession():
      - If existing: increment eventCount/errorCount, update exitUrl
      - If new: insert with isReturning = (priorSession !== null)
   c. Insert event row
         │
         ▼
6. Crons (every 10 min):
   closeStaleSessions: find sessions with no activity > 30 min, set endedAt + durationMs
   
   Crons (00:15 UTC):
   computeDailyStats: roll up yesterday's sessions → dailyStats row
```

## Geo-IP resolution

IP detection and geo-resolution happen server-side in the HTTP Action (`http.ts:resolveGeo`):

1. **IP extraction** — checks `cf-connecting-ip` (Cloudflare) → `x-forwarded-for` → `x-real-ip`
2. **Cloudflare geo** — reads `cf-ipcountry` (all plans), `cf-region` (Business+), `cf-ipcity` (Business+)
3. **Fallback** — if Cloudflare geo is incomplete, calls `ip-api.com/json/{ip}?fields=country,regionName,city` with a 2-second timeout. Free tier: 45 req/min, no API key.

The resolved geo data is passed to `recordBatchWithGeo` and stored on the machines table at creation time.

## Sampling

Sampling is a **per-machine** decision, cached in `localStorage` under `wisp_sampled_in`. This guarantees a user is either fully tracked or fully invisible — never split mid-session. The decision is made once: on the first `init()` call for that machine.

```
samplingRate: 1 → always track (default)
samplingRate: 0 → track nobody
samplingRate: 0.5 → track ~50% of distinct machines
```
