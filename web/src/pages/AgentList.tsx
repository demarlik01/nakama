import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  type Agent,
  type SessionListItem,
  fetchAgents,
  fetchAllSessions,
} from "@/lib/api";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  PlusCircle,
  Package,
  MessageSquare,
  Clock,
  Radio,
  Timer,
  Heart,
} from "lucide-react";

/* ── status badge styling ─────────────────────────────────── */

const statusVariant: Record<
  Agent["status"],
  "default" | "secondary" | "destructive" | "outline"
> = {
  running: "default",
  idle: "secondary",
  disabled: "outline",
  error: "destructive",
  disposed: "outline",
};

const statusDot: Record<Agent["status"], string> = {
  running: "bg-green-500",
  idle: "bg-gray-400",
  disabled: "bg-gray-400 opacity-50",
  error: "bg-red-500",
  disposed: "bg-gray-400 opacity-30",
};

/* ── relative-time helper ─────────────────────────────────── */

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 0) return "just now";
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

/* ── per-agent session stats ──────────────────────────────── */

interface AgentSessionStats {
  total: number;
  active: number;
  lastActivityAt: string | null;
}

function computeSessionStats(
  sessions: SessionListItem[]
): Record<string, AgentSessionStats> {
  const map: Record<string, AgentSessionStats> = {};
  for (const s of sessions) {
    if (!map[s.agentId]) {
      map[s.agentId] = { total: 0, active: 0, lastActivityAt: null };
    }
    const entry = map[s.agentId];
    entry.total++;
    if (s.status === "active") entry.active++;
    if (
      !entry.lastActivityAt ||
      new Date(s.lastActivityAt) > new Date(entry.lastActivityAt)
    ) {
      entry.lastActivityAt = s.lastActivityAt;
    }
  }
  return map;
}

/* ── component ────────────────────────────────────────────── */

export function AgentList() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    Promise.all([fetchAgents(), fetchAllSessions().catch(() => [])])
      .then(([a, s]) => {
        setAgents(a);
        setSessions(s);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const statsMap = useMemo(() => computeSessionStats(sessions), [sessions]);

  if (loading)
    return (
      <div className="text-muted-foreground p-8 text-center">Loading...</div>
    );

  const activeCount = agents.filter((a) => a.enabled).length;
  const runningCount = agents.filter((a) => a.status === "running").length;

  return (
    <div>
      {/* ── header ──────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold">Agents</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {runningCount > 0 && (
              <span className="text-green-500 font-medium">
                {runningCount} running
              </span>
            )}
            {runningCount > 0 && " · "}
            {activeCount} enabled / {agents.length} total
          </p>
        </div>
        <Button onClick={() => navigate("/agents/new")}>
          <PlusCircle className="h-4 w-4 mr-2" />
          Create Agent
        </Button>
      </div>

      {/* ── empty state ─────────────────────────────────────── */}
      {agents.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p className="text-lg mb-2">No agents configured</p>
          <p className="text-sm">Create your first agent to get started.</p>
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2">
          {agents.map((agent) => {
            const stats = statsMap[agent.id];
            const channelKeys = Object.keys(agent.channels ?? {});

            return (
              <Card
                key={agent.id}
                role="button"
                tabIndex={0}
                className={`cursor-pointer hover:border-primary/50 transition-colors ${
                  !agent.enabled ? "opacity-50" : ""
                }`}
                onClick={() => navigate(`/agents/${agent.id}`)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    navigate(`/agents/${agent.id}`);
                  }
                }}
              >
                {/* ── card header ───────────────────────────── */}
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={`inline-block h-2.5 w-2.5 rounded-full shrink-0 ${statusDot[agent.status]}`}
                      />
                      <CardTitle className="text-base truncate">
                        {agent.displayName}
                      </CardTitle>
                      <span className="text-xs text-muted-foreground font-mono shrink-0">
                        {agent.id}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {!agent.enabled && (
                        <Badge variant="outline" className="text-xs">
                          disabled
                        </Badge>
                      )}
                      <Badge
                        variant={statusVariant[agent.status] ?? "secondary"}
                        className="text-xs"
                      >
                        {agent.status}
                      </Badge>
                    </div>
                  </div>
                  <CardDescription className="line-clamp-2 mt-1">
                    {agent.description || "No description"}
                  </CardDescription>
                </CardHeader>

                {/* ── card body ──────────────────────────────── */}
                <CardContent className="text-sm text-muted-foreground space-y-2.5 pt-0">
                  {/* model */}
                  <div className="flex items-center gap-2">
                    <Package className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
                    <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded truncate">
                      {agent.model || "—"}
                    </span>
                  </div>

                  {/* sessions */}
                  <div className="flex items-center gap-2">
                    <MessageSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
                    {stats ? (
                      <span className="text-xs">
                        {stats.active > 0 && (
                          <span className="text-green-500 font-medium">
                            {stats.active} active
                          </span>
                        )}
                        {stats.active > 0 && " / "}
                        {stats.total} session{stats.total !== 1 ? "s" : ""}
                      </span>
                    ) : (
                      <span className="text-xs">No sessions</span>
                    )}
                  </div>

                  {/* last activity */}
                  <div className="flex items-center gap-2">
                    <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
                    <span className="text-xs">
                      {stats?.lastActivityAt
                        ? `Last active ${relativeTime(stats.lastActivityAt)}`
                        : "No activity"}
                    </span>
                  </div>

                  {/* channels */}
                  {channelKeys.length > 0 && (
                    <div className="flex items-center gap-2">
                      <Radio className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
                      <div className="flex flex-wrap gap-1">
                        {channelKeys.map((ch) => (
                          <Badge
                            key={ch}
                            variant="outline"
                            className="text-[10px] px-1.5 py-0"
                          >
                            {ch}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* cron + heartbeat row */}
                  {((agent.cron && agent.cron.length > 0) ||
                    agent.heartbeat?.enabled) && (
                    <div className="flex items-center gap-3 pt-0.5">
                      {agent.cron && agent.cron.length > 0 && (
                        <div className="flex items-center gap-1.5">
                          <Timer className="h-3.5 w-3.5 text-blue-400" />
                          <span className="text-xs text-blue-400">
                            {agent.cron.length} cron
                          </span>
                        </div>
                      )}
                      {agent.heartbeat?.enabled && (
                        <div className="flex items-center gap-1.5">
                          <Heart className="h-3.5 w-3.5 text-green-500" />
                          <span className="text-xs text-green-500">
                            {agent.heartbeat.intervalMin}m
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
