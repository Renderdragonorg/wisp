import { action, query, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";

const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
const dateKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export const listSessions = query({
  args: {
    paginationOpts: paginationOptsValidator,
    search: v.optional(v.string()),
    sortBy: v.optional(
      v.union(v.literal("startedAt"), v.literal("durationMs"), v.literal("eventCount"), v.literal("errorCount"))
    ),
    sortDir: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
    onlyReturning: v.optional(v.boolean()),
    onlyWithErrors: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const sortDir = args.sortDir ?? "desc";

    if (args.search && args.search.trim().length > 0) {
      const results = await ctx.db
        .query("sessions")
        .withSearchIndex("search_entryUrl", (q) => q.search("entryUrl", args.search!))
        .paginate(args.paginationOpts);

      return {
        ...results,
        page: results.page.filter(
          (s) =>
            (!args.onlyReturning || s.isReturning) &&
            (!args.onlyWithErrors || s.errorCount > 0)
        ),
      };
    }

    const indexName = `by_${args.sortBy ?? "startedAt"}` as
      | "by_startedAt"
      | "by_durationMs"
      | "by_eventCount"
      | "by_errorCount";

    let q = ctx.db.query("sessions").withIndex(indexName).order(sortDir);

    if (args.onlyReturning) {
      q = q.filter((row) => row.eq(row.field("isReturning"), true)) as typeof q;
    }
    if (args.onlyWithErrors) {
      q = q.filter((row) => row.gt(row.field("errorCount"), 0)) as typeof q;
    }

    return await q.paginate(args.paginationOpts);
  },
});

export const listEvents = query({
  args: {
    paginationOpts: paginationOptsValidator,
    search: v.optional(v.string()),
    type: v.optional(
      v.union(v.literal("pageview"), v.literal("interaction"), v.literal("error"), v.literal("custom"))
    ),
  },
  handler: async (ctx, args) => {
    if (args.search && args.search.trim().length > 0) {
      let sq = ctx.db.query("events").withSearchIndex("search_name", (q) => {
        const base = q.search("name", args.search!);
        return args.type ? base.eq("type", args.type) : base;
      });
      return await sq.paginate(args.paginationOpts);
    }

    if (args.type) {
      return await ctx.db
        .query("events")
        .withIndex("by_type_time", (q) => q.eq("type", args.type!))
        .order("desc")
        .paginate(args.paginationOpts);
    }

    return await ctx.db.query("events").order("desc").paginate(args.paginationOpts);
  },
});

export const getOverview = query({
  args: { startDate: v.string(), endDate: v.string() },
  handler: async (ctx, { startDate, endDate }) => {
    const dayStart = new Date(`${startDate}T00:00:00.000Z`).getTime();
    const dayEnd = new Date(`${endDate}T23:59:59.999Z`).getTime();

    const daily = await ctx.db
      .query("dailyStats")
      .withIndex("by_date", (q) => q.gte("date", startDate).lte("date", endDate))
      .collect();

    const totalPageViews = await countPageViews(ctx, dayStart, dayEnd);

    if (daily.length > 0) {
      const totals = daily.reduce(
        (acc, d) => ({
          newUsers: acc.newUsers + d.newUsers,
          returningUsers: acc.returningUsers + d.returningUsers,
          totalSessions: acc.totalSessions + d.totalSessions,
          totalErrors: acc.totalErrors + d.totalErrors,
          totalEvents: acc.totalEvents + d.totalEvents,
        }),
        { newUsers: 0, returningUsers: 0, totalSessions: 0, totalErrors: 0, totalEvents: 0 }
      );

      const avgDuration =
        daily.length > 0
          ? Math.round(daily.reduce((sum, d) => sum + d.avgSessionDurationMs, 0) / daily.length)
          : 0;

      return {
        totals: { ...totals, totalPageViews },
        avgSessionDurationMs: avgDuration,
        series: daily.sort((a, b) => a.date.localeCompare(b.date)),
      };
    }

    const sessionsInRange = await ctx.db
      .query("sessions")
      .filter((q) =>
        q.and(q.gte(q.field("startedAt"), dayStart), q.lt(q.field("startedAt"), dayEnd))
      )
      .collect();

    const newMachineIds = new Set<string>();
    const returningSessions = sessionsInRange.filter((s) => s.isReturning);
    for (const s of sessionsInRange) {
      if (!s.isReturning) newMachineIds.add(s.machineId);
    }

    const totalErrors = sessionsInRange.reduce((sum, s) => sum + s.errorCount, 0);
    const totalEvents = sessionsInRange.reduce((sum, s) => sum + s.eventCount, 0);
    const durations = sessionsInRange
      .map((s) => s.durationMs ?? s.lastActivityAt - s.startedAt)
      .filter((d) => d > 0);
    const avgDuration =
      durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;

    return {
      totals: {
        newUsers: newMachineIds.size,
        returningUsers: new Set(returningSessions.map((s) => s.machineId)).size,
        totalSessions: sessionsInRange.length,
        totalErrors,
        totalEvents,
        totalPageViews,
      },
      avgSessionDurationMs: Math.round(avgDuration),
      series: [
        {
          date: dateKey(Date.now()),
          newUsers: newMachineIds.size,
          returningUsers: new Set(returningSessions.map((s) => s.machineId)).size,
          totalSessions: sessionsInRange.length,
          totalErrors,
          totalEvents,
          avgSessionDurationMs: Math.round(avgDuration),
        },
      ],
    };
  },
});

export const getErrorBreakdown = query({
  args: { since: v.number() },
  handler: async (ctx, { since }) => {
    const errors = await ctx.db
      .query("events")
      .withIndex("by_type_time", (q) => q.eq("type", "error").gte("timestamp", since))
      .collect();

    const counts = new Map<string, number>();
    for (const e of errors) counts.set(e.name, (counts.get(e.name) ?? 0) + 1);

    return Array.from(counts.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  },
});

/** Fetch full error events for a given error name — shows stack traces, URLs, session IDs, timestamps. */
export const getErrorDetails = query({
  args: { errorName: v.string(), since: v.number(), limit: v.optional(v.number()) },
  handler: async (ctx, { errorName, since, limit }) => {
    const errors = await ctx.db
      .query("events")
      .withIndex("by_type_time", (q) => q.eq("type", "error").gte("timestamp", since))
      .collect();

    const filtered = errors
      .filter((e) => e.name === errorName)
      .sort((a, b) => b.timestamp - a.timestamp);

    const page = limit ? filtered.slice(0, limit) : filtered;

    return page.map((e) => ({
      id: e._id,
      name: e.name,
      payload: e.payload,
      url: e.url,
      timestamp: e.timestamp,
      sessionId: e.sessionId,
      machineId: e.machineId,
    }));
  },
});

/** Fetch aggregated stats for a single machine. */
export const getMachineStats = query({
  args: { machineId: v.string() },
  handler: async (ctx, { machineId }) => {
    const machine = await ctx.db
      .query("machines")
      .withIndex("by_machineId", (q) => q.eq("machineId", machineId))
      .unique();

    if (!machine) return null;

    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_machineId", (q) => q.eq("machineId", machineId))
      .collect();

    const totalSessions = sessions.length;
    const totalErrors = sessions.reduce((s, x) => s + x.errorCount, 0);
    const totalEvents = sessions.reduce((s, x) => s + x.eventCount, 0);
    const returningSessions = sessions.filter((s) => s.isReturning).length;
    const durations = sessions
      .map((s) => s.durationMs ?? s.lastActivityAt - s.startedAt)
      .filter((d) => d > 0);
    const avgDurationMs = durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;

    const errorNames = await ctx.db
      .query("events")
      .withIndex("by_machine_time", (q) => q.eq("machineId", machineId))
      .filter((q) => q.eq(q.field("type"), "error"))
      .collect();
    const topErrors = Array.from(
      errorNames.reduce((map, e) => map.set(e.name, (map.get(e.name) ?? 0) + 1), new Map<string, number>())
    )
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ name, count }));

    const pageviews = await ctx.db
      .query("events")
      .withIndex("by_machine_time", (q) => q.eq("machineId", machineId))
      .filter((q) => q.eq(q.field("type"), "pageview"))
      .collect();
    const topPages = Array.from(
      pageviews.reduce((map, e) => map.set(e.url, (map.get(e.url) ?? 0) + 1), new Map<string, number>())
    )
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([url, count]) => ({ url, count }));

    const lastSession = sessions.reduce((a, b) => (a.lastActivityAt > b.lastActivityAt ? a : b), sessions[0]);

    return {
      machine: {
        id: machine.machineId,
        userId: machine.userId ?? null,
        firstSeenAt: machine.firstSeenAt,
        lastSeenAt: machine.lastSeenAt,
        visitCount: machine.visitCount,
        userAgent: machine.userAgent ?? null,
        platform: machine.platform ?? null,
        referrer: machine.referrer ?? null,
        ip: machine.ip ?? null,
        country: machine.country ?? null,
        region: machine.region ?? null,
        city: machine.city ?? null,
        screen: machine.screen ?? null,
      },
      stats: {
        totalSessions,
        totalErrors,
        totalEvents,
        returningSessions,
        avgSessionDurationMs: avgDurationMs,
        returningRate: totalSessions > 0 ? Math.round((returningSessions / totalSessions) * 100) : 0,
      },
      topErrors,
      topPages,
      lastSession: {
        id: lastSession.sessionId,
        startedAt: lastSession.startedAt,
        entryUrl: lastSession.entryUrl ?? null,
        exitUrl: lastSession.exitUrl ?? null,
        durationMs: lastSession.durationMs,
        errorCount: lastSession.errorCount,
      },
    };
  },
});

