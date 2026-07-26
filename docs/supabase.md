# Supabase Integration

Wisp comes with optional Supabase integration that:

1. **Wires auth state** — automatically calls `wisp.identify()` on sign-in and
   `wisp.reset()` on sign-out so analytics events are associated with the
   authenticated user.
2. **Enriches user profiles** — extracts the user's email, name, and auth
   provider (e.g. `github`, `google`, `email`) from the Supabase session and
   sends them along so the dashboard can display who the user is.

---

## Quick start

```ts
import { createClient } from "@supabase/supabase-js";
import { bindSupabase } from "@renderdragonorg/wisp/supabase";
import { init } from "@renderdragonorg/wisp";

// Initialize Wisp first
init({ convexUrl: "https://your-project.convex.cloud" });

// Then bind Supabase — must be called after both are initialized
const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

const unsubscribe = bindSupabase(supabase);

// Later, if you need to stop listening:
unsubscribe();
```

That's it. On every `SIGNED_IN` event, Wisp will automatically:

- Attach the user's Supabase `id` as the Wisp `userId`
- Send the user's email, name (`user_metadata.full_name`), and auth provider
  (`app_metadata.provider`) as enriched profile data

The dashboard's **Machine View** will then display the user's email, name,
and auth provider alongside the device and session data.

---

## Package setup

`@supabase/supabase-js` is declared as an **optional peer dependency** of
the Wisp SDK. You only need to install it if you plan to use the Supabase
binding:

```bash
npm install @supabase/supabase-js
```

The `bindSupabase` function is exported from the subpath
`@renderdragonorg/wisp/supabase`.

---

## Manual identify (without Supabase)

If you're using a different auth provider, you can still pass user metadata
by calling `wisp.identify()` directly:

```ts
import { wisp } from "@renderdragonorg/wisp";

wisp.identify("user-abc-123", {
  email: "alice@example.com",
  name: "Alice Smith",
  provider: "google",
});
```

The metadata is forwarded to Convex and stored on the machine record,
making it visible in the dashboard.

To clear the identity on logout:

```ts
wisp.reset();
```

---

## Data flow

```
Supabase auth state change
        │
        ▼
bindSupabase() extracts
  • user.id
  • user.email
  • user.user_metadata.full_name
  • user.app_metadata.provider
        │
        ▼
wisp.identify(userId, userInfo)
        │
        ▼
Wisp queues a "session_identify" event
with { email, name, provider, userId }
        │
        ▼
Convex HTTP Action /ingest
        │
        ▼
recordBatchWithGeo()
        │
        ▼
upsertMachine() stores
userEmail, userName, authProvider
on the machines table
        │
        ▼
Dashboard queries expose
the enriched user fields
```

---

## Dashboard display

User profile data appears in:

- **Machine View** — shows Email, Name, Auth Provider, and User ID in a
  dedicated "User" section
- **Page Visitors** — shows user email/name in the User column
- **Machine Search** — shows email and name alongside platform and country
- **Sessions Table** — shows the user ID in a User column

---

## Schema

The `machines` table gains three optional fields:

| Field          | Type   | Source                     |
|----------------|--------|----------------------------|
| `userEmail`    | string | `session.user.email`       |
| `userName`     | string | `user_metadata.full_name`  |
| `authProvider` | string | `app_metadata.provider`    |

These are set when a `session_identify` event is processed, and are
preserved across subsequent sessions for the same machine.
