# Testing

## Running tests

```bash
# Full suite (81 unit + 27 integration = 108 tests)
npm test

# Unit tests only (faster, no network)
npx vitest run tests/comprehensive.test.ts tests/index.test.ts tests/transport.test.ts tests/plugins.test.ts tests/queue.test.ts tests/machineId.test.ts tests/session.test.ts tests/supabase.test.ts

# Integration tests (requires Convex dev deployment running)
npx vitest run tests/convex-integration.test.ts

# Watch mode
npm run test:watch

# Specific file
npx vitest run tests/transport.test.ts
```

## Test structure

```
tests/
├── setup.ts                    — jsdom config, stubs
├── convex-integration.test.ts  — 27 tests against live Convex dev deployment
├── index.test.ts               — 22 tests: client init, track, trackError, identify, redact, sampling, custom transport
├── transport.test.ts           — 12 tests: fetch, sendBeacon, fallback, keepalive, URL normalization
├── plugins.test.ts             — 11 tests: error, click, pageview plugins
├── queue.test.ts               — 7 tests: buffering, flushing, destroy, error tolerance
├── machineId.test.ts           — 7 tests: localStorage, cookie, SSR fallback, error recovery
├── session.test.ts             — 9 tests: creation, reuse, timeout, persistence
├── supabase.test.ts            — 4 tests: bindSupabase, auth state change
└── comprehensive.test.ts       — 6 tests: full client lifecycle, Supabase auth integration, data integrity, sampling, transport failure
```

## Comprehensive test (`tests/comprehensive.test.ts`)

A single file that tests the entire client lifecycle end-to-end with a mock transport:

| Test | Coverage |
|------|----------|
| **full lifecycle** | Init → all 4 event types (pageview/interaction/error/custom) → click plugin → error plugin (onerror + unhandledrejection) → pushState/replaceState pageviews → identify/reset cycle → flush → data integrity checks → destroy stops tracking |
| **Supabase end-to-end** | `bindSupabase` with pre-existing session → getSession resolves → userId on subsequent events → SIGNED_IN with new user → SIGNED_OUT clears userId → unsubscribe |
| **Supabase pre-existing user** | `session_start` has no userId (fires before identify resolves) → later events carry it |
| **Supabase no initial session** | No userId before SIGNED_IN → synchronous callback sets userId → late events carry it |
| **Data integrity** | Per-type payload verification, consistent machineId/sessionId cross-event, monotonic timestamps |
| **Sampling + transport failure** | `samplingRate: 0` drops everything; transport `send` rejection doesn't throw |

The test uses a mock `WispTransport` to capture events in memory for inspection, avoiding any network calls. It dynamically imports `bindSupabase` from the Supabase entry point with a mock `SupabaseClient` to verify the auth binding.

## Setup file (`tests/setup.ts`)

The Vitest config uses `jsdom` as the test environment with `globals: true`. The setup file (if present) configures jsdom stubs. No special setup is required beyond that.

## Integration tests

Integration tests run against the **live Convex dev deployment**. They:

- Call `recordBatch` mutations to insert test data
- Call dashboard queries to verify the data is returned correctly
- Test the HTTP Action endpoint (`/ingest`) for status codes and geo header handling
- Verify that `session_start` payloads propagate to the machines table
- Test `searchMachines` and `getMachineStats` end-to-end
- Test page analytics queries: `getTopPages`, `getPageVisitors`, `getPageViewsOverTime`

Each test uses a unique `machineId` and `sessionId` (via `crypto.randomUUID()`) to avoid cross-test pollution.

### Writing integration tests

```typescript
import { describe, it, expect } from "vitest";

const convexUrl = "https://outstanding-snake-923.convex.cloud";

const machineId = crypto.randomUUID();

function makeEvent(overrides = {}) {
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

it("records an event and reads it back", async () => {
  // Insert via mutation
  const insert = await callMutation("events:recordBatch", {
    events: [makeEvent({ name: "my_test" })],
  });
  expect(insert.status).toBe("success");
  expect(insert.value.inserted).toBe(1);

  // Query the session's events
  const result = await callQuery("events:getSessionEvents", {
    sessionId,
  });
  expect(result.value[0].name).toBe("my_test");
});
```

Helper functions are at the top of the test file:

```typescript
async function callMutation(path, args) {
  const res = await fetch(`${convexUrl}/api/mutation`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, args, format: "json" }),
  });
  return JSON.parse(await res.text());
}

async function callQuery(path, args) {
  const res = await fetch(`${convexUrl}/api/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, args, format: "json" }),
  });
  return JSON.parse(await res.text());
}
```

### Adding a new integration test

1. Add the test function to `convex-integration.test.ts`
2. If the test creates data, use unique identifiers (`Date.now()`, `crypto.randomUUID()`)
3. If the test needs a new backend function, add it to `convex/` and run `npx convex dev --once`
4. Write the test and run `npx vitest run tests/convex-integration.test.ts`

## Unit test conventions

- Use `vi.resetModules()` in `beforeEach` when testing module-level singletons
- Mock `fetch` with `vi.spyOn(globalThis, "fetch")` to avoid real network calls
- Use `vi.useFakeTimers()` / `vi.useRealTimers()` for timer-dependent tests (queue)
- For DOM-dependent tests, the jsdom environment provides `window`, `document`, `navigator`, `location`, and `history`
- Customize `navigator` properties with `Object.defineProperty(globalThis.navigator, ...)`

## CI

Example GitHub Actions workflow:

```yaml
name: Test
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: npm test
```

Integration tests require `CONVEX_DEPLOYMENT` and `CONVEX_URL` to be set as environment variables. You can skip them in CI if the Convex dev deployment isn't available:

```bash
npx vitest run --exclude tests/convex-integration.test.ts
```
