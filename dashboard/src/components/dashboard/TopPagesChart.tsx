import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  PieChart, Pie, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, CartesianGrid,
  type TooltipValueType,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";

type ChartType = "donut" | "pie" | "bar" | "line";

const CHART_TYPES: ChartType[] = ["donut", "pie", "bar", "line"];

const PALETTE = [
  "#60a5fa",  "#34d399",  "#a78bfa",  "#fbbf24",  "#f87171",
  "#f472b6",  "#2dd4bf",  "#fb923c",  "#818cf8",  "#a3e635",
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

export function TopPagesChart({
  startDate,
  endDate,
  onSelectPage,
  selectedPage,
}: {
  startDate: string;
  endDate: string;
  onSelectPage: (url: string | null) => void;
  selectedPage: string | null;
}) {
  const data = useQuery(api.dashboard.getTopPages, { startDate, endDate, limit: 10 });
  const [chartType, setChartType] = useState<ChartType>("donut");

  if (!data)
    return (
      <Card className="bg-card border-border">
        <CardContent className="p-4">
          <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">
            Loading pages…
          </div>
        </CardContent>
      </Card>
    );

  if (data.length === 0)
    return (
      <Card className="bg-card border-border">
        <CardContent className="p-4">
          <div className="h-24 flex items-center justify-center text-sm text-muted-foreground">
            No page views in this range.
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
            Top Pages
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
          {selectedPage && (
            <button
              onClick={() => onSelectPage(null)}
              className="text-xs text-muted-foreground hover:text-foreground underline"
            >
              clear
            </button>
          )}
        </div>
        {selectedPage && (
          <p className="text-xs text-muted-foreground mt-1 font-mono break-all">{selectedPage}</p>
        )}
      </CardHeader>
      <CardContent className="px-2 pb-4">
        <ResponsiveContainer width="100%" height={260}>
          {isPieLike ? (
            <PieChart margin={{ top: 10, bottom: 10, left: 0, right: 0 }}>
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                formatter={(value: TooltipValueType | undefined, _name, props: { payload?: { url?: string } }) => [
                  value,
                  props.payload?.url ?? "",
                ]}
              />
              <Pie
                data={data}
                dataKey="viewCount"
                nameKey="url"
                cx="50%"
                cy="50%"
                innerRadius={chartType === "donut" ? 60 : 0}
                outerRadius={90}
                cursor="pointer"
                onClick={(entry) => onSelectPage((entry as { url?: string }).url ?? "")}
                paddingAngle={2}
              >
                {data.map((entry, i) => (
                  <Cell
                    key={i}
                    fill={PALETTE[i % PALETTE.length]}
                    opacity={selectedPage && entry.url !== selectedPage ? 0.35 : 1}
                  />
                ))}
              </Pie>
            </PieChart>
          ) : chartType === "bar" ? (
            <BarChart data={data} margin={{ top: 10, bottom: 10, left: 0, right: 0 }}>
              <CartesianGrid stroke="hsl(240 3.7% 18%)" strokeDasharray="3 3" strokeOpacity={0.5} />
              <XAxis
                dataKey="url"
                tick={AXIS_STYLE}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: string) => v.length > 20 ? v.slice(0, 20) + "…" : v}
              />
              <YAxis tick={AXIS_STYLE} tickLine={false} axisLine={false} />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                formatter={(value: TooltipValueType | undefined) => [Number(value ?? 0).toLocaleString(), "Views"]}
                labelFormatter={(label) => label}
              />
              <Bar dataKey="viewCount" radius={[2, 2, 0, 0]} cursor="pointer">
                {data.map((entry, i) => (
                  <Cell
                    key={i}
                    fill={PALETTE[i % PALETTE.length]}
                    opacity={selectedPage && entry.url !== selectedPage ? 0.35 : 1}
                    onClick={() => onSelectPage(entry.url)}
                  />
                ))}
              </Bar>
            </BarChart>
          ) : (
            <LineChart data={data} margin={{ top: 10, bottom: 10, left: 0, right: 0 }}>
              <CartesianGrid stroke="hsl(240 3.7% 18%)" strokeDasharray="3 3" strokeOpacity={0.5} />
              <XAxis
                dataKey="url"
                tick={AXIS_STYLE}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: string) => v.length > 20 ? v.slice(0, 20) + "…" : v}
              />
              <YAxis tick={AXIS_STYLE} tickLine={false} axisLine={false} />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                formatter={(value: TooltipValueType | undefined) => [Number(value ?? 0).toLocaleString(), "Views"]}
                labelFormatter={(label) => label}
              />
              <Line
                type="monotone"
                dataKey="viewCount"
                stroke="#60a5fa"
                strokeWidth={2}
                dot={{ r: 4, cursor: "pointer", onClick: (props) => onSelectPage((props as { payload?: { url?: string } }).payload?.url ?? "") }}
                activeDot={{ r: 6 }}
              />
            </LineChart>
          )}
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
