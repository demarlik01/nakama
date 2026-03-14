#!/usr/bin/env node
/**
 * nakama CLI entry point.
 *
 * Usage:
 *   nakama auth <login|set-key|status>
 */
import { runAuthCli } from './auth.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'auth':
      await runAuthCli(args.slice(1));
      break;
    default:
      console.log('Usage: nakama <command>');
      console.log('');
      console.log('Commands:');
      console.log('  auth    — Manage LLM authentication');
      process.exit(command ? 1 : 0);
  }
}

main().catch((err: unknown) => {
  console.error('Fatal error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
