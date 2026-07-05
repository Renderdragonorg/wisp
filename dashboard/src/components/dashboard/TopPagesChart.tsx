import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";

const PALETTE = [
  "#60a5fa",  // blue-400
  "#34d399",  // emerald-400
  "#a78bfa",  // violet-400
  "#fbbf24",  // amber-400
  "#f87171",  // red-400
  "#f472b6",  // pink-400
  "#2dd4bf",  // teal-400
  "#fb923c",  // orange-400
  "#818cf8",  // indigo-400
  "#a3e635",  // lime-400
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

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-widest">
            Top Pages
          </CardTitle>
          {selectedPage && (
            <button
              onClick={() => onSelectPage(null)}
              className="text-xs text-muted-foreground hover:text-foreground underline"
            >
              clear selection
            </button>
          )}
        </div>
        {selectedPage && (
          <p className="text-xs text-muted-foreground mt-1 font-mono break-all">{selectedPage}</p>
        )}
      </CardHeader>
      <CardContent className="px-2 pb-4">
        <ResponsiveContainer width="100%" height={Math.max(200, data.length * 36 + 20)}>
          <BarChart data={data} layout="vertical" margin={{ left: 8, right: 8, top: 0, bottom: 0 }}>
            <XAxis type="number" tick={AXIS_STYLE} tickLine={false} axisLine={false} />
            <YAxis
              type="category"
              dataKey="url"
              width={260}
              tick={AXIS_STYLE}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: string) => {
                try {
                  const p = new URL(v).pathname;
                  return p.length > 34 ? p.slice(0, 34) + "…" : p;
                } catch {
                  return v.slice(0, 34);
                }
              }}
            />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              cursor={{ fill: "hsl(240 3.7% 15.9%)" }}
              formatter={(value: number, _name: string, props: { payload: { url: string } }) => [
                value,
                props.payload.url,
              ]}
            />
            <Bar
              dataKey="viewCount"
              cursor="pointer"
              radius={[0, 2, 2, 0]}
              onClick={(entry) => onSelectPage(entry.url as string)}
            >
              {data.map((entry, i) => (
                <Cell
                  key={i}
                  fill={PALETTE[i % PALETTE.length]}
                  opacity={selectedPage && entry.url !== selectedPage ? 0.35 : 1}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
