import type { SupabaseClient } from "@supabase/supabase-js";
import { wisp } from "./index";

/**
 * Wires Supabase auth state to Wisp identity. Call once after both Supabase
 * and Wisp are initialized. Handles the current session on call, plus every
 * future sign-in/sign-out.
 *
 * import { bindSupabase } from "@codersoft/wisp/supabase";
 * bindSupabase(supabase);
 */
export function bindSupabase(supabase: SupabaseClient): () => void {
  supabase.auth.getSession().then(({ data }) => {
    if (data.session?.user?.id) wisp.identify(data.session.user.id);
  });

  const { data: subscription } = supabase.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_IN" && session?.user?.id) {
      wisp.identify(session.user.id);
    } else if (event === "SIGNED_OUT") {
      wisp.reset();
    }
  });

  return () => subscription.subscription.unsubscribe();
}
