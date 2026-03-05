import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { Type, type Static } from '@sinclair/typebox';
import type { ToolDefinition } from '@mariozechner/pi-coding-agent';

const MemoryReadSchema = Type.Object({
  path: Type.String({
    description:
      'File path relative to memory/ directory (e.g., "notes.md", "2024/journal.md"). Use "" or "." to list files.',
  }),
});

const MemoryWriteSchema = Type.Object({
  path: Type.String({
    description: 'File path relative to memory/ directory (e.g., "notes.md")',
  }),
  content: Type.String({ description: 'Content to write' }),
  append: Type.Optional(
    Type.Boolean({
      description: 'If true, append to existing file instead of overwriting (default false)',
    }),
  ),
});

type MemoryReadParams = Static<typeof MemoryReadSchema>;
type MemoryWriteParams = Static<typeof MemoryWriteSchema>;

/**
 * Validate that a path stays within the memory directory.
 * Returns the resolved absolute path or null if unsafe.
 */
function resolveSafePath(memoryDir: string, relativePath: string): string | null {
  // Block .. traversal
  if (relativePath.includes('..')) {
    return null;
  }

  const resolved = path.resolve(memoryDir, relativePath);

  // Ensure resolved path starts with memoryDir
  if (!resolved.startsWith(memoryDir)) {
    return null;
  }

  return resolved;
}

export function createMemoryReadTool(workspacePath: string): ToolDefinition<typeof MemoryReadSchema> {
  const memoryDir = path.join(workspacePath, 'memory');

  return {
    name: 'memory_read',
    label: 'Memory Read',
    description:
      'Read a file from the agent memory directory. Pass "" or "." to list all files in memory/.',
    parameters: MemoryReadSchema,
    async execute(toolCallId, params) {
      const { path: filePath } = params as MemoryReadParams;

      // List mode
      if (!filePath || filePath === '.' || filePath === '') {
        try {
          const files = await listFilesRecursive(memoryDir);
          if (files.length === 0) {
            return {
              content: [{ type: 'text', text: 'Memory directory is empty.' }],
              details: { files: [] },
            };
          }
          const listing = files.map((f) => `- ${f}`).join('\n');
          return {
            content: [{ type: 'text', text: `Files in memory/:\n${listing}` }],
            details: { files },
          };
        } catch {
          return {
            content: [{ type: 'text', text: 'Memory directory does not exist yet.' }],
            details: { files: [] },
          };
        }
      }

      const resolved = resolveSafePath(memoryDir, filePath);
      if (resolved === null) {
        return {
          content: [{ type: 'text', text: 'Error: path traversal not allowed' }],
          details: { error: true },
        };
      }

      try {
        const content = await readFile(resolved, 'utf-8');
        return {
          content: [{ type: 'text', text: content }],
          details: { path: filePath, chars: content.length },
        };
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        if (errMsg.includes('ENOENT')) {
          return {
            content: [{ type: 'text', text: `File not found: memory/${filePath}` }],
            details: { error: true },
          };
        }
        return {
          content: [{ type: 'text', text: `Error reading memory/${filePath}: ${errMsg}` }],
          details: { error: true },
        };
      }
    },
  };
}

export function createMemoryWriteTool(
  workspacePath: string,
): ToolDefinition<typeof MemoryWriteSchema> {
  const memoryDir = path.join(workspacePath, 'memory');

  return {
    name: 'memory_write',
    label: 'Memory Write',
    description:
      'Write or append content to a file in the agent memory directory. Creates directories as needed.',
    parameters: MemoryWriteSchema,
    async execute(toolCallId, params) {
      const { path: filePath, content, append = false } = params as MemoryWriteParams;

      if (!filePath || filePath.trim().length === 0) {
        return {
          content: [{ type: 'text', text: 'Error: path is required' }],
          details: { error: true },
        };
      }

      const resolved = resolveSafePath(memoryDir, filePath);
      if (resolved === null) {
        return {
          content: [{ type: 'text', text: 'Error: path traversal not allowed' }],
          details: { error: true },
        };
      }

      try {
        // Ensure parent directories exist
        await mkdir(path.dirname(resolved), { recursive: true });

        if (append) {
          let existing = '';
          try {
            existing = await readFile(resolved, 'utf-8');
          } catch {
            // File doesn't exist yet; that's fine for append
          }
          await writeFile(resolved, existing + content, 'utf-8');
        } else {
          await writeFile(resolved, content, 'utf-8');
        }

        const action = append ? 'Appended to' : 'Wrote';
        return {
          content: [
            {
              type: 'text',
              text: `${action} memory/${filePath} (${content.length} chars)`,
            },
          ],
          details: { path: filePath, chars: content.length, append },
        };
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text', text: `Error writing memory/${filePath}: ${errMsg}` }],
          details: { error: true },
        };
      }
    },
  };
}

async function listFilesRecursive(dir: string, prefix = ''): Promise<string[]> {
  const results: string[] = [];
  const entries = await readdir(dir);

  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    const relPath = prefix ? `${prefix}/${entry}` : entry;
    const s = await stat(fullPath);

    if (s.isDirectory()) {
      const nested = await listFilesRecursive(fullPath, relPath);
      results.push(...nested);
    } else {
      results.push(relPath);
    }
  }

  return results;
}
