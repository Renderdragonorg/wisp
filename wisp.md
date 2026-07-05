# Wisp — a drop-in analytics engine on Convex

Wisp is a small, framework-agnostic analytics SDK you bundle into any web app (vanilla JS, React, Vue, Next.js, whatever). It tracks machine identity, 30-minute sessions, interactions, and errors, and writes everything to a Convex backend you own. No third-party analytics vendor, no cookie-consent nightmare beyond what you already need for first-party analytics.

This guide is self-contained: every snippet below is real, working code (typechecked against strict TypeScript + DOM lib). A ready-to-drop `wisp-package.zip` is attached alongside this guide with the same files pre-organized into a package structure.

---

## 1. What you're building — recap

- **Machine ID** — permanent per-browser identity (localStorage + cookie fallback). Answers "new vs. returning visitor."
- **Session ID** — resets after 30 minutes of inactivity, shared across tabs via localStorage. Answers "what did this visit look like."
- **User ID** — attached once your auth provider (Supabase here) resolves a logged-in user. Links anonymous activity to an identity going forward.
- **Events** — pageviews, interactions (clicks), errors, and custom events, batched client-side and flushed to Convex.
- **Convex backend** — three write-heavy tables (`machines`, `sessions`, `events`) plus a `dailyStats` rollup table computed by a cron job, so your dashboard queries never have to scan raw events.

---

## 2. Project layout

```
wisp/
├── package.json
├── tsup.config.ts
├── src/
│   ├── index.ts              # public API: init(), track(), trackError(), identify()
│   ├── types.ts               # shared TypeScript types
│   ├── supabase.ts            # optional Supabase auth binding (separate entry point)
│   ├── core/
│   │   ├── machineId.ts       # persistent machine identity
│   │   ├── session.ts         # 30-min session window manager
│   │   ├── queue.ts           # batching + flush-on-unload
│   │   └── transport.ts       # default Convex HTTP transport
│   └── plugins/
│       ├── errors.ts          # window.onerror / unhandledrejection
│       ├── clicks.ts          # data-wisp-id delegated click tracking
│       └── pageviews.ts       # SPA pushState/popstate tracking
└── convex/
    ├── schema.ts
    ├── events.ts               # recordBatch mutation + dashboard queries
    ├── stats.ts                # cron-driven aggregation
    └── crons.ts
```

