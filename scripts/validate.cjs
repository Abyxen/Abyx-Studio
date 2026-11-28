'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const commands = [
  { label: 'tests', command: process.platform === 'win32' ? 'npm.cmd' : 'npm', args: ['test'], cwd: root },
  { label: 'frontend build', command: process.platform === 'win32' ? 'npm.cmd' : 'npm', args: ['run', 'build'], cwd: path.join(root, 'app', 'frontend') }
];

for (const item of commands) {
  process.stdout.write(`\n[validate] ${item.label}\n`);
  const result = spawnSync(item.command, item.args, { cwd: item.cwd, stdio: 'inherit', shell: false });
  if (result.error) {
    process.stderr.write(`[validate] ${item.label} could not start: ${result.error.message}\n`);
    process.exitCode = 1;
    break;
  }
  if (result.status !== 0) {
    process.stderr.write(`[validate] ${item.label} failed with exit code ${result.status}\n`);
    process.exitCode = result.status || 1;
    break;
  }
}
