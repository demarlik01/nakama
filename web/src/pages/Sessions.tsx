import { useEffect, useState, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useEventSource, type SSEMessage } from "@/hooks/useEventSource";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RefreshCw, MessageSquare, Clock } from "lucide-react";
import { fetchAllSessions, fetchAgents, type SessionListItem } from "@/lib/api";

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

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes().toString().padStart(2, "0");
  const ampm = hours >= 12 ? "pm" : "am";
  const h12 = hours % 12 || 12;
  return `${month}/${day} ${h12}:${minutes}${ampm}`;
}

export function Sessions() {
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [agents, setAgents] = useState<string[]>([]);
  const [agentFilter, setAgentFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [sessionData, agentData] = await Promise.all([
        fetchAllSessions(),
        fetchAgents(),
      ]);
      setSessions(sessionData);
      setAgents(agentData.map((a) => a.id));
    } catch (error) {
      console.error("Failed to load sessions:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // SSE handler — update active session statuses in real-time
  const handleSSE = useCallback((event: SSEMessage) => {
    const { type, data } = event;
    const agentId = data.agentId as string | undefined;

    if (type === "session:start" && agentId) {
      setSessions((prev) => {
        const sessionId = (data.sessionId as string) ?? (data.sessionKey as string) ?? agentId;
        if (prev.find((s) => s.sessionId === sessionId && s.status === "active")) return prev;
        return [
          {
            sessionId,
            agentId,
            status: "active" as const,
            messageCount: 0,
            createdAt: (data.timestamp as string) ?? new Date().toISOString(),
            lastActivityAt: (data.timestamp as string) ?? new Date().toISOString(),
          },
          ...prev,
        ];
      });
    }

    if (type === "session:end" && agentId) {
      // Move to archived instead of removing
      setSessions((prev) =>
        prev.map((s) =>
          s.agentId === agentId && s.status === "active"
            ? { ...s, status: "archived" as const }
            : s
        )
      );
    }

    if (type === "session:message" && agentId) {
      setSessions((prev) =>
        prev.map((s) =>
          s.agentId === agentId && s.status === "active"
            ? {
                ...s,
                messageCount: s.messageCount + 1,
                lastActivityAt: (data.timestamp as string) ?? new Date().toISOString(),
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

  const filteredSessions = useMemo(() => {
    if (agentFilter === "all") return sessions;
    return sessions.filter((s) => s.agentId === agentFilter);
  }, [sessions, agentFilter]);

  const handleRowClick = (session: SessionListItem) => {
    navigate(
      `/sessions/${encodeURIComponent(session.agentId)}/${encodeURIComponent(session.sessionId)}`
    );
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
            onClick={() => void loadData()}
            aria-label="Refresh sessions"
          >
            <RefreshCw className="size-4" />
          </Button>
        </div>
      </div>

      {/* Agent Filter */}
      <div className="flex items-center gap-2">
        <Select value={agentFilter} onValueChange={setAgentFilter}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Filter by agent" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Agents</SelectItem>
            {agents.map((id) => (
              <SelectItem key={id} value={id}>
                {id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">
          {filteredSessions.length} session{filteredSessions.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
          Loading sessions…
        </div>
      ) : filteredSessions.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 gap-2 text-muted-foreground border border-border rounded-xl">
          <MessageSquare className="size-8 opacity-50" />
          <p className="text-sm">No sessions found</p>
          <p className="text-xs">
            {agentFilter !== "all"
              ? "Try selecting a different agent or 'All Agents'"
              : "Sessions will appear here when agents are active"}
          </p>
        </div>
      ) : (
        <div className="border border-border rounded-xl overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Session ID</TableHead>
                <TableHead>Agent</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-center">Messages</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Last Activity</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredSessions.map((session) => (
                <TableRow
                  key={`${session.agentId}-${session.sessionId}`}
                  role="button"
                  tabIndex={0}
                  className="cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => handleRowClick(session)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleRowClick(session);
                    }
                  }}
                >
                  <TableCell>
                    <span
                      className="font-mono text-sm"
                      title={session.sessionId}
                    >
                      {session.sessionId.slice(0, 8)}…
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm">{session.agentId}</span>
                  </TableCell>
                  <TableCell>
                    {session.status === "active" ? (
                      <Badge variant="default" className="text-xs">
                        <span className="mr-1">🟢</span>active
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="text-xs">
                        archived
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    <span className="text-sm tabular-nums">
                      {session.messageCount}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm text-muted-foreground">
                      {formatDate(session.createdAt)}
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