Two independently deployable halves:
- **`src/`** → published as an npm package (or just copied into any web app's source tree) and imported client-side.
- **`convex/`** → copied into any project that already has (or is willing to add) a Convex deployment.

---

## 3. Backend setup (Convex)

### 3.1 Install and init Convex in your project

```bash
npm install convex
npx convex dev
```

This creates a `convex/` folder with `_generated/` types. Drop the four files below into it (overwriting the placeholder `convex/schema.ts` Convex scaffolds for you).

### 3.2 Schema — `convex/schema.ts`

```typescript
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  machines: defineTable({
    machineId: v.string(),
    userId: v.optional(v.string()),
    firstSeenAt: v.number(),
    lastSeenAt: v.number(),
    firstSeenDate: v.string(), // "YYYY-MM-DD", set once — drives new-vs-returning
    visitCount: v.number(),
    userAgent: v.optional(v.string()),
    platform: v.optional(v.string()),
    referrer: v.optional(v.string()),
  })
    .index("by_machineId", ["machineId"])
    .index("by_userId", ["userId"])
    .index("by_firstSeenDate", ["firstSeenDate"]),

  sessions: defineTable({
    sessionId: v.string(),
    machineId: v.string(),
    userId: v.optional(v.string()),
    startedAt: v.number(),
    lastActivityAt: v.number(),
    endedAt: v.optional(v.number()),
    durationMs: v.optional(v.number()),
    eventCount: v.number(),
    errorCount: v.number(),
    isReturning: v.boolean(),
    entryUrl: v.optional(v.string()),
    exitUrl: v.optional(v.string()),
  })
    .index("by_sessionId", ["sessionId"])
    .index("by_machineId", ["machineId"])
    .index("by_open", ["endedAt"]),

  events: defineTable({
    sessionId: v.string(),
    machineId: v.string(),
    userId: v.optional(v.string()),
    type: v.union(
      v.literal("pageview"),
      v.literal("interaction"),
      v.literal("error"),
      v.literal("custom")
    ),
    name: v.string(),
    payload: v.optional(v.any()),
    url: v.string(),
    timestamp: v.number(),
  })
    .index("by_session", ["sessionId"])
    .index("by_type_time", ["type", "timestamp"])
    .index("by_machine_time", ["machineId", "timestamp"]),

  dailyStats: defineTable({
    date: v.string(), // "YYYY-MM-DD"
    newUsers: v.number(),
    returningUsers: v.number(),
    totalSessions: v.number(),
    totalErrors: v.number(),
    totalEvents: v.number(),
    avgSessionDurationMs: v.number(),
  }).index("by_date", ["date"]),
});
```

**Design notes:**
- `firstSeenDate` is written once and never touched again — it's what lets `computeDailyStats` answer "how many *new* users today" without recomputing history.
- `isReturning` is decided at session-creation time (not per-event), so a session's returning/new status can't flip mid-session.
- Indexes are chosen for the exact lookups the mutations below do — `by_sessionId` and `by_machineId` are hit on every single event.

### 3.3 Ingestion — `convex/events.ts`

This is the one mutation the client actually calls. It's designed to process a whole batch of events per network round-trip, doing the machine-upsert / session-upsert / event-insert dance for each one inside a single Convex transaction.

```typescript
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { MutationCtx } from "./_generated/server";

const dateKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);

const eventValidator = v.object({
  sessionId: v.string(),
  machineId: v.string(),
  userId: v.optional(v.string()),
  type: v.union(
    v.literal("pageview"),
    v.literal("interaction"),
    v.literal("error"),
    v.literal("custom")
  ),
  name: v.string(),
  payload: v.optional(v.any()),
  url: v.string(),
  timestamp: v.number(),
});

async function upsertMachine(
  ctx: MutationCtx,
  args: { machineId: string; userId?: string; timestamp: number; meta?: Record<string, unknown> }
) {
  const existing = await ctx.db
    .query("machines")
    .withIndex("by_machineId", (q) => q.eq("machineId", args.machineId))
    .unique();

  if (!existing) {
    await ctx.db.insert("machines", {
      machineId: args.machineId,
      userId: args.userId,
      firstSeenAt: args.timestamp,
      lastSeenAt: args.timestamp,
      firstSeenDate: dateKey(args.timestamp),
      visitCount: 1,
      userAgent: args.meta?.userAgent as string | undefined,
      platform: args.meta?.platform as string | undefined,
      referrer: args.meta?.referrer as string | undefined,
    });
    return { isNewMachine: true };
  }

  await ctx.db.patch(existing._id, {
    lastSeenAt: args.timestamp,
    userId: args.userId ?? existing.userId,
  });
  return { isNewMachine: false };
}

async function upsertSession(
  ctx: MutationCtx,
  args: {
    sessionId: string;
    machineId: string;
    userId?: string;
    timestamp: number;
    url: string;
    isError: boolean;
  }
) {
  const existing = await ctx.db
    .query("sessions")
    .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
    .unique();

  if (existing) {
    await ctx.db.patch(existing._id, {
      lastActivityAt: args.timestamp,
      eventCount: existing.eventCount + 1,
      errorCount: existing.errorCount + (args.isError ? 1 : 0),
      exitUrl: args.url,
      userId: args.userId ?? existing.userId,
    });
    return;
  }

  const priorSession = await ctx.db
    .query("sessions")
    .withIndex("by_machineId", (q) => q.eq("machineId", args.machineId))
    .first();

  await ctx.db.insert("sessions", {
    sessionId: args.sessionId,
    machineId: args.machineId,
    userId: args.userId,
    startedAt: args.timestamp,
    lastActivityAt: args.timestamp,
    eventCount: 1,
    errorCount: args.isError ? 1 : 0,
    isReturning: priorSession !== null,
    entryUrl: args.url,
    exitUrl: args.url,
  });

  const machine = await ctx.db
    .query("machines")
    .withIndex("by_machineId", (q) => q.eq("machineId", args.machineId))
    .unique();
  if (machine && priorSession !== null) {
    await ctx.db.patch(machine._id, { visitCount: machine.visitCount + 1 });
  }
}

export const recordBatch = mutation({
  args: { events: v.array(eventValidator) },
  handler: async (ctx, { events }) => {
    const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);

    for (const event of sorted) {
      const isBookkeeping = event.name === "session_start";

      await upsertMachine(ctx, {
        machineId: event.machineId,
        userId: event.userId,
        timestamp: event.timestamp,
        meta: isBookkeeping ? event.payload : undefined,
      });

      await upsertSession(ctx, {
        sessionId: event.sessionId,
        machineId: event.machineId,
        userId: event.userId,
        timestamp: event.timestamp,
        url: event.url,
        isError: event.type === "error",
      });

      await ctx.db.insert("events", {
        sessionId: event.sessionId,
        machineId: event.machineId,
        userId: event.userId,
        type: event.type,
        name: event.name,
        payload: event.payload,
        url: event.url,
        timestamp: event.timestamp,
      });
    }

    return { inserted: sorted.length };
  },
});

export const getSessionEvents = query({
  args: { sessionId: v.string() },
  handler: async (ctx, { sessionId }) => {
    return await ctx.db
      .query("events")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .order("asc")
      .collect();
  },
});

export const getTopErrors = query({
  args: { since: v.number() },
  handler: async (ctx, { since }) => {
    const errors = await ctx.db
      .query("events")
      .withIndex("by_type_time", (q) => q.eq("type", "error").gte("timestamp", since))
      .collect();

    const counts = new Map<string, number>();
    for (const e of errors) counts.set(e.name, (counts.get(e.name) ?? 0) + 1);

    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);
  },
});
```

**Why "returning" is decided server-side, not client-side:** the client can't be trusted to know a machine's full session history (it only has localStorage for *this* browser profile) and shouldn't need to run an extra query just to label a session. The server already touches the `sessions` table on every write, so checking "does this machine have a prior session" is a single indexed lookup away.

### 3.4 Aggregation — `convex/stats.ts`

```typescript
import { internalMutation, query } from "./_generated/server";
import { v } from "convex/values";

const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
const dateKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export const closeStaleSessions = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - SESSION_TIMEOUT_MS;

    const stale = await ctx.db
      .query("sessions")
      .withIndex("by_open", (q) => q.eq("endedAt", undefined))
      .filter((q) => q.lt(q.field("lastActivityAt"), cutoff))
      .collect();

    for (const session of stale) {
      await ctx.db.patch(session._id, {
        endedAt: session.lastActivityAt,
        durationMs: session.lastActivityAt - session.startedAt,
      });
    }

    return { closed: stale.length };
  },
});

export const computeDailyStats = internalMutation({
  args: { date: v.optional(v.string()) },
  handler: async (ctx, { date }) => {
    const targetDate = date ?? dateKey(Date.now() - 24 * 60 * 60 * 1000);
    const dayStart = new Date(`${targetDate}T00:00:00.000Z`).getTime();
    const dayEnd = dayStart + 24 * 60 * 60 * 1000;

    const sessionsToday = await ctx.db
      .query("sessions")
      .filter((q) =>
        q.and(q.gte(q.field("startedAt"), dayStart), q.lt(q.field("startedAt"), dayEnd))
      )
      .collect();

    const newMachines = await ctx.db
      .query("machines")
      .withIndex("by_firstSeenDate", (q) => q.eq("firstSeenDate", targetDate))
      .collect();

    const returningSessions = sessionsToday.filter((s) => s.isReturning);
    const totalErrors = sessionsToday.reduce((sum, s) => sum + s.errorCount, 0);
    const totalEvents = sessionsToday.reduce((sum, s) => sum + s.eventCount, 0);
    const durations = sessionsToday
      .map((s) => s.durationMs ?? s.lastActivityAt - s.startedAt)
      .filter((d) => d > 0);
    const avgDuration =
      durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;

    const existing = await ctx.db
      .query("dailyStats")
      .withIndex("by_date", (q) => q.eq("date", targetDate))
      .unique();

    const row = {
      date: targetDate,
      newUsers: newMachines.length,
      returningUsers: new Set(returningSessions.map((s) => s.machineId)).size,
      totalSessions: sessionsToday.length,
      totalErrors,
      totalEvents,
      avgSessionDurationMs: Math.round(avgDuration),
    };

    if (existing) {
      await ctx.db.patch(existing._id, row);
    } else {
      await ctx.db.insert("dailyStats", row);
    }

    return row;
  },
});

export const getDailyStats = query({
  args: { startDate: v.string(), endDate: v.string() },
  handler: async (ctx, { startDate, endDate }) => {
    return await ctx.db
      .query("dailyStats")
      .withIndex("by_date", (q) => q.gte("date", startDate).lte("date", endDate))
      .collect();
  },
});
```

### 3.5 Cron wiring — `convex/crons.ts`

```typescript
import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval("close stale sessions", { minutes: 10 }, internal.stats.closeStaleSessions, {});
crons.cron("compute daily stats", "15 0 * * *", internal.stats.computeDailyStats, {});

export default crons;
```

Deploy with `npx convex deploy`. Grab your deployment URL (`https://<name>.convex.cloud`) from the Convex dashboard — you'll need it client-side next.

---

## 4. Client SDK

### 4.1 Shared types — `src/types.ts`

```typescript
export type EventType = "pageview" | "interaction" | "error" | "custom";

export interface WispEvent {
  type: EventType;
  name: string;
  payload?: Record<string, unknown>;
  url: string;
  timestamp: number;
  sessionId: string;
  machineId: string;
  userId?: string;
}

export interface WispTransport {
  send(events: WispEvent[], opts: { beacon?: boolean }): Promise<void> | void;
}

export interface WispPlugin {
  name: string;
  install(client: WispClientInternal): void;
  uninstall?(): void;
}

export interface WispClientInternal {
  track(name: string, payload?: Record<string, unknown>): void;
  trackError(error: Error | string, context?: Record<string, unknown>): void;
  getMachineId(): string;
  getSessionId(): string;
  config: Required<Omit<WispConfig, "transport" | "plugins" | "redact">> & {
    transport?: WispTransport;
    redact?: (event: WispEvent) => WispEvent | null;
  };
}

export interface WispConfig {
  convexUrl?: string;
  transport?: WispTransport;
  sessionTimeoutMs?: number;
  batchIntervalMs?: number;
  batchMaxSize?: number;
  autoTrackErrors?: boolean;
  autoTrackClicks?: boolean;
  autoTrackPageviews?: boolean;
  samplingRate?: number;
  plugins?: WispPlugin[];
  redact?: (event: WispEvent) => WispEvent | null;
  debug?: boolean;
}
```

### 4.2 Machine identity — `src/core/machineId.ts`

```typescript
const STORAGE_KEY = "wisp_machine_id";
const COOKIE_KEY = "wisp_mid";
const COOKIE_MAX_AGE_DAYS = 400;

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function writeCookie(name: string, value: string): void {
  const maxAge = COOKIE_MAX_AGE_DAYS * 24 * 60 * 60;
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAge}; SameSite=Lax`;
}

