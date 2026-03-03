import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  type Agent,
  type AgentSessionDetail,
  type AgentSessionMessage,
  type AgentSessionSummary,
  type SessionUsageSummary,
  type UsageBucket,
  fetchAgent,
  fetchAgentSession,
  fetchAgentSessionUsage,
  fetchAgentSessions,
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  const [usage, setUsage] = useState<UsageBucket[]>([]);
  const [usagePeriod, setUsagePeriod] = useState<"day" | "week">("day");
  const [sessions, setSessions] = useState<AgentSessionSummary[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [selectedSession, setSelectedSession] = useState<AgentSessionDetail | null>(null);
  const [selectedSessionUsage, setSelectedSessionUsage] = useState<SessionUsageSummary | null>(null);
  const [loadingSession, setLoadingSession] = useState(false);
  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState<Array<{ message: string; timestamp: string; level?: string }>>([]);
  const sessionTimelineRef = useRef<HTMLDivElement | null>(null);
  const sessionRequestSeq = useRef(0);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [a, md, persistedSessions] = await Promise.all([
        fetchAgent(id),
        fetchAgentsMd(id).catch(() => ({ content: "" })),
        fetchAgentSessions(id).catch(() => []),
      ]);
      setAgent(a);
      setForm(a);
      setMdContent(md.content);
      setSessions(persistedSessions);
      setSelectedSessionId(null);
      setSelectedSession(null);
      setSelectedSessionUsage(null);
      sessionRequestSeq.current += 1;
      setLoadingSession(false);
    } catch (e) {
      console.error(e);
      toast.error("Failed to load agent");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const loadUsage = useCallback(async () => {
    if (!id) {
      return;
    }

    try {
      const values = await fetchAgentUsage(id, usagePeriod);
      setUsage(values);
    } catch {
      setUsage([]);
      toast.error("Failed to load usage");
    }
  }, [id, usagePeriod]);

  useEffect(() => {
    void loadUsage();
  }, [loadUsage]);

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

  const handleSelectSession = async (sessionId: string) => {
    if (!id) return;

    const requestSeq = sessionRequestSeq.current + 1;
    sessionRequestSeq.current = requestSeq;
    setSelectedSessionId(sessionId);
    setSelectedSession(null);
    setSelectedSessionUsage(null);
    setLoadingSession(true);

    try {
      const [detail, usageResponse] = await Promise.all([
        fetchAgentSession(id, sessionId),
        fetchAgentSessionUsage(id, sessionId).catch(() => ({ usage: [], summary: undefined })),
      ]);
      if (sessionRequestSeq.current !== requestSeq) return;
      setSelectedSession(detail);
      setSelectedSessionUsage(usageResponse.summary ?? null);
    } catch {
      if (sessionRequestSeq.current !== requestSeq) return;
      setSelectedSession(null);
      setSelectedSessionUsage(null);
      toast.error("Failed to load session history");
    } finally {
      if (sessionRequestSeq.current !== requestSeq) return;
      setLoadingSession(false);
    }
  };

  const timestampFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
    []
  );
  const sessionMessages = useMemo(() => {
    if (!selectedSession) {
      return [];
    }

    const parsed = parseMessagesFromJsonl(selectedSession.rawJsonl);
    return parsed.length > 0 ? parsed : selectedSession.messages;
  }, [selectedSession]);

  useEffect(() => {
    if (!selectedSessionId || loadingSession) {
      return;
    }

    const timelineEl = sessionTimelineRef.current;
    if (!timelineEl) {
      return;
    }

    timelineEl.scrollTop = timelineEl.scrollHeight;
  }, [selectedSessionId, loadingSession, sessionMessages.length]);

  const maxTokens = Math.max(...usage.map((d) => d.totalTokens), 1);

  if (loading) return <div className="text-muted-foreground">Loading...</div>;
  if (!agent) return <div className="text-destructive">Agent not found</div>;

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
          <TabsTrigger value="sessions">Sessions</TabsTrigger>
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
              <Label>Slack Display Name</Label>
              <Input
                value={form.slackDisplayName ?? ""}
                onChange={(e) => setForm({ ...form, slackDisplayName: e.target.value })}
                placeholder="Agent Bot Name"
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Slack Icon Emoji</Label>
              <Input
                value={form.slackIcon ?? ""}
                onChange={(e) => setForm({ ...form, slackIcon: e.target.value })}
                placeholder=":robot_face:"
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
            <div className="grid gap-1.5">
              <Label>Error Notification Channel</Label>
              <Input
                value={form.errorNotificationChannel ?? ""}
                onChange={(e) =>
                  setForm({
                    ...form,
                    errorNotificationChannel: e.target.value,
                  })
                }
                placeholder="C01234567"
              />
            </div>
          </div>

            {/* Resource Limits */}
            <div className="space-y-6 pt-4 border-t">
              <div className="space-y-4">
                <h3 className="text-sm font-medium leading-none">Resource Limits</h3>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="maxConcurrentSessions">Max Concurrent Sessions</Label>
                    <Input
                      id="maxConcurrentSessions"
                      type="number"
                      value={form.limits?.maxConcurrentSessions ?? ""}
                      onChange={(e) => setForm({
                        ...form,
                        limits: { ...form.limits, maxConcurrentSessions: Number(e.target.value) }
                      })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="dailyTokenLimit">Daily Token Limit</Label>
                    <Input
                      id="dailyTokenLimit"
                      type="number"
                      value={form.limits?.dailyTokenLimit ?? ""}
                      onChange={(e) => setForm({
                        ...form,
                        limits: { ...form.limits, dailyTokenLimit: Number(e.target.value) }
                      })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="maxMessageLength">Max Message Length</Label>
                    <Input
                      id="maxMessageLength"
                      type="number"
                      value={form.limits?.maxMessageLength ?? ""}
                      onChange={(e) => setForm({
                        ...form,
                        limits: { ...form.limits, maxMessageLength: Number(e.target.value) }
                      })}
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <h3 className="text-sm font-medium leading-none">Reaction Triggers</h3>
                <Label htmlFor="reactionTriggers">Comma-separated emoji names</Label>
                <Input
                  id="reactionTriggers"
                  placeholder="robot_face, eyes"
                  value={form.reactionTriggers?.join(", ") ?? ""}
                  onChange={(e) => setForm({
                    ...form,
                    reactionTriggers: e.target.value.split(",").map((s) => s.trim()).filter(Boolean)
                  })}
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
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="text-sm text-muted-foreground">
                {usagePeriod === "day" ? "Daily token usage" : "Weekly token usage"}
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant={usagePeriod === "day" ? "default" : "outline"}
                  size="xs"
                  onClick={() => setUsagePeriod("day")}
                >
                  Day
                </Button>
                <Button
                  variant={usagePeriod === "week" ? "default" : "outline"}
                  size="xs"
                  onClick={() => setUsagePeriod("week")}
                >
                  Week
                </Button>
              </div>
            </div>
            {usage.length === 0 ? (
              <p className="text-muted-foreground">No usage data yet.</p>
            ) : (
              <>
              {usage.map((d) => (
                <div key={d.period} className="flex items-center gap-2 text-xs">
                  <span className="w-24 text-muted-foreground">{d.period}</span>
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
                    {d.totalTokens.toLocaleString()}
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
              </>
            )}
          </div>
        </TabsContent>

        <TabsContent value="sessions" className="mt-4">
          {sessions.length === 0 ? (
            <p className="text-muted-foreground">No persisted sessions yet.</p>
          ) : (
            <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
              <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
                {sessions.map((session) => (
                  <Card
                    key={session.sessionId}
                    className={`cursor-pointer transition-colors ${
                      selectedSessionId === session.sessionId
                        ? "border-primary"
                        : "hover:border-primary/50"
                    }`}
                    onClick={() => handleSelectSession(session.sessionId)}
                  >
                    <CardHeader className="p-3 pb-2">
                      <CardTitle className="text-sm font-medium truncate">
                        {session.fileName}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-3 pt-0 text-xs text-muted-foreground space-y-1">
                      <div>{session.messageCount} messages</div>
                      <div>{new Date(session.createdAt).toLocaleString()}</div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              <Card className="min-h-[320px]">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">
                    {selectedSession ? selectedSession.fileName : "Session timeline"}
                  </CardTitle>
                  {selectedSessionUsage ? (
                    <div className="text-xs text-muted-foreground flex flex-wrap items-center gap-3">
                      <span>Input: {selectedSessionUsage.totalInputTokens.toLocaleString()}</span>
                      <span>Output: {selectedSessionUsage.totalOutputTokens.toLocaleString()}</span>
                      <span>Total: {selectedSessionUsage.totalTokens.toLocaleString()}</span>
                      <span>Records: {selectedSessionUsage.recordCount.toLocaleString()}</span>
                    </div>
                  ) : null}
                </CardHeader>
                <CardContent>
                  {!selectedSessionId ? (
                    <p className="text-sm text-muted-foreground">
                      Select a session to view messages.
                    </p>
                  ) : loadingSession ? (
                    <p className="text-sm text-muted-foreground">Loading session...</p>
                  ) : !selectedSession ? (
                    <p className="text-sm text-muted-foreground">Session not found.</p>
                  ) : sessionMessages.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No messages in this session.</p>
                  ) : (
                    <div ref={sessionTimelineRef} className="space-y-2 max-h-[460px] overflow-y-auto pr-1">
                      {sessionMessages.map((message, index) => (
                        <div
                          key={`${message.timestamp}-${index}`}
                          className={`rounded-lg border p-3 text-sm ${
                            message.role === "user"
                              ? "bg-muted/50"
                              : "bg-primary/10"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <span className="font-medium">{message.role}</span>
                            <span className="text-xs text-muted-foreground">
                              {formatSessionTimestamp(message.timestamp, timestampFormatter)}
                            </span>
                          </div>
                          <div className="whitespace-pre-wrap break-words">{message.content}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
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
              <DialogTitle>에이전트 삭제</DialogTitle>
              <DialogDescription>
                정말 삭제하시겠습니까? "{agent.displayName}" 에이전트는 아카이브 처리됩니다.
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

function parseMessagesFromJsonl(rawJsonl: string): AgentSessionMessage[] {
  if (rawJsonl.trim() === "") {
    return [];
  }

  const messages: AgentSessionMessage[] = [];
  const lines = rawJsonl.split("\n");
  let sessionTimestamp = new Date().toISOString();

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "") {
      continue;
    }

    let entry: unknown;
    try {
      entry = JSON.parse(trimmed);
    } catch {
      continue;
    }

    if (!isRecord(entry)) {
      continue;
    }

    if (entry.type === "session") {
      const parsed = parseIsoTimestamp(entry.timestamp);
      if (parsed) {
        sessionTimestamp = parsed;
      }
      continue;
    }

    const message = entry.message;
    if (entry.type !== "message" || !isRecord(message)) {
      continue;
    }

    const role = message.role;
    if (role !== "user" && role !== "assistant") {
      continue;
    }

    messages.push({
      role,
      content: extractMessageText(message.content),
      timestamp:
        parseIsoTimestamp(message.timestamp) ??
        parseIsoTimestamp(entry.timestamp) ??
        sessionTimestamp,
    });
  }

  return messages;
}

function formatSessionTimestamp(timestamp: string, formatter: Intl.DateTimeFormat): string {
  const parsed = Date.parse(timestamp);
  if (Number.isNaN(parsed)) {
    return timestamp;
  }
  return formatter.format(new Date(parsed));
}

function extractMessageText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "(No text content)";
  }

  const parts: string[] = [];
  for (const part of content) {
    if (!isRecord(part)) {
      continue;
    }
    if (part.type === "text" && typeof part.text === "string") {
      parts.push(part.text);
    }
  }

  return parts.length > 0 ? parts.join("") : "(No text content)";
}

function parseIsoTimestamp(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }

  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isNaN(parsed)) {
      return undefined;
    }
    return new Date(parsed).toISOString();
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
