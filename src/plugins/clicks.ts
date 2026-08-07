import type { WispClientInternal, WispPlugin } from "../types";

/**
 * Delegated click tracking. Add `data-wisp-id="signup_button"` to any element
 * and clicks on it (or its descendants) are tracked automatically — no need to
 * wire up onClick handlers by hand throughout the app. Extra data-wisp-* attrs
 * are collected into the event payload, e.g. data-wisp-plan="pro" -> { plan: "pro" }.
 */
export function clickPlugin(): WispPlugin {
  let handler: ((e: MouseEvent) => void) | null = null;

  return {
    name: "clicks",
    install(client: WispClientInternal) {
      handler = (event: MouseEvent) => {
        const target = event.target as HTMLElement | null;
        const el = target?.closest<HTMLElement>("[data-wisp-id]");
        if (!el) return;

        const id = el.getAttribute("data-wisp-id")!;
        const payload: Record<string, unknown> = {};
        for (const attr of Array.from(el.attributes)) {
          if (attr.name.startsWith("data-wisp-") && attr.name !== "data-wisp-id") {
            const key = attr.name.replace("data-wisp-", "");
            payload[key] = attr.value;
          }
        }

        client.track(`click:${id}`, payload);
      };

      document.addEventListener("click", handler, { capture: true });
    },
    uninstall() {
      if (handler) document.removeEventListener("click", handler, { capture: true });
    },
  };
}
