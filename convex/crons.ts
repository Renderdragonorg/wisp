import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Sweep for sessions that have gone quiet for 30+ min and mark them closed.
crons.interval("close stale sessions", { minutes: 10 }, internal.stats.closeStaleSessions, {});

// Roll up activity into the aggregate tables. Runs every 15 minutes so the
// dashboard's "today" numbers stay live and yesterday stays finalized —
// computeDailyStats rolls both today and yesterday when no date is passed.
crons.interval("compute daily stats", { minutes: 15 }, internal.stats.computeDailyStats, {});

export default crons;