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
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function Health() {
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchHealth()
      .then(setHealth)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-muted-foreground">Loading...</div>;
  if (!health) return <div className="text-destructive">Failed to load health info</div>;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">System Health</h1>
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
            <CardTitle className="text-sm text-muted-foreground">Slack</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant={health.slackConnected ? "default" : "destructive"}>
              {health.slackConnected ? "Connected" : "Disconnected"}
            </Badge>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Agents</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-bold">{health.agentCount}</CardContent>
        </Card>
      </div>
    </div>
  );
}
