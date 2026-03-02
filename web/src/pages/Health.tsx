import { useEffect, useState } from "react";
import { type HealthInfo, fetchHealth } from "@/lib/api";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

function formatUptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function Health() {
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const load = () => {
    fetchHealth()
      .then((data) => {
        setHealth(data);
        setLastRefresh(new Date());
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, []);

  if (loading) return <div className="text-muted-foreground">Loading...</div>;
  if (!health) return <div className="text-destructive">Failed to load health info</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">System Health</h1>
        <div className="flex items-center gap-3">
          {lastRefresh && (
            <span className="text-xs text-muted-foreground">
              Updated {lastRefresh.toLocaleTimeString()}
            </span>
          )}
          <Badge
            variant={health.status === "ok" ? "default" : "destructive"}
            className={health.status === "ok" ? "bg-green-600" : ""}
          >
            {health.status === "ok" ? "● Healthy" : "● Unhealthy"}
          </Badge>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Uptime</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-bold">
            {formatUptime(health.uptimeSec)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Slack Connection</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant={health.slackConnected ? "default" : "destructive"}
                   className={health.slackConnected ? "bg-green-600" : ""}>
              {health.slackConnected ? "● Connected" : "● Disconnected"}
            </Badge>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Active Agents</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-bold">{health.agentCount}</CardContent>
        </Card>
      </div>
    </div>
  );
}