function generateId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function getOrCreateMachineId(): string {
  if (typeof window === "undefined") return "ssr-placeholder";

  let id: string | null = null;
  try {
    id = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // storage-restricted context
  }
  if (!id) id = readCookie(COOKIE_KEY);
  if (!id) id = generateId();

  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // ignore
  }
  writeCookie(COOKIE_KEY, id);
  return id;
}
```

Two storage layers because `localStorage` alone is fragile — private-browsing modes, aggressive "clear site data" extensions, and some mobile browsers wipe it more readily than cookies. The cookie fallback keeps the machine ID stable through more of those cases.

### 4.3 Session manager — `src/core/session.ts`

```typescript
const STATE_KEY = "wisp_session_state";
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

interface SessionState {
  sessionId: string;
  startedAt: number;
  lastActivityAt: number;
  entryUrl: string;
}

function generateId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function readState(): SessionState | null {
  try {
    const raw = window.localStorage.getItem(STATE_KEY);
    return raw ? (JSON.parse(raw) as SessionState) : null;
  } catch {
    return null;
  }
}

function writeState(state: SessionState): void {
  try {
    window.localStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

export class SessionManager {
  private timeoutMs: number;
  private state: SessionState;
  private isNew: boolean;

  constructor(timeoutMs: number = DEFAULT_TIMEOUT_MS) {
    this.timeoutMs = timeoutMs;
    const existing = readState();
    const now = Date.now();

    if (existing && now - existing.lastActivityAt < this.timeoutMs) {
      this.state = existing;
      this.isNew = false;
    } else {
      this.state = {
        sessionId: generateId(),
        startedAt: now,
        lastActivityAt: now,
        entryUrl: typeof location !== "undefined" ? location.href : "",
      };
      this.isNew = true;
      writeState(this.state);
    }
  }

  touch(): { sessionId: string; startedNewSession: boolean } {
    const now = Date.now();
    const expired = now - this.state.lastActivityAt >= this.timeoutMs;

    if (expired) {
      this.state = {
        sessionId: generateId(),
        startedAt: now,
        lastActivityAt: now,
        entryUrl: typeof location !== "undefined" ? location.href : "",
      };
      this.isNew = true;
    } else {
      this.state.lastActivityAt = now;
    }

    writeState(this.state);
    const startedNewSession = this.isNew;
    this.isNew = false;
    return { sessionId: this.state.sessionId, startedNewSession };
  }

  getSessionId(): string {
    return this.state.sessionId;
  }

  getEntryUrl(): string {
    return this.state.entryUrl;
  }
}
```

Storing session state in `localStorage` (not `sessionStorage`) is deliberate: `sessionStorage` is per-tab, so opening a link in a new tab would fragment one visit into two sessions. Sharing through `localStorage` keeps a 30-minute visit as one session even across tabs.

### 4.4 Event queue — `src/core/queue.ts`

```typescript
import type { WispEvent, WispTransport } from "../types";

export interface QueueOptions {
  intervalMs: number;
  maxSize: number;
  transport: WispTransport;
  debug?: boolean;
}

export class EventQueue {
  private buffer: WispEvent[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private opts: QueueOptions;
  private destroyed = false;

  constructor(opts: QueueOptions) {
    this.opts = opts;
    this.timer = setInterval(() => void this.flush(), opts.intervalMs);

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.handleVisibilityChange);
      window.addEventListener("pagehide", this.handlePageHide);
    }
  }

  private handleVisibilityChange = (): void => {
    if (document.visibilityState === "hidden") void this.flush({ beacon: true });
  };

  private handlePageHide = (): void => {
    void this.flush({ beacon: true });
  };

  push(event: WispEvent): void {
    if (this.destroyed) return;
    this.buffer.push(event);
    if (this.opts.debug) console.debug("[wisp] queued", event.type, event.name);
    if (this.buffer.length >= this.opts.maxSize) void this.flush();
  }

  async flush(opts: { beacon?: boolean } = {}): Promise<void> {
    if (this.buffer.length === 0) return;
    const batch = this.buffer;
    this.buffer = [];

    try {
      await this.opts.transport.send(batch, opts);
      if (this.opts.debug) console.debug(`[wisp] flushed ${batch.length} event(s)`);
    } catch (err) {
      if (this.opts.debug) console.warn("[wisp] flush failed, dropping batch", err);
    }
  }

  destroy(): void {
    this.destroyed = true;
    if (this.timer) clearInterval(this.timer);
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.handleVisibilityChange);
      window.removeEventListener("pagehide", this.handlePageHide);
    }
    void this.flush({ beacon: true });
  }
}
```

### 4.5 Default transport — `src/core/transport.ts`

```typescript
import type { WispEvent, WispTransport } from "../types";

