import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { PieChart, Pie, Tooltip, ResponsiveContainer, Cell, Legend } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";

const PALETTE = [
  "#60a5fa", "#34d399", "#a78bfa", "#fbbf24", "#f87171",
  "#f472b6", "#2dd4bf", "#fb923c", "#818cf8", "#a3e635"
];

const TOOLTIP_STYLE = {
  background: "hsl(240 10% 3.9%)",
  border: "1px solid hsl(240 3.7% 15.9%)",
  borderRadius: "6px",
  fontSize: "12px",
  boxShadow: "none",
};

export function DeviceCharts({
  startDate,
  endDate,
}: {
  startDate: string;
  endDate: string;
}) {
  const browsers = useQuery(api.dashboard.getTopBrowsers, { startDate, endDate });
  const platforms = useQuery(api.dashboard.getTopPlatforms, { startDate, endDate });

  return (
    <div className="chart-grid">
      {/* Browsers Chart */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-widest">
            Top Browsers
          </CardTitle>
        </CardHeader>
        <CardContent className="px-2 pb-4">
          {!browsers ? (
            <div className="h-[200px] flex items-center justify-center text-sm text-muted-foreground">
              Loading...
            </div>
          ) : browsers.length === 0 ? (
            <div className="h-[200px] flex items-center justify-center text-sm text-muted-foreground">
              No data
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart margin={{ top: 10, bottom: 10, left: 0, right: 0 }}>
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Pie
                  data={browsers}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={80}
                  paddingAngle={2}
                >
                  {browsers.map((_, i) => (
                    <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                  ))}
                </Pie>
                <Legend 
                  layout="vertical" 
                  verticalAlign="middle" 
                  align="right"
                  wrapperStyle={{ fontSize: '11px', color: 'hsl(240 5% 64.9%)' }}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Platforms Chart */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-widest">
            Top Platforms
          </CardTitle>
        </CardHeader>
        <CardContent className="px-2 pb-4">
          {!platforms ? (
            <div className="h-[200px] flex items-center justify-center text-sm text-muted-foreground">
              Loading...
            </div>
          ) : platforms.length === 0 ? (
            <div className="h-[200px] flex items-center justify-center text-sm text-muted-foreground">
              No data
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart margin={{ top: 10, bottom: 10, left: 0, right: 0 }}>
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Pie
                  data={platforms}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={80}
                  paddingAngle={2}
                >
                  {platforms.map((_, i) => (
                    <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                  ))}
                </Pie>
                <Legend 
                  layout="vertical" 
                  verticalAlign="middle" 
                  align="right"
                  wrapperStyle={{ fontSize: '11px', color: 'hsl(240 5% 64.9%)' }}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
