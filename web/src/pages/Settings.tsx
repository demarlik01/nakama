import { useEffect, useState } from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Shield, Bell } from "lucide-react";

interface ConfigResponse {
  config: {
    api: {
      enabled: boolean;
      port: number;
      auth?: { username: string; password: string };
    };
    notifications?: {
      adminSlackUser?: string;
    };
    [key: string]: unknown;
  };
}

export function Settings() {
  const [config, setConfig] = useState<ConfigResponse["config"] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/config")
      .then((res) => res.json())
      .then((data: ConfigResponse) => setConfig(data.config))
      .catch((err) => setError(String(err)));
  }, []);

  if (error) {
    return <div className="text-destructive p-4">Failed to load config: {error}</div>;
  }

  if (!config) {
    return <div className="p-4 text-muted-foreground">Loading...</div>;
  }

  const authEnabled = !!config.api?.auth;
  const adminUser = config.notifications?.adminSlackUser;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted-foreground">System configuration overview</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Basic Auth
            </CardTitle>
            <CardDescription>
              API authentication via HTTP Basic Auth
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Status:</span>
              {authEnabled ? (
                <Badge variant="default" className="bg-green-600">Enabled</Badge>
              ) : (
                <Badge variant="secondary">Disabled</Badge>
              )}
            </div>
            {authEnabled && (
              <p className="text-xs text-muted-foreground mt-2">
                All API endpoints except /api/health require authentication.
              </p>
            )}
            {!authEnabled && (
              <p className="text-xs text-muted-foreground mt-2">
                Add <code className="bg-muted px-1 rounded">api.auth</code> to config.yaml to enable.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bell className="h-5 w-5" />
              Admin Notifications
            </CardTitle>
            <CardDescription>
              Slack DM alerts on agent errors
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Admin User:</span>
              {adminUser ? (
                <Badge variant="default" className="bg-green-600">{adminUser}</Badge>
              ) : (
                <Badge variant="secondary">Not configured</Badge>
              )}
            </div>
            {!adminUser && (
              <p className="text-xs text-muted-foreground mt-2">
                Add <code className="bg-muted px-1 rounded">notifications.adminSlackUser</code> to config.yaml.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
