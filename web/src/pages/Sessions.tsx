import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useEventSource, type SSEMessage } from "@/hooks/useEventSource";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RefreshCw, MessageSquare, Clock } from "lucide-react";

interface SessionInfo {
  agentId: string;
  sessionKey?: string;
  sessionId?: string;
  threadTs?: string;
  status: string;
  queueDepth: number;
  lastActivityAt: string;
  messages?: { role: string; preview: string; timestamp: string }[];
}

function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  if (diffMs < 0) return "just now";
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function StatusDot({ status }: { status: string }) {
  const color =
    status === "running"
      ? "bg-green-500"
      : status === "error"
      ? "bg-red-500"
      : "bg-muted-foreground";
  return <span className={`inline-block size-2 rounded-full ${color}`} />;
}

export function Sessions() {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const loadSessions = useCallback(() => {
    setLoading(true);
    fetch("/api/sessions")
      .then((r) => r.json())
      .then((data: SessionInfo[]) => {
        setSessions(
          data.map((s) => ({
            ...s,
            messages: s.messages ?? [],
          }))
        );
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  // Match session by sessionKey first, fallback to agentId
  const matchSession = useCallback(
    (s: SessionInfo, agentId: string, sessionKey?: string) =>
      sessionKey ? s.sessionKey === sessionKey : s.agentId === agentId,
    []
  );

  // SSE handler to keep list up-to-date
  const handleSSE = useCallback((event: SSEMessage) => {
    const { type, data } = event;
    const agentId = data.agentId as string;
    const sessionKey = data.sessionKey as string | undefined;

    if (type === "session:start") {
      setSessions((prev) => {
        if (prev.find((s) => matchSession(s, agentId, sessionKey))) return prev;
        return [
          ...prev,
          {
            agentId,
            sessionKey: sessionKey,
            status: "idle",
            threadTs: data.threadTs as string | undefined,
            queueDepth: 0,
            lastActivityAt:
              (data.timestamp as string) ?? new Date().toISOString(),
            messages: [],
          },
        ];
      });
    }

    if (type === "session:end") {
      setSessions((prev) => prev.filter((s) => !matchSession(s, agentId, sessionKey)));
    }

    if (type === "agent:status") {
      setSessions((prev) =>
        prev.map((s) =>
          matchSession(s, agentId, sessionKey)
            ? {
                ...s,
                status: data.status as string,
                lastActivityAt:
                  (data.timestamp as string) ?? s.lastActivityAt,
              }
            : s
        )
      );
    }

    if (type === "session:message") {
      setSessions((prev) =>
        prev.map((s) =>
          matchSession(s, agentId, sessionKey)
            ? {
                ...s,
                lastActivityAt:
                  (data.timestamp as string) ?? new Date().toISOString(),
                messages: [
                  ...(s.messages ?? []),
                  {
                    role: data.role as string,
                    preview: data.preview as string,
                    timestamp:
                      (data.timestamp as string) ?? new Date().toISOString(),
                  },
                ],
              }
            : s
        )
      );
    }
  }, [matchSession]);

  const { connected } = useEventSource({
    url: "/api/events",
    onMessage: handleSSE,
  });

  const handleRowClick = (session: SessionInfo) => {
    if (session.sessionId) {
      navigate(`/sessions/${encodeURIComponent(session.agentId)}/${encodeURIComponent(session.sessionId)}`);
    }
  };

  return (
    <div className="flex flex-col gap-4 flex-1 overflow-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div>
          <h1 className="text-2xl font-bold">Sessions</h1>
          <p className="text-sm text-muted-foreground">
            Active agent sessions and conversation history
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Badge variant={connected ? "default" : "destructive"}>
            {connected ? "Live" : "Disconnected"}
          </Badge>
          <Button
            variant="outline"
            size="icon"
            onClick={loadSessions}
            aria-label="Refresh sessions"
          >
            <RefreshCw className="size-4" />
          </Button>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
          Loading sessions…
        </div>
      ) : sessions.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 gap-2 text-muted-foreground border border-border rounded-xl">
          <MessageSquare className="size-8 opacity-50" />
          <p className="text-sm">No active sessions</p>
          <p className="text-xs">Sessions will appear here when agents are active</p>
        </div>
      ) : (
        <div className="border border-border rounded-xl overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Agent ID</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-center">Messages</TableHead>
                <TableHead className="text-center">Queue</TableHead>
                <TableHead>Last Activity</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessions.map((session) => (
                <TableRow
                  key={session.sessionKey ?? session.agentId}
                  role={session.sessionId ? "button" : undefined}
                  tabIndex={session.sessionId ? 0 : undefined}
                  className={
                    session.sessionId
                      ? "cursor-pointer hover:bg-muted/50 transition-colors"
                      : "opacity-60"
                  }
                  onClick={() => handleRowClick(session)}
                  onKeyDown={(e) => {
                    if ((e.key === "Enter" || e.key === " ") && session.sessionId) {
                      e.preventDefault();
                      handleRowClick(session);
                    }
                  }}
                >
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <StatusDot status={session.status} />
                      <span className="font-mono text-sm">{session.agentId}</span>
                    </div>
                    {session.sessionKey && (
                      <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-[300px] font-mono">
                        {session.sessionKey}
                      </p>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        session.status === "running"
                          ? "default"
                          : session.status === "error"
                          ? "destructive"
                          : "secondary"
                      }
                      className="text-xs"
                    >
                      {session.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center">
                    <span className="text-sm tabular-nums">
                      {session.messages?.length ?? 0}
                    </span>
                  </TableCell>
                  <TableCell className="text-center">
                    <span className="text-sm tabular-nums">
                      {session.queueDepth}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <Clock className="size-3.5" />
                      <span>{formatRelativeTime(session.lastActivityAt)}</span>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