async function countPageViews(ctx: QueryCtx, dayStart: number, dayEnd: number): Promise<number> {
  const pvs = await ctx.db
    .query("events")
    .withIndex("by_type_time", (q) => q.eq("type", "pageview").gte("timestamp", dayStart))
    .collect();
  return pvs.filter((e) => e.timestamp < dayEnd).length;
}

/** Most viewed pages in a date range. */
export const getTopPages = query({
  args: { startDate: v.string(), endDate: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { startDate, endDate, limit }) => {
    const dayStart = new Date(`${startDate}T00:00:00.000Z`).getTime();
    const dayEnd = new Date(`${endDate}T23:59:59.999Z`).getTime();

    const pageviews = await ctx.db
      .query("events")
      .withIndex("by_type_time", (q) => q.eq("type", "pageview").gte("timestamp", dayStart))
      .collect();

    const inRange = pageviews.filter((e) => e.timestamp < dayEnd);

    const pageMap = new Map<string, { viewCount: number; machines: Set<string> }>();
    for (const e of inRange) {
      const entry = pageMap.get(e.url) ?? { viewCount: 0, machines: new Set<string>() };
      entry.viewCount++;
      entry.machines.add(e.machineId);
      pageMap.set(e.url, entry);
    }

    return Array.from(pageMap.entries())
      .map(([url, { viewCount, machines }]) => ({ url, viewCount, uniqueMachines: machines.size }))
      .sort((a, b) => b.viewCount - a.viewCount)
      .slice(0, limit ?? 20);
  },
});

