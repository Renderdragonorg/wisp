import { getOrCreateMachineId } from "./core/machineId";
import { SessionManager } from "./core/session";
import { EventQueue } from "./core/queue";
import { ConvexTransport } from "./core/transport";
import { errorPlugin } from "./plugins/errors";
import { clickPlugin } from "./plugins/clicks";
import { pageviewPlugin } from "./plugins/pageviews";
import type { WispConfig, WispEvent, WispPlugin, WispClientInternal } from "./types";

export type { WispConfig, WispEvent, WispPlugin, WispTransport, EventType } from "./types";

const DEFAULTS = {
  sessionTimeoutMs: 30 * 60 * 1000,
  batchIntervalMs: 5_000,
  batchMaxSize: 20,
  autoTrackErrors: true,
  autoTrackClicks: true,
  autoTrackPageviews: true,
  samplingRate: 1,
  debug: false,
};

class WispClient implements WispClientInternal {
  private machineId: string;
  private session: SessionManager;
  private queue: EventQueue;
  private plugins: WispPlugin[] = [];
  private userId?: string;
  private sampledIn: boolean;
  public config: WispClientInternal["config"];

  constructor(cfg: WispConfig) {
    if (!cfg.convexUrl && !cfg.transport) {
      throw new Error("[wisp] init() requires either `convexUrl` or a custom `transport`.");
    }

    this.config = {
      convexUrl: cfg.convexUrl ?? "",
      wispSecret: cfg.wispSecret,
      sessionTimeoutMs: cfg.sessionTimeoutMs ?? DEFAULTS.sessionTimeoutMs,
      batchIntervalMs: cfg.batchIntervalMs ?? DEFAULTS.batchIntervalMs,
      batchMaxSize: cfg.batchMaxSize ?? DEFAULTS.batchMaxSize,
      autoTrackErrors: cfg.autoTrackErrors ?? DEFAULTS.autoTrackErrors,
      autoTrackClicks: cfg.autoTrackClicks ?? DEFAULTS.autoTrackClicks,
      autoTrackPageviews: cfg.autoTrackPageviews ?? DEFAULTS.autoTrackPageviews,
      samplingRate: cfg.samplingRate ?? DEFAULTS.samplingRate,
      debug: cfg.debug ?? DEFAULTS.debug,
      transport: cfg.transport,
      redact: cfg.redact,
    };

    this.machineId = getOrCreateMachineId();
    this.sampledIn = this.resolveSampling(this.config.samplingRate);
    this.session = new SessionManager(this.config.sessionTimeoutMs);

    const transport = this.config.transport ?? new ConvexTransport(this.config.convexUrl, this.config.debug, this.config.wispSecret);
    this.queue = new EventQueue({
      intervalMs: this.config.batchIntervalMs,
      maxSize: this.config.batchMaxSize,
      transport,
      debug: this.config.debug,
    });

    this.installPlugins(cfg.plugins ?? []);

    // Fire the session bookkeeping event immediately so a machine/session row
    // exists even if the visitor never triggers another event. Metadata here
    // is only ever read by the backend on a machine/session's *first* event.
    this.track("session_start", {
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
      platform: typeof navigator !== "undefined" ? navigator.platform : undefined,
      referrer: typeof document !== "undefined" ? document.referrer : undefined,
      screen: typeof screen !== "undefined" ? `${screen.width}x${screen.height}` : undefined,
    });
  }

  /** Sampling is decided once per machine and stored, so a machine is either fully in or fully out — never split mid-session. */
  private resolveSampling(rate: number): boolean {
    if (rate >= 1) return true;
    const key = "wisp_sampled_in";
    try {
      const cached = window.localStorage.getItem(key);
      if (cached !== null) return cached === "1";
      const decision = Math.random() < rate;
      window.localStorage.setItem(key, decision ? "1" : "0");
      return decision;
    } catch {
      return Math.random() < rate;
    }
  }

  private installPlugins(extra: WispPlugin[]): void {
    if (this.config.autoTrackErrors) this.plugins.push(errorPlugin());
    if (this.config.autoTrackClicks) this.plugins.push(clickPlugin());
    if (this.config.autoTrackPageviews) this.plugins.push(pageviewPlugin());
    this.plugins.push(...extra);

    for (const plugin of this.plugins) {
      plugin.install(this);
    }
  }

  /** Call after Supabase (or any auth provider) resolves a logged-in user. Attaches userId to all future events for this machine/session. */
  identify(userId: string): void {
    this.userId = userId;
  }

  /** Clear identity on logout. Machine ID persists — only the userId link is dropped. */
  reset(): void {
    this.userId = undefined;
  }

  track(name: string, payload?: Record<string, unknown>): void {
    if (!this.sampledIn) return;

    const { sessionId } = this.session.touch();

    let event: WispEvent = {
      type: name.startsWith("click:") ? "interaction" : name === "pageview" ? "pageview" : "custom",
      name,
      payload,
      url: typeof location !== "undefined" ? location.href : "",
      timestamp: Date.now(),
      sessionId,
      machineId: this.machineId,
      userId: this.userId,
    };

    if (this.config.redact) {
      const redacted = this.config.redact(event);
      if (!redacted) return;
      event = redacted;
    }

    this.queue.push(event);
  }

  trackError(error: Error | string, context?: Record<string, unknown>): void {
    if (!this.sampledIn) return;

    const { sessionId } = this.session.touch();
    const message = error instanceof Error ? error.message : error;
    const stack = error instanceof Error ? error.stack : undefined;

    let event: WispEvent = {
      type: "error",
      name: message.slice(0, 200),
      payload: { ...context, stack },
      url: typeof location !== "undefined" ? location.href : "",
      timestamp: Date.now(),
      sessionId,
      machineId: this.machineId,
      userId: this.userId,
    };

    if (this.config.redact) {
      const redacted = this.config.redact(event);
      if (!redacted) return;
      event = redacted;
    }

    this.queue.push(event);
  }

  getMachineId(): string {
    return this.machineId;
  }

  getSessionId(): string {
    return this.session.getSessionId();
  }

  async flush(): Promise<void> {
    await this.queue.flush();
  }

  destroy(): void {
    for (const plugin of this.plugins) plugin.uninstall?.();
    this.queue.destroy();
  }
}

let instance: WispClient | null = null;

/** Initialize Wisp once, as early in your app's lifecycle as possible (e.g. root layout, main.ts entrypoint). */
export function init(config: WispConfig): WispClient {
  if (instance) {
    if (config.debug) console.warn("[wisp] init() called more than once — reusing existing instance.");
    return instance;
  }
  instance = new WispClient(config);
  return instance;
}

function requireInstance(): WispClient {
  if (!instance) {
    throw new Error("[wisp] Not initialized — call wisp.init({ convexUrl }) first.");
  }
  return instance;
}

export const wisp = {
  init,
  identify: (userId: string) => requireInstance().identify(userId),
  reset: () => requireInstance().reset(),
  track: (name: string, payload?: Record<string, unknown>) => requireInstance().track(name, payload),
  trackError: (error: Error | string, context?: Record<string, unknown>) =>
    requireInstance().trackError(error, context),
  flush: () => requireInstance().flush(),
  destroy: () => requireInstance().destroy(),
  getMachineId: () => requireInstance().getMachineId(),
  getSessionId: () => requireInstance().getSessionId(),
};

export default wisp;
