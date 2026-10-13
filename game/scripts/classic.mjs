// Runs an npm script with DWU_EDITION=classic set (cross-platform; `VAR=x cmd` does not work in Windows' npm shell).
// Usage: node scripts/classic.mjs <npm script> [...]   e.g. build, dev, desktop:dev
import { spawnSync } from 'node:child_process';

const [script, ...rest] = process.argv.slice(2);
if (!script) throw new Error('usage: node scripts/classic.mjs <npm script>');
const r = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', script, ...(rest.length > 0 ? ['--', ...rest] : [])], { stdio: 'inherit', env: { ...process.env, DWU_EDITION: 'classic' }, shell: process.platform === 'win32' });
process.exit(r.status ?? 1);
