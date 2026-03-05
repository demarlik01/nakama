import type { ImageContent } from '@mariozechner/pi-ai';
import { createLogger, type Logger } from '../utils/logger.js';

const logger: Logger = createLogger('ImageHandler');

/** Supported image MIME types for vision */
const SUPPORTED_IMAGE_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

const MAX_IMAGE_DIMENSION_PX = 1200;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB

export interface SlackFile {
  url_private?: string;
  name?: string;
  mimetype?: string;
  filetype?: string;
  size?: number;
}

export interface ProcessedImage {
  content: ImageContent;
  filename: string;
}

export interface ProcessedTextFile {
  tag: string;
  filename: string;
}

export type ProcessedFile = ProcessedImage | ProcessedTextFile;

export function isProcessedImage(f: ProcessedFile): f is ProcessedImage {
  return 'content' in f;
}

export function isProcessedTextFile(f: ProcessedFile): f is ProcessedTextFile {
  return 'tag' in f;
}

/**
 * Detect MIME type from buffer magic bytes.
 * Returns null if the format is not recognized.
 */
export function inferMimeTypeFromBuffer(buffer: Buffer): string | null {
  if (buffer.length < 12) return null;

  // JPEG: FF D8 FF
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
    return 'image/jpeg';
  }

  // PNG: 89 50 4E 47
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4E &&
    buffer[3] === 0x47
  ) {
    return 'image/png';
  }

  // GIF: GIF8
  if (
    buffer[0] === 0x47 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x38
  ) {
    return 'image/gif';
  }

  // WEBP: RIFF....WEBP
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return 'image/webp';
  }

  return null;
}

/**
 * Download a file from Slack using the private URL + bot token.
 */
export async function downloadSlackFile(
  url: string,
  botToken: string,
): Promise<Buffer> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${botToken}`,
    },
  });

  if (!response.ok || response.body === null) {
    throw new Error(`Failed to download Slack file: HTTP ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Resize an image buffer if it exceeds dimension or byte limits.
 * Returns { buffer, mimeType } with the possibly resized result.
 *
 * Uses sharp for resizing. If sharp is not available, returns the original buffer.
 */
