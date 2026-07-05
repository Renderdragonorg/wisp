import { useState, useRef } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { StatCards } from "./components/dashboard/StatCards";
import { TrendChart } from "./components/dashboard/TrendChart";
import { DistributionChart } from "./components/dashboard/DistributionChart";
import { ErrorBreakdownChart } from "./components/dashboard/ErrorBreakdownChart";
import { ErrorDetails } from "./components/dashboard/ErrorDetails";
import { TopPagesChart } from "./components/dashboard/TopPagesChart";
import { PageVisitors } from "./components/dashboard/PageVisitors";
import { SessionsTable } from "./components/dashboard/SessionsTable";
import { MachineView } from "./components/dashboard/MachineView";
import { Input } from "./components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./components/ui/select";
import { Separator } from "./components/ui/separator";
import { Button } from "./components/ui/button";
import {
  LayoutDashboard,
  Activity,
  AlertTriangle,
  FileText,
  Users,
  Search,
  TrendingUp,
  Monitor,
} from "lucide-react";

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

type NavSection = "overview" | "trends" | "distribution" | "errors" | "pages" | "sessions";

const NAV_ITEMS: { id: NavSection; label: string; icon: React.ReactNode }[] = [
  { id: "overview",     label: "Overview",     icon: <LayoutDashboard className="h-4 w-4" /> },
  { id: "trends",       label: "Trends",       icon: <TrendingUp className="h-4 w-4" /> },
  { id: "distribution", label: "Distribution", icon: <Activity className="h-4 w-4" /> },
  { id: "errors",       label: "Errors",       icon: <AlertTriangle className="h-4 w-4" /> },
  { id: "pages",        label: "Pages",        icon: <FileText className="h-4 w-4" /> },
  { id: "sessions",     label: "Sessions",     icon: <Users className="h-4 w-4" /> },
];