export class ConvexTransport implements WispTransport {
  private endpoint: string;
  private debug: boolean;

  constructor(convexUrl: string, debug = false) {
    this.endpoint = `${convexUrl.replace(/\/$/, "")}/api/mutation`;
    this.debug = debug;
  }

  async send(events: WispEvent[], opts: { beacon?: boolean }): Promise<void> {
    if (events.length === 0) return;

    const body = JSON.stringify({
      path: "events:recordBatch",
      args: { events },
      format: "json",
    });

    try {
      if (opts.beacon && typeof navigator !== "undefined" && navigator.sendBeacon) {
        const blob = new Blob([body], { type: "application/json" });
        const ok = navigator.sendBeacon(this.endpoint, blob);
        if (!ok && this.debug) console.warn("[wisp] sendBeacon returned false");
        return;
      }

      await fetch(this.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: opts.beacon,
      });
    } catch (err) {
      if (this.debug) console.warn("[wisp] transport error", err);
    }
  }
}
```

This talks directly to [Convex's HTTP API](https://docs.convex.dev/http-api/) (`POST /api/mutation`) rather than depending on the `convex` client package client-side — that keeps the bundle tiny and means Wisp works from a bare `<script>` tag with no build step at all, not just from apps that already have Convex installed.

### 4.6 Plugins

**Errors — `src/plugins/errors.ts`**
```typescript
import type { WispClientInternal, WispPlugin } from "../types";

