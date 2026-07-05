import type { WispEvent, WispTransport } from "../types";

export interface QueueOptions {
  intervalMs: number;
  maxSize: number;
  transport: WispTransport;
  debug?: boolean;
}

/**
 * Buffers events in memory and flushes them in batches instead of firing one
 * network request per interaction. Flushes on: interval timer, buffer hitting
 * maxSize, and page hide / visibility change (using a beacon-style send so the
 * request survives the tab closing).
 */
export class EventQueue {
  private buffer: WispEvent[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private opts: QueueOptions;
  private destroyed = false;

  constructor(opts: QueueOptions) {
    this.opts = opts;
    this.timer = setInterval(() => void this.flush(), opts.intervalMs);

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.handleVisibilityChange);
      window.addEventListener("pagehide", this.handlePageHide);
    }
  }

  private handleVisibilityChange = (): void => {
    if (document.visibilityState === "hidden") {
      void this.flush({ beacon: true });
    }
  };

  private handlePageHide = (): void => {
    void this.flush({ beacon: true });
  };

  push(event: WispEvent): void {
    if (this.destroyed) return;
    this.buffer.push(event);
    if (this.opts.debug) console.debug("[wisp] queued", event.type, event.name);
    if (this.buffer.length >= this.opts.maxSize) {
      void this.flush();
    }
  }

  async flush(opts: { beacon?: boolean } = {}): Promise<void> {
    if (this.buffer.length === 0) return;
    const batch = this.buffer;
    this.buffer = [];

    try {
      await this.opts.transport.send(batch, opts);
      if (this.opts.debug) console.debug(`[wisp] flushed ${batch.length} event(s)`);
    } catch (err) {
      // Transport is expected to swallow its own errors, but guard here too —
      // analytics must never throw into the host app.
      if (this.opts.debug) console.warn("[wisp] flush failed, dropping batch", err);
    }
  }

  destroy(): void {
    this.destroyed = true;
    if (this.timer) clearInterval(this.timer);
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.handleVisibilityChange);
      window.removeEventListener("pagehide", this.handlePageHide);
    }
    void this.flush({ beacon: true });
  }
}
