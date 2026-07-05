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
    ip: v.optional(v.string()),
    country: v.optional(v.string()),
    region: v.optional(v.string()),
    city: v.optional(v.string()),
    screen: v.optional(v.string()),
  })
    .index("by_machineId", ["machineId"])
    .index("by_userId", ["userId"])
    .index("by_firstSeenDate", ["firstSeenDate"])
    .index("by_country", ["country"]),

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
    .index("by_open", ["endedAt"])
    .index("by_startedAt", ["startedAt"])
    .index("by_durationMs", ["durationMs"])
    .index("by_eventCount", ["eventCount"])
    .index("by_errorCount", ["errorCount"])
    .searchIndex("search_entryUrl", { searchField: "entryUrl" }),

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
    .index("by_machine_time", ["machineId", "timestamp"])
    .searchIndex("search_name", { searchField: "name", filterFields: ["type"] }),

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
