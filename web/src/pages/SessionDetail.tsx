import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useEventSource, type SSEMessage } from "@/hooks/useEventSource";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Send, RefreshCw } from "lucide-react";
import { ChatBubble } from "@/components/chat/ChatBubble";
import { fetchAgentSession } from "@/lib/api";

interface SessionMessage {
  role: "user" | "assistant";
  preview: string;
  timestamp: string;
}

export function SessionDetail() {
  const { agentId, sessionId } = useParams<{ agentId: string; sessionId: string }>();
  const navigate = useNavigate();
  const [messages, setMessages] = useState<SessionMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<string>("idle");
  const scrollRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, []);

  // Load session history
  const loadHistory = useCallback(() => {
    if (!agentId || !sessionId) return;
    setLoading(true);
    setMessages([]);
    fetchAgentSession(agentId, sessionId)
      .then((detail) => {
        const loaded = (detail?.messages ?? []).map((m) => ({
          role: m.role,
          preview: m.content,
          timestamp: m.timestamp,
        }));
        setMessages(loaded);
        if (loaded.length > 0) {
          setTimeout(scrollToBottom, 100);
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [agentId, sessionId, scrollToBottom]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // SSE handler for real-time updates
  const handleSSE = useCallback(
    (event: SSEMessage) => {
      const { type, data } = event;
      const eventAgentId = data.agentId as string;
      // Match by agentId (sessionKey filtering would be ideal but SSE may not always include it)
      if (eventAgentId !== agentId) return;

      if (type === "agent:status") {
        setStatus(data.status as string);
      }

      if (type === "session:message") {
        setMessages((prev) => [
          ...prev,
          {
            role: data.role as "user" | "assistant",
            preview: data.preview as string,
            timestamp: (data.timestamp as string) ?? new Date().toISOString(),
          },
        ]);
        setTimeout(scrollToBottom, 50);
      }
    },
    [agentId, scrollToBottom]
  );

  const { connected } = useEventSource({
    url: "/api/events",
    onMessage: handleSSE,
  });

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSend = () => {
    if (!input.trim() || !agentId) return;
    console.log("Send message:", input, "to agent:", agentId);
    setInput("");
  };

  if (!agentId || !sessionId) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Invalid session URL
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Header */}
      <div className="shrink-0 mb-4 space-y-1">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/sessions")}
            className="shrink-0 -ml-2"
          >
            <ArrowLeft className="size-4 mr-1" />
            Sessions
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold truncate font-mono">{agentId}</h1>
            <p className="text-xs text-muted-foreground truncate">
              Session: {sessionId}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Badge
              variant={
                status === "running"
                  ? "default"
                  : status === "error"
                  ? "destructive"
                  : "secondary"
              }
            >
              {status}
            </Badge>
            <Badge variant={connected ? "default" : "destructive"}>
              {connected ? "Live" : "Disconnected"}
            </Badge>
            <Button
              variant="outline"
              size="icon"
              onClick={loadHistory}
              className="shrink-0"
              aria-label="Refresh"
            >
              <RefreshCw className="size-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Chat area */}
      <div className="flex-1 min-h-0 border border-border rounded-xl overflow-hidden flex flex-col">
        {loading ? (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            Loading messages…
          </div>
        ) : (
          <>
            {/* Messages */}
            <div className="flex-1 min-h-0 overflow-y-auto" ref={scrollRef}>
              <div className="p-4 space-y-4">
                {messages.length === 0 ? (
                  <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
                    No messages yet. Waiting for activity…
                  </div>
                ) : (
                  messages.map((m, i) => (
                    <ChatBubble
                      key={`${agentId}-${m.role}-${m.timestamp}-${i}`}
                      role={m.role}
                      content={m.preview}
                      timestamp={m.timestamp}
                    />
                  ))
                )}
              </div>
            </div>

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
                  size="sm"
                  className="shrink-0"
                  disabled={!input.trim()}
                  onClick={handleSend}
                  aria-label="Send message"
                >
                  <Send className="size-4 mr-1" />
                  Send
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
