import { existsSync } from 'node:fs';
import { mkdir, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { CronService } from '../src/core/cron.js';
import type { SessionManager } from '../src/core/session.js';
import type { HeartbeatRunner } from '../src/core/heartbeat.js';
import type { AgentRegistry } from '../src/core/registry.js';
import { createLogger } from '../src/utils/logger.js';

function createMockRegistry() {
  return {
    getById: vi.fn(() => undefined),
  } as unknown as AgentRegistry;
}

function createMockSessionManager() {
  return {
    handleMessage: vi.fn(async () => 'Cron response'),
    runIsolatedTurn: vi.fn(async () => 'Isolated response'),
    getActiveSession: vi.fn(() => undefined),
    getMessageCount: vi.fn(() => 0),
    pruneMessagesFrom: vi.fn(() => 0),
  } as unknown as SessionManager;
}

function createMockHeartbeatRunner() {
  return {
    requestHeartbeatNow: vi.fn(),
  } as unknown as HeartbeatRunner;
}

describe('CronService', () => {
  let testDir: string;
  let storePath: string;

  beforeEach(async () => {
    testDir = path.join(tmpdir(), `cron-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
    storePath = path.join(testDir, 'cron-store.json');
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('starts with empty store when no file exists', async () => {
    const sessionManager = createMockSessionManager();
    const service = new CronService({
      registry: createMockRegistry(),
      storePath,
      sessionManager,
      postToSlack: vi.fn(async () => {}),
      logger: createLogger('cron-test'),
    });

    await service.start();
    expect(service.list()).toEqual([]);
    service.stop();
  });

  it('adds and lists cron jobs via API', async () => {
    const sessionManager = createMockSessionManager();
    const service = new CronService({
      registry: createMockRegistry(),
      storePath,
      sessionManager,
      postToSlack: vi.fn(async () => {}),
      logger: createLogger('cron-test'),
    });

    await service.start();

    const job = await service.add({
      agentId: 'test-agent',
      schedule: { kind: 'cron', expr: '0 9 * * 1' },
      payload: { message: 'Weekly report' },
    });

    expect(job.id).toBeTruthy();
    expect(job.agentId).toBe('test-agent');
    expect(job.schedule).toEqual({ kind: 'cron', expr: '0 9 * * 1' });
    expect(job.source).toBe('api');

    const jobs = service.list();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.id).toBe(job.id);

    service.stop();
  });

  it('persists jobs to JSON file', async () => {
    const sessionManager = createMockSessionManager();
    const service = new CronService({
      registry: createMockRegistry(),
      storePath,
      sessionManager,
      postToSlack: vi.fn(async () => {}),
      logger: createLogger('cron-test'),
    });

    await service.start();
    await service.add({
      agentId: 'test-agent',
      schedule: { kind: 'every', everyMs: 60_000 },
      payload: { message: 'Check inbox' },
    });
    service.stop();

    // Verify file exists
    expect(existsSync(storePath)).toBe(true);
    const data = JSON.parse(await readFile(storePath, 'utf8'));
    expect(data.jobs).toHaveLength(1);
    expect(data.jobs[0].payload.message).toBe('Check inbox');
  });

  it('restores jobs from persisted store', async () => {
    const sessionManager = createMockSessionManager();

    // Create and persist a job
    const service1 = new CronService({
      registry: createMockRegistry(),
      storePath,
      sessionManager,
      postToSlack: vi.fn(async () => {}),
      logger: createLogger('cron-test'),
    });
    await service1.start();
    await service1.add({
      agentId: 'test-agent',
      schedule: { kind: 'cron', expr: '0 * * * *' },
      payload: { message: 'Hourly check' },
    });
    service1.stop();

    // Create new service instance — should restore from file
    const service2 = new CronService({
      registry: createMockRegistry(),
      storePath,
      sessionManager,
      postToSlack: vi.fn(async () => {}),
      logger: createLogger('cron-test'),
    });
    await service2.start();
    expect(service2.list()).toHaveLength(1);
    expect(service2.list()[0]?.payload.message).toBe('Hourly check');
    service2.stop();
  });

  it('updates a cron job', async () => {
    const sessionManager = createMockSessionManager();
    const service = new CronService({
      registry: createMockRegistry(),
      storePath,
      sessionManager,
      postToSlack: vi.fn(async () => {}),
      logger: createLogger('cron-test'),
    });

    await service.start();
    const job = await service.add({
      agentId: 'test-agent',
      schedule: { kind: 'cron', expr: '0 9 * * *' },
      payload: { message: 'Old message' },
    });

    const updated = await service.update(job.id, {
      payload: { message: 'New message' },
      enabled: false,
    });

    expect(updated.payload.message).toBe('New message');
    expect(updated.enabled).toBe(false);
    service.stop();
  });

  it('removes a cron job', async () => {
    const sessionManager = createMockSessionManager();
    const service = new CronService({
      registry: createMockRegistry(),
      storePath,
      sessionManager,
      postToSlack: vi.fn(async () => {}),
      logger: createLogger('cron-test'),
    });

    await service.start();
    const job = await service.add({
      agentId: 'test-agent',
      schedule: { kind: 'cron', expr: '0 9 * * *' },
      payload: { message: 'To remove' },
    });

    await service.remove(job.id);
    expect(service.list()).toHaveLength(0);
    service.stop();
  });

  it('throws when removing non-existent job', async () => {
    const sessionManager = createMockSessionManager();
    const service = new CronService({
      registry: createMockRegistry(),
      storePath,
      sessionManager,
      postToSlack: vi.fn(async () => {}),
      logger: createLogger('cron-test'),
    });

    await service.start();
    await expect(service.remove('nonexistent')).rejects.toThrow('not found');
    service.stop();
  });

  it('runs a job manually via runNow', async () => {
    const sessionManager = createMockSessionManager();
    const postToSlack = vi.fn(async () => {});
    const service = new CronService({
      registry: createMockRegistry(),
      storePath,
      sessionManager,
      postToSlack,
      logger: createLogger('cron-test'),
    });

    await service.start();
    const job = await service.add({
      agentId: 'test-agent',
      schedule: { kind: 'cron', expr: '0 9 * * *' },
      payload: { message: 'Run now test' },
    });

    const response = await service.runNow(job.id);
    expect(response).toBe('Cron response');
    expect(sessionManager.handleMessage).toHaveBeenCalled();
    service.stop();
  });

  it('registers agent config cron jobs', async () => {
    const sessionManager = createMockSessionManager();
    const service = new CronService({
      registry: createMockRegistry(),
      storePath,
      sessionManager,
      postToSlack: vi.fn(async () => {}),
      logger: createLogger('cron-test'),
    });

    await service.start();
    await service.register({
      id: 'my-agent',
      displayName: 'My Agent',
      workspacePath: '/tmp/agent',
      channels: {},
      slackUsers: [],
      enabled: true,
      cron: [
        { name: 'daily', schedule: '0 9 * * *', message: 'Daily check', channel: 'C123' },
        { name: 'weekly', schedule: '0 9 * * 1', message: 'Weekly report' },
      ],
    });

    const jobs = service.list('my-agent');
    expect(jobs).toHaveLength(2);
    expect(jobs[0]?.source).toBe('config');
    expect(jobs[0]?.deliverTo).toBe('C123');
    service.stop();
  });

  it('re-registration replaces config jobs but preserves API jobs', async () => {
    const sessionManager = createMockSessionManager();
    const service = new CronService({
      registry: createMockRegistry(),
      storePath,
      sessionManager,
      postToSlack: vi.fn(async () => {}),
      logger: createLogger('cron-test'),
    });

    await service.start();

    // Add an API job
    await service.add({
      agentId: 'my-agent',
      schedule: { kind: 'every', everyMs: 300_000 },
      payload: { message: 'API job' },
    });

    // Register agent config
    await service.register({
      id: 'my-agent',
      displayName: 'My Agent',
      workspacePath: '/tmp/agent',
      channels: {},
      slackUsers: [],
      enabled: true,
      cron: [{ name: 'daily', schedule: '0 9 * * *', message: 'Config job' }],
    });

    const jobs = service.list('my-agent');
    expect(jobs).toHaveLength(2);
    expect(jobs.find(j => j.source === 'api')?.payload.message).toBe('API job');
    expect(jobs.find(j => j.source === 'config')?.payload.message).toBe('Config job');

    service.stop();
  });

  it('uses heartbeatRunner for main session target', async () => {
    const sessionManager = createMockSessionManager();
    const heartbeatRunner = createMockHeartbeatRunner();
    const service = new CronService({
      registry: createMockRegistry(),
      storePath,
      sessionManager,
      heartbeatRunner,
      postToSlack: vi.fn(async () => {}),
      logger: createLogger('cron-test'),
    });

    await service.start();
    const job = await service.add({
      agentId: 'test-agent',
      schedule: { kind: 'cron', expr: '0 9 * * *' },
      sessionTarget: 'main',
      payload: { message: 'Main session task' },
    });

    await service.runNow(job.id);
    expect(heartbeatRunner.requestHeartbeatNow).toHaveBeenCalledWith('test-agent');
    expect(sessionManager.handleMessage).toHaveBeenCalled();
    service.stop();
  });

  it('uses runIsolatedTurn for isolated session target', async () => {
    const sessionManager = createMockSessionManager();
    const service = new CronService({
      registry: createMockRegistry(),
      storePath,
      sessionManager,
      postToSlack: vi.fn(async () => {}),
      logger: createLogger('cron-test'),
    });

    await service.start();
    const job = await service.add({
      agentId: 'test-agent',
      schedule: { kind: 'cron', expr: '0 9 * * *' },
      sessionTarget: 'isolated',
      payload: { message: 'Isolated task', model: 'fast-model' },
    });

    await service.runNow(job.id);
    expect(sessionManager.runIsolatedTurn).toHaveBeenCalledWith(
      'test-agent',
      expect.stringContaining('Isolated task'),
      { model: 'fast-model' },
    );
    service.stop();
  });
});
