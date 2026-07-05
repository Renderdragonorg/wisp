import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";
import { Separator } from "../ui/separator";
import { X } from "lucide-react";

function fmt(ms: number) {
  return new Date(ms).toLocaleString();
}
function dur(ms?: number) {
  if (!ms) return "—";
  const m = Math.floor(ms / 60000);
  const s = Math.round((ms % 60000) / 1000);
  return `${m}m ${s}s`;
}
function shortenUA(ua: string): string {
  if (ua.includes("Chrome/")) return "Chrome";
  if (ua.includes("Firefox/")) return "Firefox";
  if (ua.includes("Safari/") && !ua.includes("Chrome")) return "Safari";
  if (ua.includes("Edg/")) return "Edge";
  if (ua.includes("OPR/") || ua.includes("Opera")) return "Opera";
  const match = ua.match(/(\S+)\/\d+/);
  return match ? match[1] : ua.slice(0, 30);
}

function StatItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-muted/30 rounded-md p-3">
      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-widest mb-1">{label}</p>
      <p className="text-sm text-foreground break-all font-medium">{value}</p>
    </div>
  );
}

export function MachineView({
  machineId,
  onClose,
}: {
  machineId: string;
  onClose: () => void;
}) {
  const data = useQuery(api.dashboard.getMachineStats, { machineId });

  if (data === undefined)
    return (
      <Card className="bg-card border-border">
        <CardContent className="p-4">
          <p className="text-sm text-muted-foreground">Loading machine…</p>
        </CardContent>
      </Card>
    );

  if (data === null)
    return (
      <Card className="bg-card border-border">
        <CardContent className="p-4">
          <p className="text-sm text-muted-foreground">Machine not found.</p>
        </CardContent>
      </Card>
    );

  const { machine, stats, topErrors, topPages, lastSession } = data;

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-3 pt-4 px-4">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-widest mb-1">
              Machine
            </CardTitle>
            <p className="text-sm font-mono text-foreground break-all">{machine.id}</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="h-7 w-7">
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="px-4 pb-6 space-y-6">
        {/* Visit info */}
        <div className="grid grid-cols-3 gap-3">
          <StatItem label="First seen" value={fmt(machine.firstSeenAt)} />
          <StatItem label="Last seen" value={fmt(machine.lastSeenAt)} />
          <StatItem label="Visit count" value={String(machine.visitCount)} />
        </div>

        <Separator className="border-border" />

        {/* Stats */}
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-widest mb-3">Statistics</p>
          <div className="grid grid-cols-3 gap-3">
            <StatItem label="Sessions" value={String(stats.totalSessions)} />
            <StatItem label="Events" value={String(stats.totalEvents)} />
            <StatItem label="Errors" value={String(stats.totalErrors)} />
            <StatItem label="Returning sessions" value={String(stats.returningSessions)} />
            <StatItem label="Return rate" value={`${stats.returningRate}%`} />
            <StatItem label="Avg session" value={dur(stats.avgSessionDurationMs)} />
          </div>
        </div>

        <Separator className="border-border" />

        {/* Device & location */}
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-widest mb-3">Device & Location</p>
          <div className="grid grid-cols-2 gap-3">
            <StatItem label="Browser" value={machine.userAgent ? shortenUA(machine.userAgent) : "—"} />
            <StatItem label="Platform" value={machine.platform ?? "—"} />
            <StatItem label="Screen" value={machine.screen ?? "—"} />
            <StatItem label="IP" value={machine.ip ?? "—"} />
            <StatItem label="Country" value={machine.country ?? "—"} />
            <StatItem label="Region" value={machine.region ?? "—"} />
            <StatItem label="City" value={machine.city ?? "—"} />
            <StatItem label="Referrer" value={machine.referrer ?? "—"} />
          </div>
        </div>

        {topErrors.length > 0 && (
          <>
            <Separator className="border-border" />
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-widest mb-3">Top Errors</p>
              <div className="space-y-1">
                {topErrors.map((e) => (
                  <div key={e.name} className="flex justify-between items-center py-1.5 border-b border-border last:border-0">
                    <span className="text-xs text-destructive font-mono">{e.name}</span>
                    <span className="text-xs font-semibold text-foreground">{e.count}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {topPages.length > 0 && (
          <>
            <Separator className="border-border" />
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-widest mb-3">Top Pages</p>
              <div className="space-y-1">
                {topPages.map((p) => (
                  <div key={p.url} className="flex justify-between items-center py-1.5 border-b border-border last:border-0 gap-4">
                    <span className="text-xs text-muted-foreground break-all min-w-0">{p.url}</span>
                    <span className="text-xs font-semibold text-foreground flex-shrink-0">{p.count}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        <Separator className="border-border" />

        {/* Last session */}
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-widest mb-3">Last Session</p>
          <div className="grid grid-cols-2 gap-3">
            <StatItem label="Session ID" value={lastSession.id} />
            <StatItem label="Started" value={fmt(lastSession.startedAt)} />
            <StatItem label="Duration" value={dur(lastSession.durationMs ?? undefined)} />
            <StatItem label="Entry URL" value={lastSession.entryUrl ?? "—"} />
            <StatItem label="Exit URL" value={lastSession.exitUrl ?? "—"} />
            <StatItem label="Errors" value={String(lastSession.errorCount)} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
