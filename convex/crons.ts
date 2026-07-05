import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Sweep for sessions that have gone quiet for 30+ min and mark them closed.
crons.interval("close stale sessions", { minutes: 10 }, internal.stats.closeStaleSessions, {});

// Roll up yesterday's activity once a day. Run at 00:15 UTC so the full
// previous day's sessions have had a chance to close first.
crons.cron("compute daily stats", "15 0 * * *", internal.stats.computeDailyStats, {});

export default crons;
