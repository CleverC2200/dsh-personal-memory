import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
const workbench = process.env.DSH_WORKBENCH_CHECKOUT ?? resolve(import.meta.dirname, '../../dsh-agent-workbench');
const result = spawnSync(process.execPath, [resolve(workbench, 'scripts/check-source-comments.mjs'), '--root', process.cwd(), ...process.argv.slice(2)], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
