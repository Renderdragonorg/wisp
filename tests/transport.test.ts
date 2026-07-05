import { describe, it, expect, vi, beforeEach } from "vitest";
import { ConvexTransport } from "../src/core/transport";
import type { WispEvent } from "../src/types";

const makeEvent = (overrides: Partial<WispEvent> = {}): WispEvent => ({
  type: "custom",
  name: "test_event",
  url: "http://localhost/",
  timestamp: Date.now(),
  sessionId: "sess-1",
  machineId: "mach-1",
  ...overrides,
});

function mockSendBeacon(impl?: () => boolean) {
  const fn = impl ?? (() => true);
  Object.defineProperty(globalThis.navigator, "sendBeacon", {
    value: fn,
    configurable: true,
    writable: true,
  });
  return vi.spyOn(globalThis.navigator, "sendBeacon").mockImplementation(fn);
}

function removeSendBeacon() {
  Object.defineProperty(globalThis.navigator, "sendBeacon", {
    value: undefined,
    configurable: true,
    writable: true,
  });
}

describe("ConvexTransport", () => {
  const convexUrl = "https://test-123.convex.cloud";
  const siteUrl = "https://test-123.convex.site";

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("sends events via fetch to the /ingest endpoint", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    const t = new ConvexTransport(convexUrl);
    await t.send([makeEvent()], {});
    expect(fetchSpy).toHaveBeenCalledWith(
      `${siteUrl}/ingest`,
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      })
    );
    const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string);
    expect(body.events).toHaveLength(1);
    expect(body.path).toBeUndefined();
  });

  it("uses sendBeacon when beacon option is true", async () => {
    const beaconSpy = mockSendBeacon();
    const t = new ConvexTransport(convexUrl);
    await t.send([makeEvent()], { beacon: true });
    expect(beaconSpy).toHaveBeenCalledWith(
      `${siteUrl}/ingest`,
      expect.any(Blob)
    );
  });

  it("falls back to fetch when sendBeacon returns false", async () => {
    const beaconSpy = mockSendBeacon(() => false);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    const t = new ConvexTransport(convexUrl);
    await t.send([makeEvent()], { beacon: true });
    expect(beaconSpy).toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalled();
  });

  it("passes keepalive flag to fetch when beacon is true", async () => {
    mockSendBeacon();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    const t = new ConvexTransport(convexUrl);

    await t.send([makeEvent()], { beacon: true });
    // sendBeacon was used, fetch not called
    expect(fetchSpy).not.toHaveBeenCalled();

    // Now test keepalive with fetch when sendBeacon NOT available
    removeSendBeacon();
    fetchSpy.mockClear();
    await t.send([makeEvent()], { beacon: true });
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ keepalive: true })
    );
  });

  it("does nothing with empty events", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const t = new ConvexTransport(convexUrl);
    await t.send([], {});
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not throw on fetch failure", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("fetch failed"));
    const t = new ConvexTransport(convexUrl);
    await expect(t.send([makeEvent()], {})).resolves.toBeUndefined();
  });

  it("does not throw on sendBeacon failure", async () => {
    const beaconSpy = mockSendBeacon(() => { throw new Error("beacon failed"); });
    const t = new ConvexTransport(convexUrl);
    await expect(t.send([makeEvent()], { beacon: true })).resolves.toBeUndefined();
  });

  it("normalizes trailing slash in URL", () => {
    const t1 = new ConvexTransport("https://test-123.convex.cloud/");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    t1.send([makeEvent()], {});
    expect(fetchSpy).toHaveBeenCalledWith(
      `${siteUrl}/ingest`,
      expect.anything()
    );
  });

  it("handles multiple events in a single request", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    const t = new ConvexTransport(convexUrl);
    await t.send([makeEvent({ name: "a" }), makeEvent({ name: "b" }), makeEvent({ name: "c" })], {});
    const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string);
    expect(body.events).toHaveLength(3);
  });

  it("works when sendBeacon is not available", async () => {
    removeSendBeacon();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    const t = new ConvexTransport(convexUrl);
    await t.send([makeEvent()], { beacon: true });
    expect(fetchSpy).toHaveBeenCalled();
  });
});
