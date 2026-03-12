import { useState } from "react";
import { ChevronRight, Check, Loader2, X } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

interface ToolCallBlockProps {
  name: string;
  input?: string;
  output?: string;
  status?: "running" | "completed" | "error";
}

const statusIcon = {
  running: <Loader2 className="size-3.5 animate-spin text-yellow-500" />,
  completed: <Check className="size-3.5 text-green-500" />,
  error: <X className="size-3.5 text-red-500" />,
};

export function ToolCallBlock({
  name,
  input,
  output,
  status = "completed",
}: ToolCallBlockProps) {
  const [open, setOpen] = useState(false);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="my-1.5">
      <CollapsibleTrigger className="flex items-center gap-1.5 rounded-md border border-border/50 bg-muted/50 px-2.5 py-1.5 text-xs font-mono hover:bg-muted transition-colors w-full text-left">
        <ChevronRight
          className={`size-3.5 shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
        />
        {statusIcon[status]}
        <span className="font-medium">{name}</span>
        {!open && input && (
          <span className="text-muted-foreground truncate ml-1">
            {input.length > 60 ? input.slice(0, 60) + "…" : input}
          </span>
        )}
      </CollapsibleTrigger>
      <CollapsibleContent className="ml-4 mt-1 space-y-1">
        {input && (
          <div className="rounded bg-muted/30 p-2 text-xs font-mono whitespace-pre-wrap break-all text-muted-foreground">
            {input}
          </div>
        )}
        {output && (
          <div className="rounded bg-muted/30 p-2 text-xs font-mono whitespace-pre-wrap break-all text-muted-foreground border-l-2 border-green-500/30">
            {output}
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