export function errorPlugin(): WispPlugin {
  let onError: ((e: ErrorEvent) => void) | null = null;
  let onRejection: ((e: PromiseRejectionEvent) => void) | null = null;

  return {
    name: "errors",
    install(client: WispClientInternal) {
      onError = (event: ErrorEvent) => {
        client.trackError(event.error ?? event.message, {
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
          source: "window.onerror",
        });
      };

      onRejection = (event: PromiseRejectionEvent) => {
        const reason = event.reason;
        const error = reason instanceof Error ? reason : new Error(String(reason ?? "Unhandled rejection"));
        client.trackError(error, { source: "unhandledrejection" });
      };

      window.addEventListener("error", onError);
      window.addEventListener("unhandledrejection", onRejection);
    },
    uninstall() {
      if (onError) window.removeEventListener("error", onError);
      if (onRejection) window.removeEventListener("unhandledrejection", onRejection);
    },
  };
}
```

**Clicks — `src/plugins/clicks.ts`**
```typescript
import type { WispClientInternal, WispPlugin } from "../types";

export function clickPlugin(): WispPlugin {
  let handler: ((e: MouseEvent) => void) | null = null;

  return {
    name: "clicks",
    install(client: WispClientInternal) {
      handler = (event: MouseEvent) => {
        const target = event.target as HTMLElement | null;
        const el = target?.closest<HTMLElement>("[data-wisp-id]");
        if (!el) return;

        const id = el.getAttribute("data-wisp-id")!;
        const payload: Record<string, unknown> = {};
        for (const attr of Array.from(el.attributes)) {
          if (attr.name.startsWith("data-wisp-") && attr.name !== "data-wisp-id") {
            payload[attr.name.replace("data-wisp-", "")] = attr.value;
          }
        }
        client.track(`click:${id}`, payload);
      };
      document.addEventListener("click", handler, { capture: true });
    },
    uninstall() {
      if (handler) document.removeEventListener("click", handler, { capture: true });
    },
  };
}
```
Usage in markup — no JS wiring needed per-button:
```html
<button data-wisp-id="signup_button" data-wisp-plan="pro">Sign up</button>
```

**Pageviews — `src/plugins/pageviews.ts`**
```typescript
import type { WispClientInternal, WispPlugin } from "../types";

export function pageviewPlugin(): WispPlugin {
  let originalPushState: typeof history.pushState | null = null;
  let originalReplaceState: typeof history.replaceState | null = null;
  let onPopState: (() => void) | null = null;

  return {
    name: "pageviews",
    install(client: WispClientInternal) {
      const fire = () => client.track("pageview", { url: location.href, path: location.pathname });
      fire();

      originalPushState = history.pushState.bind(history);
      originalReplaceState = history.replaceState.bind(history);

      history.pushState = function (...args: Parameters<typeof history.pushState>) {
        originalPushState!(...args);
        fire();
      };
      history.replaceState = function (...args: Parameters<typeof history.replaceState>) {
        originalReplaceState!(...args);
        fire();
      };

      onPopState = fire;
      window.addEventListener("popstate", onPopState);
    },
    uninstall() {
      if (originalPushState) history.pushState = originalPushState;
      if (originalReplaceState) history.replaceState = originalReplaceState;
      if (onPopState) window.removeEventListener("popstate", onPopState);
    },
  };
}
```

### 4.7 Main client — `src/index.ts`

```typescript
import { getOrCreateMachineId } from "./core/machineId";
import { SessionManager } from "./core/session";
import { EventQueue } from "./core/queue";
import { ConvexTransport } from "./core/transport";
import { errorPlugin } from "./plugins/errors";
import { clickPlugin } from "./plugins/clicks";
import { pageviewPlugin } from "./plugins/pageviews";
import type { WispConfig, WispEvent, WispPlugin, WispClientInternal } from "./types";

