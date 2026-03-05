import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createMemoryReadTool, createMemoryWriteTool } from '../src/tools/memory.js';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('memory tools', () => {
  let tmpDir: string;
  let readTool: ReturnType<typeof createMemoryReadTool>;
  let writeTool: ReturnType<typeof createMemoryWriteTool>;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'memory-test-'));
    readTool = createMemoryReadTool(tmpDir);
    writeTool = createMemoryWriteTool(tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe('memory_read', () => {
    it('should have correct metadata', () => {
      expect(readTool.name).toBe('memory_read');
      expect(readTool.label).toBe('Memory Read');
    });

    it('should list empty directory', async () => {
      const result = await readTool.execute('t1', { path: '' } as any, undefined, undefined, undefined as any);
      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain('does not exist');
    });

    it('should read written files', async () => {
      await writeTool.execute(
        't2',
        { path: 'test.md', content: 'Hello World' } as any,
        undefined,
        undefined,
        undefined as any,
      );

      const result = await readTool.execute(
        't3',
        { path: 'test.md' } as any,
        undefined,
        undefined,
        undefined as any,
      );
      const text = (result.content[0] as { text: string }).text;
      expect(text).toBe('Hello World');
    });

    it('should return error for missing file', async () => {
      const result = await readTool.execute(
        't4',
        { path: 'missing.md' } as any,
        undefined,
        undefined,
        undefined as any,
      );
      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain('not found');
    });

    it('should block path traversal', async () => {
      const result = await readTool.execute(
        't5',
        { path: '../etc/passwd' } as any,
        undefined,
        undefined,
        undefined as any,
      );
      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain('path traversal not allowed');
    });

    it('should list files in memory directory', async () => {
      await writeTool.execute('t6', { path: 'a.md', content: 'aaa' } as any, undefined, undefined, undefined as any);
      await writeTool.execute('t7', { path: 'b.md', content: 'bbb' } as any, undefined, undefined, undefined as any);

      const result = await readTool.execute('t8', { path: '.' } as any, undefined, undefined, undefined as any);
      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain('a.md');
      expect(text).toContain('b.md');
    });
  });

  describe('memory_write', () => {
    it('should have correct metadata', () => {
      expect(writeTool.name).toBe('memory_write');
      expect(writeTool.label).toBe('Memory Write');
    });

    it('should write file', async () => {
      const result = await writeTool.execute(
        't1',
        { path: 'note.md', content: 'Test content' } as any,
        undefined,
        undefined,
        undefined as any,
      );
      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain('Wrote');

      const content = await readFile(path.join(tmpDir, 'memory', 'note.md'), 'utf-8');
      expect(content).toBe('Test content');
    });

    it('should create nested directories', async () => {
      await writeTool.execute(
        't2',
        { path: 'sub/dir/note.md', content: 'nested' } as any,
        undefined,
        undefined,
        undefined as any,
      );

      const content = await readFile(path.join(tmpDir, 'memory', 'sub', 'dir', 'note.md'), 'utf-8');
      expect(content).toBe('nested');
    });

    it('should append content', async () => {
      await writeTool.execute(
        't3',
        { path: 'log.md', content: 'line1\n' } as any,
        undefined,
        undefined,
        undefined as any,
      );
      await writeTool.execute(
        't4',
        { path: 'log.md', content: 'line2\n', append: true } as any,
        undefined,
        undefined,
        undefined as any,
      );

      const content = await readFile(path.join(tmpDir, 'memory', 'log.md'), 'utf-8');
      expect(content).toBe('line1\nline2\n');
    });

    it('should block path traversal', async () => {
      const result = await writeTool.execute(
        't5',
        { path: '../../evil.sh', content: 'bad' } as any,
        undefined,
        undefined,
        undefined as any,
      );
      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain('path traversal not allowed');
    });

    it('should return error for empty path', async () => {
      const result = await writeTool.execute(
        't6',
        { path: '', content: 'test' } as any,
        undefined,
        undefined,
        undefined as any,
      );
      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain('Error');
    });
  });
});
