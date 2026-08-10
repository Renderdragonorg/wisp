import { internal } from "./_generated/api";
import { convexAuth } from "@convex-dev/auth/server";
import { ConvexCredentials } from "@convex-dev/auth/providers/ConvexCredentials";

function constantTimeEqual(left: string, right: string): boolean {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);

  for (let i = 0; i < length; i++) {
    difference |= (left.charCodeAt(i) || 0) ^ (right.charCodeAt(i) || 0);
  }

  return difference === 0;
}

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    ConvexCredentials({
      authorize: async (credentials, ctx) => {
        const configuredName = process.env.DASHBOARD_NAME;
        const configuredKey = process.env.DASHBOARD_KEY;
        const name = credentials.name;
        const key = credentials.key;

        if (
          typeof configuredName !== "string" ||
          typeof configuredKey !== "string" ||
          typeof name !== "string" ||
          typeof key !== "string" ||
          !constantTimeEqual(name, configuredName) ||
          !constantTimeEqual(key, configuredKey)
        ) {
          return null;
        }

        const userId = await ctx.runMutation(internal.dashboardAuth.ensureDashboardUser, {
          name: configuredName,
        });

        return { userId };
      },
    }),
  ],
});
