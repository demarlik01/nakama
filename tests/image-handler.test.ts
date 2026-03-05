import { describe, expect, it } from 'vitest';

import { inferMimeTypeFromBuffer } from '../src/slack/image-handler.js';

describe('image-handler', () => {
  describe('inferMimeTypeFromBuffer', () => {
    it('detects JPEG from magic bytes', () => {
      const buf = Buffer.alloc(16);
      buf[0] = 0xFF;
      buf[1] = 0xD8;
      buf[2] = 0xFF;
      expect(inferMimeTypeFromBuffer(buf)).toBe('image/jpeg');
    });

    it('detects PNG from magic bytes', () => {
      const buf = Buffer.alloc(16);
      buf[0] = 0x89;
      buf[1] = 0x50; // P
      buf[2] = 0x4E; // N
      buf[3] = 0x47; // G
      expect(inferMimeTypeFromBuffer(buf)).toBe('image/png');
    });

    it('detects GIF from magic bytes', () => {
      const buf = Buffer.alloc(16);
      buf.write('GIF8', 0, 'ascii');
      expect(inferMimeTypeFromBuffer(buf)).toBe('image/gif');
    });

    it('detects WEBP from magic bytes', () => {
      const buf = Buffer.alloc(16);
      buf.write('RIFF', 0, 'ascii');
      buf.write('WEBP', 8, 'ascii');
      expect(inferMimeTypeFromBuffer(buf)).toBe('image/webp');
    });

    it('returns null for unrecognized format', () => {
      const buf = Buffer.from('Hello, world!');
      expect(inferMimeTypeFromBuffer(buf)).toBeNull();
    });

    it('returns null for too-small buffer', () => {
      const buf = Buffer.alloc(4);
      expect(inferMimeTypeFromBuffer(buf)).toBeNull();
    });
  });
});
