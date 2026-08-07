const STATE_KEY = "wisp_session_state";
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

interface SessionState {
  sessionId: string;
  startedAt: number;
  lastActivityAt: number;
  entryUrl: string;
}

function generateId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function readState(): SessionState | null {
  try {
    const raw = window.localStorage.getItem(STATE_KEY);
    return raw ? (JSON.parse(raw) as SessionState) : null;
  } catch {
    return null;
  }
}

function writeState(state: SessionState): void {
  try {
    window.localStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch {
    // ignore — worst case we start a fresh session next call
  }
}

/**
 * Manages the 30-minute session window on the client. This is intentionally
 * "best effort" — the source of truth for when a session actually *ends* is
 * the Convex cron sweep (closeStaleSessions), because the client can't run
 * code after a tab is closed. This class exists to (a) decide, on each
 * tracked event, whether we're continuing an existing session or starting a
 * new one, and (b) share that session across multiple tabs on the same origin
 * via localStorage, so opening a link in a new tab doesn't fragment a session.
 */
export class SessionManager {
  private timeoutMs: number;
  private state: SessionState;
  private isNew: boolean;

  constructor(timeoutMs: number = DEFAULT_TIMEOUT_MS) {
    this.timeoutMs = timeoutMs;
    const existing = readState();
    const now = Date.now();

    if (existing && now - existing.lastActivityAt < this.timeoutMs) {
      this.state = existing;
      this.isNew = false;
    } else {
      this.state = {
        sessionId: generateId(),
        startedAt: now,
        lastActivityAt: now,
        entryUrl: typeof location !== "undefined" ? location.href : "",
      };
      this.isNew = true;
      writeState(this.state);
    }
  }

  /** Call on every tracked event. Returns whether this call started a brand new session. */
  touch(): { sessionId: string; startedNewSession: boolean } {
    const now = Date.now();
    const expired = now - this.state.lastActivityAt >= this.timeoutMs;

    if (expired) {
      this.state = {
        sessionId: generateId(),
        startedAt: now,
        lastActivityAt: now,
        entryUrl: typeof location !== "undefined" ? location.href : "",
      };
      this.isNew = true;
    } else {
      this.state.lastActivityAt = now;
    }

    writeState(this.state);

    const startedNewSession = this.isNew;
    this.isNew = false; // only report "new" once, on the call that created it
    return { sessionId: this.state.sessionId, startedNewSession };
  }

  getSessionId(): string {
    return this.state.sessionId;
  }

  getEntryUrl(): string {
    return this.state.entryUrl;
  }
}
