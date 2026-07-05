# Wisp dashboard — charts, filtering, sorting, search

This extends the Wisp backend from the earlier guide with the queries a real dashboard needs, and a React (Next.js) frontend that consumes them: stat cards, three charts (DAU trend, new vs. returning, error breakdown), and a searchable/sortable/filterable sessions table.

Nothing here modifies the existing `convex/schema.ts`, `events.ts`, or `stats.ts` files — it adds to them. Treat the snippets below as new exports/fields layered on top.

---

## 1. Why this needs backend changes, not just frontend

Convex doesn't support arbitrary "sort by any column, filter by any combination, search any field" the way SQL does — every sort and most filters need to go through an index you define up front. So before touching React, we need to:

1. Add indexes that match the specific sorts you want (by duration, by error count, by start time).
2. Add a **search index** for free-text search (Convex's built-in full-text search — not a `LIKE '%term%'` filter, which would be a full table scan).
3. Write paginated queries that accept `{ search, sortBy, sortDir, filterHasError, filterReturning, cursor }` and translate that into the right index + Convex's built-in pagination.

---

## 2. Schema additions — `convex/schema.ts`

Add these to the existing `sessions` table definition (indexes are additive, this won't break existing data):

```typescript
sessions: defineTable({
  // ...all existing fields unchanged...
})
  .index("by_sessionId", ["sessionId"])
  .index("by_machineId", ["machineId"])
  .index("by_open", ["endedAt"])
  // New: enables sorting by these columns without a full collect() + in-memory sort
  .index("by_startedAt", ["startedAt"])
  .index("by_duration", ["durationMs"])
  .index("by_eventCount", ["eventCount"])
  .index("by_errorCount", ["errorCount"])
  // New: full-text search over the entry URL (e.g. searching "/checkout")
  .searchIndex("search_entryUrl", { searchField: "entryUrl" }),
```

And on `events`, to support searching error messages / event names:

```typescript
events: defineTable({
  // ...all existing fields unchanged...
})
  .index("by_session", ["sessionId"])
  .index("by_type_time", ["type", "timestamp"])
  .index("by_machine_time", ["machineId", "timestamp"])
  .searchIndex("search_name", { searchField: "name", filterFields: ["type"] }),
```

`filterFields` on a search index lets you combine full-text search with an equality filter in one query — e.g. "search for 'timeout' *within* error-type events only," which is exactly what an error-log search box needs.

Run `npx convex dev` after this — it needs to build the search index, which can take a minute on existing data.

---

## 3. Backend queries — new file `convex/dashboard.ts`

```typescript
import { query } from "./_generated/server";
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";

/**
 * Paginated, filterable, sortable, searchable session list.
 * This is the query the sessions table in the UI calls directly.
 */
export const listSessions = query({
  args: {
    paginationOpts: paginationOptsValidator,
    search: v.optional(v.string()),
    sortBy: v.optional(
      v.union(v.literal("startedAt"), v.literal("durationMs"), v.literal("eventCount"), v.literal("errorCount"))
    ),
    sortDir: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
    onlyReturning: v.optional(v.boolean()),
    onlyWithErrors: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const sortDir = args.sortDir ?? "desc";

    // Search takes priority — Convex search indexes return relevance-ordered
    // results and can't be combined with a different sort, so if there's a
    // search term we search first and apply filters as a post-filter.
    if (args.search && args.search.trim().length > 0) {
      const results = await ctx.db
        .query("sessions")
        .withSearchIndex("search_entryUrl", (q) => q.search("entryUrl", args.search!))
        .paginate(args.paginationOpts);

      return {
        ...results,
        page: results.page.filter(
          (s) =>
            (!args.onlyReturning || s.isReturning) &&
            (!args.onlyWithErrors || s.errorCount > 0)
        ),
      };
    }

    const indexName = `by_${args.sortBy ?? "startedAt"}` as
      | "by_startedAt"
      | "by_durationMs"
      | "by_eventCount"
      | "by_errorCount";

    let q = ctx.db.query("sessions").withIndex(indexName).order(sortDir);

    if (args.onlyReturning) {
      q = q.filter((row) => row.eq(row.field("isReturning"), true)) as typeof q;
    }
    if (args.onlyWithErrors) {
      q = q.filter((row) => row.gt(row.field("errorCount"), 0)) as typeof q;
    }

    return await q.paginate(args.paginationOpts);
  },
});

/**
 * Paginated event log with optional type filter and full-text search over event name.
 * Powers a "search error messages" or "search interactions" view.
 */
export const listEvents = query({
  args: {
    paginationOpts: paginationOptsValidator,
    search: v.optional(v.string()),
    type: v.optional(
      v.union(v.literal("pageview"), v.literal("interaction"), v.literal("error"), v.literal("custom"))
    ),
  },
  handler: async (ctx, args) => {
    if (args.search && args.search.trim().length > 0) {
      let sq = ctx.db.query("events").withSearchIndex("search_name", (q) => {
        const base = q.search("name", args.search!);
        return args.type ? base.eq("type", args.type) : base;
      });
      return await sq.paginate(args.paginationOpts);
    }

    if (args.type) {
      return await ctx.db
        .query("events")
        .withIndex("by_type_time", (q) => q.eq("type", args.type!))
        .order("desc")
        .paginate(args.paginationOpts);
    }

    return await ctx.db.query("events").order("desc").paginate(args.paginationOpts);
  },
});

/**
 * Everything the top-of-dashboard stat cards + charts need, in one call —
 * avoids the frontend firing four separate queries on every date range change.
 */
export const getOverview = query({
  args: { startDate: v.string(), endDate: v.string() },
  handler: async (ctx, { startDate, endDate }) => {
    const daily = await ctx.db
      .query("dailyStats")
      .withIndex("by_date", (q) => q.gte("date", startDate).lte("date", endDate))
      .collect();

    const totals = daily.reduce(
      (acc, d) => ({
        newUsers: acc.newUsers + d.newUsers,
        returningUsers: acc.returningUsers + d.returningUsers,
        totalSessions: acc.totalSessions + d.totalSessions,
        totalErrors: acc.totalErrors + d.totalErrors,
        totalEvents: acc.totalEvents + d.totalEvents,
      }),
      { newUsers: 0, returningUsers: 0, totalSessions: 0, totalErrors: 0, totalEvents: 0 }
    );

    const avgDuration =
      daily.length > 0
        ? Math.round(daily.reduce((sum, d) => sum + d.avgSessionDurationMs, 0) / daily.length)
        : 0;

    return {
      totals,
      avgSessionDurationMs: avgDuration,
      series: daily.sort((a, b) => a.date.localeCompare(b.date)), // chronological, for the line chart
    };
  },
});

/** Error breakdown for the pie/bar chart — reuses the existing getTopErrors logic but scoped to a date range. */
export const getErrorBreakdown = query({
  args: { since: v.number() },
  handler: async (ctx, { since }) => {
    const errors = await ctx.db
      .query("events")
      .withIndex("by_type_time", (q) => q.eq("type", "error").gte("timestamp", since))
      .collect();

    const counts = new Map<string, number>();
    for (const e of errors) counts.set(e.name, (counts.get(e.name) ?? 0) + 1);

    return Array.from(counts.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8); // top 8, "other" bucket for the rest
  },
});
```

**Why search and sort are mutually exclusive above:** Convex search indexes return results ordered by text-relevance score — there's no way to also sort those results by `startedAt` or `durationMs` in the same query. In practice this matches how people actually use a search box (they want relevant results, not a specific sort), so the UI just hides the sort dropdown while a search term is active. If you need both simultaneously, you'd have to search all matches (uncapped), then sort in-memory — only reasonable if your matched-result count stays small.

---

## 4. Frontend setup

```bash
npm install convex recharts
```

`recharts` is a solid pick here — it's already listed as an available library in this environment's artifact sandbox, has no heavyweight dependencies, and renders clean SVG charts without a canvas/WebGL dependency.

### 4.1 Convex provider (Next.js App Router)

```tsx
// app/convex-provider.tsx
"use client";
import { ConvexProvider, ConvexReactClient } from "convex/react";

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export function ConvexClientProvider({ children }: { children: React.ReactNode }) {
  return <ConvexProvider client={convex}>{children}</ConvexProvider>;
}
```

```tsx
// app/layout.tsx
import { ConvexClientProvider } from "./convex-provider";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ConvexClientProvider>{children}</ConvexClientProvider>
      </body>
    </html>
  );
}
```

### 4.2 Stat cards — `components/dashboard/StatCards.tsx`

```tsx
"use client";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

function formatDuration(ms: number): string {
  const min = Math.floor(ms / 60000);
  const sec = Math.round((ms % 60000) / 1000);
  return `${min}m ${sec}s`;
}

export function StatCards({ startDate, endDate }: { startDate: string; endDate: string }) {
  const overview = useQuery(api.dashboard.getOverview, { startDate, endDate });

  if (!overview) return <div>Loading stats…</div>;

  const cards = [
    { label: "New users", value: overview.totals.newUsers },
    { label: "Returning users", value: overview.totals.returningUsers },
    { label: "Sessions", value: overview.totals.totalSessions },
    { label: "Errors", value: overview.totals.totalErrors },
    { label: "Avg. session length", value: formatDuration(overview.avgSessionDurationMs) },
  ];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "12px" }}>
      {cards.map((c) => (
        <div key={c.label} style={{ padding: "16px", border: "1px solid #e2e2e2", borderRadius: "8px" }}>
          <div style={{ fontSize: "13px", color: "#666" }}>{c.label}</div>
          <div style={{ fontSize: "24px", fontWeight: 600 }}>{c.value}</div>
        </div>
      ))}
    </div>
  );
}
```

### 4.3 DAU / trend line chart — `components/dashboard/TrendChart.tsx`

```tsx
"use client";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Legend } from "recharts";

export function TrendChart({ startDate, endDate }: { startDate: string; endDate: string }) {
  const overview = useQuery(api.dashboard.getOverview, { startDate, endDate });
  if (!overview) return <div>Loading chart…</div>;

  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={overview.series}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="date" fontSize={12} />
        <YAxis fontSize={12} />
        <Tooltip />
        <Legend />
        <Line type="monotone" dataKey="newUsers" name="New users" stroke="#3B82F6" strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="returningUsers" name="Returning users" stroke="#10B981" strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="totalErrors" name="Errors" stroke="#EF4444" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
```

### 4.4 Error breakdown chart — `components/dashboard/ErrorBreakdownChart.tsx`

```tsx
"use client";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";

const COLORS = ["#EF4444", "#F97316", "#F59E0B", "#84CC16", "#10B981", "#06B6D4", "#3B82F6", "#8B5CF6"];

export function ErrorBreakdownChart({ sinceMs }: { sinceMs: number }) {
  const data = useQuery(api.dashboard.getErrorBreakdown, { since: sinceMs });
  if (!data) return <div>Loading errors…</div>;
  if (data.length === 0) return <div>No errors in this range.</div>;

  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} layout="vertical" margin={{ left: 80 }}>
        <XAxis type="number" fontSize={12} />
        <YAxis type="category" dataKey="name" width={160} fontSize={11} tickFormatter={(v) => v.slice(0, 24)} />
        <Tooltip />
        <Bar dataKey="value">
          {data.map((_, i) => (
            <Cell key={i} fill={COLORS[i % COLORS.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
```

### 4.5 Sessions table with search, sort, filter, pagination — `components/dashboard/SessionsTable.tsx`

This is the piece with the most moving parts: a debounced search box, a sort dropdown, filter checkboxes, and Convex's `usePaginatedQuery` for infinite-scroll-style "load more."

```tsx
"use client";
import { useState, useMemo, useEffect } from "react";
import { usePaginatedQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

type SortBy = "startedAt" | "durationMs" | "eventCount" | "errorCount";

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

function formatDuration(ms?: number): string {
  if (!ms) return "—";
  const min = Math.floor(ms / 60000);
  const sec = Math.round((ms % 60000) / 1000);
  return `${min}m ${sec}s`;
}

export function SessionsTable() {
  const [searchInput, setSearchInput] = useState("");
  const search = useDebouncedValue(searchInput, 300); // avoid firing a query on every keystroke

  const [sortBy, setSortBy] = useState<SortBy>("startedAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [onlyReturning, setOnlyReturning] = useState(false);
  const [onlyWithErrors, setOnlyWithErrors] = useState(false);

  const { results, status, loadMore } = usePaginatedQuery(
    api.dashboard.listSessions,
    { search: search || undefined, sortBy, sortDir, onlyReturning, onlyWithErrors },
    { initialNumItems: 25 }
  );

  const isSearching = search.trim().length > 0;

  return (
    <div>
      <div style={{ display: "flex", gap: "8px", marginBottom: "12px", flexWrap: "wrap" }}>
        <input
          type="text"
          placeholder="Search by URL…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          style={{ padding: "6px 10px", border: "1px solid #ccc", borderRadius: "6px", minWidth: "220px" }}
        />

        {/* Sort controls are hidden while searching — search results are relevance-ordered, see backend note */}
        {!isSearching && (
          <>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortBy)}>
              <option value="startedAt">Start time</option>
              <option value="durationMs">Duration</option>
              <option value="eventCount">Event count</option>
              <option value="errorCount">Error count</option>
            </select>
            <select value={sortDir} onChange={(e) => setSortDir(e.target.value as "asc" | "desc")}>
              <option value="desc">Descending</option>
              <option value="asc">Ascending</option>
            </select>
          </>
        )}

        <label style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <input type="checkbox" checked={onlyReturning} onChange={(e) => setOnlyReturning(e.target.checked)} />
          Returning only
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <input type="checkbox" checked={onlyWithErrors} onChange={(e) => setOnlyWithErrors(e.target.checked)} />
          Has errors
        </label>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
            <th style={{ padding: "8px" }}>Started</th>
            <th style={{ padding: "8px" }}>Machine</th>
            <th style={{ padding: "8px" }}>Entry URL</th>
            <th style={{ padding: "8px" }}>Duration</th>
            <th style={{ padding: "8px" }}>Events</th>
            <th style={{ padding: "8px" }}>Errors</th>
            <th style={{ padding: "8px" }}>Returning</th>
          </tr>
        </thead>
        <tbody>
          {results.map((s) => (
            <tr key={s._id} style={{ borderBottom: "1px solid #f0f0f0" }}>
              <td style={{ padding: "8px" }}>{new Date(s.startedAt).toLocaleString()}</td>
              <td style={{ padding: "8px", fontFamily: "monospace" }}>{s.machineId.slice(0, 8)}…</td>
              <td style={{ padding: "8px", maxWidth: "220px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {s.entryUrl}
              </td>
              <td style={{ padding: "8px" }}>{formatDuration(s.durationMs)}</td>
              <td style={{ padding: "8px" }}>{s.eventCount}</td>
              <td style={{ padding: "8px", color: s.errorCount > 0 ? "#EF4444" : undefined }}>{s.errorCount}</td>
              <td style={{ padding: "8px" }}>{s.isReturning ? "Yes" : "No"}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {status === "CanLoadMore" && (
        <button onClick={() => loadMore(25)} style={{ marginTop: "12px" }}>
          Load more
        </button>
      )}
      {status === "LoadingMore" && <div style={{ marginTop: "12px" }}>Loading…</div>}
      {results.length === 0 && status !== "LoadingFirstPage" && <div style={{ marginTop: "12px" }}>No sessions match these filters.</div>}
    </div>
  );
}
```

`usePaginatedQuery` is Convex's built-in hook for exactly this — it manages the cursor, tracks loading state (`LoadingFirstPage` / `CanLoadMore` / `LoadingMore` / `Exhausted`), and re-fetches from scratch whenever the query args (search/sort/filter) change, which is exactly the behavior you want when someone types a new search term.

### 4.6 Composing the dashboard page — `app/dashboard/page.tsx`

```tsx
"use client";
import { useState } from "react";
import { StatCards } from "@/components/dashboard/StatCards";
import { TrendChart } from "@/components/dashboard/TrendChart";
import { ErrorBreakdownChart } from "@/components/dashboard/ErrorBreakdownChart";
import { SessionsTable } from "@/components/dashboard/SessionsTable";

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export default function DashboardPage() {
  const [rangeDays, setRangeDays] = useState(30);
  const startDate = daysAgo(rangeDays);
  const endDate = daysAgo(0);

  return (
    <div style={{ padding: "24px", maxWidth: "1100px", margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
        <h1 style={{ fontSize: "20px", fontWeight: 600 }}>Analytics</h1>
        <select value={rangeDays} onChange={(e) => setRangeDays(Number(e.target.value))}>
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>
      </div>

      <StatCards startDate={startDate} endDate={endDate} />

      <div style={{ marginTop: "24px" }}>
        <h2 style={{ fontSize: "16px", fontWeight: 500, marginBottom: "8px" }}>Trend</h2>
        <TrendChart startDate={startDate} endDate={endDate} />
      </div>

      <div style={{ marginTop: "24px" }}>
        <h2 style={{ fontSize: "16px", fontWeight: 500, marginBottom: "8px" }}>Top errors</h2>
        <ErrorBreakdownChart sinceMs={Date.now() - rangeDays * 24 * 60 * 60 * 1000} />
      </div>

      <div style={{ marginTop: "24px" }}>
        <h2 style={{ fontSize: "16px", fontWeight: 500, marginBottom: "8px" }}>Sessions</h2>
        <SessionsTable />
      </div>
    </div>
  );
}
```

---

## 5. What's still rough / not covered above

- **Styling is inline and bare-bones on purpose** — this is functional scaffolding, not a design pass. Swap in your own component library / Tailwind classes once the data flow is confirmed working.
- **No auth on the dashboard route** — anyone who reaches `/dashboard` can see everything. Gate this behind your existing Supabase auth (check for an admin role) before deploying — don't ship an open analytics dashboard.
- **`getOverview` and `getErrorBreakdown` re-collect on every render** with no caching beyond Convex's own reactive query caching. Fine at your current scale; if `dailyStats` grows into the thousands of rows, consider capping the date range harder or pre-aggregating weekly/monthly rollups.
- **Search is exact substring/word matching**, not fuzzy — Convex's search index does token-based matching, which is good enough for URLs and error names but won't catch typos.

---

## 6. Sources

- Convex pagination (`usePaginatedQuery`, `paginationOptsValidator`): https://docs.convex.dev/database/pagination
- Convex search indexes: https://docs.convex.dev/search
- Convex indexes & query ordering: https://docs.convex.dev/database/indexes/
- Recharts docs: https://recharts.org/en-US/api