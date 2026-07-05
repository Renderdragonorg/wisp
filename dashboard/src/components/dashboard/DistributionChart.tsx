import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
} from "recharts";
import type { PieLabelRenderProps } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";

type DistChartType = "pie" | "donut" | "radar";

const DIST_TYPES: DistChartType[] = ["pie", "donut", "radar"];

const COLORS = [
  "#60a5fa",  // blue-400     – New users
  "#34d399",  // emerald-400  – Returning
  "#a78bfa",  // violet-400   – Sessions
  "#fbbf24",  // amber-400    – Events
  "#f87171",  // red-400      – Errors
];

const AXIS_STYLE = {
  fontSize: 11,
  fill: "hsl(240 5% 64.9%)",
  fontFamily: "Inter, system-ui, sans-serif",
};

const TOOLTIP_STYLE = {
  background: "hsl(240 10% 3.9%)",
  border: "1px solid hsl(240 3.7% 15.9%)",
  borderRadius: "6px",
  fontSize: "12px",
  boxShadow: "none",
};

function buildData(overview: {
  totals: { newUsers: number; returningUsers: number; totalSessions: number; totalEvents: number; totalErrors: number };
}) {
  return [
    { name: "New users", value: overview.totals.newUsers },
    { name: "Returning", value: overview.totals.returningUsers },
    { name: "Sessions", value: overview.totals.totalSessions },
    { name: "Events", value: overview.totals.totalEvents },
    { name: "Errors", value: overview.totals.totalErrors },
  ].filter((d) => d.value > 0);
}

function renderLabel({
  cx, cy, midAngle, innerRadius, outerRadius, percent,
}: PieLabelRenderProps) {
  if ((percent as number) < 0.04) return null; // hide tiny slices
  const RADIAN = Math.PI / 180;
  const radius =
    (innerRadius as number) + ((outerRadius as number) - (innerRadius as number)) * 0.55;
  const x = (cx as number) + radius * Math.cos(-midAngle! * RADIAN);
  const y = (cy as number) + radius * Math.sin(-midAngle! * RADIAN);
  return (
    <text
      x={x}
      y={y}
      textAnchor="middle"
      dominantBaseline="central"
      style={{
        fontSize: "11px",
        fontWeight: 600,
        fill: "#ffffff",
        fontFamily: "Inter, system-ui, sans-serif",
        pointerEvents: "none",
      }}
    >
      {`${((percent as number) * 100).toFixed(1)}%`}
    </text>
  );
}

export function DistributionChart({ startDate, endDate }: { startDate: string; endDate: string }) {
  const overview = useQuery(api.dashboard.getOverview, { startDate, endDate });
  const [type, setType] = useState<DistChartType>("donut");

  if (!overview)
    return (
      <Card className="bg-card border-border">
        <CardContent className="p-4">
          <div className="h-72 flex items-center justify-center text-sm text-muted-foreground">
            Loading…
          </div>
        </CardContent>
      </Card>
    );

  const data = buildData(overview);
  if (data.length === 0)
    return (
      <Card className="bg-card border-border">
        <CardContent className="p-4">
          <div className="h-72 flex items-center justify-center text-sm text-muted-foreground">
            No data yet.
          </div>
        </CardContent>
      </Card>
    );

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-widest">
            Distribution
          </CardTitle>
          <div className="flex items-center gap-1">
            {DIST_TYPES.map((t) => (
              <Button
                key={t}
                variant={type === t ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setType(t)}
                className="h-6 text-xs capitalize px-2"
              >
                {t}
              </Button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-2 pb-4">
        <ResponsiveContainer width="100%" height={280}>
          {type === "radar" ? (
            <RadarChart data={data}>
              <PolarGrid stroke="hsl(240 3.7% 15.9%)" />
              <PolarAngleAxis dataKey="name" tick={AXIS_STYLE} />
              <PolarRadiusAxis tick={AXIS_STYLE} />
              <Radar
                dataKey="value"
                stroke="hsl(240 5.9% 40%)"
                fill="hsl(240 5.9% 40%)"
                fillOpacity={0.15}
              />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
            </RadarChart>
          ) : (
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={type === "donut" ? 70 : 0}
                outerRadius={110}
                strokeWidth={0}
                label={renderLabel}
                labelLine={false}
              >
                {data.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                formatter={(value: number) => [value.toLocaleString(), ""]}
              />
              <Legend
                iconType="circle"
                iconSize={8}
                wrapperStyle={{ fontSize: "12px", color: "hsl(240 5% 64.9%)" }}
              />
            </PieChart>
          )}
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
