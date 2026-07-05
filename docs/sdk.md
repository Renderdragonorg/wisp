# Client SDK

## Installation

```bash
npm install @renderdragonorg/wisp
```

Peer dependency (optional): `@supabase/supabase-js` ^2.110.0 — only needed if you use the Supabase auth binding.

## Initialization

```typescript
import { init } from "@renderdragonorg/wisp";

const client = init({
  convexUrl: "https://happy-animal-123.convex.cloud",
});
```

Call `init()` once at the earliest possible point — your root layout, `main.tsx`, or `app.vue`. It creates a singleton; repeated calls return the existing instance.

### Singleton API

After `init()`, you can use the `wisp` singleton anywhere without holding a reference to the client:

```typescript
import wisp from "@renderdragonorg/wisp";

wisp.track("checkout_completed", { total: 29.99 });
wisp.trackError(new Error("Payment failed"), { paymentMethod: "card" });
```

Methods throw `"Not initialized"` if called before `init()`.

## Configuration

| Option | Default | Description |
|--------|---------|-------------|
| `convexUrl` | — | **Required** (unless `transport` is provided). Convex deployment URL. |
| `transport` | — | Custom transport. Overrides `convexUrl`. |
| `sessionTimeoutMs` | `1800000` (30 min) | Inactivity before a new session starts. |
| `batchIntervalMs` | `5000` (5 s) | How often the queue auto-flushes. |
| `batchMaxSize` | `20` | Max buffered events before forced flush. |
| `autoTrackErrors` | `true` | Track `window.onerror` and `unhandledrejection`. |
| `autoTrackClicks` | `true` | Track clicks on `[data-wisp-id]` elements. |
| `autoTrackPageviews` | `true` | Track SPA pageviews via history.pushState/replaceState. |
| `samplingRate` | `1` | Fraction of machines to track (0–1). Decision is per-machine, cached in localStorage. |
| `plugins` | `[]` | Additional WispPlugin instances. |
| `redact` | — | `(event) => event | null` — mutate or drop events before queuing. |
| `debug` | `false` | Console-log internal SDK behavior. |

```typescript
init({
  convexUrl: "https://happy-animal-123.convex.cloud",
  sessionTimeoutMs: 15 * 60 * 1000, // 15 min
  batchIntervalMs: 2000,             // flush every 2s
  batchMaxSize: 10,                  // or after 10 events
  autoTrackErrors: true,
  autoTrackClicks: true,
  autoTrackPageviews: true,
  samplingRate: 0.5,                 // track 50% of machines
  debug: true,
  redact: (event) => {
    if (event.name === "password_entered") return null;
    return event;
  },
});
```

## Tracking methods

### `track(name, payload?)`

Track a custom event.

```typescript
client.track("signup_completed", { plan: "pro", referral: "twitter" });
// Or via singleton:
wisp.track("signup_completed", { plan: "pro" });
```

Event type is inferred from the name:
- `"pageview"` → type `pageview`
- `"click:*"` → type `interaction`
- everything else → type `custom`

### `trackError(error, context?)`

Track an error. Accepts an `Error` object (captures `message` + `stack`) or a plain string.

```typescript
try {
  riskyOperation();
} catch (err) {
  client.trackError(err, { component: "CheckoutForm" });
}

// Or inline:
client.trackError("Something went wrong manually");
```

The error `message` is stored in `name` (truncated to 200 chars). The `stack` is stored in `payload.stack`.

### `identify(userId)`

Attach a user identity (e.g. after login). Attaches `userId` to all subsequent events from this machine. Does not retroactively update past events.

```typescript
// After Supabase login:
wisp.identify(data.session.user.id);
```

### `reset()`

Clear the user identity (e.g. after logout).

```typescript
wisp.reset();
```

### `getMachineId()`

Returns the stable machine ID.

```typescript
const mid = wisp.getMachineId();
```

### `getSessionId()`

Returns the current session ID.

```typescript
const sid = wisp.getSessionId();
```

### `flush()`

Force-flush the event buffer. Returns a promise that resolves when the transport completes (or fails silently).

```typescript
await wisp.flush();
```

### `destroy()`

Tear down: uninstalls all plugins, clears the flush timer, and emits a final beacon flush. Call when your app unmounts (rarely needed).

```typescript
wisp.destroy();
```

## Automatic tracking

Three plugins are installed by default (configurable via `autoTrackErrors`, `autoTrackClicks`, `autoTrackPageviews`).

### Error plugin

Listens to:
- `window"error"` — captures JS runtime errors with filename, line, column
- `window"unhandledrejection"` — captures unhandled promise rejections

Calls `client.trackError()` with the error and source metadata.

### Click plugin

Uses event delegation. Add `data-wisp-id="button_name"` to any HTML element. Clicks on that element (or its descendants) are tracked automatically. Extra `data-wisp-*` attributes are collected into the payload:

```html
<button data-wisp-id="signup_btn" data-wisp-plan="pro" data-wisp-price="29.99">
  Sign up
</button>
```

This produces: `track("click:signup_btn", { plan: "pro", price: "29.99" })`.

### Pageview plugin

On install, fires a `pageview` event immediately. Then patches `history.pushState` and `history.replaceState` to fire on every SPA navigation. Also listens to `popstate` for browser back/forward.

## Custom transport

Replace the default Convex HTTP transport with your own endpoint:

```typescript
import { init, type WispTransport } from "@renderdragonorg/wisp";

const myTransport: WispTransport = {
  async send(events, opts) {
    await fetch("/api/analytics", {
      method: "POST",
      body: JSON.stringify(events),
      keepalive: opts.beacon,
    });
  },
};

init({ transport: myTransport });
```

## Custom plugin

```typescript
import { init, type WispPlugin, type WispClientInternal } from "@renderdragonorg/wisp";

const scrollPlugin: WispPlugin = {
  name: "scroll_depth",
  install(client: WispClientInternal) {
    window.addEventListener("scroll", () => {
      const depth = Math.round(
        (window.scrollY / (document.documentElement.scrollHeight - window.innerHeight)) * 100
      );
      if (depth >= 25 && depth % 25 === 0) {
        client.track("scroll_depth", { depth });
      }
    }, { passive: true });
  },
};

init({
  convexUrl: "https://happy-animal-123.convex.cloud",
  plugins: [scrollPlugin],
});
```

## Supabase auth binding

```typescript
import { bindSupabase } from "@renderdragonorg/wisp/supabase";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient("https://abc.supabase.co", "public-anon-key");
bindSupabase(supabase);
```

This calls `wisp.identify(user.id)` on sign-in and `wisp.reset()` on sign-out. Returns an unsubscribe function.

## Event queue behavior

The `EventQueue` buffers events in memory and flushes in batches:

- **Timer-based**: every `batchIntervalMs` (default 5s)
- **Size-based**: when buffer reaches `batchMaxSize` (default 20)
- **Pagehide**: on `visibilitychange → hidden` and `pagehide` events, flushes with `beacon: true` (uses `navigator.sendBeacon` if available, falls back to `fetch` with `keepalive`)
- **Destroy**: on `destroy()`, flushes remaining events then tears down

The transport **never throws** — errors are logged (in debug mode) and the batch is dropped. This guarantees your app never crashes because of analytics.
