import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WispEvent, WispTransport } from "../src/types";

interface MockSupabaseClient {
  auth: {
    getSession: ReturnType<typeof vi.fn>;
    onAuthStateChange: ReturnType<typeof vi.fn>;
  };
}

function createMockSupabase(initialUser?: { id: string }): MockSupabaseClient {
  const session = initialUser
    ? { data: { session: { user: { id: initialUser.id } } }, error: null }
    : { data: { session: null }, error: null };
  return {
    auth: {
      getSession: vi.fn().mockResolvedValue(session),
      onAuthStateChange: vi.fn().mockReturnValue({
        data: { subscription: { unsubscribe: vi.fn() } },
      }),
    },
  };
}

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

const convexUrl = "https://test.convex.cloud";

describe("comprehensive wisp lifecycle", () => {
  let capturedEvents: WispEvent[];

  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.resetModules();
    mockNavigator();
    mockScreen();
    capturedEvents = [];
  });

  it("tests the full lifecycle: init, pageviews, clicks, errors, identify, flush, destroy", async () => {
    const { init } = await import("../src/index");
    const mockTransport: WispTransport = {
      send: vi.fn().mockImplementation((events: WispEvent[]) => {
        capturedEvents.push(...events);
        return Promise.resolve();
      }),
    };

    const client = init({
      convexUrl,
      transport: mockTransport,
      autoTrackErrors: true,
      autoTrackClicks: true,
      autoTrackPageviews: true,
      samplingRate: 1,
    });

    expect(client).toBeDefined();
    expect(client.getMachineId()).toBeTruthy();
    expect(client.getSessionId()).toBeTruthy();
    const machineId = client.getMachineId();
    expect(capturedEvents.length).toBe(0);

    // Track all event types
    client.track("custom_event", { key: "value" });
    client.track("pageview", { path: "/home" });
    client.track("click:signup", { plan: "pro" });
    client.trackError(new Error("test error"));
    client.trackError("string error");

    // Pageview plugin: pushState navigation
    history.pushState({}, "", "/pushed-page");
    history.replaceState({}, "", "/replaced-page");

    // Click plugin
    const btn = document.createElement("button");
    btn.setAttribute("data-wisp-id", "checkout_btn");
    btn.setAttribute("data-wisp-price", "29.99");
    document.body.appendChild(btn);
    btn.click();
    document.body.removeChild(btn);

    // Error plugin
    window.dispatchEvent(new ErrorEvent("error", {
      message: "runtime error", filename: "bundle.js", lineno: 10, colno: 5,
      error: new Error("runtime error"),
    }));
    window.dispatchEvent(new PromiseRejectionEvent("unhandledrejection", {
      promise: Promise.resolve(), reason: "async failure",
    }));

    // Identify + Reset cycle
    client.identify("user-abc-123");
    client.track("identified_event", { role: "admin" });
    client.reset();
    client.track("anonymous_event");
    client.identify("user-xyz-789");
    client.track("reidentified_event");

    await client.flush();

    expect(capturedEvents.length).toBeGreaterThanOrEqual(14);
    expect(mockTransport.send).toHaveBeenCalled();

    // Verify event types present
    const types = capturedEvents.map(e => e.type);
    expect(types).toContain("pageview");
    expect(types).toContain("interaction");
    expect(types).toContain("error");
    expect(types).toContain("custom");

    // All events have consistent identity
    for (const event of capturedEvents) {
      expect(event.machineId).toBe(machineId);
      expect(event.sessionId).toBeTruthy();
      expect(event.timestamp).toBeGreaterThan(0);
      expect(event.url).toBeTruthy();
    }

    // Event type counts
    expect(capturedEvents.filter(e => e.type === "pageview").length).toBeGreaterThanOrEqual(4);
    expect(capturedEvents.filter(e => e.type === "error").length).toBeGreaterThanOrEqual(4);
    expect(capturedEvents.filter(e => e.type === "interaction").length).toBeGreaterThanOrEqual(2);

    // Identity tracking
    expect(capturedEvents.filter(e => e.userId === "user-abc-123").length).toBeGreaterThanOrEqual(1);
    expect(capturedEvents.filter(e => e.userId === "user-xyz-789").length).toBeGreaterThanOrEqual(1);
    expect(capturedEvents.find(e => e.name === "anonymous_event")!.userId).toBeUndefined();

    // Error payloads
    expect(capturedEvents.find(e => e.name === "test error")!.payload).toHaveProperty("stack");

    // pushState URL tracked
    expect(capturedEvents.find(e => e.url?.includes("/pushed-page"))).toBeDefined();

    // Click plugin data
    const checkoutClick = capturedEvents.find(e => e.name === "click:checkout_btn");
    expect(checkoutClick).toBeDefined();
    expect(checkoutClick!.payload).toMatchObject({ price: "29.99" });

    // Destroy stops tracking
    const countBeforeDestroy = capturedEvents.length;
    client.destroy();
    client.track("post_destroy_event");
    expect(capturedEvents.length).toBe(countBeforeDestroy);
  });

  it("tests supabase auth integration end-to-end", async () => {
    const { bindSupabase } = await import("../src/supabase");
    const { init } = await import("../src/index");
    const mockTransport: WispTransport = {
      send: vi.fn().mockImplementation((events: WispEvent[]) => {
        capturedEvents.push(...events);
        return Promise.resolve();
      }),
    };

    const client = init({ convexUrl, transport: mockTransport, samplingRate: 1 });

    // Create mock Supabase with a pre-existing signed-in user
    const supabase = createMockSupabase({ id: "supabase-user-42" });
    const unsubscribe = bindSupabase(supabase as any);

    expect(supabase.auth.getSession).toHaveBeenCalledTimes(1);
    expect(supabase.auth.onAuthStateChange).toHaveBeenCalledTimes(1);

    // Yield to allow getSession().then(identify) microtask to fire
    await new Promise(r => setTimeout(r, 10));

    // Track a pageview — should carry the Supabase userId
    client.track("pageview", { path: "/dashboard" });
    await client.flush();

    const pageview = capturedEvents.find(e => e.userId === "supabase-user-42");
    expect(pageview).toBeDefined();

    // Simulate SIGNED_IN event with a new user
    const signInCallback = supabase.auth.onAuthStateChange.mock.calls[0][0];
    signInCallback("SIGNED_IN", { user: { id: "new-user-99" } });

    client.track("post_signin_event");
    await client.flush();
    expect(capturedEvents.filter(e => e.userId === "new-user-99").length).toBeGreaterThanOrEqual(1);

    // Simulate SIGNED_OUT
    signInCallback("SIGNED_OUT", null);
    client.track("post_signout_event");
    await client.flush();

    const signOutEvents = capturedEvents.filter(e => e.name === "post_signout_event");
    expect(signOutEvents.length).toBeGreaterThanOrEqual(1);
    expect(signOutEvents[0].userId).toBeUndefined();

    // Unsubscribe
    expect(typeof unsubscribe).toBe("function");
    unsubscribe();
    const { subscription } = supabase.auth.onAuthStateChange.mock.results[0].value.data;
    expect(subscription.unsubscribe).toHaveBeenCalled();

    client.destroy();
  });

  it("tests supabase identifies pre-existing user before subsequent events", async () => {
    const { bindSupabase } = await import("../src/supabase");
    const { init } = await import("../src/index");

    // Navigate to a distinct URL to identify our pageview
    window.history.pushState({}, "", "/preexisting-test");
    const mockTransport: WispTransport = {
      send: vi.fn().mockImplementation((events: WispEvent[]) => {
        capturedEvents.push(...events);
        return Promise.resolve();
      }),
    };

    const client = init({ convexUrl, transport: mockTransport, samplingRate: 1 });
    const supabase = createMockSupabase({ id: "pre-existing-user" });
    bindSupabase(supabase as any);

    // Yield to getSession microtask
    await new Promise(r => setTimeout(r, 10));

    // Now track — should have userId from resolved getSession
    client.track("pageview", { path: "/preexisting-test" });
    await client.flush();

    const pageview = capturedEvents.find(
      e => e.type === "pageview" && e.userId === "pre-existing-user"
    );
    expect(pageview).toBeDefined();

    // session_start from init has no userId (fired before identify)
    const sessionStart = capturedEvents.find(e => e.name === "session_start");
    expect(sessionStart!.userId).toBeUndefined();

    client.destroy();
  });

  it("tests supabase with no initial session — identify only after sign-in", async () => {
    const { bindSupabase } = await import("../src/supabase");
    const { init } = await import("../src/index");
    const mockTransport: WispTransport = {
      send: vi.fn().mockImplementation((events: WispEvent[]) => {
        capturedEvents.push(...events);
        return Promise.resolve();
      }),
    };

    const client = init({ convexUrl, transport: mockTransport, samplingRate: 1 });

    // No initial user
    const supabase = createMockSupabase();
    bindSupabase(supabase as any);

    // Yield to getSession microtask (resolves with null, no identify)
    await new Promise(r => setTimeout(r, 10));

    // Events before SIGNED_IN have no userId
    client.track("pre_signin_event");
    await client.flush();
    expect(capturedEvents.filter(e => e.userId != null).length).toBe(0);

    // Simulate SIGNED_IN — this callback is synchronous
    const signInCallback = supabase.auth.onAuthStateChange.mock.calls[0][0];
    signInCallback("SIGNED_IN", { user: { id: "late-user" } });

    client.track("late_signin_event");
    await client.flush();
    const lateEvents = capturedEvents.filter(e => e.userId === "late-user");
    expect(lateEvents.length).toBeGreaterThanOrEqual(1);

    client.destroy();
  });

  it("tracks all event types with full data integrity through the queue", async () => {
    window.history.pushState({}, "", "/full-test-page");
    const { init } = await import("../src/index");
    const mockTransport: WispTransport = {
      send: vi.fn().mockImplementation((events: WispEvent[]) => {
        capturedEvents.push(...events);
        return Promise.resolve();
      }),
    };

    const client = init({
      convexUrl,
      transport: mockTransport,
      batchMaxSize: 100,
      batchIntervalMs: 50000,
      samplingRate: 1,
    });

    // Track one of each event type
    client.track("pageview", { path: "/full-test-page" });
    client.track("click:subscribe", { tier: "premium" });
    client.track("custom_metric", { value: 42 });
    client.trackError(new TypeError("type error"));
    client.identify("user-full-test");
    client.track("post_identify_event");

    await client.flush();

    // Find pageview by payload path
    const pageview = capturedEvents.find(
      e => e.type === "pageview" && e.payload?.path === "/full-test-page"
    );
    expect(pageview).toBeDefined();
    expect(pageview!.type).toBe("pageview");
    expect(pageview!.payload).toMatchObject({ path: "/full-test-page" });

    const click = capturedEvents.find(e => e.name === "click:subscribe");
    expect(click!.type).toBe("interaction");
    expect(click!.payload).toEqual({ tier: "premium" });

    const custom = capturedEvents.find(e => e.name === "custom_metric");
    expect(custom!.type).toBe("custom");
    expect(custom!.payload).toEqual({ value: 42 });

    const error = capturedEvents.find(e => e.name === "type error");
    expect(error!.type).toBe("error");
    expect(error!.payload).toHaveProperty("stack");

    const identified = capturedEvents.find(e => e.name === "post_identify_event");
    expect(identified!.userId).toBe("user-full-test");

    // Consistent identity
    const machineIds = [...new Set(capturedEvents.map(e => e.machineId))];
    expect(machineIds.length).toBe(1);

    const sessionIds = [...new Set(capturedEvents.map(e => e.sessionId))];
    expect(sessionIds.length).toBe(1);

    // Monotonic timestamps
    const timestamps = capturedEvents.map(e => e.timestamp);
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i - 1]);
    }

    client.destroy();
  });

  it("handles sampling disabled and transport failure gracefully", async () => {
    const { init } = await import("../src/index");
    const mockTransport: WispTransport = {
      send: vi.fn(),
    };

    const client = init({ convexUrl, transport: mockTransport, samplingRate: 0 });

    client.track("should_be_dropped");
    client.trackError(new Error("dropped_error"));
    await client.flush();

    expect(capturedEvents.length).toBe(0);
    expect(mockTransport.send).not.toHaveBeenCalled();
    client.destroy();

    // Separate: test transport failure
    vi.resetModules();
    const mod2 = await import("../src/index");
    const failingTransport: WispTransport = {
      send: vi.fn().mockRejectedValue(new Error("network failure")),
    };
    const client2 = mod2.init({ convexUrl, transport: failingTransport, samplingRate: 1 });

    expect(() => client2.track("event_with_failing_transport")).not.toThrow();
    await client2.flush();
    expect(failingTransport.send).toHaveBeenCalled();
    client2.destroy();
  });
});