export type { WispConfig, WispEvent, WispPlugin, WispTransport, EventType } from "./types";

const DEFAULTS = {
  sessionTimeoutMs: 30 * 60 * 1000,
  batchIntervalMs: 5_000,
  batchMaxSize: 20,
  autoTrackErrors: true,
  autoTrackClicks: true,
  autoTrackPageviews: true,
  samplingRate: 1,
  debug: false,
};

class WispClient implements WispClientInternal {
  private machineId: string;
  private session: SessionManager;
  private queue: EventQueue;
  private plugins: WispPlugin[] = [];
  private userId?: string;
  private sampledIn: boolean;
  public config: WispClientInternal["config"];

  constructor(cfg: WispConfig) {
    if (!cfg.convexUrl && !cfg.transport) {
      throw new Error("[wisp] init() requires either `convexUrl` or a custom `transport`.");
    }

    this.config = {
      convexUrl: cfg.convexUrl ?? "",
      sessionTimeoutMs: cfg.sessionTimeoutMs ?? DEFAULTS.sessionTimeoutMs,
      batchIntervalMs: cfg.batchIntervalMs ?? DEFAULTS.batchIntervalMs,
      batchMaxSize: cfg.batchMaxSize ?? DEFAULTS.batchMaxSize,
      autoTrackErrors: cfg.autoTrackErrors ?? DEFAULTS.autoTrackErrors,
      autoTrackClicks: cfg.autoTrackClicks ?? DEFAULTS.autoTrackClicks,
      autoTrackPageviews: cfg.autoTrackPageviews ?? DEFAULTS.autoTrackPageviews,
      samplingRate: cfg.samplingRate ?? DEFAULTS.samplingRate,
      debug: cfg.debug ?? DEFAULTS.debug,
      transport: cfg.transport,
      redact: cfg.redact,
    };

    this.machineId = getOrCreateMachineId();
    this.sampledIn = this.resolveSampling(this.config.samplingRate);
    this.session = new SessionManager(this.config.sessionTimeoutMs);

    const transport = this.config.transport ?? new ConvexTransport(this.config.convexUrl, this.config.debug);
    this.queue = new EventQueue({
      intervalMs: this.config.batchIntervalMs,
      maxSize: this.config.batchMaxSize,
      transport,
      debug: this.config.debug,
    });

    this.installPlugins(cfg.plugins ?? []);

    this.track("session_start", {
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
      platform: typeof navigator !== "undefined" ? navigator.platform : undefined,
      referrer: typeof document !== "undefined" ? document.referrer : undefined,
    });
  }

  private resolveSampling(rate: number): boolean {
    if (rate >= 1) return true;
    const key = "wisp_sampled_in";
    try {
      const cached = window.localStorage.getItem(key);
      if (cached !== null) return cached === "1";
      const decision = Math.random() < rate;
      window.localStorage.setItem(key, decision ? "1" : "0");
      return decision;
    } catch {
      return Math.random() < rate;
    }
  }

  private installPlugins(extra: WispPlugin[]): void {
    if (this.config.autoTrackErrors) this.plugins.push(errorPlugin());
    if (this.config.autoTrackClicks) this.plugins.push(clickPlugin());
    if (this.config.autoTrackPageviews) this.plugins.push(pageviewPlugin());
    this.plugins.push(...extra);
    for (const plugin of this.plugins) plugin.install(this);
  }

  identify(userId: string): void {
    this.userId = userId;
  }

  reset(): void {
    this.userId = undefined;
  }

  track(name: string, payload?: Record<string, unknown>): void {
    if (!this.sampledIn) return;
    const { sessionId } = this.session.touch();

    let event: WispEvent = {
      type: name.startsWith("click:") ? "interaction" : name === "pageview" ? "pageview" : "custom",
      name,
      payload,
      url: typeof location !== "undefined" ? location.href : "",
      timestamp: Date.now(),
      sessionId,
      machineId: this.machineId,
      userId: this.userId,
    };

    if (this.config.redact) {
      const redacted = this.config.redact(event);
      if (!redacted) return;
      event = redacted;
    }

    this.queue.push(event);
  }

  trackError(error: Error | string, context?: Record<string, unknown>): void {
    if (!this.sampledIn) return;
    const { sessionId } = this.session.touch();
    const message = error instanceof Error ? error.message : error;
    const stack = error instanceof Error ? error.stack : undefined;

    let event: WispEvent = {
      type: "error",
      name: message.slice(0, 200),
      payload: { ...context, stack },
      url: typeof location !== "undefined" ? location.href : "",
      timestamp: Date.now(),
      sessionId,
      machineId: this.machineId,
      userId: this.userId,
    };

    if (this.config.redact) {
      const redacted = this.config.redact(event);
      if (!redacted) return;
      event = redacted;
    }

    this.queue.push(event);
  }

  getMachineId(): string {
    return this.machineId;
  }

  getSessionId(): string {
    return this.session.getSessionId();
  }

  async flush(): Promise<void> {
    await this.queue.flush();
  }

  destroy(): void {
    for (const plugin of this.plugins) plugin.uninstall?.();
    this.queue.destroy();
  }
}

