import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { type Agent, fetchAgents, fetchHealth, type HealthInfo } from "@/lib/api";
import { useEventSource, type SSEMessage } from "@/hooks/useEventSource";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Bot, Radio, Activity, Clock } from "lucide-react";

export function Dashboard() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    Promise.all([
      fetchAgents().then(setAgents),
      fetchHealth().then(setHealth).catch(() => null),
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

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Overview</h1>

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

        <Card>
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

        <Card>
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
            <Badge
              variant={health?.status === "ok" ? "default" : "destructive"}
            >
              {health?.status === "ok" ? "Healthy" : "Error"}
            </Badge>
            {health?.uptimeSec != null && (
              <p className="text-xs text-muted-foreground mt-1">
                Uptime: {formatUptime(health.uptimeSec)}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Quick Agent Status */}
      {agents.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-3">Agent Status</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {agents.map((agent) => (
              <Card
                key={agent.id}
                className="cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => navigate(`/agents/${agent.id}`)}
              >
                <CardContent className="flex items-center justify-between py-3 px-4">
                  <div className="flex items-center gap-3">
                    <div
                      className={`h-2 w-2 rounded-full ${
                        agent.status === "running"
                          ? "bg-green-500"
                          : agent.status === "error"
                            ? "bg-red-500"
                            : agent.enabled
                              ? "bg-yellow-500"
                              : "bg-gray-500"
                      }`}
                    />
                    <span className="text-sm font-medium">
                      {agent.displayName}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground font-mono">
                    {agent.status}
                  </span>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
