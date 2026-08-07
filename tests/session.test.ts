import { describe, it, expect, vi, beforeEach } from "vitest";
import { SessionManager } from "../src/core/session";

describe("SessionManager", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("creates a session with a sessionId", () => {
    const sm = new SessionManager(30_000);
    expect(sm.getSessionId()).toBeTruthy();
    expect(typeof sm.getSessionId()).toBe("string");
  });

  it("reuses an existing valid session", () => {
    const sm1 = new SessionManager(30_000);
    const id1 = sm1.getSessionId();
    const sm2 = new SessionManager(30_000);
    expect(sm2.getSessionId()).toBe(id1);
  });

  it("creates a new session when timeout expires", () => {
    vi.useFakeTimers();
    const sm1 = new SessionManager(50);
    const id1 = sm1.getSessionId();
    vi.advanceTimersByTime(100);
    const sm2 = new SessionManager(50);
    expect(sm2.getSessionId()).not.toBe(id1);
    vi.useRealTimers();
  });

  it("touch() returns startedNewSession=true on first call after construction", () => {
    const sm = new SessionManager(30_000);
    const { startedNewSession } = sm.touch();
    expect(startedNewSession).toBe(true);
  });

  it("touch() returns startedNewSession=false on subsequent calls", () => {
    const sm = new SessionManager(30_000);
    sm.touch();
    const { startedNewSession } = sm.touch();
    expect(startedNewSession).toBe(false);
  });

  it("touch() updates lastActivityAt", () => {
    const sm = new SessionManager(30_000);
    const id1 = sm.getSessionId();
    const { sessionId } = sm.touch();
    expect(sessionId).toBe(id1);
  });

  it("touch() starts a new session after timeout", () => {
    vi.useFakeTimers();
    const sm = new SessionManager(50);
    const id1 = sm.getSessionId();
    vi.advanceTimersByTime(100);
    const { sessionId, startedNewSession } = sm.touch();
    expect(sessionId).not.toBe(id1);
    expect(startedNewSession).toBe(true);
    vi.useRealTimers();
  });

  it("getEntryUrl() returns location.href", () => {
    const sm = new SessionManager(30_000);
    expect(sm.getEntryUrl()).toBe("http://localhost:3000/");
  });

  it("persists session state across instances via localStorage", () => {
    const sm1 = new SessionManager(30_000);
    const id1 = sm1.getSessionId();
    const sm2 = new SessionManager(30_000);
    expect(sm2.getSessionId()).toBe(id1);
  });
});
