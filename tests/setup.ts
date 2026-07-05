import { vi } from "vitest";

Object.defineProperty(globalThis, "crypto", {
  value: {
    randomUUID: () => "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    }),
  },
  writable: true,
});

const localStorageStore = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: vi.fn((key: string) => localStorageStore.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { localStorageStore.set(key, value); }),
    removeItem: vi.fn((key: string) => { localStorageStore.delete(key); }),
    clear: vi.fn(() => localStorageStore.clear()),
    get length() { return localStorageStore.size; },
    key: vi.fn((i: number) => [...localStorageStore.keys()][i] ?? null),
  },
  writable: true,
});

const origDoc = globalThis.document;
let cookieStore = "";
Object.defineProperty(globalThis, "document", {
  value: new Proxy(origDoc, {
    get(target, prop, receiver) {
      if (prop === "cookie") {
        return cookieStore;
      }
      return Reflect.get(target, prop, receiver);
    },
    set(target, prop, value, receiver) {
      if (prop === "cookie") {
        const parts = (value as string).split(";")[0];
        const [key, ...rest] = parts.split("=");
        const val = rest.join("=");
        const entries = cookieStore.split("; ").filter(c => c && !c.startsWith(key + "="));
        if (val) entries.push(`${key}=${val}`);
        cookieStore = entries.join("; ");
        return true;
      }
      return Reflect.set(target, prop, value, receiver);
    },
  }),
  writable: true,
});

beforeEach(() => {
  localStorageStore.clear();
  cookieStore = "";
  vi.restoreAllMocks();
});
