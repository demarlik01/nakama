import { useEffect, useState, useCallback, useRef } from "react";
import { useEventSource, type SSEMessage } from "@/hooks/useEventSource";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { RefreshCw, Send, Plus, Maximize2, Minimize2 } from "lucide-react";
import { ChatBubble } from "@/components/chat/ChatBubble";
import { SessionSelect } from "@/components/chat/SessionSelect";

interface SessionMessage {
  role: "user" | "assistant";
  preview: string;
  timestamp: string;
}

interface SessionInfo {
  agentId: string;
  status: string;
  threadTs?: string;
  queueDepth: number;
  lastActivityAt: string;
  messages: SessionMessage[];
}

export function Sessions() {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [focused, setFocused] = useState(false);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  // Auto-scroll to bottom on new messages
  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      const viewport = scrollRef.current.querySelector(
        "[data-slot='scroll-area-viewport']"
      );
      if (viewport) {
        viewport.scrollTop = viewport.scrollHeight;
      }
    }
  }, []);

  // Load initial sessions
  useEffect(() => {
    fetch("/api/sessions")
      .then((r) => r.json())
      .then((data: SessionInfo[]) => {
        const loaded = data.map((s) => ({ ...s, messages: s.messages ?? [] }));
        setSessions(loaded);
        // Auto-select first session if none selected
        if (loaded.length > 0 && !selected) {
          setSelected(loaded[0].agentId);
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // SSE handler
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
            lastActivityAt:
              (data.timestamp as string) ?? new Date().toISOString(),
            messages: [],
          },
        ];
      });
    }

    if (type === "session:end") {
      setSessions((prev) => prev.filter((s) => s.agentId !== agentId));
      // Reset selected if the ended session was selected
      if (selectedRef.current === agentId) {
        setSelected(null);
      }
    }

    if (type === "agent:status") {
      setSessions((prev) =>
        prev.map((s) =>
          s.agentId === agentId
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
          s.agentId === agentId
            ? {
                ...s,
                messages: [
                  ...s.messages,
                  {
                    role: data.role as "user" | "assistant",
                    preview: data.preview as string,
                    timestamp:
                      (data.timestamp as string) ?? new Date().toISOString(),
                  },
                ],
              }
            : s
        )
      );
      // Auto-scroll after a tick
      setTimeout(scrollToBottom, 50);
    }
  }, [scrollToBottom]);

  const { connected } = useEventSource({
    url: "/api/events",
    onMessage: handleSSE,
  });

  const selectedSession = sessions.find((s) => s.agentId === selected);

  // Scroll to bottom when session changes
  useEffect(() => {
    setTimeout(scrollToBottom, 100);
  }, [selected, scrollToBottom]);

  const handleRefresh = () => {
    setLoading(true);
    fetch("/api/sessions")
      .then((r) => r.json())
      .then((data: SessionInfo[]) => {
        const loaded = data.map((s) => ({ ...s, messages: s.messages ?? [] }));
        setSessions(loaded);
        // Reset selected if it no longer exists
        setSelected((prev) => {
          if (prev && !loaded.find((s) => s.agentId === prev)) {
            return loaded.length > 0 ? loaded[0].agentId : null;
          }
          return prev;
        });
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSend = () => {
    if (!input.trim() || !selected) return;
    // TODO: POST /api/sessions/{sessionId}/message when API is available
    console.log("Send message:", input, "to session:", selected);
    setInput("");
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Loading sessions…
      </div>
    );
  }

  return (
    <div className={`flex flex-col h-full ${focused ? "fixed inset-0 z-50 bg-background p-4" : ""}`}>
      {/* Header */}
      <div className="shrink-0 mb-4 space-y-1">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-2xl font-bold">Chat</h1>
            <p className="text-sm text-muted-foreground">Agent sessions viewer</p>
          </div>
          <Badge
            variant={connected ? "default" : "destructive"}
            className="ml-auto"
          >
            {connected ? "Live" : "Disconnected"}
          </Badge>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2 pt-2">
          <SessionSelect
            sessions={sessions.map((s) => ({
              agentId: s.agentId,
              lastActivityAt: s.lastActivityAt,
              messageCount: s.messages.length,
              status: s.status,
            }))}
            value={selected}
            onValueChange={setSelected}
          />
          <Button variant="outline" size="icon" onClick={handleRefresh} className="shrink-0" aria-label="Refresh sessions">
            <RefreshCw className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setFocused(!focused)}
            className="shrink-0"
            aria-label={focused ? "Exit focus mode" : "Focus mode"}
          >
            {focused ? (
              <Minimize2 className="size-4" />
            ) : (
              <Maximize2 className="size-4" />
            )}
          </Button>
        </div>
      </div>

      {/* Chat area */}
      <div className="flex-1 min-h-0 border border-border rounded-xl overflow-hidden flex flex-col">
        {selectedSession ? (
          <>
            {/* Messages */}
            <ScrollArea className="flex-1" ref={scrollRef}>
              <div className="p-4 space-y-4">
                {selectedSession.messages.length === 0 ? (
                  <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
                    No messages yet. Waiting for activity…
                  </div>
                ) : (
                  selectedSession.messages.map((m, i) => (
                    <ChatBubble
                      key={`${selected}-${m.role}-${m.timestamp}-${i}`}
                      role={m.role}
                      content={m.preview}
                      timestamp={m.timestamp}
                    />
                  ))
                )}
              </div>
            </ScrollArea>

            {/* Input area */}
            <div className="shrink-0 border-t border-border p-3">
              <div className="flex items-end gap-2">
                <Textarea
                  placeholder="Message…"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  className="min-h-[40px] max-h-[120px] resize-none"
                  rows={1}
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={() => {
                    // TODO: Create new session via API
                    console.log("New session");
                  }}
                >
                  <Plus className="size-4 mr-1" />
                  New
                </Button>
                <Button
                  size="sm"
                  className="shrink-0"
                  disabled={!input.trim() || !selected}
                  onClick={handleSend}
                  aria-label="Send message"
                >
                  <Send className="size-4 mr-1" />
                  Send
                </Button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            {sessions.length === 0
              ? "No active sessions"
              : "Select a session to view conversation"}
          </div>
        )}
      </div>
    </div>
  );
}
