# Wisp

Drop-in, self-hosted analytics engine backed by [Convex](https://convex.dev). Tracks sessions, pageviews, interactions, and errors with a single machine/session identity model.

- **Client SDK** (~3 KB gzip) — drops into any web app, SPA or MPA
- **Convex backend** — ingestion, geo-IP, aggregation, dashboard queries
- **Dashboard** — Vite + React app with charts, session explorer, error viewer, page analytics, machine detail view

## Install

```bash
npm install @renderdragonorg/wisp
```

## Quickstart

```typescript
import { init } from "@renderdragonorg/wisp";

init({
  convexUrl: "https://happy-animal-123.convex.cloud",
});
```

The SDK auto-tracks pageviews, clicks (via `data-wisp-id`), errors, and sessions out of the box.

## Supabase auth binding

```typescript
import { bindSupabase } from "@renderdragonorg/wisp/supabase";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient("https://abc.supabase.co", "public-anon-key");
bindSupabase(supabase);
```

## Documentation

| Doc | What it covers |
|-----|----------------|
| [Quickstart](https://github.com/Renderdragonorg/wisp/blob/master/docs/quickstart.md) | Set up Convex, install the SDK, see your first event |
| [Client SDK](https://github.com/Renderdragonorg/wisp/blob/master/docs/sdk.md) | `init()`, `track()`, `trackError()`, plugins, config |
| [Backend](https://github.com/Renderdragonorg/wisp/blob/master/docs/backend.md) | Schema, mutations, queries, HTTP Action, crons |
| [Dashboard](https://github.com/Renderdragonorg/wisp/blob/master/docs/dashboard.md) | Charts, sessions table, error viewer, machine view |
| [Deployment](https://github.com/Renderdragonorg/wisp/blob/master/docs/deployment.md) | Production Convex deploy, building the SDK, dashboard |

## License

ISC
