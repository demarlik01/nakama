import Database from 'better-sqlite3';
import path from 'node:path';
import { createLogger, type Logger } from '../utils/logger.js';

export interface UsageRecord {
  agentId: string;
  timestamp: number;
  inputTokens: number;
  outputTokens: number;
  model: string;
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
        model TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_usage_agent_ts ON usage(agent_id, timestamp);
    `);
  }

  record(record: UsageRecord): void {
    const stmt = this.db.prepare(
      'INSERT INTO usage (agent_id, timestamp, input_tokens, output_tokens, model) VALUES (?, ?, ?, ?, ?)',
    );
    stmt.run(record.agentId, record.timestamp, record.inputTokens, record.outputTokens, record.model);
  }

  getUsage(agentId: string, period: 'day' | 'week' | 'month'): PeriodUsage[] {
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

    const rows = this.db
      .prepare(
        `SELECT ${groupBy} as period,
                SUM(input_tokens) as inputTokens,
                SUM(output_tokens) as outputTokens,
                SUM(input_tokens + output_tokens) as totalTokens
         FROM usage
         WHERE agent_id = ? AND timestamp >= ?
         GROUP BY period
         ORDER BY period`,
      )
      .all(agentId, since) as PeriodUsage[];

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

  close(): void {
    this.db.close();
  }
}
