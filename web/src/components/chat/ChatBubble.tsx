import { useState, memo } from "react";
import Markdown from "react-markdown";
import { Copy, Check, User, Bot, ChevronRight, ChevronDown, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ToolCallBlock } from "./ToolCallBlock";
import { parseSlackMessage, parseToolCallMarker } from "@/lib/message-parser";

interface ToolCall {
  name: string;
  input?: string;
  output?: string;
  status?: "running" | "completed" | "error";
}

interface ChatBubbleProps {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  toolCalls?: ToolCall[];
}

export const ChatBubble = memo(function ChatBubble({ role, content, timestamp, toolCalls }: ChatBubbleProps) {
  const [copied, setCopied] = useState(false);
  const [metadataOpen, setMetadataOpen] = useState(false);
  const isUser = role === "user";

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API may fail in non-secure contexts
    }
  };

  const formattedTime = new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  // Parse user messages for metadata; check assistant messages for tool-call markers
  const parsed = isUser ? parseSlackMessage(content) : null;
  const toolCallMarker = !isUser ? parseToolCallMarker(content) : null;
  const displayContent = parsed ? parsed.text : content;

  // Tool-call marker → compact badge instead of full bubble
  if (toolCallMarker) {
    return (
      <div className="flex flex-col gap-0.5 items-start px-1">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground italic">
          <Wrench className="size-3" />
          <span className="font-mono">{toolCallMarker.toolName}</span>
        </div>
        {toolCallMarker.detail && (
          <div className="ml-[18px] text-[11px] text-muted-foreground/70 font-mono truncate max-w-[80%]">
            {toolCallMarker.detail}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`flex flex-col gap-1 ${isUser ? "items-end" : "items-start"}`}>
      {/* Header */}
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground px-1">
        {isUser ? (
          <User className="size-3.5" />
        ) : (
          <Bot className="size-3.5" />
        )}
        <span className="font-medium">{isUser ? "User" : "Agent"}</span>
        <span>{formattedTime}</span>
      </div>

      {/* Bubble */}
      <div
        className={`relative group rounded-xl px-4 py-2.5 text-sm max-w-[85%] ${
          isUser
            ? "bg-muted text-foreground"
            : "bg-primary/10 text-foreground"
        }`}
      >
        {/* Tool calls before content */}
        {toolCalls && toolCalls.length > 0 && (
          <div className="mb-2">
            {toolCalls.map((tc, i) => (
              <ToolCallBlock
                key={i}
                name={tc.name}
                input={tc.input}
                output={tc.output}
                status={tc.status}
              />
            ))}
          </div>
        )}

        {/* Content */}
        {displayContent && (
          <div className="prose prose-sm prose-invert max-w-none break-words [&_pre]:bg-muted [&_pre]:rounded-md [&_pre]:p-3 [&_pre]:text-xs [&_pre]:overflow-x-auto [&_code]:bg-muted [&_code]:rounded [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1">
            <Markdown>{displayContent}</Markdown>
          </div>
        )}

        {/* Metadata collapsible (user messages only) */}
        {parsed?.metadata && (
          <Collapsible open={metadataOpen} onOpenChange={setMetadataOpen}>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors mt-2 cursor-pointer"
              >
                {metadataOpen ? (
                  <ChevronDown className="size-3" />
                ) : (
                  <ChevronRight className="size-3" />
                )}
                <span>Metadata</span>
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mt-1.5 rounded-md bg-background/50 border border-border/50 px-3 py-2 text-[11px] font-mono text-muted-foreground space-y-0.5">
                {parsed.metadata.sender && (
                  <div>
                    <span className="text-foreground/60">Sender:</span>{" "}
                    {parsed.metadata.sender}
                  </div>
                )}
                {parsed.metadata.messageId && (
                  <div>
                    <span className="text-foreground/60">Message ID:</span>{" "}
                    {parsed.metadata.messageId}
                  </div>
                )}
                {parsed.metadata.senderId && (
                  <div>
                    <span className="text-foreground/60">Sender ID:</span>{" "}
                    {parsed.metadata.senderId}
                  </div>
                )}
                {parsed.metadata.timestamp && (
                  <div>
                    <span className="text-foreground/60">Timestamp:</span>{" "}
                    {parsed.metadata.timestamp}
                  </div>
                )}
                {parsed.metadata.repliedMessage && (
                  <div>
                    <span className="text-foreground/60">Replied to:</span>
                    <pre className="mt-0.5 whitespace-pre-wrap text-[10px] opacity-70">
                      {parsed.metadata.repliedMessage}
                    </pre>
                  </div>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* Copy button for assistant */}
        {!isUser && content && (
          <Button
            variant="ghost"
            size="icon"
            className="absolute -top-1 -right-1 size-7 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={handleCopy}
            aria-label="Copy message"
          >
            {copied ? (
              <Check className="size-3.5 text-green-500" />
            ) : (
              <Copy className="size-3.5" />
            )}
          </Button>
        )}
      </div>
    </div>
  );
});
