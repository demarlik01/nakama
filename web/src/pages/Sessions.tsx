import { useEffect, useState, useCallback } from "react";
import { useEventSource, type SSEMessage } from "@/hooks/useEventSource";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

interface SessionInfo {
  agentId: string;
  status: string;
  threadTs?: string;
  queueDepth: number;
  lastActivityAt: string;
  messages: Array<{ role: string; preview: string; timestamp: string }>;
}

export function Sessions() {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Load initial sessions
  useEffect(() => {
    fetch("/api/sessions")
      .then((r) => r.json())
      .then((data: SessionInfo[]) => {
        setSessions(data.map((s) => ({ ...s, messages: [] })));
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const handleSSE = useCallback((event: SSEMessage) => {
    const { type, data } = event;
    const agentId = data.agentId as string;

    if (type === "session:start") {
      setSessions((prev) => {
        if (prev.find((s) => s.agentId === agentId)) return prev;
        return [
          ...prev,
          {
            agentId,
            status: "idle",
            threadTs: data.threadTs as string | undefined,
            queueDepth: 0,
            lastActivityAt: (data.timestamp as string) ?? new Date().toISOString(),
            messages: [],
          },
        ];
      });
    }

    if (type === "session:end") {
      setSessions((prev) => prev.filter((s) => s.agentId !== agentId));
    }

    if (type === "agent:status") {
      setSessions((prev) =>
        prev.map((s) =>
          s.agentId === agentId
            ? { ...s, status: data.status as string, lastActivityAt: (data.timestamp as string) ?? s.lastActivityAt }
            : s
        )
      );
    }

    if (type === "session:message") {
      setSessions((prev) =>
        prev.map((s) =>
          s.agentId === agentId
            ? {
                ...s,
                messages: [
                  ...s.messages,
                  {
                    role: data.role as string,
                    preview: data.preview as string,
                    timestamp: (data.timestamp as string) ?? new Date().toISOString(),
                  },
                ],
              }
            : s
        )
      );
    }
  }, []);

  const { connected } = useEventSource({
    url: "/api/events",
    onMessage: handleSSE,
  });

  const selectedSession = sessions.find((s) => s.agentId === selected);

  if (loading) return <div className="text-muted-foreground">Loading...</div>;

  return (
    <div className="flex gap-6 h-full">
      {/* Session list */}
      <div className="w-72 shrink-0 space-y-2">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold">Sessions</h1>
          <Badge variant={connected ? "default" : "destructive"}>
            {connected ? "Live" : "Disconnected"}
          </Badge>
        </div>

        {sessions.length === 0 ? (
          <p className="text-muted-foreground text-sm">No active sessions.</p>
        ) : (
          sessions.map((s) => (
            <Card
              key={s.agentId}
              className={`cursor-pointer transition-colors ${
                selected === s.agentId ? "border-primary" : "hover:border-primary/50"
              }`}
              onClick={() => setSelected(s.agentId)}
            >
              <CardHeader className="p-3 pb-1">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">{s.agentId}</CardTitle>
                  <Badge
                    variant={
                      s.status === "running"
                        ? "default"
                        : s.status === "error"
                        ? "destructive"
                        : "secondary"
                    }
                    className="text-xs"
                  >
                    {s.status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="p-3 pt-0 text-xs text-muted-foreground">
                <div>{s.messages.length} messages</div>
                <div>{new Date(s.lastActivityAt).toLocaleTimeString()}</div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Conversation view */}
      <div className="flex-1 min-w-0">
        {selectedSession ? (
          <div className="space-y-3">
            <h2 className="text-lg font-semibold">{selectedSession.agentId}</h2>
            <div className="space-y-2 max-h-[calc(100vh-200px)] overflow-y-auto">
              {selectedSession.messages.length === 0 ? (
                <p className="text-muted-foreground text-sm">No messages yet.</p>
              ) : (
                selectedSession.messages.map((m, i) => (
                  <div
                    key={i}
                    className={`rounded-lg p-3 text-sm ${
                      m.role === "user"
                        ? "bg-muted ml-8"
                        : "bg-primary/10 mr-8"
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-xs">
                        {m.role === "user" ? "User" : "Agent"}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(m.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <div className="whitespace-pre-wrap break-words">
                      {m.preview}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            Select a session to view conversation
          </div>
        )}
      </div>
    </div>
  );
}