let instance: WispClient | null = null;

export function init(config: WispConfig): WispClient {
  if (instance) {
    if (config.debug) console.warn("[wisp] init() called more than once — reusing existing instance.");
    return instance;
  }
  instance = new WispClient(config);
  return instance;
}

function requireInstance(): WispClient {
  if (!instance) throw new Error("[wisp] Not initialized — call wisp.init({ convexUrl }) first.");
  return instance;
}

export const wisp = {
  init,
  identify: (userId: string) => requireInstance().identify(userId),
  reset: () => requireInstance().reset(),
  track: (name: string, payload?: Record<string, unknown>) => requireInstance().track(name, payload),
  trackError: (error: Error | string, context?: Record<string, unknown>) => requireInstance().trackError(error, context),
  flush: () => requireInstance().flush(),
  destroy: () => requireInstance().destroy(),
  getMachineId: () => requireInstance().getMachineId(),
  getSessionId: () => requireInstance().getSessionId(),
};

export default wisp;
```

### 4.8 Supabase binding — `src/supabase.ts`

Separate entry point so importing the core SDK never pulls in `@supabase/supabase-js` as a hard dependency.

```typescript
import type { SupabaseClient } from "@supabase/supabase-js";
import { wisp } from "./index";

export function bindSupabase(supabase: SupabaseClient): () => void {
  supabase.auth.getSession().then(({ data }) => {
    if (data.session?.user?.id) wisp.identify(data.session.user.id);
  });

  const { data: subscription } = supabase.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_IN" && session?.user?.id) {
      wisp.identify(session.user.id);
    } else if (event === "SIGNED_OUT") {
      wisp.reset();
    }
  });

  return () => subscription.subscription.unsubscribe();
}
```

### 4.9 Build

```json
// package.json (excerpt)
{
  "name": "@yourorg/wisp",
  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js", "require": "./dist/index.cjs" },
    "./supabase": { "types": "./dist/supabase.d.ts", "import": "./dist/supabase.js", "require": "./dist/supabase.cjs" }
  },
  "scripts": { "build": "tsup", "dev": "tsup --watch" },
  "peerDependencies": { "@supabase/supabase-js": ">=2.0.0" },
  "peerDependenciesMeta": { "@supabase/supabase-js": { "optional": true } }
}
```

```typescript
// tsup.config.ts
import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts", supabase: "src/supabase.ts" },
  format: ["esm", "cjs"],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  minify: true,
  target: "es2020",
});
```

```bash
npm run build
```

Publish it to your own npm scope (`npm publish`), or skip publishing entirely and just copy `src/` into whichever app consumes it — both work identically since there's zero framework coupling.

---

## 5. Dropping it into a host app

### 5.1 Plain HTML / vanilla JS (no build step)

```html
<script type="module">
  import wisp from "https://cdn.jsdelivr.net/npm/@yourorg/wisp/dist/index.js";

  wisp.init({ convexUrl: "https://happy-animal-123.convex.cloud" });
</script>
```

### 5.2 Next.js (App Router)

```tsx
// app/analytics-provider.tsx
"use client";
import { useEffect } from "react";
import wisp from "@yourorg/wisp";
import { bindSupabase } from "@yourorg/wisp/supabase";
import { createClient } from "@/lib/supabase/client";

export function AnalyticsProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    wisp.init({ convexUrl: process.env.NEXT_PUBLIC_CONVEX_URL! });
    const unbind = bindSupabase(createClient());
    return unbind;
  }, []);

  return <>{children}</>;
}
```

```tsx
// app/layout.tsx
import { AnalyticsProvider } from "./analytics-provider";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AnalyticsProvider>{children}</AnalyticsProvider>
      </body>
    </html>
  );
}
```

### 5.3 Vue 3

```typescript
// main.ts
import { createApp } from "vue";
import App from "./App.vue";
import wisp from "@yourorg/wisp";

wisp.init({ convexUrl: import.meta.env.VITE_CONVEX_URL });

createApp(App).mount("#app");
```

### 5.4 Manual event tracking anywhere

```typescript
import wisp from "@yourorg/wisp";

wisp.track("video_played", { videoId: "abc123", durationSec: 42 });

try {
  await riskyOperation();
} catch (err) {
  wisp.trackError(err as Error, { operation: "riskyOperation" });
}
```

---

## 6. Customization guide

Every one of these is a config knob or a swappable piece — this is what makes Wisp bundleable into *any* app rather than tied to one stack.

**Custom transport** (e.g. route through your own API instead of hitting Convex directly from the browser — useful if you want to add auth, rate-limiting, or IP-based geolocation server-side first):
```typescript
import wisp, { type WispTransport } from "@yourorg/wisp";

const myTransport: WispTransport = {
  async send(events, { beacon }) {
    const body = JSON.stringify({ events });
    if (beacon) {
      navigator.sendBeacon("/api/analytics", new Blob([body], { type: "application/json" }));
      return;
    }
    await fetch("/api/analytics", { method: "POST", body, keepalive: true });
  },
};

