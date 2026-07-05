import type { WispClientInternal, WispPlugin } from "../types";

/**
 * Tracks a "pageview" event on initial load and on every client-side route
 * change. Works for any SPA router (React Router, Vue Router, etc.) because it
 * patches history.pushState/replaceState directly rather than depending on a
 * specific router's events.
 */
export function pageviewPlugin(): WispPlugin {
  let originalPushState: typeof history.pushState | null = null;
  let originalReplaceState: typeof history.replaceState | null = null;
  let onPopState: (() => void) | null = null;

  return {
    name: "pageviews",
    install(client: WispClientInternal) {
      const fire = () => client.track("pageview", { url: location.href, path: location.pathname });

      fire(); // initial load

      originalPushState = history.pushState.bind(history);
      originalReplaceState = history.replaceState.bind(history);

      history.pushState = function (...args: Parameters<typeof history.pushState>) {
        originalPushState!(...args);
        fire();
      };
      history.replaceState = function (...args: Parameters<typeof history.replaceState>) {
        originalReplaceState!(...args);
        fire();
      };

      onPopState = fire;
      window.addEventListener("popstate", onPopState);
    },
    uninstall() {
      if (originalPushState) history.pushState = originalPushState;
      if (originalReplaceState) history.replaceState = originalReplaceState;
      if (onPopState) window.removeEventListener("popstate", onPopState);
    },
  };
}
