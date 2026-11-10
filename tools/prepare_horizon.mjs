// Build the GAME from the Horizon Rust repository (never Horizon Launcher).
// Executed automatically by Tauri before dev/build, cross-platform Python discovery.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const candidates = process.platform === 'win32'
  ? [['py', ['-3']], ['python', []], ['python3', []]]
  : [['python3', []], ['python', []]];
let lastError = 'Python 3.10+ no está disponible';
for (const [program, prefix] of candidates) {
  const result = spawnSync(program, [...prefix, 'tools/horizon_from_source.py', ...process.argv.slice(2)],
    { cwd: fileURLToPath(new URL('..', import.meta.url)), stdio: 'inherit', env: process.env });
  if (result.error?.code === 'ENOENT') continue;
  if (result.error) { lastError = String(result.error); continue; }
  process.exit(result.status ?? 1);
}
console.error('[VIS Horizon Source]', lastError);
process.exit(1);
