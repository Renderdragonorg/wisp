import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";

// Vivid palette – cycles across bars
const PALETTE = [
  "#f87171",  // red-400
  "#fb923c",  // orange-400
  "#facc15",  // yellow-400
  "#a78bfa",  // violet-400
  "#60a5fa",  // blue-400
  "#34d399",  // emerald-400
  "#f472b6",  // pink-400
  "#2dd4bf",  // teal-400
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

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2 pt-4 px-4">
        <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-widest">
          Error Breakdown
        </CardTitle>
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
        <ResponsiveContainer width="100%" height={Math.max(200, data.length * 36)}>
          <BarChart data={data} layout="vertical" margin={{ left: 8, right: 8, top: 0, bottom: 0 }}>
            <XAxis type="number" tick={AXIS_STYLE} tickLine={false} axisLine={false} />
            <YAxis
              type="category"
              dataKey="name"
              width={160}
              tick={AXIS_STYLE}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: string) => (v.length > 22 ? v.slice(0, 22) + "…" : v)}
            />
            <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "hsl(240 3.7% 15.9%)" }} />
            <Bar
              dataKey="value"
              cursor="pointer"
              radius={[0, 2, 2, 0]}
              onClick={(entry) => onSelectError(entry.name as string)}
            >
              {data.map((entry, i) => (
                <Cell
                  key={i}
                  fill={
                    entry.name === selectedError
                      ? "#f8fafc"          // near-white highlight when selected
                      : PALETTE[i % PALETTE.length]
                  }
                  opacity={selectedError && entry.name !== selectedError ? 0.4 : 1}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
