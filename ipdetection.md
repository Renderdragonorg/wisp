Here's the full plan — no files touched, just the roadmap and exact snippets you'd drop in when ready.

## Overview

IP detection has to move server-side, since browser JS can't see the caller's own IP. That means: intercept the request at Convex's edge (via an HTTP Action, not the mutation the client currently hits), extract the IP from a header, resolve it to a region, then hand off to the existing `recordBatch` mutation with geo data attached.

Four moving pieces:
1. A new Convex HTTP endpoint that sits in front of `recordBatch`
2. A geo-resolution step (pick a provider)
3. Schema additions to store the result
4. A client-side switch to point at the new endpoint instead of `/api/mutation`

---

## Step 1 — Add an HTTP Action endpoint

Convex HTTP Actions run outside the regular mutation/query pipeline and get access to the raw `Request` object — that's where headers like `x-forwarded-for` live.

`convex/http.ts` (new file):
```typescript
import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

const http = httpRouter();

http.route({
  path: "/ingest",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const ip = extractIp(request);
    const geo = await resolveGeo(ip); // see Step 2

    const body = await request.json();

    await ctx.runMutation(internal.events.recordBatchWithGeo, {
      events: body.events,
      geo,
    });

    return new Response(null, {
      status: 204,
      headers: { "Access-Control-Allow-Origin": "*" }, // tighten to your domain in prod
    });
  }),
});

// Convex HTTP actions need an explicit CORS preflight handler for cross-origin POSTs
http.route({
  path: "/ingest",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }),
});

function extractIp(request: Request): string {
  // Cloudflare sets this if you're behind it — most reliable, no extra hop needed
  const cf = request.headers.get("cf-connecting-ip");
  if (cf) return cf;

  // Standard proxy header — may contain a comma-separated chain, first entry is the client
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();

  const real = request.headers.get("x-real-ip");
  if (real) return real;

  return "unknown";
}

export default http;
```

**Important gotcha:** `x-forwarded-for` is trivially spoofable by the client unless something in front of Convex (a CDN, a reverse proxy) is stripping and re-setting it. If you're behind Cloudflare, `cf-connecting-ip` is trustworthy because Cloudflare sets it after stripping any client-supplied value. If you're not behind anything, treat this as best-effort, not authoritative — fine for analytics, not fine for security decisions.

---

## Step 2 — Resolve IP to region

Three real options, pick one:

### Option A — Cloudflare geo headers (best, if you're already on Cloudflare)
Zero extra API calls or dependencies. Cloudflare injects these headers automatically on every request that passes through it:

```typescript
async function resolveGeo(ip: string, request: Request): Promise<GeoInfo> {
  return {
    ip,
    country: request.headers.get("cf-ipcountry") ?? undefined,
    region: request.headers.get("cf-region") ?? undefined,
    city: request.headers.get("cf-ipcity") ?? undefined,
  };
}
```
No signup, no rate limits, no cost. If your app already sits behind Cloudflare (even just Cloudflare DNS with proxy on), this is the correct choice — skip straight to Step 3.

### Option B — ipapi.co (simple REST lookup, no Cloudflare needed)
```typescript
interface GeoInfo {
  ip: string;
  country?: string;
  region?: string;
  city?: string;
}

async function resolveGeo(ip: string): Promise<GeoInfo> {
  if (ip === "unknown") return { ip };

  try {
    const res = await fetch(`https://ipapi.co/${ip}/json/`);
    if (!res.ok) return { ip };
    const data = await res.json();
    return {
      ip,
      country: data.country_name,
      region: data.region,
      city: data.city,
    };
  } catch {
    return { ip }; // never let a failed geo lookup block event ingestion
  }
}
```
Check ipapi.co's current free-tier rate limits before relying on this at volume — I can't confirm today's limits reliably, so verify on their site. At meaningful traffic you'd want a paid tier or a self-hosted alternative (Option C).

### Option C — Self-hosted MaxMind GeoLite2 (no per-request API calls, no external rate limits)
Download the free GeoLite2 City database, bundle it, and look up IPs locally instead of calling an external API. More setup work, but no network dependency per event and no rate limiting to worry about. Worth it once you're past prototype-scale traffic. This needs a Node runtime with file access (not the edge-style HTTP action environment), so it's a bigger architectural change — flag this as a "later" option unless you're already hitting rate limits on A or B.

**Recommendation:** start with A if you're on Cloudflare, otherwise B. Move to C only if volume justifies it.

---

## Step 3 — Schema changes

Add a `geo` field to `machines` (captured once, like `firstSeenDate`) — no need to duplicate it per-session or per-event, since a machine's rough location doesn't change often enough to matter for this use case, and storing it once keeps the events table lean.

`convex/schema.ts` — add to the `machines` table definition:
```typescript
machines: defineTable({
  // ...existing fields...
  ip: v.optional(v.string()),
  country: v.optional(v.string()),
  region: v.optional(v.string()),
  city: v.optional(v.string()),
})
  // ...existing indexes...
  .index("by_country", ["country"]), // enables "users by country" dashboard queries
