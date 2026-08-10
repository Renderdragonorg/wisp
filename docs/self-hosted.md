# Self-hosted deployment

This guide describes the production setup for Wisp backed by a self-hosted
Convex deployment.

## Architecture

The self-hosted Convex Docker deployment exposes two services:

| Service | Port | Purpose |
|---------|------|---------|
| Convex backend | `3210` | Queries, mutations, WebSocket connections, CLI administration |
| Convex HTTP actions | `3211` | `/ingest` and Convex Auth HTTP routes |

The services listen on the Linux host's localhost interface. Cloudflare Tunnel
publishes them through:

```text
https://convexapi.codersoft.xyz
```

Normal Convex traffic is routed to port `3210`. `/ingest`, `/api/auth/*`, and
`/.well-known/*` are routed to port `3211`.

## Frontend configuration

The public frontend and dashboard must use the self-hosted backend URL:

```env
VITE_CONVEX_URL=https://convexapi.codersoft.xyz
```

For the Wisp browser SDK:

```ts
import { init } from "@renderdragonorg/wisp";

init({
  convexUrl: "https://convexapi.codersoft.xyz",
});
```

If the application uses a Wisp ingestion secret, keep using the same secret
that is configured on the self-hosted Convex deployment. Do not commit it to
the repository.

After changing `VITE_CONVEX_URL`, rebuild and redeploy the dashboard. A Vite
environment variable is compiled into the frontend at build time; changing it
in the hosting provider without a new deployment does not update an already
published dashboard.

## Cloudflare DNS

In the `codersoft.xyz` zone, the record should be:

| Type | Name | Target | Proxy |
|------|------|--------|-------|
| CNAME | `api.wisp` | `<tunnel-id>.cfargotunnel.com` | Proxied |

Do not create an A record pointing at `192.168.100.6`. That is a private
address and must not be published in DNS.

If Cloudflare reports that a record with the same name already exists, edit the
existing record instead of creating a second A, AAAA, or CNAME record.

## Cloudflare Tunnel routing

The tunnel configuration must route HTTP actions before the general backend
route. The relevant ingress rules are:

```yaml
ingress:
  - hostname: convexapi.codersoft.xyz
    path: ^/ingest(/.*)?$
    service: http://127.0.0.1:3211
  - hostname: convexapi.codersoft.xyz
    path: ^/api/auth(/.*)?$
    service: http://127.0.0.1:3211
  - hostname: convexapi.codersoft.xyz
    path: ^/\.well-known/.*$
    service: http://127.0.0.1:3211
  - hostname: convexapi.codersoft.xyz
    service: http://127.0.0.1:3210
  - service: http_status:404
```

If the tunnel is configured from a local `cloudflared` config file, restart
the tunnel after changing that file. If the tunnel is managed from the
Cloudflare dashboard, configure the equivalent public-hostname and path rules
there. Use one configuration source as the authority; do not create
conflicting duplicate routes.

Validate ingestion with the configured Wisp secret:

```bash
curl -i -X POST https://convexapi.codersoft.xyz/ingest \
  -H 'content-type: application/json' \
  -H "x-wisp-token: $WISP_SECRET" \
  --data '{"events":[]}'
```

An authorized empty event batch should return `204`. A `401` means the route
works but the token is missing or incorrect. A `404` usually means `/ingest`
was sent to port `3210` instead of port `3211`.

## Deploying Convex code

Use the latest Convex CLI for self-hosted operations:

```bash
npx convex@latest dev --once
```

For a self-hosted deployment, set these variables in the shell or in a local,
untracked environment file:

```env
CONVEX_SELF_HOSTED_URL=https://convexapi.codersoft.xyz
CONVEX_SELF_HOSTED_ADMIN_KEY=<self-hosted-admin-key>
```

The admin key is only for CLI and administrative operations. It must never be
used in browser code.

## Migrating data from Convex Cloud

Export the hosted production deployment, including file storage:

```bash
npx convex@latest export \
  --prod \
  --include-file-storage \
  --path /tmp/wisp-prod.zip
```

Push the current schema and functions to self-hosted Convex, then import the
snapshot:

```bash
npx convex@latest dev --once
npx convex@latest import --replace-all --yes /tmp/wisp-prod.zip
```

`--replace-all` deletes existing target data. Use it only when the target is
dedicated to Wisp or when a target backup already exists. Convex imports retain
document IDs and creation times, so references between machines, sessions,
events, rollups, and auth records remain valid.

The export does not transfer deployment environment variables, OAuth secrets,
JWT signing keys, Cloudflare configuration, or frontend hosting variables.
Copy those values separately through the self-hosted deployment settings.

## Dashboard access

The custom Wisp dashboard has no login gate. Dashboard queries are public, so
protect the dashboard hostname with Cloudflare Access, a private network, or
another external access-control layer before exposing it publicly.

The legacy Convex Auth tables remain in the schema to avoid deleting migrated
auth data, but the dashboard no longer uses GitHub, credentials, JWT, or Convex
Auth sessions.

## Cutover checklist

- Export hosted production data.
- Deploy the current `convex/` code and schema to self-hosted Convex.
- Import the snapshot and wait for index backfills to finish.
- Copy required Convex environment variables and secrets.
- Verify the Cloudflare CNAME points to the tunnel.
- Verify `/ingest` returns `204` with the correct Wisp token.
- Set frontend and dashboard `VITE_CONVEX_URL` to the self-hosted URL.
- Redeploy the frontend and dashboard.
- Test dashboard queries and confirm the external access-control layer.
- Test a real Wisp event and confirm it appears in the self-hosted dashboard.
- Keep the hosted deployment available until the cutover is verified.

## Rollback

To roll back frontend traffic, restore the previous hosted Convex URL in the
frontend and dashboard environment variables, then redeploy them. Do not delete
the hosted deployment or its data until the self-hosted deployment has been
verified and retained backups are available.
