import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { type Agent, fetchAgents } from "@/lib/api";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PlusCircle } from "lucide-react";

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

export function AgentList() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    fetchAgents()
      .then(setAgents)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-muted-foreground">Loading...</div>;

  const activeCount = agents.filter((a) => a.enabled).length;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Agents</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {activeCount} active / {agents.length} total
          </p>
        </div>
        <Button onClick={() => navigate("/agents/new")}>
          <PlusCircle className="h-4 w-4 mr-2" />
          Create Agent
        </Button>
      </div>

      {agents.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p className="text-lg mb-2">No agents configured</p>
          <p className="text-sm">Create your first agent to get started.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {agents.map((agent) => (
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
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">
                    {agent.displayName}
                  </CardTitle>
                  <div className="flex items-center gap-1.5">
                    {!agent.enabled && (
                      <Badge variant="outline" className="text-xs">
                        disabled
                      </Badge>
                    )}
                    <Badge
                      variant={statusVariant[agent.status] ?? "secondary"}
                    >
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
                  <span>Ch: {Object.keys(agent.channels ?? {}).length}</span>
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
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
