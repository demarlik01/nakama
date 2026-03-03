import Database from 'better-sqlite3';
import path from 'node:path';
import { createLogger, type Logger } from '../utils/logger.js';

export interface UsageRecord {
  agentId: string;
  timestamp: number;
  inputTokens: number;
  outputTokens: number;
  model: string;
  sessionId?: string;
}

export interface UsageSummary {
  agentId: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  recordCount: number;
}

export interface PeriodUsage {
  period: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface SessionUsageSummary extends UsageSummary {
  sessionId: string;
}

export class UsageTracker {
  private readonly db: Database.Database;
  private readonly logger: Logger;

  constructor(dataDir: string, logger?: Logger) {
    this.logger = logger ?? createLogger('UsageTracker');
    const dbPath = path.join(dataDir, 'usage.db');
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.migrate();
    this.logger.info('UsageTracker initialized', { dbPath });
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        input_tokens INTEGER NOT NULL,
        output_tokens INTEGER NOT NULL,
        model TEXT NOT NULL,
        session_id TEXT
      );
    `);

    const columns = this.db
      .prepare('PRAGMA table_info(usage)')
      .all() as Array<{ name?: unknown }>;
    const hasSessionIdColumn = columns.some((column) => column.name === 'session_id');
    if (!hasSessionIdColumn) {
      this.db.exec('ALTER TABLE usage ADD COLUMN session_id TEXT');
    }

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_usage_agent_ts ON usage(agent_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_usage_agent_session_ts ON usage(agent_id, session_id, timestamp);
    `);
  }

  record(record: UsageRecord): void {
    const stmt = this.db.prepare(
      'INSERT INTO usage (agent_id, timestamp, input_tokens, output_tokens, model, session_id) VALUES (?, ?, ?, ?, ?, ?)',
    );
    stmt.run(
      record.agentId,
      record.timestamp,
      record.inputTokens,
      record.outputTokens,
      record.model,
      record.sessionId ?? null,
    );
  }

  getUsage(
    agentId: string,
    period: 'day' | 'week' | 'month',
    sessionId?: string,
  ): PeriodUsage[] {
    const now = Date.now();
    let since: number;
    let groupBy: string;

    switch (period) {
      case 'day':
        since = now - 30 * 24 * 60 * 60 * 1000;
        groupBy = "strftime('%Y-%m-%d', timestamp / 1000, 'unixepoch')";
        break;
      case 'week':
        since = now - 12 * 7 * 24 * 60 * 60 * 1000;
        groupBy = "strftime('%Y-W%W', timestamp / 1000, 'unixepoch')";
        break;
      case 'month':
        since = now - 365 * 24 * 60 * 60 * 1000;
        groupBy = "strftime('%Y-%m', timestamp / 1000, 'unixepoch')";
        break;
    }

    const scopedBySession = typeof sessionId === 'string' && sessionId.length > 0;
    const whereClause = scopedBySession
      ? 'agent_id = ? AND session_id = ? AND timestamp >= ?'
      : 'agent_id = ? AND timestamp >= ?';
    const params = scopedBySession ? [agentId, sessionId, since] : [agentId, since];

    const rows = this.db
      .prepare(
        `SELECT ${groupBy} as period,
                SUM(input_tokens) as inputTokens,
                SUM(output_tokens) as outputTokens,
                SUM(input_tokens + output_tokens) as totalTokens
         FROM usage
         WHERE ${whereClause}
         GROUP BY period
         ORDER BY period`,
      )
      .all(...params) as PeriodUsage[];

    return rows;
  }

  getSummary(): UsageSummary[] {
    const rows = this.db
      .prepare(
        `SELECT agent_id as agentId,
                SUM(input_tokens) as totalInputTokens,
                SUM(output_tokens) as totalOutputTokens,
                SUM(input_tokens + output_tokens) as totalTokens,
                COUNT(*) as recordCount
         FROM usage
         GROUP BY agent_id
         ORDER BY totalTokens DESC`,
      )
      .all() as UsageSummary[];

    return rows;
  }

  getSessionSummary(agentId: string, sessionId: string): UsageSummary | undefined {
    const row = this.db
      .prepare(
        `SELECT agent_id as agentId,
                SUM(input_tokens) as totalInputTokens,
                SUM(output_tokens) as totalOutputTokens,
                SUM(input_tokens + output_tokens) as totalTokens,
                COUNT(*) as recordCount
         FROM usage
         WHERE agent_id = ? AND session_id = ?`,
      )
      .get(agentId, sessionId) as UsageSummary | undefined;

    if (row === undefined || row.recordCount === 0) {
      return undefined;
    }

    return row;
  }

  getSessionSummaries(agentId: string): SessionUsageSummary[] {
    const rows = this.db
      .prepare(
        `SELECT session_id as sessionId,
                agent_id as agentId,
                SUM(input_tokens) as totalInputTokens,
                SUM(output_tokens) as totalOutputTokens,
                SUM(input_tokens + output_tokens) as totalTokens,
                COUNT(*) as recordCount
         FROM usage
         WHERE agent_id = ? AND session_id IS NOT NULL
         GROUP BY session_id
         ORDER BY totalTokens DESC`,
      )
      .all(agentId) as SessionUsageSummary[];

    return rows;
  }

  close(): void {
    this.db.close();
  }
}
