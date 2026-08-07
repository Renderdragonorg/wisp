import { describe, it, expect, vi, beforeEach } from "vitest";
import { errorPlugin } from "../src/plugins/errors";
import { clickPlugin } from "../src/plugins/clicks";
import { pageviewPlugin } from "../src/plugins/pageviews";
import type { WispClientInternal } from "../src/types";

function createMockClient(): WispClientInternal {
  return {
    track: vi.fn(),
    trackError: vi.fn(),
    getMachineId: () => "mach-1",
    getSessionId: () => "sess-1",
    config: {
      convexUrl: "http://test.convex.cloud",
      sessionTimeoutMs: 1800000,
      batchIntervalMs: 5000,
      batchMaxSize: 20,
      autoTrackErrors: true,
      autoTrackClicks: true,
      autoTrackPageviews: true,
      samplingRate: 1,
      debug: false,
    },
  };
}

describe("errorPlugin", () => {
  it("captures window.onerror", () => {
    const client = createMockClient();
    const plugin = errorPlugin();
    plugin.install(client);

    const event = new ErrorEvent("error", {
      message: "Something broke",
      filename: "app.js",
      lineno: 42,
      colno: 10,
      error: new Error("Something broke"),
    });
    window.dispatchEvent(event);

    expect(client.trackError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ source: "window.onerror" })
    );
  });

  it("captures unhandledrejection", () => {
    const client = createMockClient();
    const plugin = errorPlugin();
    plugin.install(client);

    const event = new PromiseRejectionEvent("unhandledrejection", {
      promise: Promise.resolve(),
      reason: "nope",
    });
    window.dispatchEvent(event);

    expect(client.trackError).toHaveBeenCalled();
  });

  it("removes listeners on uninstall", () => {
    const client = createMockClient();
    const plugin = errorPlugin();
    plugin.install(client);
    plugin.uninstall!();

    window.dispatchEvent(new ErrorEvent("error", { message: "x" }));
    expect(client.trackError).not.toHaveBeenCalled();
  });
});

describe("clickPlugin", () => {
  it("tracks clicks on elements with data-wisp-id", () => {
    const client = createMockClient();
    const plugin = clickPlugin();
    plugin.install(client);

    const btn = document.createElement("button");
    btn.setAttribute("data-wisp-id", "signup_btn");
    btn.setAttribute("data-wisp-plan", "pro");
    document.body.appendChild(btn);
    btn.click();

    expect(client.track).toHaveBeenCalledWith("click:signup_btn", { plan: "pro" });
    document.body.removeChild(btn);
  });

  it("collects extra data-wisp-* attributes into payload", () => {
    const client = createMockClient();
    const plugin = clickPlugin();
    plugin.install(client);

    const btn = document.createElement("button");
    btn.setAttribute("data-wisp-id", "checkout");
    btn.setAttribute("data-wisp-price", "29.99");
    btn.setAttribute("data-wisp-currency", "usd");
    document.body.appendChild(btn);
    btn.click();

    expect(client.track).toHaveBeenCalledWith("click:checkout", {
      price: "29.99",
      currency: "usd",
    });
    document.body.removeChild(btn);
  });

  it("ignores clicks without data-wisp-id", () => {
    const client = createMockClient();
    const plugin = clickPlugin();
    plugin.install(client);

    const btn = document.createElement("button");
    document.body.appendChild(btn);
    btn.click();

    expect(client.track).not.toHaveBeenCalled();
    document.body.removeChild(btn);
  });

  it("removes listener on uninstall", () => {
    const client = createMockClient();
    const plugin = clickPlugin();
    plugin.install(client);
    plugin.uninstall!();

    const btn = document.createElement("button");
    btn.setAttribute("data-wisp-id", "test");
    document.body.appendChild(btn);
    btn.click();

    expect(client.track).not.toHaveBeenCalled();
    document.body.removeChild(btn);
  });
});

describe("pageviewPlugin", () => {
  it("fires pageview on install", () => {
    const client = createMockClient();
    const plugin = pageviewPlugin();
    plugin.install(client);
    expect(client.track).toHaveBeenCalledWith("pageview", expect.any(Object));
  });

  it("fires pageview on history.pushState", () => {
    const client = createMockClient();
    const plugin = pageviewPlugin();
    plugin.install(client);
    (client.track as ReturnType<typeof vi.fn>).mockClear();

    history.pushState({}, "", "/new-page");
    expect(client.track).toHaveBeenCalledWith("pageview", expect.objectContaining({ path: "/new-page" }));
  });

  it("fires pageview on history.replaceState", () => {
    const client = createMockClient();
    const plugin = pageviewPlugin();
    plugin.install(client);
    (client.track as ReturnType<typeof vi.fn>).mockClear();

    history.replaceState({}, "", "/replaced");
    expect(client.track).toHaveBeenCalledWith("pageview", expect.objectContaining({ path: "/replaced" }));
  });

  it("uninstall restores pushState behavior", () => {
    const client = createMockClient();
    const plugin = pageviewPlugin();
    plugin.install(client);
    (client.track as ReturnType<typeof vi.fn>).mockClear();
    plugin.uninstall!();

    history.pushState({}, "", "/after-uninstall");
    expect(client.track).not.toHaveBeenCalled();
  });
});
