import { internalMutation, query } from "./_generated/server";
import { v } from "convex/values";

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
 * Rolls yesterday's (or today's, if run more frequently) sessions/machines up
 * into a single dailyStats row. Cheap to query from a dashboard instead of
 * scanning raw sessions every time.
 */
export const computeDailyStats = internalMutation({
  args: { date: v.optional(v.string()) },
  handler: async (ctx, { date }) => {
    const targetDate = date ?? dateKey(Date.now() - 24 * 60 * 60 * 1000); // default: yesterday
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