export async function resizeImageIfNeeded(
  buffer: Buffer,
  mimeType: string,
): Promise<{ buffer: Buffer; mimeType: string }> {
  // If already within limits, return as-is
  if (buffer.length <= MAX_IMAGE_BYTES) {
    try {
      const sharp = await importSharp();
      if (sharp === null) return { buffer, mimeType };

      const metadata = await sharp(buffer).metadata();
      const width = metadata.width ?? 0;
      const height = metadata.height ?? 0;

      if (width <= MAX_IMAGE_DIMENSION_PX && height <= MAX_IMAGE_DIMENSION_PX) {
        return { buffer, mimeType };
      }
    } catch {
      return { buffer, mimeType };
    }
  }

  const sharp = await importSharp();
  if (sharp === null) {
    logger.warn('sharp not available; skipping image resize');
    return { buffer, mimeType };
  }

  // Resize pipeline: fit within dimension limit, then try quality steps
  const qualitySteps = [85, 70, 50, 30];

  for (const quality of qualitySteps) {
    try {
      const resized = await sharp(buffer)
        .resize(MAX_IMAGE_DIMENSION_PX, MAX_IMAGE_DIMENSION_PX, {
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({ quality, mozjpeg: true })
        .toBuffer();

      if (resized.length <= MAX_IMAGE_BYTES) {
        return { buffer: resized, mimeType: 'image/jpeg' };
      }
    } catch (err) {
      logger.warn('Resize attempt failed', { quality, error: String(err) });
    }
  }

  // Last resort: return the first resize attempt even if over limit
  try {
    const resized = await sharp(buffer)
      .resize(MAX_IMAGE_DIMENSION_PX, MAX_IMAGE_DIMENSION_PX, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: 30, mozjpeg: true })
      .toBuffer();
    return { buffer: resized, mimeType: 'image/jpeg' };
  } catch {
    return { buffer, mimeType };
  }
}

/**
 * Process a Slack file into an image content block or a text file tag.
 *
 * - Image files → download, detect MIME, resize, base64 → ImageContent
 * - Text files → download, extract text → <file> tag
 */
export async function processSlackFile(
  file: SlackFile,
  botToken: string,
): Promise<ProcessedFile | null> {
  const url = file.url_private;
  const name = file.name ?? `file_${Date.now()}`;

  if (url === undefined || url.length === 0) {
    logger.warn('File missing url_private, skipping', { name });
    return null;
  }

  let buffer: Buffer;
  try {
    buffer = await downloadSlackFile(url, botToken);
  } catch (err) {
    logger.warn('Failed to download Slack file for vision', {
      name,
      error: String(err),
    });
    return null;
  }

  // Detect actual MIME type from magic bytes
  const detectedMime = inferMimeTypeFromBuffer(buffer);
  const declaredMime = file.mimetype;
  const effectiveMime = detectedMime ?? declaredMime;

  // Image file → process for vision
  if (effectiveMime !== undefined && SUPPORTED_IMAGE_MIMES.has(effectiveMime)) {
    try {
      const { buffer: resized, mimeType: finalMime } = await resizeImageIfNeeded(
        buffer,
        effectiveMime,
      );
      const base64 = resized.toString('base64');

      return {
        content: {
          type: 'image',
          data: base64,
          mimeType: finalMime,
        },
        filename: name,
      } satisfies ProcessedImage;
    } catch (err) {
      logger.warn('Failed to process image for vision', {
        name,
        error: String(err),
      });
      return null;
    }
  }

  // Non-image text file → extract content as <file> tag
  if (isLikelyTextFile(effectiveMime, name)) {
    try {
      const textContent = buffer.toString('utf-8');
      const safeName = name.replace(/[<>&"]/g, '_');
      const safeMime = (effectiveMime ?? 'text/plain').replace(/[<>&"]/g, '_');
      // Truncate very large text files
      const truncated =
        textContent.length > MAX_TEXT_FILE_CHARS
          ? textContent.slice(0, MAX_TEXT_FILE_CHARS) + '\n[...truncated]'
          : textContent;

      return {
        tag: `<file name="${safeName}" mime="${safeMime}">\n${truncated}\n</file>`,
        filename: name,
      } satisfies ProcessedTextFile;
    } catch (err) {
      logger.warn('Failed to extract text from file', {
        name,
        error: String(err),
      });
      return null;
    }
  }

  logger.debug('Unsupported file type, skipping vision processing', {
    name,
    mime: effectiveMime,
  });
  return null;
}

const MAX_TEXT_FILE_CHARS = 50_000;

const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'csv', 'json', 'xml', 'yaml', 'yml', 'toml',
  'ts', 'js', 'py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h',
  'html', 'css', 'scss', 'less', 'sql', 'sh', 'bash', 'zsh',
  'log', 'ini', 'conf', 'cfg', 'env', 'gitignore', 'dockerfile',
]);

function isLikelyTextFile(mime: string | undefined, filename: string): boolean {
  if (mime !== undefined && mime.startsWith('text/')) return true;
  if (mime === 'application/json' || mime === 'application/xml') return true;

  const ext = filename.split('.').pop()?.toLowerCase();
  if (ext !== undefined && TEXT_EXTENSIONS.has(ext)) return true;

  return false;
}

// Lazy-import sharp to make it an optional dependency
let sharpModule: typeof import('sharp') | null | undefined;

async function importSharp(): Promise<typeof import('sharp') | null> {
  if (sharpModule !== undefined) return sharpModule;
  try {
    sharpModule = (await import('sharp')).default as unknown as typeof import('sharp');
    return sharpModule;
  } catch {
    sharpModule = null;
    return null;
  }
}