/** Machines that visited a specific page. */
export const getPageVisitors = query({
  args: { url: v.string(), startDate: v.string(), endDate: v.string() },
  handler: async (ctx, { url, startDate, endDate }) => {
    const dayStart = new Date(`${startDate}T00:00:00.000Z`).getTime();
    const dayEnd = new Date(`${endDate}T23:59:59.999Z`).getTime();

    const pageviews = await ctx.db
      .query("events")
      .withIndex("by_type_time", (q) => q.eq("type", "pageview").gte("timestamp", dayStart))
      .collect();

    const inRange = pageviews.filter((e) => e.timestamp < dayEnd && e.url === url);

    const machineMap = new Map<string, { visitCount: number; firstVisitedAt: number; lastVisitedAt: number }>();
    for (const e of inRange) {
      const entry = machineMap.get(e.machineId) ?? { visitCount: 0, firstVisitedAt: e.timestamp, lastVisitedAt: e.timestamp };
      entry.visitCount++;
      entry.firstVisitedAt = Math.min(entry.firstVisitedAt, e.timestamp);
      entry.lastVisitedAt = Math.max(entry.lastVisitedAt, e.timestamp);
      machineMap.set(e.machineId, entry);
    }

    const machines = await Promise.all(
      Array.from(machineMap.entries()).map(async ([machineId, stats]) => {
        const machine = await ctx.db
          .query("machines")
          .withIndex("by_machineId", (q) => q.eq("machineId", machineId))
          .unique();
        return {
          machineId,
          visitCount: stats.visitCount,
          firstVisitedAt: stats.firstVisitedAt,
          lastVisitedAt: stats.lastVisitedAt,
          country: machine?.country ?? null,
          platform: machine?.platform ?? null,
          userAgent: machine?.userAgent ?? null,
        };
      })
    );

    return machines.sort((a, b) => b.visitCount - a.visitCount);
  },
});

