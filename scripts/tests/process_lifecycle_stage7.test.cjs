'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { ProcessLifecycleManager } = require('../../services/process_lifecycle_manager');

test('process manager never terminates a manifest-only PID and cleans an owned child', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'abyx-stage7-process-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const manager = new ProcessLifecycleManager(root);
  fs.writeFileSync(manager.manifestPath, JSON.stringify({ foreign: { id: 'foreign', pid: process.pid, role: 'llm' } }));

  const staleTermination = await manager.terminate('foreign', { gracefulTimeoutMs: 1 });
  assert.equal(staleTermination.ownershipVerified, false);
  assert.equal(process.kill(process.pid, 0), true);
  assert.equal(JSON.parse(fs.readFileSync(manager.manifestPath, 'utf8')).foreign.pid, process.pid);
  assert.equal((await manager.cleanupStaleProcesses()).terminated, 0);
  assert.ok(fs.existsSync(manager.manifestPath));
  assert.throws(() => manager.registerProcess('foreign', process.pid), /bare PIDs are not ownership proof/);

  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true });
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  manager.register('owned-child', child, { role: 'test' });
  const ownedTermination = await manager.terminate('owned-child', { gracefulTimeoutMs: 1500 });
  assert.equal(ownedTermination.ownershipVerified, true);
  assert.equal(ownedTermination.terminated, true);
  assert.equal(child.exitCode == null && child.signalCode == null, false);
});
