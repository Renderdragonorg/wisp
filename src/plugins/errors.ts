import type { WispClientInternal, WispPlugin } from "../types";

export function errorPlugin(): WispPlugin {
  let onError: ((e: ErrorEvent) => void) | null = null;
  let onRejection: ((e: PromiseRejectionEvent) => void) | null = null;

  return {
    name: "errors",
    install(client: WispClientInternal) {
      onError = (event: ErrorEvent) => {
        client.trackError(event.error ?? event.message, {
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
          source: "window.onerror",
        });
      };

      onRejection = (event: PromiseRejectionEvent) => {
        const reason = event.reason;
        const error =
          reason instanceof Error ? reason : new Error(String(reason ?? "Unhandled rejection"));
        client.trackError(error, { source: "unhandledrejection" });
      };

      window.addEventListener("error", onError);
      window.addEventListener("unhandledrejection", onRejection);
    },
    uninstall() {
      if (onError) window.removeEventListener("error", onError);
      if (onRejection) window.removeEventListener("unhandledrejection", onRejection);
    },
  };
}
