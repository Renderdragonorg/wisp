import { describe, it, expect, vi, beforeEach } from "vitest";
import { bindSupabase } from "../src/supabase";
import { init } from "../src/index";

interface MockSupabaseClient {
  auth: {
    getSession: ReturnType<typeof vi.fn>;
    onAuthStateChange: ReturnType<typeof vi.fn>;
  };
}

function createMockSupabase(): MockSupabaseClient {
  return {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      onAuthStateChange: vi.fn().mockReturnValue({
        data: { subscription: { unsubscribe: vi.fn() } },
      }),
    },
  };
}

describe("bindSupabase", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    try { init({ convexUrl: "https://test.convex.cloud" }); } catch {}
  });

  it("returns an unsubscribe function", () => {
    const supabase = createMockSupabase();
    const unsubscribe = bindSupabase(supabase as any);
    expect(typeof unsubscribe).toBe("function");
  });

  it("calls getSession on init", () => {
    const supabase = createMockSupabase();
    bindSupabase(supabase as any);
    expect(supabase.auth.getSession).toHaveBeenCalled();
  });

  it("calls onAuthStateChange on init", () => {
    const supabase = createMockSupabase();
    bindSupabase(supabase as any);
    expect(supabase.auth.onAuthStateChange).toHaveBeenCalled();
  });

  it("calls unsubscribe on returned function", () => {
    const supabase = createMockSupabase();
    const unsubscribe = bindSupabase(supabase as any);
    unsubscribe();
    const { subscription } = supabase.auth.onAuthStateChange.mock.results[0].value.data;
    expect(subscription.unsubscribe).toHaveBeenCalled();
  });
});
