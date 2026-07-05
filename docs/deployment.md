# Deployment

## Convex backend

### Development

```bash
npx convex dev
```

This watches the `convex/` directory for changes, regenerates `_generated/` types, and pushes to your dev deployment. Your dev deployment URL is shown in the terminal output.

### Production

When you're ready to go live:

1. **Deploy to production:**

```bash
npx convex deploy
```

This typechecks, regenerates types, bundles, and pushes to the production deployment. You'll be prompted to confirm.

2. **Set the production URL** in your app's environment variables:

```
VITE_CONVEX_URL=https://precious-crocodile-678.convex.cloud
```

3. **Update the dashboard's `.env.local`:**

```
VITE_CONVEX_URL=https://precious-crocodile-678.convex.cloud
```

4. **Push environment variables** if needed (not required for the backend — ip-api.com works without keys).

### Managing deployments

```bash
# List deployments
npx convex deployments list

# Create a preview deployment
npx convex deploy --preview-create my-feature-branch

# Delete a preview deployment
npx convex deployments delete <deployment-name>
```

See the [Convex deploy docs](https://docs.convex.dev/production/deploy) for more.

## Client SDK

### Building the package

```bash
npm run build
```

This runs `tsup`, which outputs:

```
dist/
├── index.js          (ESM)
├── index.cjs         (CommonJS)
├── index.d.ts        (TypeScript declarations)
├── supabase.js       (ESM)
├── supabase.cjs      (CommonJS)
├── supabase.d.ts     (TypeScript declarations)
└── ...sourcemaps
```

### Publishing to npm

```bash
npm login
npm publish --access public
```

### Using without publishing

If you don't want to publish to npm, you can:

1. **Git link** in package.json:
```json
{
  "dependencies": {
    "@codersoft/wisp": "github:your-org/wisp"
  }
}
```

2. **Local tarball:**
```bash
npm run build
npm pack
# Installs in your app:
npm install ./yourorg-wisp-0.1.0.tgz
```

3. **Copy dist/ directly** into a `vendor/` folder in your app.

## Dashboard

### Building

```bash
cd dashboard
npm run build
# Output: dashboard/dist/
```

### Deploying

Upload `dashboard/dist/` to any static host:

| Host | Instructions |
|------|-------------|
| **Vercel** | `vercel --prod` — auto-detects Vite |
| **Cloudflare Pages** | Set build command to `npm run build`, output dir to `dist` |
| **Netlify** | Set publish directory to `dist` |
| **Any S3/static** | `aws s3 sync dist/ s3://my-bucket/` + redirect all paths to `index.html` |

### SPA fallback

Since the dashboard is a single-page app without a router (uses conditional rendering instead), you generally don't need `_redirects` or fallback rules. If you add client-side routing later, configure the SPA fallback for your host:

| Host | Config |
|------|--------|
| Cloudflare Pages | `_redirects` file: `/* /index.html 200` |
| Netlify | `_redirects`: `/* /index.html 200` |
| Vercel | `vercel.json`: `{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }` |

## Production checklist

- [ ] **Convex production deployment** deployed via `npx convex deploy`
- [ ] **SDK** initialized with the production `convexUrl`
- [ ] **Dashboard** `.env.local` points to production URL
- [ ] **CORS** — the HTTP Action returns `Access-Control-Allow-Origin: *`, so the SDK works from any domain
- [ ] **Session sweep cron** runs every 10 minutes (enabled by default once deployed)
- [ ] **Daily stats cron** runs at 00:15 UTC (enabled by default)
- [ ] **Tests** pass: `npm test`
- [ ] **Geo-IP** fallback — verify ip-api.com resolves for your server's IP range
