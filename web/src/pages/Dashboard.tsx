import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { type Agent, fetchAgents } from "@/lib/api";
import { useEventSource, type SSEMessage } from "@/hooks/useEventSource";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

const statusVariant: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  running: "default",
  idle: "secondary",
  disabled: "outline",
  error: "destructive",
};

export function Dashboard() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    fetchAgents()
      .then(setAgents)
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

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Agents</h1>
        <span className="text-sm text-muted-foreground">
          {agents.filter((a) => a.enabled).length} active / {agents.length} total
        </span>
      </div>
      {agents.length === 0 ? (
        <p className="text-muted-foreground">No agents configured.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {agents.map((agent) => (
            <Card
              key={agent.id}
              className={`cursor-pointer hover:border-primary/50 transition-colors ${
                !agent.enabled ? "opacity-50" : ""
              }`}
              onClick={() => navigate(`/agents/${agent.id}`)}
            >
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{agent.displayName}</CardTitle>
                  <div className="flex items-center gap-1.5">
                    {!agent.enabled && (
                      <Badge variant="outline" className="text-xs">
                        disabled
                      </Badge>
                    )}
                    <Badge variant={statusVariant[agent.status] ?? "secondary"}>
                      {agent.status}
                    </Badge>
                  </div>
                </div>
                <CardDescription className="line-clamp-2">
                  {agent.description || "No description"}
                </CardDescription>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[11px] bg-muted px-1.5 py-0.5 rounded">
                    {agent.model}
                  </span>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  <span>Ch: {agent.slackChannels?.length ?? 0}</span>
                  <span>Users: {agent.slackUsers?.length ?? 0}</span>
                  {agent.heartbeat?.enabled && (
                    <span className="text-green-500">
                      ♥ {agent.heartbeat.intervalMin}m
                    </span>
                  )}
                  {agent.cron && agent.cron.length > 0 && (
                    <span className="text-blue-400">
                      ⏱ {agent.cron.length} cron
                    </span>
                  )}
                </div>
                {agent.limits?.dailyTokenLimit && (
                  <div className="text-[11px]">
                    Token limit: {(agent.limits.dailyTokenLimit / 1000).toFixed(0)}k/day
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
