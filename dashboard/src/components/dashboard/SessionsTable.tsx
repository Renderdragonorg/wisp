import { useState, useEffect } from "react";
import { usePaginatedQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Badge } from "../ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";
import { Search, ChevronDown, ChevronUp } from "lucide-react";

type SortBy = "startedAt" | "durationMs" | "eventCount" | "errorCount";

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

function formatDuration(ms?: number): string {
  if (!ms) return "—";
  const min = Math.floor(ms / 60000);
  const sec = Math.round((ms % 60000) / 1000);
  return `${min}m ${sec}s`;
}

export function SessionsTable({ onSelectMachine }: { onSelectMachine?: (id: string) => void }) {
  const [searchInput, setSearchInput] = useState("");
  const search = useDebouncedValue(searchInput, 300);
  const [sortBy, setSortBy] = useState<SortBy>("startedAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [onlyReturning, setOnlyReturning] = useState(false);
  const [onlyWithErrors, setOnlyWithErrors] = useState(false);

  const { results, status, loadMore } = usePaginatedQuery(
    api.dashboard.listSessions,
    { search: search || undefined, sortBy, sortDir, onlyReturning, onlyWithErrors },
    { initialNumItems: 25 }
  );

  const isSearching = search.trim().length > 0;

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-3 pt-4 px-4">
        <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-widest mb-3">
          Sessions
        </CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input
              type="text"
              placeholder="Search by URL…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="pl-8 h-8 text-xs w-56 bg-transparent"
            />
          </div>

          {!isSearching && (
            <>
              <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortBy)}>
                <SelectTrigger className="h-8 text-xs w-36 bg-transparent">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="startedAt">Start time</SelectItem>
                  <SelectItem value="durationMs">Duration</SelectItem>
                  <SelectItem value="eventCount">Event count</SelectItem>
                  <SelectItem value="errorCount">Error count</SelectItem>
                </SelectContent>
              </Select>

              <Button
                variant="outline"
                size="sm"
                onClick={() => setSortDir((d) => (d === "desc" ? "asc" : "desc"))}
                className="h-8 text-xs gap-1 bg-transparent"
              >
                {sortDir === "desc" ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronUp className="h-3 w-3" />
                )}
                {sortDir === "desc" ? "Desc" : "Asc"}
              </Button>
            </>
          )}

          <Button
            variant={onlyReturning ? "secondary" : "outline"}
            size="sm"
            onClick={() => setOnlyReturning((v) => !v)}
            className="h-8 text-xs bg-transparent"
          >
            Returning
          </Button>
          <Button
            variant={onlyWithErrors ? "secondary" : "outline"}
            size="sm"
            onClick={() => setOnlyWithErrors((v) => !v)}
            className="h-8 text-xs bg-transparent"
          >
            Has errors
          </Button>
        </div>
      </CardHeader>

      <CardContent className="px-4 pb-4">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="text-xs">Started</TableHead>
              <TableHead className="text-xs">Machine</TableHead>
              <TableHead className="text-xs">Entry URL</TableHead>
              <TableHead className="text-xs">Duration</TableHead>
              <TableHead className="text-xs">Events</TableHead>
              <TableHead className="text-xs">Errors</TableHead>
              <TableHead className="text-xs">Type</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {results.map((s) => (
              <TableRow key={s._id} className="border-border">
                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                  {new Date(s.startedAt).toLocaleString()}
                </TableCell>
                <TableCell className="text-xs font-mono">
                  {onSelectMachine ? (
                    <button
                      onClick={() => onSelectMachine(s.machineId)}
                      className="text-foreground hover:text-muted-foreground underline-offset-2 hover:underline"
                    >
                      {s.machineId.slice(0, 8)}…
                    </button>
                  ) : (
                    <span className="text-foreground">{s.machineId.slice(0, 8)}…</span>
                  )}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground max-w-[180px] truncate">
                  {s.entryUrl}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                  {formatDuration(s.durationMs)}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{s.eventCount}</TableCell>
                <TableCell className="text-xs">
                  {s.errorCount > 0 ? (
                    <span className="text-destructive font-medium">{s.errorCount}</span>
                  ) : (
                    <span className="text-muted-foreground">0</span>
                  )}
                </TableCell>
                <TableCell>
                  {s.isReturning ? (
                    <Badge variant="secondary" className="text-[10px] h-5 px-1.5">
                      Returning
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px] h-5 px-1.5 text-muted-foreground">
                      New
                    </Badge>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {results.length === 0 && status !== "LoadingFirstPage" && (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No sessions match these filters.
          </div>
        )}

        {status === "CanLoadMore" && (
          <div className="flex justify-center mt-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => loadMore(25)}
              className="text-xs bg-transparent"
            >
              Load more
            </Button>
          </div>
        )}
        {status === "LoadingMore" && (
          <div className="text-center text-sm text-muted-foreground mt-4 py-2">Loading…</div>
        )}
      </CardContent>
    </Card>
  );
}
