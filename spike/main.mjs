// M0 spike: run checks inside an Electron utilityProcess, print one JSON line per check, exit non-zero on failure.
// `electron spike/main.mjs --desk-hook <claude|codex> [json]` instead acts as the hook client (exec form, no shell).
import { app, utilityProcess } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const hookAt = process.argv.indexOf('--desk-hook');
if (hookAt !== -1) {
  const { runHook } = await import('./hook.mjs');
  await runHook(process.argv.slice(hookAt + 1));
  app.exit(0);
} else {
  app.whenReady().then(() => {
    const child = utilityProcess.fork(path.join(here, 'child.mjs'), [], {
      stdio: 'pipe',
      env: { ...process.env, SPIKE_MAIN_EXEC: process.execPath, SPIKE_APP: path.join(here, 'main.mjs') },
    });
    // Windows GUI binaries don't hand an inherited console to utility processes: relay their output.
    child.stdout.on('data', (d) => process.stdout.write(d));
    child.stderr.on('data', (d) => process.stderr.write(d));
    child.on('exit', (code) => {
      console.log(JSON.stringify({ check: 'utility-exit', code }));
      app.exit(code);
    });
  });
}