```

If you want geo per-session too (e.g. someone travels between sessions and you want that reflected), add the same fields to `sessions` instead of/in addition to `machines` — but for most analytics use cases, "the machine's home region" is what you want, not per-session drift.

---

## Step 4 — New internal mutation that accepts geo

`convex/events.ts` — add alongside the existing `recordBatch`:
```typescript
import { internalMutation } from "./_generated/server";

export const recordBatchWithGeo = internalMutation({
  args: {
    events: v.array(eventValidator),
    geo: v.object({
      ip: v.optional(v.string()),
      country: v.optional(v.string()),
      region: v.optional(v.string()),
      city: v.optional(v.string()),
    }),
  },
  handler: async (ctx, { events, geo }) => {
    const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);

    for (const event of sorted) {
      const isBookkeeping = event.name === "session_start";

      await upsertMachine(ctx, {
        machineId: event.machineId,
        userId: event.userId,
        timestamp: event.timestamp,
        meta: isBookkeeping ? event.payload : undefined,
        geo, // only actually applied on first-seen machines — see upsertMachine change below
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
```

And extend `upsertMachine` to write geo only on the insert branch (first sighting):
```typescript
async function upsertMachine(
  ctx: MutationCtx,
  args: {
    machineId: string;
    userId?: string;
    timestamp: number;
    meta?: Record<string, unknown>;
    geo?: { ip?: string; country?: string; region?: string; city?: string };
  }
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
      ip: args.geo?.ip,
      country: args.geo?.country,
      region: args.geo?.region,
      city: args.geo?.city,
    });
    return { isNewMachine: true };
  }

  await ctx.db.patch(existing._id, {
    lastSeenAt: args.timestamp,
    userId: args.userId ?? existing.userId,
  });
  return { isNewMachine: false };
}
```

---

## Step 5 — Point the client at the new endpoint

The existing `ConvexTransport` hits `{convexUrl}/api/mutation`. HTTP Actions live at a slightly different base URL — Convex serves them from your deployment's `.convex.site` domain (not `.convex.cloud`), at whatever path you registered (`/ingest` above).

Change needed in `src/core/transport.ts` — swap the endpoint construction:
```typescript
export class ConvexTransport implements WispTransport {
  private endpoint: string;
  private debug: boolean;

  constructor(convexUrl: string, debug = false) {
    // .convex.cloud -> .convex.site for HTTP Actions, per Convex's routing convention
    const siteUrl = convexUrl.replace(".convex.cloud", ".convex.site");
    this.endpoint = `${siteUrl.replace(/\/$/, "")}/ingest`;
    this.debug = debug;
  }

  async send(events: WispEvent[], opts: { beacon?: boolean }): Promise<void> {
    if (events.length === 0) return;

    const body = JSON.stringify({ events }); // no more {path, args, format} wrapper — the HTTP action expects a plain body

    try {
      if (opts.beacon && typeof navigator !== "undefined" && navigator.sendBeacon) {
        const blob = new Blob([body], { type: "application/json" });
        navigator.sendBeacon(this.endpoint, blob);
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

Note the request body shape changes — no more `{ path, args, format }` wrapper, since you're hitting your own HTTP Action, not Convex's generic `/api/mutation` endpoint directly. The action itself calls `recordBatchWithGeo` internally.

---

## Deployment checklist, in order

1. Add the `geo`/`ip`/`country`/`region`/`city` fields to `convex/schema.ts`.
2. Pick and wire up a geo provider (Cloudflare headers, ipapi.co, or MaxMind).
3. Add `convex/http.ts` with the `/ingest` route.
4. Add `recordBatchWithGeo` to `convex/events.ts`.
5. Run `npx convex dev` to regenerate types and confirm no compile errors.
6. Update `ConvexTransport` in the SDK to hit `/ingest` on the `.convex.site` domain.
7. Test locally: open your app, check the Convex dashboard's `machines` table for a row with `country`/`region` populated.
8. Tighten `Access-Control-Allow-Origin` from `*` to your actual domain before shipping — wide open CORS on an ingestion endpoint is an easy way to get spammed.
9. Update your privacy policy to disclose IP/geo collection, per the compliance note from earlier.

---

## One architectural fork worth deciding before you build this

Do you want geo captured **once per machine** (what's scaffolded above — cheap, one geo lookup on first sight only) or **per session** (catches travel, costs a geo lookup on every new session)? The plan above defaults to once-per-machine since that's cheaper and covers the vast majority of use cases — most analytics questions ("what % of my users are in the US") don't need session-level granularity. Flag it if you want the per-session version instead; it's a small change (move the `geo` write into `upsertSession`'s insert branch instead of `upsertMachine`'s).