import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Card, CardContent } from "../ui/card";
import { Users, UserCheck, Activity, Eye, AlertTriangle, Clock } from "lucide-react";

function formatDuration(ms: number): string {
  const min = Math.floor(ms / 60000);
  const sec = Math.round((ms % 60000) / 1000);
  return `${min}m ${sec}s`;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

const STAT_META = [
  { key: "newUsers", label: "New Users", icon: Users, format: formatNumber },
  { key: "returningUsers", label: "Returning", icon: UserCheck, format: formatNumber },
  { key: "totalSessions", label: "Sessions", icon: Activity, format: formatNumber },
  { key: "totalPageViews", label: "Page Views", icon: Eye, format: formatNumber },
  { key: "totalErrors", label: "Errors", icon: AlertTriangle, format: formatNumber },
  { key: "avgSessionDuration", label: "Avg. Duration", icon: Clock, format: (v: number) => formatDuration(v) },
] as const;

export function StatCards({ startDate, endDate }: { startDate: string; endDate: string }) {
  const overview = useQuery(api.dashboard.getOverview, { startDate, endDate });

  if (!overview) {
    return (
      <div className="stats-grid">
        {STAT_META.map((m) => (
          <Card key={m.key} className="bg-card border-border">
            <CardContent className="p-4">
              <div className="h-8 w-24 bg-muted rounded animate-none" />
              <div className="h-3 w-16 bg-muted rounded mt-2" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const values: Record<string, number> = {
    newUsers: overview.totals.newUsers,
    returningUsers: overview.totals.returningUsers,
    totalSessions: overview.totals.totalSessions,
    totalPageViews: overview.totals.totalPageViews,
    totalErrors: overview.totals.totalErrors,
    avgSessionDuration: overview.avgSessionDurationMs,
  };

  return (
    <div className="stats-grid">
      {STAT_META.map((m) => {
        const Icon = m.icon;
        const raw = values[m.key] ?? 0;
        const isError = m.key === "totalErrors";
        return (
          <Card key={m.key} className="bg-card border-border">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="stat-card-label">{m.label}</span>
                <Icon
                  className={`h-3.5 w-3.5 ${isError && raw > 0 ? "text-destructive" : "text-muted-foreground"}`}
                />
              </div>
              <div
                className={`stat-card-value ${isError && raw > 0 ? "text-destructive" : ""}`}
              >
                {m.key === "avgSessionDuration"
                  ? formatDuration(raw)
                  : formatNumber(raw)}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
