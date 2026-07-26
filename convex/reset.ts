import { mutation } from "./_generated/server";

const BATCH_SIZE = 500;

export const clearAll = mutation({
  args: {},
  handler: async (ctx) => {
    for (const table of ["events", "sessions", "machines", "dailyStats"] as const) {
      let docs = await ctx.db.query(table).take(BATCH_SIZE);
      while (docs.length > 0) {
        for (const doc of docs) {
          await ctx.db.delete(doc._id);
        }
        docs = await ctx.db.query(table).take(BATCH_SIZE);
      }
    }
  },
});
