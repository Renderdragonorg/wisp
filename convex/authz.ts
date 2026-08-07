import { ConvexError } from "convex/values";
import type { QueryCtx, MutationCtx, ActionCtx } from "./_generated/server";

const ALLOWED_EMAILS = new Set([
  "codersoft25@gmail.com",
  "powernplant101@gmail.com",
  "theckie@protonmail.com",
]);

type AuthCtx = Pick<QueryCtx, "auth"> | Pick<MutationCtx, "auth"> | Pick<ActionCtx, "auth">;

/**
 * Require a signed-in user whose email is on the dashboard allowlist.
 * Throws "Unauthorized" otherwise. Call at the top of every guarded function.
 */
export async function requireAdmin(ctx: AuthCtx): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  const email = identity?.email;

  if (!email || !ALLOWED_EMAILS.has(email)) {
    throw new ConvexError("Unauthorized");
  }

  return email;
}