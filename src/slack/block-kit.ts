/**
 * Markdown → Slack Block Kit converter.
 */

import type { SlackBlock } from '../types.js';

const BLOCK_TEXT_LIMIT = 3000;

/**
 * Convert markdown text to an array of Slack Block Kit blocks.
 */
export function markdownToBlocks(markdown: string): SlackBlock[] {
  const lines = markdown.split('\n');
  const blocks: SlackBlock[] = [];
  let i = 0;

  const getLine = (idx: number): string => lines[idx] ?? '';

  while (i < lines.length) {
    const line = getLine(i);

    if (line.trim() === '') {
      i++;
      continue;
    }

    // Code block
    if (line.trim().startsWith('```')) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !getLine(i).trim().startsWith('```')) {
        codeLines.push(getLine(i));
        i++;
      }
      i++;
      blocks.push({
        type: 'rich_text',
        elements: [{
          type: 'rich_text_preformatted',
          elements: [{ type: 'text', text: codeLines.join('\n') }],
        }],
      });
      continue;
    }

    // Heading
    const headingMatch = line.match(/^#{1,3}\s+(.+)$/);
    if (headingMatch) {
      blocks.push({
        type: 'header',
        text: { type: 'plain_text', text: headingMatch[1]?.trim() ?? '', emoji: true },
      });
      i++;
      continue;
    }

    // Bullet list
    if (/^\s*[-*]\s+/.test(line)) {
      const bulletLines: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(getLine(i))) {
        bulletLines.push(getLine(i).replace(/^\s*[-*]\s+/, '• '));
        i++;
      }
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: convertInlineMarkdown(bulletLines.join('\n')) },
      });
      continue;
    }

    // Numbered list
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const listLines: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(getLine(i))) {
        listLines.push(getLine(i));
        i++;
      }
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: convertInlineMarkdown(listLines.join('\n')) },
      });
      continue;
    }

    // Regular text
    const textLines: string[] = [];
    while (
      i < lines.length &&
      getLine(i).trim() !== '' &&
      !getLine(i).trim().startsWith('```') &&
      !/^#{1,3}\s+/.test(getLine(i)) &&
      !/^\s*[-*]\s+/.test(getLine(i)) &&
      !/^\s*\d+[.)]\s+/.test(getLine(i))
    ) {
      textLines.push(getLine(i));
      i++;
    }

    if (textLines.length > 0) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: convertInlineMarkdown(textLines.join('\n')) },
      });
    }
  }

  return blocks;
}

function convertInlineMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '*$1*')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<$2|$1>');
}

export function splitBlocksForSlack(blocks: SlackBlock[], maxChars = BLOCK_TEXT_LIMIT): SlackBlock[][] {
  if (blocks.length === 0) return [[]];

  const chunks: SlackBlock[][] = [];
  let current: SlackBlock[] = [];
  let currentSize = 0;

  for (const block of blocks) {
    const blockSize = estimateBlockSize(block);

    if (currentSize + blockSize > maxChars && current.length > 0) {
      chunks.push(current);
      current = [];
      currentSize = 0;
    }

    current.push(block);
    currentSize += blockSize;
  }

  if (current.length > 0) {
    chunks.push(current);
  }

  return chunks;
}

function estimateBlockSize(block: SlackBlock): number {
  const text = block.text;
  if (typeof text === 'object' && text !== null && 'text' in (text as Record<string, unknown>)) {
    return ((text as Record<string, unknown>).text as string).length;
  }
  return JSON.stringify(block).length / 2;
}

export function markdownToPlainText(markdown: string): string {
  return markdown
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/_(.+?)_/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/```[\s\S]*?```/g, (match) => match.replace(/```\w*\n?/, '').replace(/```/, ''))
    .replace(/^#{1,3}\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
}
