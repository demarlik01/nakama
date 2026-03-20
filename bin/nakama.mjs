#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(here, '..');
const distEntry = resolve(rootDir, 'dist/cli/index.js');
const srcEntry = resolve(rootDir, 'src/cli/index.ts');

if (existsSync(distEntry)) {
  await import(pathToFileURL(distEntry).href);
} else {
  const { tsImport } = await import('tsx/esm/api');
  await tsImport(pathToFileURL(srcEntry).href, import.meta.url);
}
