import { describe, it, expect, vi } from "vitest";

const convexUrl = "https://outstanding-snake-923.convex.cloud";
const siteUrl = "https://outstanding-snake-923.convex.site";
const mutationEndpoint = `${convexUrl}/api/mutation`;
const queryEndpoint = `${convexUrl}/api/query`;

const machineId = crypto.randomUUID();

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: crypto.randomUUID(),
    machineId,
    type: "custom",
    name: "test_integration",
    url: "http://localhost:3000/test",
    timestamp: Date.now(),
    ...overrides,
  };
}

function makeSessionStart(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: crypto.randomUUID(),
    machineId: crypto.randomUUID(),
    type: "custom",
    name: "session_start",
    url: "http://localhost:3000/",
    timestamp: Date.now(),
    payload: {
      userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      platform: "Win32",
      referrer: "https://google.com/",
      screen: "1920x1080",
    },
    ...overrides,
  };
}

async function callMutation(path: string, args: Record<string, unknown>) {
  const res = await fetch(mutationEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, args, format: "json" }),
  });
  return JSON.parse(await res.text());
}

async function callQuery(path: string, args: Record<string, unknown>) {
  const res = await fetch(queryEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, args, format: "json" }),
  });
  return JSON.parse(await res.text());
}

describe("Convex backend integration", () => {
  it("HTTP Action /ingest accepts events and returns 204", async () => {
    const res = await fetch(`${siteUrl}/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events: [makeEvent({ name: "ingest_test" })] }),
    });
    expect(res.status).toBe(204);
  });

  it("HTTP Action /ingest handles CORS preflight", async () => {
    const res = await fetch(`${siteUrl}/ingest`, {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:3000",
        "Access-Control-Request-Method": "POST",
      },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("HTTP Action captures IP and geo from headers or fallback", async () => {
    const customMachineId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    const events = [{
      sessionId,
      machineId: customMachineId,
      type: "custom" as const,
      name: "geo_test",
      url: "http://localhost:3000/",
      timestamp: Date.now(),
    }];

    const res = await fetch(`${siteUrl}/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events }),
    });
    expect(res.status).toBe(204);

    const stats = await callQuery("dashboard:getMachineStats", { machineId: customMachineId });
    expect(stats.status).toBe("success");
    // IP should always be captured (from Cloudflare cf-connecting-ip, x-forwarded-for, or x-real-ip)
    expect(stats.value.machine.ip).toBeTruthy();
    // Geo (country/region/city) is best-effort — may come from Cloudflare headers
    // or the ip-api.com fallback, or be null if neither is available
    expect(
      stats.value.machine.country === null ||
      typeof stats.value.machine.country === "string"
    ).toBe(true);
  });

  it("recordBatch inserts events and returns count", async () => {
    const result = await callMutation("events:recordBatch", {
      events: [makeEvent({ name: "integration_test" })],
    });
    expect(result.status).toBe("success");
    expect(result.value.inserted).toBe(1);
  });

  it("recordBatch with pageview event works", async () => {
    const result = await callMutation("events:recordBatch", {
      events: [makeEvent({ type: "pageview", name: "pageview" })],
    });
    expect(result.status).toBe("success");
    expect(result.value.inserted).toBe(1);
  });

  it("recordBatch with error event works", async () => {
    const result = await callMutation("events:recordBatch", {
      events: [makeEvent({ type: "error", name: "TestError" })],
    });
    expect(result.status).toBe("success");
    expect(result.value.inserted).toBe(1);
  });

  it("recordBatch with interaction event works", async () => {
    const result = await callMutation("events:recordBatch", {
      events: [makeEvent({ type: "interaction", name: "click:test_button" })],
    });
    expect(result.status).toBe("success");
    expect(result.value.inserted).toBe(1);
  });

  it("session_start metadata propagates to machines table", async () => {
    const ev = makeSessionStart();
    const result = await callMutation("events:recordBatch", {
      events: [ev],
    });
    expect(result.status).toBe("success");

    const stats = await callQuery("dashboard:getMachineStats", { machineId: ev.machineId });
    expect(stats.status).toBe("success");
    expect(stats.value.machine.userAgent).toContain("Chrome/120");
    expect(stats.value.machine.platform).toBe("Win32");
    expect(stats.value.machine.referrer).toBe("https://google.com/");
    expect(stats.value.machine.screen).toBe("1920x1080");
  });

  it("getSessionEvents returns events for a session", async () => {
    const sessionId = crypto.randomUUID();
    const insert = await callMutation("events:recordBatch", {
      events: [
        makeEvent({ sessionId, name: "session_start" }),
        makeEvent({ sessionId, name: "pageview", type: "pageview" }),
      ],
    });
    expect(insert.status).toBe("success");

    const result = await callQuery("events:getSessionEvents", { sessionId });
    expect(result.status).toBe("success");
    expect(Array.isArray(result.value)).toBe(true);
    expect(result.value.length).toBeGreaterThanOrEqual(1);
    expect(result.value[0].sessionId).toBe(sessionId);
  });

  it("getTopErrors returns error counts", async () => {
    const since = Date.now() - 86400000;
    const errName = `err_${Date.now()}`;
    const insert = await callMutation("events:recordBatch", {
      events: [makeEvent({ type: "error", name: errName })],
    });
    expect(insert.status).toBe("success");

    const result = await callQuery("events:getTopErrors", { since });
    expect(result.status).toBe("success");
    expect(Array.isArray(result.value)).toBe(true);
  });

  describe("dashboard queries", () => {
    it("listSessions returns paginated sessions", async () => {
      const result = await callQuery("dashboard:listSessions", {
        paginationOpts: { numItems: 10, cursor: null },
        sortBy: "startedAt",
        sortDir: "desc",
      });
      expect(result.status).toBe("success");
      expect(Array.isArray(result.value.page)).toBe(true);
      expect(typeof result.value.continueCursor).toBe("string");
      expect(typeof result.value.isDone).toBe("boolean");
    });

    it("listSessions supports search filter", async () => {
      const sessionId = crypto.randomUUID();
      await callMutation("events:recordBatch", {
        events: [makeEvent({ sessionId, url: "http://localhost:3000/checkout" })],
      });

      const result = await callQuery("dashboard:listSessions", {
        paginationOpts: { numItems: 10, cursor: null },
        search: "checkout",
      });
      expect(result.status).toBe("success");
      expect(Array.isArray(result.value.page)).toBe(true);
    });

    it("listEvents returns paginated events", async () => {
      const result = await callQuery("dashboard:listEvents", {
        paginationOpts: { numItems: 10, cursor: null },
      });
      expect(result.status).toBe("success");
      expect(Array.isArray(result.value.page)).toBe(true);
    });

    it("listEvents filters by type", async () => {
      const result = await callQuery("dashboard:listEvents", {
        paginationOpts: { numItems: 10, cursor: null },
        type: "error",
      });
      expect(result.status).toBe("success");
      expect(Array.isArray(result.value.page)).toBe(true);
    });

    it("getOverview returns aggregated stats", async () => {
      const today = new Date().toISOString().slice(0, 10);
      const result = await callQuery("dashboard:getOverview", {
        startDate: "2020-01-01",
        endDate: today,
      });
      expect(result.status).toBe("success");
      expect(result.value).toHaveProperty("totals");
      expect(result.value).toHaveProperty("avgSessionDurationMs");
      expect(result.value).toHaveProperty("series");
      expect(Array.isArray(result.value.series)).toBe(true);
    });

    it("getErrorBreakdown returns top errors", async () => {
      const since = Date.now() - 86400000;
      const result = await callQuery("dashboard:getErrorBreakdown", { since });
      expect(result.status).toBe("success");
      expect(Array.isArray(result.value)).toBe(true);
    });

    it("getErrorDetails returns error events for a given error name", async () => {
      const errName = `err_details_${Date.now()}`;
      await callMutation("events:recordBatch", {
        events: [makeEvent({ type: "error", name: errName, payload: { stack: "Error: test", source: "unittest" } })],
      });

      const result = await callQuery("dashboard:getErrorDetails", {
        errorName: errName,
        since: Date.now() - 86400000,
        limit: 10,
      });
      expect(result.status).toBe("success");
      expect(Array.isArray(result.value)).toBe(true);
      expect(result.value.length).toBeGreaterThanOrEqual(1);
      expect(result.value[0]).toMatchObject({
        name: errName,
        payload: { stack: "Error: test", source: "unittest" },
        sessionId: expect.any(String),
        machineId: expect.any(String),
        url: expect.any(String),
        timestamp: expect.any(Number),
      });
    });

    it("recomputeStats action runs successfully", async () => {
      const res = await fetch("https://outstanding-snake-923.convex.cloud/api/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: "dashboard:recomputeStats", args: {}, format: "json" }),
      });
      const result = await res.json();
      expect(result.status).toBe("success");
      expect(result.value.done).toBe(true);
    });

    it("searchMachines returns matching machines by prefix", async () => {
      const customMachineId = `searchtest_${Date.now()}_${crypto.randomUUID().slice(0, 6)}`;
      await callMutation("events:recordBatch", {
        events: [makeEvent({ machineId: customMachineId })],
      });

      const result = await callQuery("dashboard:searchMachines", { prefix: customMachineId.slice(0, 20) });
      expect(result.status).toBe("success");
      expect(Array.isArray(result.value)).toBe(true);
      expect(result.value.length).toBeGreaterThanOrEqual(1);
      const found = result.value.find((m: { id: string }) => m.id === customMachineId);
      expect(found).toBeDefined();
      expect(found).toHaveProperty("label");
      expect(found).toHaveProperty("lastSeenAt");
    });

    it("searchMachines returns empty for no match", async () => {
      const result = await callQuery("dashboard:searchMachines", { prefix: "zzzzz_nonexistent_xyz" });
      expect(result.status).toBe("success");
      expect(result.value).toEqual([]);
    });

    it("searchMachines returns empty for empty prefix", async () => {
      const result = await callQuery("dashboard:searchMachines", { prefix: "" });
      expect(result.status).toBe("success");
      expect(result.value).toEqual([]);
    });

    it("getMachineStats returns structured data for known machine", async () => {
      const customMachineId = `machstats_${Date.now()}`;
      await callMutation("events:recordBatch", {
        events: [
          makeEvent({ machineId: customMachineId, name: "session_start", payload: { platform: "macOS" } }),
          makeEvent({ machineId: customMachineId, type: "pageview", name: "pageview" }),
          makeEvent({ machineId: customMachineId, type: "error", name: "StatsError" }),
        ],
      });

      const result = await callQuery("dashboard:getMachineStats", { machineId: customMachineId });
      expect(result.status).toBe("success");
      expect(result.value).not.toBeNull();

      expect(result.value.machine.id).toBe(customMachineId);
      expect(result.value.machine.firstSeenAt).toBeGreaterThan(0);
      expect(result.value.machine.lastSeenAt).toBeGreaterThan(0);
      expect(result.value.machine.visitCount).toBeGreaterThanOrEqual(1);

      expect(result.value.stats.totalSessions).toBeGreaterThanOrEqual(1);
      expect(result.value.stats.totalEvents).toBeGreaterThanOrEqual(3);
      expect(result.value.stats.totalErrors).toBeGreaterThanOrEqual(1);
      expect(typeof result.value.stats.returningRate).toBe("number");
      expect(typeof result.value.stats.avgSessionDurationMs).toBe("number");

      expect(Array.isArray(result.value.topErrors)).toBe(true);
      expect(Array.isArray(result.value.topPages)).toBe(true);

      expect(result.value.lastSession).toHaveProperty("id");
      expect(result.value.lastSession).toHaveProperty("startedAt");
      expect(result.value.lastSession).toHaveProperty("entryUrl");
    });

    it("getMachineStats returns null for unknown machine", async () => {
      const result = await callQuery("dashboard:getMachineStats", { machineId: "nonexistent_machine_id_xyz" });
      expect(result.status).toBe("success");
      expect(result.value).toBeNull();
    });

    it("getTopPages returns most viewed pages", async () => {
      const pageMachineId = `pg_${crypto.randomUUID().slice(0, 8)}`;
      await callMutation("events:recordBatch", {
        events: [
          makeEvent({ machineId: pageMachineId, type: "pageview", name: "pageview", url: "http://localhost:3000/landing" }),
          makeEvent({ machineId: pageMachineId, type: "pageview", name: "pageview", url: "http://localhost:3000/landing" }),
          makeEvent({ machineId: pageMachineId, type: "pageview", name: "pageview", url: "http://localhost:3000/pricing" }),
        ],
      });

      const today = new Date().toISOString().slice(0, 10);
      const result = await callQuery("dashboard:getTopPages", {
        startDate: "2020-01-01",
        endDate: today,
        limit: 10,
      });
      expect(result.status).toBe("success");
      expect(Array.isArray(result.value)).toBe(true);
      const landing = result.value.find((p: { url: string }) => p.url === "http://localhost:3000/landing");
      expect(landing).toBeDefined();
      expect(landing.viewCount).toBeGreaterThanOrEqual(2);
      expect(landing.uniqueMachines).toBeGreaterThanOrEqual(1);
    });

    it("getPageVisitors returns machines that visited a page", async () => {
      const visitorMachineId = `vis_${crypto.randomUUID().slice(0, 8)}`;
      await callMutation("events:recordBatch", {
        events: [
          makeEvent({ machineId: visitorMachineId, type: "pageview", name: "pageview", url: "http://localhost:3000/visitor-test" }),
          makeEvent({ machineId: visitorMachineId, type: "pageview", name: "pageview", url: "http://localhost:3000/visitor-test" }),
        ],
      });

      const today = new Date().toISOString().slice(0, 10);
      const result = await callQuery("dashboard:getPageVisitors", {
        url: "http://localhost:3000/visitor-test",
        startDate: "2020-01-01",
        endDate: today,
      });
      expect(result.status).toBe("success");
      expect(Array.isArray(result.value)).toBe(true);
      expect(result.value.length).toBeGreaterThanOrEqual(1);
      const found = result.value.find((v: { machineId: string }) => v.machineId === visitorMachineId);
      expect(found).toBeDefined();
      expect(found.visitCount).toBeGreaterThanOrEqual(2);
      expect(found).toHaveProperty("firstVisitedAt");
      expect(found).toHaveProperty("lastVisitedAt");
    });

    it("getPageViewsOverTime returns daily time series", async () => {
      const today = new Date().toISOString().slice(0, 10);
      const result = await callQuery("dashboard:getPageViewsOverTime", {
        startDate: "2020-01-01",
        endDate: today,
      });
      expect(result.status).toBe("success");
      expect(Array.isArray(result.value)).toBe(true);
      if (result.value.length > 0) {
        expect(result.value[0]).toHaveProperty("date");
        expect(result.value[0]).toHaveProperty("pageViews");
        expect(result.value[0]).toHaveProperty("uniqueMachines");
      }
    });

    it("getOverview includes totalPageViews", async () => {
      const today = new Date().toISOString().slice(0, 10);
      const result = await callQuery("dashboard:getOverview", {
        startDate: "2020-01-01",
        endDate: today,
      });
      expect(result.status).toBe("success");
      expect(result.value.totals).toHaveProperty("totalPageViews");
      expect(typeof result.value.totals.totalPageViews).toBe("number");
    });
  });
});
