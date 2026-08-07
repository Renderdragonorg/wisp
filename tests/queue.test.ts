import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventQueue } from "../src/core/queue";
import type { WispEvent, WispTransport } from "../src/types";

const makeEvent = (overrides: Partial<WispEvent> = {}): WispEvent => ({
  type: "custom",
  name: "test_event",
  url: "http://localhost/",
  timestamp: Date.now(),
  sessionId: "sess-1",
  machineId: "mach-1",
  ...overrides,
});

describe("EventQueue", () => {
  let transport: WispTransport;

  beforeEach(() => {
    transport = { send: vi.fn().mockResolvedValue(undefined) };
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("buffers events and flushes on interval", () => {
    const q = new EventQueue({ intervalMs: 100, maxSize: 100, transport });
    q.push(makeEvent());
    expect(transport.send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(transport.send).toHaveBeenCalledTimes(1);
    q.destroy();
  });

  it("flushes when buffer exceeds maxSize", () => {
    const q = new EventQueue({ intervalMs: 5000, maxSize: 3, transport });
    q.push(makeEvent());
    q.push(makeEvent());
    expect(transport.send).not.toHaveBeenCalled();
    q.push(makeEvent());
    expect(transport.send).toHaveBeenCalledTimes(1);
    q.destroy();
  });

  it("does not flush an empty buffer", () => {
    const q = new EventQueue({ intervalMs: 100, maxSize: 100, transport });
    vi.advanceTimersByTime(100);
    expect(transport.send).not.toHaveBeenCalled();
    q.destroy();
  });

  it("drops events after destroy", () => {
    const q = new EventQueue({ intervalMs: 100, maxSize: 100, transport });
    q.destroy();
    q.push(makeEvent());
    vi.advanceTimersByTime(100);
    expect(transport.send).not.toHaveBeenCalled();
  });

  it("flushes on destroy", () => {
    const q = new EventQueue({ intervalMs: 5000, maxSize: 100, transport });
    q.push(makeEvent());
    q.destroy();
    expect(transport.send).toHaveBeenCalledTimes(1);
  });

  it("does not throw on transport error", () => {
    (transport.send as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("network failure"));
    const q = new EventQueue({ intervalMs: 100, maxSize: 1, transport });
    q.push(makeEvent());
    // Should not throw
    vi.advanceTimersByTime(100);
    expect(transport.send).toHaveBeenCalled();
    q.destroy();
  });
});
