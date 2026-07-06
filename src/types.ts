export type EventType = "pageview" | "interaction" | "error" | "custom";

export interface WispEvent {
  type: EventType;
  name: string;
  payload?: Record<string, unknown>;
  url: string;
  timestamp: number;
  sessionId: string;
  machineId: string;
  userId?: string;
}

export interface WispTransport {
  /** Send a batch of events. Must not throw on network failure — swallow and drop, or the queue will grow unbounded. */
  send(events: WispEvent[], opts: { beacon?: boolean }): Promise<void> | void;
}

export interface WispPlugin {
  name: string;
  /** Called once on init with the live client instance. Attach listeners here. */
  install(client: WispClientInternal): void;
  /** Called on client.destroy(). Remove listeners here. */
  uninstall?(): void;
}

/** Subset of the client surface plugins are allowed to touch. Keeps plugins decoupled from queue/session internals. */
export interface WispClientInternal {
  track(name: string, payload?: Record<string, unknown>): void;
  trackError(error: Error | string, context?: Record<string, unknown>): void;
  getMachineId(): string;
  getSessionId(): string;
  config: Required<Omit<WispConfig, "transport" | "plugins" | "redact" | "wispSecret">> & {
    transport?: WispTransport;
    wispSecret?: string;
    redact?: (event: WispEvent) => WispEvent | null;
  };
}

export interface WispConfig {
  /** Convex deployment URL, e.g. https://happy-animal-123.convex.cloud. Ignored if a custom `transport` is provided. */
  convexUrl?: string;
  /** Shared secret for authenticating with the Wisp ingest endpoint. Sent as x-wisp-token header. */
  wispSecret?: string;
  /** Swap the default Convex HTTP transport for anything else (e.g. your own /api/analytics endpoint). */
  transport?: WispTransport;
  /** Inactivity window before a new session starts. Default 30 min. */
  sessionTimeoutMs?: number;
  /** How often the queue auto-flushes. Default 5s. */
  batchIntervalMs?: number;
  /** Max events buffered before a forced flush. Default 20. */
  batchMaxSize?: number;
  /** Automatically track window "error" and "unhandledrejection". Default true. */
  autoTrackErrors?: boolean;
  /** Automatically track clicks on elements with [data-wisp-id]. Default true. */
  autoTrackClicks?: boolean;
  /** Automatically track SPA pageviews via history.pushState/popstate. Default true. */
  autoTrackPageviews?: boolean;
  /** Fraction of sessions to track, 0-1. Default 1 (no sampling). Sampling decision is made once per machineId. */
  samplingRate?: number;
  /** Extra plugins to install alongside the built-ins. */
  plugins?: WispPlugin[];
  /** Called on every event right before it's queued. Return null to drop the event entirely (e.g. to scrub PII). */
  redact?: (event: WispEvent) => WispEvent | null;
  /** Turn on console logging of internal SDK behavior. Default false. */
  debug?: boolean;
}
