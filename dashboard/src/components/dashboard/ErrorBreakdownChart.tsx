import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  PieChart, Pie, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, CartesianGrid,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";

type ChartType = "donut" | "pie" | "bar" | "line";

const CHART_TYPES: ChartType[] = ["donut", "pie", "bar", "line"];

const PALETTE = [
  "#f87171",  "#fb923c",  "#facc15",  "#a78bfa",
  "#60a5fa",  "#34d399",  "#f472b6",  "#2dd4bf",
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

export function ErrorBreakdownChart({
  sinceMs,
  onSelectError,
  selectedError,
}: {
  sinceMs: number;
  onSelectError: (name: string | null) => void;
  selectedError: string | null;
}) {
  const data = useQuery(api.dashboard.getErrorBreakdown, { since: sinceMs });
  const [chartType, setChartType] = useState<ChartType>("donut");

  if (!data)
    return (
      <Card className="bg-card border-border">
        <CardContent className="p-4">
          <div className="h-64 flex items-center justify-center text-sm text-muted-foreground">
            Loading errors…
          </div>
        </CardContent>
      </Card>
    );

  if (data.length === 0)
    return (
      <Card className="bg-card border-border">
        <CardContent className="p-4">
          <div className="h-32 flex items-center justify-center text-sm text-muted-foreground">
            No errors in this range.
          </div>
        </CardContent>
      </Card>
    );

  const isPieLike = chartType === "donut" || chartType === "pie";

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-widest">
            Error Breakdown
          </CardTitle>
          <div className="flex items-center gap-1">
            {CHART_TYPES.map((t) => (
              <Button
                key={t}
                variant={chartType === t ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setChartType(t)}
                className="h-6 text-xs capitalize px-2"
              >
                {t}
              </Button>
            ))}
          </div>
        </div>
        {selectedError && (
          <p className="text-xs text-muted-foreground mt-1">
            Selected: <span className="font-mono text-foreground">{selectedError}</span>
            <button
              onClick={() => onSelectError(null)}
              className="ml-2 text-muted-foreground hover:text-foreground underline"
            >
              clear
            </button>
          </p>
        )}
      </CardHeader>
      <CardContent className="px-2 pb-4">
        <ResponsiveContainer width="100%" height={260}>
          {isPieLike ? (
            <PieChart margin={{ top: 10, bottom: 10, left: 0, right: 0 }}>
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Pie
                data={data}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={chartType === "donut" ? 60 : 0}
                outerRadius={90}
                cursor="pointer"
                onClick={(entry) => onSelectError(entry.name as string)}
                paddingAngle={2}
              >
                {data.map((entry, i) => (
                  <Cell
                    key={i}
                    fill={entry.name === selectedError ? "#f8fafc" : PALETTE[i % PALETTE.length]}
                    opacity={selectedError && entry.name !== selectedError ? 0.4 : 1}
                  />
                ))}
              </Pie>
            </PieChart>
          ) : chartType === "bar" ? (
            <BarChart data={data} margin={{ top: 10, bottom: 10, left: 0, right: 0 }}>
              <CartesianGrid stroke="hsl(240 3.7% 18%)" strokeDasharray="3 3" strokeOpacity={0.5} />
              <XAxis dataKey="name" tick={AXIS_STYLE} tickLine={false} axisLine={false} />
              <YAxis tick={AXIS_STYLE} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "hsl(240 3.7% 15.9%)" }} />
              <Bar dataKey="value" radius={[2, 2, 0, 0]}>
                {data.map((entry, i) => (
                  <Cell
                    key={i}
                    fill={entry.name === selectedError ? "#f8fafc" : PALETTE[i % PALETTE.length]}
                    opacity={selectedError && entry.name !== selectedError ? 0.4 : 1}
                    cursor="pointer"
                    onClick={() => onSelectError(entry.name)}
                  />
                ))}
              </Bar>
            </BarChart>
          ) : (
            <LineChart data={data} margin={{ top: 10, bottom: 10, left: 0, right: 0 }}>
              <CartesianGrid stroke="hsl(240 3.7% 18%)" strokeDasharray="3 3" strokeOpacity={0.5} />
              <XAxis dataKey="name" tick={AXIS_STYLE} tickLine={false} axisLine={false} />
              <YAxis tick={AXIS_STYLE} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Line
                type="monotone"
                dataKey="value"
                stroke="#f87171"
                strokeWidth={2}
                dot={{ r: 4, cursor: "pointer", onClick: (props) => onSelectError((props as { payload?: { name?: string } }).payload?.name ?? "") }}
                activeDot={{ r: 6 }}
              />
            </LineChart>
          )}
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
