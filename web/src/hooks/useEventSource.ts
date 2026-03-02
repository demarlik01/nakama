import { useEffect, useRef, useCallback, useState } from "react";

export interface SSEMessage {
  type: string;
  data: Record<string, unknown>;
}

interface UseEventSourceOptions {
  url: string;
  onMessage?: (event: SSEMessage) => void;
  onError?: (error: Event) => void;
  enabled?: boolean;
}

export function useEventSource({ url, onMessage, onError, enabled = true }: UseEventSourceOptions) {
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);
  const onMessageRef = useRef(onMessage);
  const onErrorRef = useRef(onError);
  onMessageRef.current = onMessage;
  onErrorRef.current = onError;

  useEffect(() => {
    if (!enabled) return;

    const es = new EventSource(url);
    esRef.current = es;

    es.addEventListener("connected", () => setConnected(true));

    const eventTypes = [
      "agent:status",
      "session:start",
      "session:message",
      "session:end",
      "health",
      "log",
      "error",
    ];

    for (const type of eventTypes) {
      es.addEventListener(type, (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          onMessageRef.current?.({ type, data });
        } catch {
          // ignore parse errors
        }
      });
    }

    es.onerror = (e) => {
      setConnected(false);
      onErrorRef.current?.(e);
    };

    return () => {
      es.close();
      esRef.current = null;
      setConnected(false);
    };
  }, [url, enabled]);

  return { connected };
}
