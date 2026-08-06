import { internalMutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { MutationCtx } from "./_generated/server";

const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
const dateKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * Runs periodically (see crons.ts). A session can't "know" it ended — the
 * client just stops sending events — so this sweep is the server-side source
 * of truth: any session whose lastActivityAt is more than 30 min old and has
 * no endedAt yet is considered closed, and gets a final durationMs.
 */
export const closeStaleSessions = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - SESSION_TIMEOUT_MS;

    const stale = await ctx.db
      .query("sessions")
      .withIndex("by_open_lastActivityAt", (q) =>
        q.eq("endedAt", undefined).lt("lastActivityAt", cutoff)
      )
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

/**
 * Roll one day's sessions/machines/pageviews up into the aggregate tables
 * (dailyStats, dailyPages, dailyPageVisitors). Scanning one day of raw
 * events is cheap; the dashboard then reads only the rolled-up rows, which
 * keeps it under Convex's 32k-docs-per-transaction limit.
 */
async function rollUpDay(ctx: MutationCtx, targetDate: string) {
  const dayStart = new Date(`${targetDate}T00:00:00.000Z`).getTime();
  const dayEnd = dayStart + 24 * 60 * 60 * 1000;

  const sessionsToday = await ctx.db
    .query("sessions")
    .withIndex("by_startedAt", (q) => q.gte("startedAt", dayStart).lt("startedAt", dayEnd))
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

  // Pageview aggregates: one day of pageviews is well under the read limit.
  const pageviews = await ctx.db
    .query("events")
    .withIndex("by_type_time", (q) =>
      q.eq("type", "pageview").gte("timestamp", dayStart).lt("timestamp", dayEnd)
    )
    .collect();

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
    totalPageViews: pageviews.length,
    avgSessionDurationMs: Math.round(avgDuration),
  };

  if (existing) {
    await ctx.db.patch(existing._id, row);
  } else {
    await ctx.db.insert("dailyStats", row);
  }

  // Per-page counts for the day: delete-then-reinsert keeps the rollup idempotent.
  const existingPages = await ctx.db
    .query("dailyPages")
    .withIndex("by_date", (q) => q.eq("date", targetDate))
    .collect();
  for (const doc of existingPages) await ctx.db.delete(doc._id);

  const pageMap = new Map<string, number>();
  for (const e of pageviews) pageMap.set(e.url, (pageMap.get(e.url) ?? 0) + 1);
  for (const [url, viewCount] of pageMap) {
    await ctx.db.insert("dailyPages", { date: targetDate, url, viewCount });
  }

  // Per-page-per-machine counts for the day.
  const existingVisitors = await ctx.db
    .query("dailyPageVisitors")
    .withIndex("by_date_url", (q) => q.eq("date", targetDate))
    .collect();
  for (const doc of existingVisitors) await ctx.db.delete(doc._id);

  const visitorMap = new Map<string, { viewCount: number; first: number; last: number }>();
  for (const e of pageviews) {
    const key = `${e.url}\u0000${e.machineId}`;
    const entry = visitorMap.get(key) ?? {
      viewCount: 0,
      first: e.timestamp,
      last: e.timestamp,
    };
    entry.viewCount++;
    entry.first = Math.min(entry.first, e.timestamp);
    entry.last = Math.max(entry.last, e.timestamp);
    visitorMap.set(key, entry);
  }
  for (const [key, v] of visitorMap) {
    const [url, machineId] = key.split("\u0000");
    await ctx.db.insert("dailyPageVisitors", {
      date: targetDate,
      url,
      machineId,
      viewCount: v.viewCount,
      firstVisitedAt: v.first,
      lastVisitedAt: v.last,
    });
  }

  return row;
}

/**
 * Rolls up into aggregate rows. When no date is given, rolls both today
 * (live, current-day numbers) and yesterday (finalize the previous day).
 * Scanning a single day of raw events is cheap; the dashboard reads only the
 * rolled-up rows, keeping it under Convex's 32k-docs-per-transaction limit.
 */
export const computeDailyStats = internalMutation({
  args: { date: v.optional(v.string()) },
  handler: async (ctx, { date }) => {
    const dates = date
      ? [date]
      : [dateKey(Date.now()), dateKey(Date.now() - 24 * 60 * 60 * 1000)];
    const rows = [];
    for (const targetDate of dates) {
      rows.push(await rollUpDay(ctx, targetDate));
    }
    return rows;
  },
});

/** Dashboard query: stats over a date range, e.g. last 30 days. */
export const getDailyStats = query({
  args: { startDate: v.string(), endDate: v.string() },
  handler: async (ctx, { startDate, endDate }) => {
    return await ctx.db
      .query("dailyStats")
      .withIndex("by_date", (q) => q.gte("date", startDate).lte("date", endDate))
      .collect();
  },
});
