import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";
import { X } from "lucide-react";

export function ErrorDetails({
  errorName,
  sinceMs,
  onClose,
}: {
  errorName: string;
  sinceMs: number;
  onClose: () => void;
}) {
  const errors = useQuery(api.dashboard.getErrorDetails, {
    errorName,
    since: sinceMs,
    limit: 50,
  });

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-start justify-between">
          <div className="min-w-0 flex-1">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-widest mb-1">
              Error Detail
            </CardTitle>
            <p className="text-sm font-mono text-foreground break-all">{errorName}</p>
            {errors && (
              <p className="text-xs text-muted-foreground mt-0.5">{errors.length} occurrence{errors.length !== 1 ? "s" : ""}</p>
            )}
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="h-7 w-7 ml-2 flex-shrink-0">
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        {!errors && (
          <p className="text-sm text-muted-foreground">Loading error details…</p>
        )}
        {errors && errors.length === 0 && (
          <p className="text-sm text-muted-foreground">No recent occurrences of this error.</p>
        )}
        {errors && errors.length > 0 && (
          <div className="space-y-2 max-h-[480px] overflow-y-auto">
            {errors.map((err) => (
              <div
                key={err.id}
                className="rounded-md border border-border bg-muted/30 p-3"
              >
                <p className="text-xs font-mono text-destructive font-medium mb-2">{err.name}</p>
                <div className="grid grid-cols-[72px_1fr] gap-x-3 gap-y-1 text-xs">
                  <span className="text-muted-foreground">Time</span>
                  <span className="text-foreground">{new Date(err.timestamp).toLocaleString()}</span>
                  <span className="text-muted-foreground">URL</span>
                  <span className="text-foreground break-all">{err.url}</span>
                  <span className="text-muted-foreground">Session</span>
                  <span className="font-mono text-foreground">{err.sessionId}</span>
                  <span className="text-muted-foreground">Machine</span>
                  <span className="font-mono text-foreground">{err.machineId}</span>
                </div>
                {err.payload && (
                  <div className="mt-2">
                    <p className="text-xs text-muted-foreground mb-1">Console output</p>
                    <pre className="text-xs font-mono bg-background text-foreground p-2 rounded border border-border overflow-auto max-h-40 whitespace-pre-wrap">
                      {formatPayload(err.payload)}
                    </pre>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function formatPayload(payload: unknown): string {
  if (typeof payload === "string") return payload;
  if (payload instanceof Error) return payload.stack || payload.message;
  return JSON.stringify(payload, null, 2);
}
