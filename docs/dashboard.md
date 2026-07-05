# Dashboard

A self-hosted analytics dashboard built with Vite + React + TypeScript + recharts.

## Setup

```bash
cd dashboard
npm install
```

Create `dashboard/.env.local`:

```
VITE_CONVEX_URL=https://happy-animal-123.convex.cloud
```

## Running

```bash
npm run dev
# Opens at http://localhost:5173
```

The dashboard uses Convex's `useQuery` hooks, so it subscribes to real-time data via WebSocket. When you deploy new Convex functions, run `npx convex dev` in the parent project to regenerate types (the dashboard symlinks `convex/ → ../convex` so generated types stay in sync).

## Components

### StatCards

Top-level summary: new users, returning users, sessions, page views, errors, avg session length. Takes `startDate` and `endDate` strings.

```tsx
<StatCards startDate="2026-06-01" endDate="2026-07-04" />
```

### TrendChart

Side-by-side mini charts. Left: Users (new + returning). Right: Activity (sessions, events, errors). Has a chart-type toggle: **Line**, **Bar**, **Area**.

```tsx
<TrendChart startDate="2026-06-01" endDate="2026-07-04" />
```

The two charts use separate Y-axes, so user counts aren't flattened by larger error counts.

### DistributionChart

Aggregated totals shown as **Pie**, **Donut**, or **Radar** charts. Same data as the stat cards but visually proportioned.

```tsx
<DistributionChart startDate="2026-06-01" endDate="2026-07-04" />
```

### SessionsTable

Paginated session list with:
- **Search** by entry URL (300ms debounced)
- **Sort** by start time, duration, event count, error count
- **Filter**: returning only, has errors only
- **Machine ID click** — click a truncated machine ID to open the machine detail view

```tsx
<SessionsTable onSelectMachine={(id) => setSelectedMachineId(id)} />
```

### ErrorBreakdownChart

Horizontal bar chart of the top 8 error names in the selected time range. Click a bar to see error details.

```tsx
<ErrorBreakdownChart
  sinceMs={Date.now() - 30 * 86400000}
  onSelectError={setSelectedError}
  selectedError={selectedError}
/>
```

### ErrorDetails

Expands below the error breakdown chart when an error is clicked. Shows:
- Error name header with occurrence count
- Each occurrence as a card with: error message (red), timestamp, URL, session ID, machine ID
- **Console output** section renders the payload in a dark code block (stack traces, context)

```tsx
{selectedError && (
  <ErrorDetails
    errorName={selectedError}
    sinceMs={Date.now() - 30 * 86400000}
    onClose={() => setSelectedError(null)}
  />
)}
```

### TopPagesChart

Horizontal bar chart of the top 10 pages by view count in the selected date range. Click a bar to see which machines visited that page.

```tsx
<TopPagesChart
  startDate={startDate}
  endDate={endDate}
  onSelectPage={setSelectedPage}
  selectedPage={selectedPage}
/>
```

### PageVisitors

Expands below the top pages chart when a page is clicked. Shows a table of machines that visited that page with:

- Machine ID (clickable — opens MachineView)
- Visit count per machine
- Country, platform
- First and last visit timestamps

```tsx
{selectedPage && (
  <PageVisitors
    url={selectedPage}
    startDate={startDate}
    endDate={endDate}
    onSelectMachine={(id) => setSelectedMachineId(id)}
    onClose={() => setSelectedPage(null)}
  />
)}
```

### MachineView

Full-page detail view for a single machine. Shows:

| Section | Fields |
|---------|--------|
| **Header** | Machine ID, close button |
| **Timestamps** | First seen, last seen, visit count |
| **Stats** | Sessions, events, errors, returning sessions, return rate, avg session duration |
| **Device & location** | Browser (shortened from UA), platform/OS, screen resolution, IP, country, region, city, referrer |
| **Top errors** | Error names with counts (machine-specific) |
| **Top pages** | URLs with hit counts |
| **Last session** | Session ID, started at, duration, entry/exit URL, error count |

Accessed by clicking a machine ID in the sessions table or searching for a machine in the top bar's autocomplete.

```tsx
<MachineView machineId="uuid" onClose={() => setSelectedMachineId(null)} />
```

## Layout

The dashboard is a single-page app with no router. The layout flows:

1. **Header bar** — title, machine search input, date range selector, refresh button
2. **Stat cards** — summary metrics
3. **Trend chart** — two side-by-side mini charts
4. **Distribution chart** — pie/donut/radar of totals
5. **Error breakdown** — bar chart + expandable error details
6. **Top pages** — bar chart of most-viewed pages + expandable machine visitor table
7. **Sessions table** — paginated session list with machine ID links

When a machine is selected (via search or session click), the entire dashboard is replaced by the MachineView with a "Back to dashboard" button.

## Required queries

The dashboard depends on the following Convex queries being deployed:

| Query | Used by |
|-------|---------|
| `dashboard:getOverview` | StatCards, TrendChart, DistributionChart |
| `dashboard:listSessions` | SessionsTable |
| `dashboard:listEvents` | (not currently used in components, available) |
| `dashboard:getErrorBreakdown` | ErrorBreakdownChart |
| `dashboard:getErrorDetails` | ErrorDetails |
| `dashboard:getMachineStats` | MachineView |
| `dashboard:searchMachines` | Machine search autocomplete |
| `dashboard:getTopPages` | TopPagesChart |
| `dashboard:getPageVisitors` | PageVisitors |
| `dashboard:recomputeStats` | Refresh button |

## Building for production

```bash
cd dashboard
npm run build
# Output in dashboard/dist/
```

Deploy `dashboard/dist/` to any static host (Vercel, Cloudflare Pages, Netlify, etc.). The dashboard is a fully static SPA; all data comes from Convex queries over WebSocket.
