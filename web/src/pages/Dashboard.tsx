import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  type Agent,
  type SessionListItem,
  fetchAgents,
  fetchHealth,
  fetchAllSessions,
  type HealthInfo,
} from "@/lib/api";
import { useEventSource, type SSEMessage } from "@/hooks/useEventSource";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  Bot,
  Radio,
  Activity,
  Clock,
  ArrowRight,
  MessageSquare,
  Plug,
} from "lucide-react";

/* ── helpers ──────────────────────────────────────────────── */

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatRelativeTime(dateStr: string): string {
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
  return `${Math.floor(days / 30)}mo ago`;
}

const statusDotColor: Record<string, string> = {
  active: "bg-green-500",
  archived: "bg-gray-400",
};

/* ── component ────────────────────────────────────────────── */

export function Dashboard() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    Promise.all([
      fetchAgents().then(setAgents),
      fetchHealth().then(setHealth).catch(() => null),
      fetchAllSessions().then(setSessions).catch(() => []),
    ])
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const handleSSE = useCallback((event: SSEMessage) => {
    const { type, data } = event;

    if (type === "agent:status") {
      const agentId = data.agentId as string;
      const status = data.status as string;
      setAgents((prev) =>
        prev.map((a) =>
          a.id === agentId ? { ...a, status: status as Agent["status"] } : a
        )
      );
    }

    if (type === "session:start") {
      toast.info(`Session started: ${data.agentId}`);
    }

    if (type === "session:end") {
      toast.info(`Session ended: ${data.agentId}`);
    }

    if (type === "error") {
      toast.error(`Error: ${data.error ?? data.message ?? "Unknown error"}`);
    }
  }, []);

  useEventSource({
    url: "/api/events",
    onMessage: handleSSE,
  });

  if (loading) return <div className="text-muted-foreground">Loading...</div>;

  const activeAgents = agents.filter((a) => a.enabled);
  const runningAgents = agents.filter((a) => a.status === "running");
  const totalCron = agents.reduce((sum, a) => sum + (a.cron?.length ?? 0), 0);

  // Recent sessions: sorted newest first, limit 8
  const recentSessions = [...sessions]
    .sort(
      (a, b) =>
        new Date(b.lastActivityAt).getTime() -
        new Date(a.lastActivityAt).getTime()
    )
    .slice(0, 8);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Overview</h1>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate("/sessions")}
          >
            Sessions
            <ArrowRight className="ml-1 h-3.5 w-3.5" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate("/agents")}
          >
            Agents
            <ArrowRight className="ml-1 h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-8">
        <Card
          className="cursor-pointer hover:border-primary/50 transition-colors"
          onClick={() => navigate("/agents")}
        >
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Agents
            </CardTitle>
            <Bot className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{agents.length}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {activeAgents.length} active
            </p>
          </CardContent>
        </Card>

        <Card
          className="cursor-pointer hover:border-primary/50 transition-colors"
          onClick={() => navigate("/sessions")}
        >
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Running Now
            </CardTitle>
            <Radio className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{runningAgents.length}</div>
            <p className="text-xs text-muted-foreground mt-1">
              active sessions
            </p>
          </CardContent>
        </Card>

        <Card
          className="cursor-pointer hover:border-primary/50 transition-colors"
          onClick={() => navigate("/cron")}
        >
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Cron Jobs
            </CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalCron}</div>
            <p className="text-xs text-muted-foreground mt-1">scheduled</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              System Health
            </CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <Badge
                variant={health?.status === "ok" ? "default" : "destructive"}
              >
                {health?.status === "ok" ? "Healthy" : "Error"}
              </Badge>
            </div>
            <div className="flex items-center gap-3 mt-2">
              {health?.uptimeSec != null && (
                <span className="text-xs text-muted-foreground">
                  Up {formatUptime(health.uptimeSec)}
                </span>
              )}
              <span className="text-xs flex items-center gap-1">
                <Plug className="h-3 w-3" />
                <span
                  className={
                    health?.slackConnected
                      ? "text-green-500"
                      : "text-muted-foreground"
                  }
                >
                  Slack {health?.slackConnected ? "✓" : "✗"}
                </span>
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Two-column: Recent Activity + Agent Status */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Recent Activity (2/3) */}
        <div className="lg:col-span-2">
          <h2 className="text-lg font-semibold mb-3">Recent Activity</h2>
          {recentSessions.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                <MessageSquare className="h-8 w-8 text-muted-foreground/50 mb-2" />
                <p className="text-sm text-muted-foreground">
                  No recent sessions
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="divide-y divide-border">
                  {recentSessions.map((session) => (
                    <div
                      key={`${session.agentId}-${session.sessionId}`}
                      className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors"
                      role="button"
                      tabIndex={0}
                      onClick={() =>
                        navigate(
                          `/sessions/${encodeURIComponent(session.agentId)}/${encodeURIComponent(session.sessionId)}`
                        )
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          navigate(
                            `/sessions/${encodeURIComponent(session.agentId)}/${encodeURIComponent(session.sessionId)}`
                          );
                        }
                      }}
                    >
                      <div
                        className={`h-2 w-2 rounded-full shrink-0 ${statusDotColor[session.status] ?? "bg-gray-400"}`}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium truncate">
                            {session.agentId}
                          </span>
                          <span className="text-xs text-muted-foreground font-mono">
                            {session.sessionId.slice(0, 8)}…
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge
                          variant={
                            session.status === "active"
                              ? "default"
                              : "secondary"
                          }
                          className="text-xs"
                        >
                          {session.status}
                        </Badge>
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          {formatRelativeTime(session.lastActivityAt)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Agent Status (1/3) */}
        {agents.length > 0 && (
          <div>
            <h2 className="text-lg font-semibold mb-3">Agent Status</h2>
            <Card>
              <CardContent className="p-0">
                <div className="divide-y divide-border">
                  {agents.map((agent) => (
                    <div
                      key={agent.id}
                      className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors"
                      role="button"
                      tabIndex={0}
                      onClick={() => navigate(`/agents/${agent.id}`)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          navigate(`/agents/${agent.id}`);
                        }
                      }}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className={`h-2 w-2 rounded-full shrink-0 ${
                            agent.status === "running"
                              ? "bg-green-500"
                              : agent.status === "error"
                                ? "bg-red-500"
                                : agent.enabled
                                  ? "bg-yellow-500"
                                  : "bg-gray-500"
                          }`}
                        />
                        <span className="text-sm font-medium truncate">
                          {agent.displayName}
                        </span>
                      </div>
                      <span className="text-xs text-muted-foreground font-mono shrink-0">
                        {agent.status}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
