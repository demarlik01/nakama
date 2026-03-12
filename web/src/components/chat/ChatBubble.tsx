import { useState, memo } from "react";
import Markdown from "react-markdown";
import { Copy, Check, User, Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ToolCallBlock } from "./ToolCallBlock";

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
        {content && (
          <div className="prose prose-sm prose-invert max-w-none break-words [&_pre]:bg-muted [&_pre]:rounded-md [&_pre]:p-3 [&_pre]:text-xs [&_pre]:overflow-x-auto [&_code]:bg-muted [&_code]:rounded [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1">
            <Markdown>{content}</Markdown>
          </div>
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