export default function DashboardPage() {
  const [rangeDays, setRangeDays] = useState(30);
  const [selectedError, setSelectedError] = useState<string | null>(null);
  const [selectedPage, setSelectedPage] = useState<string | null>(null);
  const [selectedMachineId, setSelectedMachineId] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeSection, setActiveSection] = useState<NavSection>("overview");
  const searchRef = useRef<HTMLDivElement>(null);

  const suggestions = useQuery(
    api.dashboard.searchMachines,
    searchInput.length >= 3 ? { prefix: searchInput } : "skip"
  );

  const startDate = daysAgo(rangeDays);
  const endDate = daysAgo(0);
  const sinceMs = Date.now() - rangeDays * 24 * 60 * 60 * 1000;

  const handleSelectMachine = (id: string) => {
    setSelectedMachineId(id);
    setSearchInput("");
    setShowSuggestions(false);
  };

  if (selectedMachineId) {
    return (
      <div className="min-h-svh bg-background dark">
        <div className="max-w-5xl mx-auto px-6 py-8">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelectedMachineId(null)}
            className="mb-6 -ml-2 text-muted-foreground"
          >
            <Monitor className="h-4 w-4 mr-1.5" />
            Back to dashboard
          </Button>
          <MachineView machineId={selectedMachineId} onClose={() => setSelectedMachineId(null)} />
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-layout dark">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 rounded-md bg-foreground flex items-center justify-center flex-shrink-0">
              <Activity className="h-3.5 w-3.5 text-background" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground leading-none">Wisp</p>
              <p className="text-xs text-muted-foreground mt-0.5">Analytics</p>
            </div>
          </div>
        </div>

        <nav className="sidebar-nav">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest px-2.5 mb-2 mt-1">
            Navigation
          </p>
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              className={`sidebar-item ${activeSection === item.id ? "active" : ""}`}
              onClick={() => setActiveSection(item.id)}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </nav>

        <div className="px-3 mt-auto pt-4">
          <Separator className="mb-4" />
          <div className="px-2.5">
            <p className="text-[10px] text-muted-foreground">Range</p>
            <Select value={String(rangeDays)} onValueChange={(v) => setRangeDays(Number(v))}>
              <SelectTrigger className="mt-1.5 h-8 text-xs bg-transparent">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="90">Last 90 days</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="main-content">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-xl font-semibold text-foreground tracking-tight">
              {NAV_ITEMS.find(n => n.id === activeSection)?.label ?? "Dashboard"}
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {startDate} — {endDate}
            </p>
          </div>

          {/* Machine search */}
          <div ref={searchRef} className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input
              type="text"
              placeholder="Search machine…"
              value={searchInput}
              onChange={(e) => { setSearchInput(e.target.value); setShowSuggestions(true); }}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
              className="pl-8 h-8 text-xs w-48 bg-transparent"
            />
            {showSuggestions && suggestions && suggestions.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-popover border border-border rounded-md z-50 shadow-md overflow-hidden max-h-48 overflow-y-auto">
                {suggestions.map((s) => (
                  <button
                    key={s.id}
                    onMouseDown={() => handleSelectMachine(s.id)}
                    className="w-full text-left px-3 py-2 text-xs hover:bg-accent border-b border-border last:border-0"
                  >
                    <div className="font-mono text-foreground">{s.id.slice(0, 16)}…</div>
                    <div className="text-muted-foreground mt-0.5">
                      {s.platform ?? "—"} · {s.country ?? "—"} · {s.lastSeenAt ? new Date(s.lastSeenAt).toLocaleDateString() : "—"}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Overview: all charts ── */}
        {activeSection === "overview" && (
          <div className="space-y-8">
            <StatCards startDate={startDate} endDate={endDate} />

            <section>
              <SectionHeader title="Trends" />
              <TrendChart startDate={startDate} endDate={endDate} />
            </section>

            <section>
              <SectionHeader title="Distribution" />
              <DistributionChart startDate={startDate} endDate={endDate} />
            </section>

            <section>
              <SectionHeader title="Top Errors" />
              <ErrorBreakdownChart
                sinceMs={sinceMs}
                onSelectError={setSelectedError}
                selectedError={selectedError}
              />
              {selectedError && (
                <div className="mt-4">
                  <ErrorDetails
                    errorName={selectedError}
                    sinceMs={sinceMs}
                    onClose={() => setSelectedError(null)}
                  />
                </div>
              )}
            </section>

            <section>
              <SectionHeader title="Top Pages" />
              <TopPagesChart
                startDate={startDate}
                endDate={endDate}
                onSelectPage={setSelectedPage}
                selectedPage={selectedPage}
              />
              {selectedPage && (
                <div className="mt-4">
                  <PageVisitors
                    url={selectedPage}
                    startDate={startDate}
                    endDate={endDate}
                    onSelectMachine={handleSelectMachine}
                    onClose={() => setSelectedPage(null)}
                  />
                </div>
              )}
            </section>

            <section>
              <SectionHeader title="Sessions" />
              <SessionsTable onSelectMachine={handleSelectMachine} />
            </section>
          </div>
        )}

        {activeSection === "trends" && (
          <TrendChart startDate={startDate} endDate={endDate} />
        )}

        {activeSection === "distribution" && (
          <DistributionChart startDate={startDate} endDate={endDate} />
        )}

        {activeSection === "errors" && (
          <div className="space-y-4">
            <ErrorBreakdownChart
              sinceMs={sinceMs}
              onSelectError={setSelectedError}
              selectedError={selectedError}
            />
            {selectedError && (
              <ErrorDetails
                errorName={selectedError}
                sinceMs={sinceMs}
                onClose={() => setSelectedError(null)}
              />
            )}
          </div>
        )}

        {activeSection === "pages" && (
          <div className="space-y-4">
            <TopPagesChart
              startDate={startDate}
              endDate={endDate}
              onSelectPage={setSelectedPage}
              selectedPage={selectedPage}
            />
            {selectedPage && (
              <PageVisitors
                url={selectedPage}
                startDate={startDate}
                endDate={endDate}
                onSelectMachine={handleSelectMachine}
                onClose={() => setSelectedPage(null)}
              />
            )}
          </div>
        )}

        {activeSection === "sessions" && (
          <SessionsTable onSelectMachine={handleSelectMachine} />
        )}
      </main>
    </div>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-widest whitespace-nowrap">
        {title}
      </h2>
      <Separator className="flex-1" />
    </div>
  );
}
