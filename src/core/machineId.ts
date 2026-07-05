const STORAGE_KEY = "wisp_machine_id";
const COOKIE_KEY = "wisp_mid";
const COOKIE_MAX_AGE_DAYS = 400; // Chrome's hard cap on cookie lifetime

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function writeCookie(name: string, value: string): void {
  const maxAge = COOKIE_MAX_AGE_DAYS * 24 * 60 * 60;
  document.cookie = `${name}=${encodeURIComponent(
    value
  )}; path=/; max-age=${maxAge}; SameSite=Lax`;
}

function generateId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for older browsers without crypto.randomUUID
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Resolves a stable machine ID for this browser. Checks localStorage first,
 * falls back to a cookie (survives some storage-clearing scenarios and can be
 * read server-side if you proxy requests), and creates a new one if neither exists.
 * Writes back to both stores so they stay in sync.
 */
export function getOrCreateMachineId(): string {
  if (typeof window === "undefined") {
    // SSR guard — callers should only invoke this client-side, but don't crash the build.
    return "ssr-placeholder";
  }

  let id: string | null = null;

  try {
    id = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // localStorage can throw in private-browsing / storage-restricted contexts
  }

  if (!id) {
    id = readCookie(COOKIE_KEY);
  }

  if (!id) {
    id = generateId();
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // ignore
  }
  writeCookie(COOKIE_KEY, id);

  return id;
}