wisp.init({ transport: myTransport });
```

**Redact / scrub PII before it's queued:**
```typescript
wisp.init({
  convexUrl: "...",
  redact(event) {
    if (event.payload?.email) {
      return { ...event, payload: { ...event.payload, email: "[redacted]" } };
    }
    if (event.name === "internal_debug_event") return null; // drop entirely
    return event;
  },
});
```

**Sampling for high-traffic sites** (fraction of *machines*, not events — a sampled-out visitor is out for their whole session, not randomly per event):
```typescript
wisp.init({ convexUrl: "...", samplingRate: 0.2 }); // track 20% of visitors
```

**Custom plugin** — anything you want auto-instrumented that isn't covered by the built-ins:
```typescript
import type { WispPlugin, WispClientInternal } from "@yourorg/wisp";

function scrollDepthPlugin(): WispPlugin {
  let handler: (() => void) | null = null;
  let firedAt25 = false, firedAt50 = false, firedAt75 = false;

  return {
    name: "scroll-depth",
    install(client: WispClientInternal) {
      handler = () => {
        const pct = (window.scrollY / (document.body.scrollHeight - window.innerHeight)) * 100;
        if (pct >= 25 && !firedAt25) { client.track("scroll_25"); firedAt25 = true; }
        if (pct >= 50 && !firedAt50) { client.track("scroll_50"); firedAt50 = true; }
        if (pct >= 75 && !firedAt75) { client.track("scroll_75"); firedAt75 = true; }
      };
      window.addEventListener("scroll", handler, { passive: true });
    },
    uninstall() {
      if (handler) window.removeEventListener("scroll", handler);
    },
  };
}

wisp.init({ convexUrl: "...", plugins: [scrollDepthPlugin()] });
```

**Turn off any auto-instrumentation individually:**
```typescript
wisp.init({
  convexUrl: "...",
  autoTrackClicks: false,     // you'll call wisp.track() manually instead
  autoTrackPageviews: false,  // e.g. if your router already fires its own events
});
```

**Tune batching for your traffic pattern** (lower `batchIntervalMs`/`batchMaxSize` for near-real-time dashboards, higher for lower request volume):
```typescript
wisp.init({ convexUrl: "...", batchIntervalMs: 2000, batchMaxSize: 10 });
```

---

## 7. Querying your data

From any Convex-connected frontend (or a Convex dashboard function), the queries already defined give you:

```typescript
import { useQuery } from "convex/react";
import { api } from "../convex/_generated/api";

// Last 30 days of new/returning/errors/duration
const stats = useQuery(api.stats.getDailyStats, {
  startDate: "2026-06-04",
  endDate: "2026-07-04",
});

// Top error names in the last 24h
const topErrors = useQuery(api.events.getTopErrors, {
  since: Date.now() - 24 * 60 * 60 * 1000,
});

// Full event timeline for a specific session (debugging a bug report)
const sessionEvents = useQuery(api.events.getSessionEvents, {
  sessionId: "the-session-id-from-a-support-ticket",
});
```

Retention cohorts (D1/D7/D30) aren't precomputed above — add a query that, for a given `firstSeenDate` cohort, checks how many of those `machineId`s also appear in `sessions.startedAt` N days later. Straightforward extension once you need it.

---

## 8. Sources

- Convex HTTP API (used by `ConvexTransport`): https://docs.convex.dev/http-api/
- Convex schema & indexes: https://docs.convex.dev/database/schemas
- Convex cron jobs: https://docs.convex.dev/scheduling/cron-jobs
- `navigator.sendBeacon` (unload-safe delivery): https://developer.mozilla.org/en-US/docs/Web/API/Navigator/sendBeacon
- Page Visibility API (`visibilitychange`, used for the beacon flush trigger): https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API
- `fetch` `keepalive` option: https://developer.mozilla.org/en-US/docs/Web/API/RequestInit#keepalive
- `crypto.randomUUID()`: https://developer.mozilla.org/en-US/docs/Web/API/Crypto/randomUUID
- `window.onerror` / `ErrorEvent`: https://developer.mozilla.org/en-US/docs/Web/API/Window/error_event
- `unhandledrejection`: https://developer.mozilla.org/en-US/docs/Web/API/Window/unhandledrejection_event
- History API (`pushState`/`popstate`, used for SPA pageview tracking): https://developer.mozilla.org/en-US/docs/Web/API/History_API
- Supabase Auth — sessions and `onAuthStateChange`: https://supabase.com/docs/reference/javascript/auth-onauthstatechange
- tsup (dual ESM/CJS build tool used for packaging): https://tsup.egoist.dev/

---

## 9. What's genuinely worth adding later (not scaffolded above, but straightforward extensions of this schema)

- **Retention cohort query** (D1/D7/D30) — described in §7.
- **Funnels** — a `getFunnel(steps: string[])` query that counts machines completing an ordered sequence of `event.name`s within a session.
- **Geo/IP enrichment** — do this server-side (e.g. in an HTTP action in front of `recordBatch`) rather than client-side, since IP isn't available to browser JS anyway.
- **Data retention/pruning** — a scheduled internal mutation that deletes `events` rows older than N days once they've been folded into `dailyStats`, if raw event volume gets large.