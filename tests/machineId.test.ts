import { describe, it, expect, vi, beforeEach } from "vitest";
import { getOrCreateMachineId } from "../src/core/machineId";

describe("getOrCreateMachineId", () => {
  beforeEach(() => {
    localStorage.clear();
    document.cookie = "";
  });

  it("returns a string ID", () => {
    const id = getOrCreateMachineId();
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });

  it("returns the same ID on subsequent calls (localStorage)", () => {
    const id1 = getOrCreateMachineId();
    const id2 = getOrCreateMachineId();
    expect(id1).toBe(id2);
  });

  it("reads from cookie when localStorage is empty but cookie exists", () => {
    const cookieId = "cookie-uuid-1234";
    document.cookie = `wisp_mid=${cookieId}`;
    const id = getOrCreateMachineId();
    expect(id).toBe(cookieId);
  });

  it("falls back to cookie after localStorage is cleared", () => {
    const id1 = getOrCreateMachineId();
    localStorage.clear();
    const id2 = getOrCreateMachineId();
    expect(id2).toBe(id1);
  });

  it("returns a placeholder in SSR (no window)", () => {
    const win = globalThis.window;
    (globalThis as any).window = undefined;
    const id = getOrCreateMachineId();
    expect(id).toBe("ssr-placeholder");
    (globalThis as any).window = win;
  });

  it("writes the ID to both localStorage and cookie", () => {
    const id = getOrCreateMachineId();
    expect(localStorage.getItem("wisp_machine_id")).toBe(id);
    expect(document.cookie).toContain("wisp_mid=" + encodeURIComponent(id));
  });

  it("recovers from localStorage throwing", () => {
    const getItem = vi.spyOn(localStorage, "getItem").mockImplementation(() => { throw new Error("no access"); });
    const id = getOrCreateMachineId();
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
    getItem.mockRestore();
  });
});
