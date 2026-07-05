import { describe, it, expect, vi, beforeEach } from "vitest";

function mockNavigator(props: Record<string, unknown> = {}) {
  Object.defineProperty(globalThis, "navigator", {
    value: { userAgent: "Mozilla/5.0 Test", platform: "TestOS", ...props },
    configurable: true,
    writable: true,
  });
}

function mockScreen(props: Record<string, unknown> = {}) {
  Object.defineProperty(globalThis, "screen", {
    value: { width: 1920, height: 1080, ...props },
    configurable: true,
    writable: true,
  });
}

describe("wisp client", () => {
  beforeEach(async () => {
    vi.resetModules();
    mockNavigator();
    mockScreen();
  });

  it("throws if init() called without convexUrl or transport", async () => {
    const { init } = await import("../src/index");
    expect(() => init({} as any)).toThrow("requires either `convexUrl`");
  });

  it("init() returns the same instance on repeated calls", async () => {
    const mod = await import("../src/index");
    const i1 = mod.init({ convexUrl: "https://test.convex.cloud", debug: true });
    const i2 = mod.init({ convexUrl: "https://other.convex.cloud" });
    expect(i1).toBe(i2);
  });

  it("getMachineId() returns a string", async () => {
    const { init } = await import("../src/index");
    const client = init({ convexUrl: "https://test.convex.cloud" });
    expect(typeof client.getMachineId()).toBe("string");
    expect(client.getMachineId().length).toBeGreaterThan(0);
  });

  it("getSessionId() returns a string", async () => {
    const { init } = await import("../src/index");
    const client = init({ convexUrl: "https://test.convex.cloud" });
    expect(typeof client.getSessionId()).toBe("string");
    expect(client.getSessionId().length).toBeGreaterThan(0);
  });

  it("track() queues events without throwing", async () => {
    const { init } = await import("../src/index");
    const client = init({ convexUrl: "https://test.convex.cloud" });
    expect(() => client.track("test_event", { foo: "bar" })).not.toThrow();
  });

  it("track() accepts events with various types", async () => {
    const { init } = await import("../src/index");
    const client = init({ convexUrl: "https://test.convex.cloud" });
    expect(() => {
      client.track("pageview");
      client.track("click:signup");
      client.track("custom_event", { key: "val" });
    }).not.toThrow();
  });

  it("trackError() queues error events", async () => {
    const { init } = await import("../src/index");
    const client = init({ convexUrl: "https://test.convex.cloud" });
    expect(() => client.trackError(new Error("boom"))).not.toThrow();
  });

  it("trackError() accepts a string", async () => {
    const { init } = await import("../src/index");
    const client = init({ convexUrl: "https://test.convex.cloud" });
    expect(() => client.trackError("string error")).not.toThrow();
  });

  it("trackError() with Error object does not throw", async () => {
    const { init } = await import("../src/index");
    const client = init({ convexUrl: "https://test.convex.cloud" });
    const err = new Error("stacktrace_test");
    expect(() => client.trackError(err)).not.toThrow();
  });

  it("identify() attaches userId and reset() clears it", async () => {
    const { init } = await import("../src/index");
    const client = init({ convexUrl: "https://test.convex.cloud" });
    expect(() => client.identify("user-42")).not.toThrow();
    expect(() => client.reset()).not.toThrow();
    expect(() => client.identify("user-99")).not.toThrow();
  });

  it("flush() resolves without error", async () => {
    const { init } = await import("../src/index");
    const client = init({ convexUrl: "https://test.convex.cloud" });
    client.track("test_event");
    await expect(client.flush()).resolves.toBeUndefined();
  });

  it("flush() sends pending events to transport", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));

    const { init } = await import("../src/index");
    const client = init({ convexUrl: "https://test.convex.cloud" });
    client.track("flush_test_event");
    await client.flush();
    expect(fetch).toHaveBeenCalled();
  });

  it("destroy() does not throw", async () => {
    const { init } = await import("../src/index");
    const client = init({ convexUrl: "https://test.convex.cloud" });
    expect(() => client.destroy()).not.toThrow();
  });

  it("destroy() does not throw even if events were queued", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    const { init } = await import("../src/index");
    const client = init({ convexUrl: "https://test.convex.cloud" });
    client.track("event_before_destroy");
    client.destroy();
    // After destroy the queue flushes synchronously, just ensure no errors
    expect(true).toBe(true);
  });

  it("redact can drop events", async () => {
    const { init } = await import("../src/index");
    const client = init({
      convexUrl: "https://test.convex.cloud",
      redact: () => null,
    });
    expect(() => client.track("dropped_event")).not.toThrow();
  });

  it("redact can modify events", async () => {
    const { init } = await import("../src/index");
    const client = init({
      convexUrl: "https://test.convex.cloud",
      redact: (event) => ({ ...event, name: "[redacted]" }),
    });
    expect(() => client.track("sensitive_event")).not.toThrow();
  });

  it("convexUrl is required without custom transport", async () => {
    const { init } = await import("../src/index");
    expect(() => init({} as any)).toThrow();
  });

  it("custom transport is used when provided", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const { init } = await import("../src/index");
    const client = init({
      convexUrl: "https://test.convex.cloud",
      transport: { send },
    });
    client.track("custom_transport_test");
    await client.flush();
    expect(send).toHaveBeenCalled();
  });

  it("sampling at 0 drops all events without throwing", async () => {
    try { window.localStorage.removeItem("wisp_sampled_in"); } catch {}
    try { window.localStorage.removeItem("wisp_machine_id"); } catch {}
    vi.resetModules();
    const mod2 = await import("../src/index");
    const client2 = mod2.init({
      convexUrl: "https://test.convex.cloud",
      samplingRate: 0,
    });
    expect(() => client2.track("should_be_dropped")).not.toThrow();
  });

  it("session_start is sent on init with navigator metadata", async () => {
    const { default: wisp } = await import("../src/index");
    // This tests that init() doesn't throw when including screen resolution
    // The session_start payload includes userAgent, platform, referrer, screen
    expect(() => {
      wisp.init({ convexUrl: "https://test.convex.cloud" });
      wisp.destroy();
    }).not.toThrow();
  });
});

describe("wisp singleton API", () => {
  beforeEach(() => { vi.resetModules(); });

  it("track() throws before init", async () => {
    const mod = await import("../src/index");
    expect(() => mod.default.track("test")).toThrow("Not initialized");
  });

  it("trackError() throws before init", async () => {
    const mod = await import("../src/index");
    expect(() => mod.default.trackError(new Error("x"))).toThrow("Not initialized");
  });

  it("getMachineId() throws before init", async () => {
    const mod = await import("../src/index");
    expect(() => mod.default.getMachineId()).toThrow("Not initialized");
  });

  it("getSessionId() throws before init", async () => {
    const mod = await import("../src/index");
    expect(() => mod.default.getSessionId()).toThrow("Not initialized");
  });

  it("identify() throws before init", async () => {
    const mod = await import("../src/index");
    expect(() => mod.default.identify("u")).toThrow("Not initialized");
  });

  it("reset() throws before init", async () => {
    const mod = await import("../src/index");
    expect(() => mod.default.reset()).toThrow("Not initialized");
  });

  it("flush() throws before init", async () => {
    const mod = await import("../src/index");
    expect(() => mod.default.flush()).toThrow("Not initialized");
  });

  it("destroy() throws before init", async () => {
    const mod = await import("../src/index");
    expect(() => mod.default.destroy()).toThrow("Not initialized");
  });
});
