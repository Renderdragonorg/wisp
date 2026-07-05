import type { WispEvent, WispTransport } from "../types";

/**
 * Calls the Wisp HTTP Action endpoint (convex.site/ingest) instead of Convex's
 * generic /api/mutation directly. The HTTP Action runs server-side IP detection
 * and geo-resolution before forwarding events to the recordBatchWithGeo mutation.
 *
 * Docs: https://docs.convex.dev/http-api/
 */
export class ConvexTransport implements WispTransport {
  private endpoint: string;
  private debug: boolean;

  constructor(convexUrl: string, debug = false) {
    // HTTP Actions live on .convex.site, not .convex.cloud
    const siteUrl = convexUrl.replace(".convex.cloud", ".convex.site");
    this.endpoint = `${siteUrl.replace(/\/$/, "")}/ingest`;
    this.debug = debug;
  }

  async send(events: WispEvent[], opts: { beacon?: boolean }): Promise<void> {
    if (events.length === 0) return;

    const body = JSON.stringify({ events });

    try {
      if (opts.beacon && typeof navigator !== "undefined" && navigator.sendBeacon) {
        const blob = new Blob([body], { type: "application/json" });
        const ok = navigator.sendBeacon(this.endpoint, blob);
        if (ok) return;
        if (this.debug) console.warn("[wisp] sendBeacon returned false, falling back to fetch");
      }

      await fetch(this.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: opts.beacon,
      });
    } catch (err) {
      if (this.debug) console.warn("[wisp] transport error", err);
    }
  }
}
