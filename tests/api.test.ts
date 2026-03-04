import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import express from 'express';
import { createAgentsRouter } from '../src/api/routes/agents.js';
import { AgentRegistry } from '../src/core/registry.js';
import { SessionManager } from '../src/core/session.js';
import { createLogger } from '../src/utils/logger.js';
import type { AppConfig, SessionState } from '../src/types.js';
import http from 'http';

describe('REST API - Agent CRUD', () => {
  let tempDir: string;
  let registry: AgentRegistry;
  let app: express.Application;
  let server: http.Server;
  let baseUrl: string;
  const logger = createLogger('test');

  const mockSessionManager = {
    getActiveSession: (_id: string): SessionState | undefined => undefined,
    getAllSessions: () => [],
  } as unknown as SessionManager;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'api-test-'));
    registry = new AgentRegistry(tempDir, logger);
    await registry.start();

    app = express();
    app.use(express.json());
    app.use('/api/agents', createAgentsRouter({ registry, sessionManager: mockSessionManager, logger }));

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address();
        if (addr !== null && typeof addr === 'object') {
          baseUrl = `http://localhost:${addr.port}`;
        }
        resolve();
      });
    });
  });

  afterEach(async () => {
    await registry?.stop();
    server?.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  async function api(method: string, path: string, body?: unknown) {
    const opts: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };
    if (body) opts.body = JSON.stringify(body);
    return fetch(`${baseUrl}/api/agents${path}`, opts);
  }

  it('creates an agent via POST', async () => {
    const res = await api('POST', '', {
      id: 'new-agent',
      displayName: 'New Agent',
      agentsMd: '# New Agent',
      channels: { C123: { mode: 'mention' } },
      slackUsers: [],
      model: 'anthropic/claude-sonnet-4-20250514',
    });
    expect(res.status).toBe(201);

    const data = await res.json() as { agent: Record<string, unknown> };
    expect(data.agent.id).toBe('new-agent');
    expect(existsSync(join(tempDir, 'new-agent', 'AGENTS.md'))).toBe(true);
    expect(existsSync(join(tempDir, 'new-agent', 'MEMORY.md'))).toBe(true);
    expect(existsSync(join(tempDir, 'new-agent', 'memory'))).toBe(true);
    expect(existsSync(join(tempDir, 'new-agent', 'skills', 'README.md'))).toBe(true);
  });

  it('lists agents via GET', async () => {
    // Create agent first
    const agentDir = join(tempDir, 'list-agent');
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, 'AGENTS.md'), '# List Agent');
    writeFileSync(join(agentDir, 'agent.json'), JSON.stringify({
      displayName: 'List Agent', channels: {}, slackUsers: [], enabled: true,
    }));

    // Re-scan
    await registry.stop();
    registry = new AgentRegistry(tempDir, logger);
    await registry.start();

    // Recreate router with new registry
    const newApp = express();
    newApp.use(express.json());
    newApp.use('/api/agents', createAgentsRouter({ registry, sessionManager: mockSessionManager, logger }));

    const newServer = await new Promise<http.Server>((resolve) => {
      const s = newApp.listen(0, () => resolve(s));
    });
    const addr = newServer.address();
    const url = addr !== null && typeof addr === 'object' ? `http://localhost:${addr.port}` : '';

    const res = await fetch(`${url}/api/agents`);
    expect(res.status).toBe(200);
    const data = await res.json() as { agents: unknown[] };
    expect(data.agents.length).toBeGreaterThanOrEqual(1);

    newServer.close();
  });

  it('returns 404 for unknown agent', async () => {
    const res = await api('GET', '/nonexistent');
    expect(res.status).toBe(404);
  });

  it('auto-generates AGENTS.md when omitted', async () => {
    const res = await api('POST', '', {
      id: 'auto-md-agent',
      displayName: 'Auto MD Agent',
      channels: { C123: { mode: 'mention' } },
      slackUsers: [],
      model: 'anthropic/claude-sonnet-4-20250514',
    });
    expect(res.status).toBe(201);

    const agentsMd = readFileSync(join(tempDir, 'auto-md-agent', 'AGENTS.md'), 'utf8');
    expect(agentsMd).toContain('# Auto MD Agent');
    expect(agentsMd).toContain('## Persona');
    expect(agentsMd).toContain('## Boundaries');
  });

  it('updates agent via PATCH', async () => {
    // Create first
    await api('POST', '', {
      id: 'patch-agent',
      displayName: 'Before',
      agentsMd: '# Patch Agent',
      channels: { C123: { mode: 'mention' } },
      slackUsers: [],
      model: 'anthropic/claude-sonnet-4-20250514',
    });

    const res = await api('PATCH', '/patch-agent', { displayName: 'After' });
    expect(res.status).toBe(200);
    const data = await res.json() as { agent: Record<string, unknown> };
    expect(data.agent.displayName).toBe('After');
  });

  it('deletes (archives) agent via DELETE', async () => {
    await api('POST', '', {
      id: 'del-agent',
      displayName: 'Delete Me',
      agentsMd: '# Delete Agent',
      channels: { C123: { mode: 'mention' } },
      slackUsers: [],
      model: 'anthropic/claude-sonnet-4-20250514',
    });

    const res = await api('DELETE', '/del-agent');
    expect(res.status).toBe(204);

    // Verify archived
    expect(existsSync(join(tempDir, 'del-agent'))).toBe(false);
  });
});
