import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  type Agent,
  type DailyUsage,
  fetchAgent,
  updateAgent,
  deleteAgent,
  fetchAgentUsage,
  fetchAgentsMd,
  updateAgentsMd,
} from "@/lib/api";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { useEventSource, type SSEMessage } from "@/hooks/useEventSource";

export function AgentDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [form, setForm] = useState<Partial<Agent>>({});
  const [mdContent, setMdContent] = useState("");
  const [usage, setUsage] = useState<DailyUsage[]>([]);
  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState<Array<{ message: string; timestamp: string; level?: string }>>([]);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [a, md, u] = await Promise.all([
        fetchAgent(id),
        fetchAgentsMd(id).catch(() => ({ content: "" })),
        fetchAgentUsage(id).catch(() => ({ daily: [] })),
      ]);
      setAgent(a);
      setForm(a);
      setMdContent(md.content);
      setUsage(u.daily);
    } catch (e) {
      console.error(e);
      toast.error("Failed to load agent");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const handleSSE = (event: SSEMessage) => {
    if (event.type === "log" && (event.data.agentId === id || !event.data.agentId)) {
      setLogs((prev) => [
        ...prev.slice(-499),
        {
          message: (event.data.message as string) ?? JSON.stringify(event.data),
          timestamp: (event.data.timestamp as string) ?? new Date().toISOString(),
          level: event.data.level as string | undefined,
        },
      ]);
    }
    if (event.type === "agent:status" && event.data.agentId === id) {
      setAgent((prev) => prev ? { ...prev, status: event.data.status as Agent["status"] } : prev);
    }
  };

  useEventSource({
    url: "/api/events?type=logs",
    onMessage: handleSSE,
    enabled: !!id,
  });

  const handleSaveConfig = async () => {
    if (!id) return;
    try {
      const updated = await updateAgent(id, form);
      setAgent(updated);
      toast.success("Config saved");
    } catch {
      toast.error("Failed to save config");
    }
  };

  const handleSaveMd = async () => {
    if (!id) return;
    try {
      await updateAgentsMd(id, mdContent);
      toast.success("AGENTS.md saved");
    } catch {
      toast.error("Failed to save AGENTS.md");
    }
  };

  const handleToggle = async () => {
    if (!id || !agent) return;
    try {
      const updated = await updateAgent(id, { enabled: !agent.enabled });
      setAgent(updated);
      toast.success(updated.enabled ? "Agent enabled" : "Agent disabled");
    } catch {
      toast.error("Failed to toggle agent");
    }
  };

  const handleDelete = async () => {
    if (!id) return;
    try {
      await deleteAgent(id);
      toast.success("Agent deleted");
      navigate("/");
    } catch {
      toast.error("Failed to delete agent");
    }
  };

  if (loading) return <div className="text-muted-foreground">Loading...</div>;
  if (!agent) return <div className="text-destructive">Agent not found</div>;

  const maxTokens = Math.max(...usage.map((d) => d.inputTokens + d.outputTokens), 1);

  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-3 mb-6">
        <h1 className="text-2xl font-bold">{agent.displayName}</h1>
        <Badge variant={agent.enabled ? "default" : "outline"}>
          {agent.status}
        </Badge>
      </div>

      <Tabs defaultValue="config">
        <TabsList>
          <TabsTrigger value="config">Config</TabsTrigger>
          <TabsTrigger value="agents-md">AGENTS.md</TabsTrigger>
          <TabsTrigger value="usage">Usage</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
        </TabsList>

        <TabsContent value="config" className="space-y-4 mt-4">
          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label>Display Name</Label>
              <Input
                value={form.displayName ?? ""}
                onChange={(e) => setForm({ ...form, displayName: e.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Description</Label>
              <Textarea
                value={form.description ?? ""}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Model</Label>
              <Input
                value={form.model ?? ""}
                onChange={(e) => setForm({ ...form, model: e.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Slack Channels (comma-separated)</Label>
              <Input
                value={form.slackChannels?.join(", ") ?? ""}
                onChange={(e) =>
                  setForm({
                    ...form,
                    slackChannels: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                  })
                }
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Slack Users (comma-separated)</Label>
              <Input
                value={form.slackUsers?.join(", ") ?? ""}
                onChange={(e) =>
                  setForm({
                    ...form,
                    slackUsers: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                  })
                }
              />
            </div>
          </div>
          <Button onClick={handleSaveConfig}>Save Config</Button>
        </TabsContent>

        <TabsContent value="agents-md" className="space-y-4 mt-4">
          <Textarea
            className="min-h-[400px] font-mono text-sm"
            value={mdContent}
            onChange={(e) => setMdContent(e.target.value)}
          />
          <Button onClick={handleSaveMd}>Save AGENTS.md</Button>
        </TabsContent>

        <TabsContent value="usage" className="mt-4">
          {usage.length === 0 ? (
            <p className="text-muted-foreground">No usage data yet.</p>
          ) : (
            <div className="space-y-2">
              <div className="text-sm text-muted-foreground mb-2">Daily token usage</div>
              {usage.map((d) => (
                <div key={d.date} className="flex items-center gap-2 text-xs">
                  <span className="w-20 text-muted-foreground">{d.date}</span>
                  <div className="flex-1 flex h-5 rounded overflow-hidden bg-muted">
                    <div
                      className="bg-chart-1 h-full"
                      style={{ width: `${(d.inputTokens / maxTokens) * 100}%` }}
                      title={`Input: ${d.inputTokens.toLocaleString()}`}
                    />
                    <div
                      className="bg-chart-2 h-full"
                      style={{ width: `${(d.outputTokens / maxTokens) * 100}%` }}
                      title={`Output: ${d.outputTokens.toLocaleString()}`}
                    />
                  </div>
                  <span className="w-28 text-right">
                    {(d.inputTokens + d.outputTokens).toLocaleString()}
                  </span>
                </div>
              ))}
              <div className="flex gap-4 text-xs text-muted-foreground mt-2">
                <span className="flex items-center gap-1">
                  <span className="w-3 h-3 rounded bg-chart-1 inline-block" /> Input
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-3 h-3 rounded bg-chart-2 inline-block" /> Output
                </span>
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="logs" className="mt-4">
          <div className="bg-zinc-950 text-zinc-200 rounded-lg p-4 font-mono text-xs max-h-[500px] overflow-y-auto">
            {logs.length === 0 ? (
              <p className="text-zinc-500">Waiting for log events...</p>
            ) : (
              logs.map((log, i) => (
                <div key={i} className="py-0.5">
                  <span className="text-zinc-500">{new Date(log.timestamp).toLocaleTimeString()} </span>
                  <span className={
                    log.level === "error" ? "text-red-400" :
                    log.level === "warn" ? "text-yellow-400" :
                    "text-zinc-300"
                  }>
                    {log.message}
                  </span>
                </div>
              ))
            )}
          </div>
        </TabsContent>
      </Tabs>

      <div className="flex gap-2 mt-8 pt-4 border-t">
        <Button variant="outline" onClick={handleToggle}>
          {agent.enabled ? "Disable" : "Enable"}
        </Button>
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="destructive">Delete</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete Agent</DialogTitle>
              <DialogDescription>
                Are you sure you want to delete "{agent.displayName}"? This cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="destructive" onClick={handleDelete}>
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
