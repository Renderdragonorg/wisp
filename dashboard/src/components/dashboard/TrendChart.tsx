import { useState, useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  LineChart, Line, BarChart, Bar, AreaChart, Area,
  XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";

type ChartType = "line" | "bar" | "area";

const CHART_TYPES: ChartType[] = ["line", "bar", "area"];

const SERIES_USERS = [
  { key: "newUsers",       name: "New users",  color: "#60a5fa" },   // blue-400
  { key: "returningUsers", name: "Returning",  color: "#34d399" },   // emerald-400
];

const SERIES_ACTIVITY = [
  { key: "totalSessions", name: "Sessions", color: "#a78bfa" },  // violet-400
  { key: "totalEvents",   name: "Events",   color: "#fbbf24" },  // amber-400
  { key: "totalErrors",   name: "Errors",   color: "#f87171" },  // red-400
];

const CHART_HEIGHT = 200;

const AXIS_STYLE = {
  fontSize: 11,
  fill: "hsl(240 5% 64.9%)",
  fontFamily: "Inter, system-ui, sans-serif",
};

const GRID_STYLE = {
  stroke: "hsl(240 3.7% 18%)",
  strokeDasharray: "3 3",
  strokeOpacity: 0.5,
};

function MiniChart({
  title,
  data,
  series,
  chartType,
}: {
  title: string;
  data: Record<string, unknown>[];
  series: { key: string; name: string; color: string }[];
  chartType: ChartType;
}) {
  if (data.length === 0) {
    return (
      <Card className="bg-card border-border">
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-widest">
            {title}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <div
            style={{ height: CHART_HEIGHT }}
            className="flex items-center justify-center text-sm text-muted-foreground"
          >
            No data in range.
          </div>
        </CardContent>
      </Card>
    );
  }

  const commonProps = {
    data,
    margin: { top: 5, right: 4, left: -20, bottom: 5 },
  };

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2 pt-4 px-4">
        <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-widest">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-2 pb-4">
        <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
          {chartType === "bar" ? (
            <BarChart {...commonProps}>
              <CartesianGrid {...GRID_STYLE} />
              <XAxis dataKey="date" tick={AXIS_STYLE} tickLine={false} axisLine={false} />
              <YAxis tick={AXIS_STYLE} tickLine={false} axisLine={false} />
              <Tooltip
                contentStyle={{
                  background: "hsl(240 10% 3.9%)",
                  border: "1px solid hsl(240 3.7% 15.9%)",
                  borderRadius: "6px",
                  fontSize: "12px",
                  boxShadow: "none",
                }}
                cursor={{ fill: "hsl(240 3.7% 15.9%)" }}
              />
              {series.map((s) => (
                <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.color} radius={[2, 2, 0, 0]} />
              ))}
            </BarChart>
          ) : chartType === "area" ? (
            <AreaChart {...commonProps}>
              <CartesianGrid {...GRID_STYLE} />
              <XAxis dataKey="date" tick={AXIS_STYLE} tickLine={false} axisLine={false} />
              <YAxis tick={AXIS_STYLE} tickLine={false} axisLine={false} />
              <Tooltip
                contentStyle={{
                  background: "hsl(240 10% 3.9%)",
                  border: "1px solid hsl(240 3.7% 15.9%)",
                  borderRadius: "6px",
                  fontSize: "12px",
                  boxShadow: "none",
                }}
              />
              {series.map((s) => (
                <Area
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.name}
                  stroke={s.color}
                  fill={s.color}
                  fillOpacity={0.08}
                  strokeWidth={1.5}
                  dot={false}
                />
              ))}
            </AreaChart>
          ) : (
            <LineChart {...commonProps}>
              <CartesianGrid {...GRID_STYLE} />
              <XAxis dataKey="date" tick={AXIS_STYLE} tickLine={false} axisLine={false} />
              <YAxis tick={AXIS_STYLE} tickLine={false} axisLine={false} />
              <Tooltip
                contentStyle={{
                  background: "hsl(240 10% 3.9%)",
                  border: "1px solid hsl(240 3.7% 15.9%)",
                  borderRadius: "6px",
                  fontSize: "12px",
                  boxShadow: "none",
                }}
              />
              {series.map((s) => (
                <Line
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.name}
                  stroke={s.color}
                  strokeWidth={1.5}
                  dot={false}
                />
              ))}
            </LineChart>
          )}
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

export function TrendChart({ startDate, endDate }: { startDate: string; endDate: string }) {
  const overview = useQuery(api.dashboard.getOverview, { startDate, endDate });
  const [chartType, setChartType] = useState<ChartType>("line");

  const data = useMemo(() => {
    if (!overview) return [];
    return overview.series.map((d) => ({
      ...d,
      date: d.date ? d.date.slice(5) : "",
    }));
  }, [overview]);

  if (!overview)
    return (
      <div className="chart-grid">
        {[0, 1].map((i) => (
          <Card key={i} className="bg-card border-border">
            <CardContent className="p-4">
              <div className="h-[200px] flex items-center justify-center text-sm text-muted-foreground">
                Loading…
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1">
        {CHART_TYPES.map((t) => (
          <Button
            key={t}
            variant={chartType === t ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setChartType(t)}
            className="h-7 text-xs capitalize px-2.5"
          >
            {t}
          </Button>
        ))}
      </div>
      <div className="chart-grid">
        <MiniChart title="Users" data={data} series={SERIES_USERS} chartType={chartType} />
        <MiniChart title="Activity" data={data} series={SERIES_ACTIVITY} chartType={chartType} />
      </div>
    </div>
  );
}
