import { internalMutation, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { MutationCtx } from "./_generated/server";

const dateKey = (ms: number) => new Date(ms).toISOString().slice(0, 10); // "YYYY-MM-DD"

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
      screen: args.meta?.screen as string | undefined,
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
    userAgent: args.meta?.userAgent as string | undefined ?? existing.userAgent,
    platform: args.meta?.platform as string | undefined ?? existing.platform,
    referrer: args.meta?.referrer as string | undefined ?? existing.referrer,
    screen: args.meta?.screen as string | undefined ?? existing.screen,
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

  // Brand new session — check if this machine has any prior session to mark "returning".
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

  // A brand new session on an existing machine counts as a return visit.
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
    // Process oldest-first so ordering-dependent bookkeeping (session creation, counters) is correct.
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

/** Fetch recent events for a single session — useful for a session-replay-lite debug view. */
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

/** Most frequent error names in a time range — your "top errors" dashboard widget. */
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

const geoValidator = v.object({
  ip: v.optional(v.string()),
  country: v.optional(v.string()),
  region: v.optional(v.string()),
  city: v.optional(v.string()),
});

/** Internal mutation called by the HTTP Action. Same as recordBatch but accepts
 * geo metadata resolved server-side (IP, country, region, city) and writes it
 * into the machines table on first sighting of each machine. */
export const recordBatchWithGeo = internalMutation({
  args: {
    events: v.array(eventValidator),
    geo: geoValidator,
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
        geo,
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
