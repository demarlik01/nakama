import type { Request, Response } from 'express';
import { createLogger, type Logger } from '../utils/logger.js';

export type SSEEventType =
  | 'agent:status'
  | 'session:start'
  | 'session:message'
  | 'session:end'
  | 'health'
  | 'log'
  | 'error';

export interface SSEEvent {
  type: SSEEventType;
  data: Record<string, unknown>;
  timestamp: string;
}

interface SSEClient {
  id: string;
  res: Response;
  filter?: string;
}

export class SSEManager {
  private clients: SSEClient[] = [];
  private healthInterval?: NodeJS.Timeout;
  private readonly logger: Logger;

  constructor(logger?: Logger) {
    this.logger = logger ?? createLogger('SSEManager');
  }

  start(): void {
    this.healthInterval = setInterval(() => {
      this.broadcast({
        type: 'health',
        data: { uptimeSec: Math.floor(process.uptime()) },
        timestamp: new Date().toISOString(),
      });
    }, 30_000);
  }

  stop(): void {
    if (this.healthInterval) {
      clearInterval(this.healthInterval);
      this.healthInterval = undefined;
    }
    for (const client of this.clients) {
      client.res.end();
    }
    this.clients = [];
  }

  handleConnection(req: Request, res: Response): void {
    const clientId = `sse-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const filter = req.query.type as string | undefined;

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    res.write(`event: connected\ndata: ${JSON.stringify({ clientId })}\n\n`);

    const client: SSEClient = { id: clientId, res, filter };
    this.clients.push(client);

    this.logger.info('SSE client connected', { clientId, filter, total: this.clients.length });

    req.on('close', () => {
      this.clients = this.clients.filter((c) => c.id !== clientId);
      this.logger.info('SSE client disconnected', { clientId, total: this.clients.length });
    });
  }

  broadcast(event: SSEEvent): void {
    const payload = `event: ${event.type}\ndata: ${JSON.stringify({ ...event.data, timestamp: event.timestamp })}\n\n`;

    for (const client of this.clients) {
      if (client.filter === 'logs' && event.type !== 'log' && event.type !== 'health') {
        continue;
      }
      try {
        client.res.write(payload);
      } catch {
        // Client disconnected, will be cleaned up
      }
    }
  }

  emit(type: SSEEventType, data: Record<string, unknown>): void {
    this.broadcast({
      type,
      data,
      timestamp: new Date().toISOString(),
    });
  }

  getClientCount(): number {
    return this.clients.length;
  }
}
