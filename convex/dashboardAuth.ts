import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

/** Create the stable Convex Auth user used by the dashboard credentials provider. */
export const ensureDashboardUser = internalMutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const email = `${name}@dashboard.local`;
    const existing = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .unique();

    if (existing) return existing._id;

    return await ctx.db.insert("users", { name, email });
  },
});
