import path from 'node:path';

export interface MediaParseResult {
  /** Text with MEDIA: lines removed */
  text: string;
  /** Resolved absolute file paths extracted from MEDIA: tokens */
  mediaUrls: string[];
}

/**
 * Parse LLM output for MEDIA: tokens and split into text + media paths.
 *
 * Rules:
 * - MEDIA: tokens inside fenced code blocks (``` ... ```) are ignored.
 * - Paths must resolve to within the workspace directory.
 * - `../` segments are rejected.
 * - Only one MEDIA: token per line.
 */
export function splitMediaFromOutput(
  raw: string,
  workspacePath: string,
): MediaParseResult {
  const lines = raw.split('\n');
  const keptLines: string[] = [];
  const mediaUrls: string[] = [];
  let inCodeBlock = false;

  for (const line of lines) {
    // Track fenced code block boundaries
    if (line.trimStart().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      keptLines.push(line);
      continue;
    }

    // Inside code blocks: keep line as-is, never parse MEDIA:
    if (inCodeBlock) {
      keptLines.push(line);
      continue;
    }

    const match = line.match(MEDIA_TOKEN_RE);
    if (match !== null) {
      const rawPath = match[1]?.trim();
      if (rawPath !== undefined && rawPath.length > 0) {
        const resolved = resolveMediaPath(rawPath, workspacePath);
        if (resolved !== null) {
          mediaUrls.push(resolved);
          // Don't include MEDIA: line in output text
          continue;
        }
      }
    }

    keptLines.push(line);
  }

  return {
    text: keptLines.join('\n').trim(),
    mediaUrls,
  };
}

/**
 * Resolve a MEDIA: path to an absolute path within the workspace.
 * Returns null if the path is invalid or escapes the workspace.
 */
function resolveMediaPath(rawPath: string, workspacePath: string): string | null {
  // Strip optional backtick wrapping
  const cleaned = rawPath.replace(/^`|`$/g, '').trim();

  if (cleaned.length === 0) {
    return null;
  }

  // Block obvious traversal attempts
  if (cleaned.includes('..')) {
    return null;
  }

  // Resolve relative to workspace
  const resolved = path.isAbsolute(cleaned)
    ? path.resolve(cleaned)
    : path.resolve(workspacePath, cleaned);

  // Verify the resolved path is within the workspace
  const normalizedWorkspace = path.resolve(workspacePath);
  if (!resolved.startsWith(normalizedWorkspace + path.sep) && resolved !== normalizedWorkspace) {
    return null;
  }

  return resolved;
}

/**
 * Match a MEDIA: token at the start of a line (with optional leading whitespace).
 * Captures the path, which may optionally be wrapped in backticks.
 */
const MEDIA_TOKEN_RE = /^\s*MEDIA:\s*`?([^\n`]+?)`?\s*$/;
