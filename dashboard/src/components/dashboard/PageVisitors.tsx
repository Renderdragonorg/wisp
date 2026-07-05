import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";
import { X } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";

export function PageVisitors({
  url,
  startDate,
  endDate,
  onSelectMachine,
  onClose,
}: {
  url: string;
  startDate: string;
  endDate: string;
  onSelectMachine: (machineId: string) => void;
  onClose: () => void;
}) {
  const visitors = useQuery(api.dashboard.getPageVisitors, { url, startDate, endDate });

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-start justify-between">
          <div className="min-w-0 flex-1">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-widest mb-1">
              Page Visitors
            </CardTitle>
            <p className="text-xs font-mono text-foreground break-all">{url}</p>
            {visitors && (
              <p className="text-xs text-muted-foreground mt-0.5">{visitors.length} machine{visitors.length !== 1 ? "s" : ""}</p>
            )}
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="h-7 w-7 ml-2 flex-shrink-0">
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        {!visitors && (
          <p className="text-sm text-muted-foreground">Loading visitors…</p>
        )}
        {visitors && visitors.length === 0 && (
          <p className="text-sm text-muted-foreground">No visitors for this page in the selected range.</p>
        )}
        {visitors && visitors.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="text-xs">Machine</TableHead>
                <TableHead className="text-xs">Visits</TableHead>
                <TableHead className="text-xs">Country</TableHead>
                <TableHead className="text-xs">Platform</TableHead>
                <TableHead className="text-xs">First visit</TableHead>
                <TableHead className="text-xs">Last visit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visitors.map((v) => (
                <TableRow
                  key={v.machineId}
                  className="border-border cursor-pointer"
                  onClick={() => onSelectMachine(v.machineId)}
                >
                  <TableCell className="font-mono text-xs text-foreground">
                    {v.machineId.slice(0, 16)}…
                  </TableCell>
                  <TableCell className="text-xs text-foreground">{v.visitCount}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{v.country ?? "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{v.platform ?? "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(v.firstVisitedAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(v.lastVisitedAt).toLocaleDateString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
