import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface SessionOption {
  agentId: string;
  lastActivityAt: string;
  messageCount: number;
  status: string;
}

interface SessionSelectProps {
  sessions: SessionOption[];
  value: string | null;
  onValueChange: (value: string) => void;
}

export function SessionSelect({ sessions, value, onValueChange }: SessionSelectProps) {
  if (sessions.length === 0) {
    return (
      <div className="text-sm text-muted-foreground px-3 py-2 border border-border rounded-md">
        No active sessions
      </div>
    );
  }

  return (
    <Select value={value ?? undefined} onValueChange={onValueChange}>
      <SelectTrigger className="w-full max-w-md" aria-label="Select session">
        <SelectValue placeholder="Select a session…" />
      </SelectTrigger>
      <SelectContent>
        {sessions.map((s) => (
          <SelectItem key={s.agentId} value={s.agentId}>
            <div className="flex items-center gap-2">
              <span
                className={`size-2 rounded-full shrink-0 ${
                  s.status === "running"
                    ? "bg-green-500"
                    : s.status === "error"
                    ? "bg-red-500"
                    : "bg-muted-foreground"
                }`}
              />
              <span className="font-mono text-xs truncate">{s.agentId}</span>
              <span className="text-muted-foreground text-xs">
                {new Date(s.lastActivityAt).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
