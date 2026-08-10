import { ConvexError } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { QueryCtx, MutationCtx, ActionCtx } from "./_generated/server";

type DatabaseAuthCtx = Pick<QueryCtx, "auth" | "db"> | Pick<MutationCtx, "auth" | "db">;

/**
 * Require the signed-in user created by the dashboard credentials provider.
 * The configured dashboard name is kept server-side in Convex environment
 * variables. Call at the top of every guarded function.
 */
export async function requireAdmin(ctx: DatabaseAuthCtx): Promise<string> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) {
    throw new ConvexError("Unauthorized");
  }

  const user = await ctx.db.get(userId);
  const dashboardName = process.env.DASHBOARD_NAME;

  if (typeof dashboardName !== "string" || user?.name !== dashboardName) {
    throw new ConvexError("Unauthorized");
  }

  return dashboardName;
}

/** Action contexts cannot read the database, so validate the authenticated name claim. */
export async function requireAdminAction(ctx: Pick<ActionCtx, "auth">): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  const dashboardName = process.env.DASHBOARD_NAME;

  if (typeof dashboardName !== "string" || identity?.name !== dashboardName) {
    throw new ConvexError("Unauthorized");
  }

  return dashboardName;
}