/** Daily time series of page views. */
export const getPageViewsOverTime = query({
  args: { startDate: v.string(), endDate: v.string() },
  handler: async (ctx, { startDate, endDate }) => {
    const dayStart = new Date(`${startDate}T00:00:00.000Z`).getTime();
    const dayEnd = new Date(`${endDate}T23:59:59.999Z`).getTime();

    const pageviews = await ctx.db
      .query("events")
      .withIndex("by_type_time", (q) => q.eq("type", "pageview").gte("timestamp", dayStart))
      .collect();

    const inRange = pageviews.filter((e) => e.timestamp < dayEnd);

    const dayMap = new Map<string, { pageViews: number; machines: Set<string> }>();
    for (const e of inRange) {
      const date = dateKey(e.timestamp);
      const entry = dayMap.get(date) ?? { pageViews: 0, machines: new Set<string>() };
      entry.pageViews++;
      entry.machines.add(e.machineId);
      dayMap.set(date, entry);
    }

    return Array.from(dayMap.entries())
      .map(([date, { pageViews, machines }]) => ({ date, pageViews, uniqueMachines: machines.size }))
      .sort((a, b) => a.date.localeCompare(b.date));
  },
});

/** Autocomplete / search machines by machineId prefix. */
export const searchMachines = query({
  args: { prefix: v.string() },
  handler: async (ctx, { prefix }) => {
    if (!prefix || prefix.trim().length === 0) return [];
    const all = await ctx.db.query("machines").collect();
    return all
      .filter((m) => m.machineId.toLowerCase().includes(prefix.toLowerCase()))
      .map((m) => ({
        id: m.machineId,
        label: `${m.machineId.slice(0, 12)}…`,
        country: m.country ?? null,
        platform: m.platform ?? null,
        lastSeenAt: m.lastSeenAt,
      }))
      .slice(0, 20);
  },
});

/** Manually recompute daily stats for yesterday and today. Call this after deploying or whenever you want to refresh dashboard data without waiting for the cron. */
export const recomputeStats = action({
  args: {},
  handler: async (ctx) => {
    await ctx.runMutation(internal.stats.closeStaleSessions, {});
    await ctx.runMutation(internal.stats.computeDailyStats, {});
    await ctx.runMutation(internal.stats.computeDailyStats, {
      date: dateKey(Date.now()),
    });
    return { done: true };
  },
});
