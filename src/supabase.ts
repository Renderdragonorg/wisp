import type { SupabaseClient, Session } from "@supabase/supabase-js";
import { wisp } from "./index";

function extractUserInfo(session: Session | null): { email?: string; name?: string; provider?: string } {
  const user = session?.user;
  if (!user) return {};
  return {
    email: user.email ?? undefined,
    name: user.user_metadata?.full_name ?? user.user_metadata?.name ?? undefined,
    provider: user.app_metadata?.provider ?? undefined,
  };
}

/**
 * Wires Supabase auth state to Wisp identity. Call once after both Supabase
 * and Wisp are initialized. Handles the current session on call, plus every
 * future sign-in/sign-out.
 *
 * Also sends user profile info (email, name, auth provider) so analytics
 * can display who the user is alongside machine/session data.
 *
 * import { bindSupabase } from "@renderdragonorg/wisp/supabase";
 * bindSupabase(supabase);
 */
export function bindSupabase(supabase: SupabaseClient): () => void {
  supabase.auth.getSession().then(({ data }) => {
    const userInfo = extractUserInfo(data.session);
    if (data.session?.user?.id) wisp.identify(data.session.user.id, userInfo);
  });

  const { data: subscription } = supabase.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_IN" && session?.user?.id) {
      const userInfo = extractUserInfo(session);
      wisp.identify(session.user.id, userInfo);
    } else if (event === "SIGNED_OUT") {
      wisp.reset();
    }
  });

  return () => subscription.subscription.unsubscribe();
}
