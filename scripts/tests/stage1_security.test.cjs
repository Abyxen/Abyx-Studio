'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const PolicyEngine = require('../../agent/policy_engine');
const PathGuard = require('../../agent/path_guard');
const WorkspaceFsTool = require('../../agent/tools/fs_tool');
const ControlledTerminalTool = require('../../agent/tools/terminal_tool');
const { validateLocalRequest, redactError } = require('../../security/local_server_guard');
const { runSilentProcess } = require('../../services/silent_process');
const SandboxPlugin = require('../../harness/plugins/provider_sandbox');

async function withWorkspace(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'abyx-stage1-'));
  try { return await run(root); } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test('shell grammar rejects chaining, pipes, substitutions, redirection and encoded shell entrypoints', () => {
  const shellInjection = [
    'git status; whoami', 'git status && whoami', 'git status | whoami',
    'git status > output.txt', 'git status $(whoami)', 'git status `whoami`',
    'git status < input.txt'
  ];
  for (const command of shellInjection) {
    const decision = PolicyEngine.commandRisk(command);
    assert.equal(PolicyEngine.parseCommand(command), null, command);
    assert.equal(decision.category, 'DENIED', command);
  }
  for (const command of ['git status%3Bwhoami', 'powershell -EncodedCommand SQBFAFgA']) {
    assert.notEqual(PolicyEngine.commandRisk(command).category, 'READ_ONLY', command);
  }
});

test('only structured read-only commands are safe; unknown tools default deny', () => {
  assert.equal(PolicyEngine.commandRisk('git status --short').category, 'READ_ONLY');
  assert.equal(PolicyEngine.commandRisk('node --version').category, 'READ_ONLY');
  assert.equal(PolicyEngine.commandRisk('npm install').category, 'APPROVAL_REQUIRED');
  assert.equal(PolicyEngine.commandRisk('powershell -NoProfile').category, 'DENIED');
  assert.equal(PolicyEngine.commandRisk('git diff --output=outside.txt').category, 'DENIED');
});

test('approval is bound to exact command and working directory', () => {
  const policy = new PolicyEngine({ allowTerminal: true });
  const approvedArgs = { command: 'npm install', cwd: 'project' };
  const approval = policy.requestApproval({ toolName: 'execute_terminal_command', args: approvedArgs, riskLevel: 'REQUIRES_APPROVAL' });
  policy.resolveApproval(approval.id, 'approve');
  assert.equal(policy.validateApprovedCall(approval.id, 'execute_terminal_command', approvedArgs), true);
  assert.equal(policy.validateApprovedCall(approval.id, 'execute_terminal_command', approvedArgs), false);
  const second = policy.requestApproval({ toolName: 'execute_terminal_command', args: approvedArgs, riskLevel: 'REQUIRES_APPROVAL' });
  policy.resolveApproval(second.id, 'approve');
  assert.equal(policy.validateApprovedCall(second.id, 'execute_terminal_command', { ...approvedArgs, cwd: '.' }), false);
  const third = policy.requestApproval({ toolName: 'execute_terminal_command', args: approvedArgs, riskLevel: 'REQUIRES_APPROVAL' });
  policy.resolveApproval(third.id, 'approve');
  assert.equal(policy.validateApprovedCall(third.id, 'execute_terminal_command', { ...approvedArgs, command: 'npm install package' }), false);
});

test('expired approval cannot be resolved into execution authority', async () => {
  const policy = new PolicyEngine({ allowTerminal: true, approvalTimeoutMs: 1 });
  const approval = policy.requestApproval({ toolName: 'execute_terminal_command', args: { command: 'npm install', cwd: '.' }, riskLevel: 'REQUIRES_APPROVAL' });
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.throws(() => policy.resolveApproval(approval.id, 'approve'), /expired/i);
  assert.equal(approval.status, 'timed_out');
});

test('direct terminal API authorization requires a separate exact approval round trip', () => {
  const policy = new PolicyEngine({ allowTerminal: true });
  const first = policy.authorizeTerminalApiRequest({ command: 'npm install', cwd: 'project' });
  assert.equal(first.allowed, false);
  assert.equal(first.requiresApproval, true);
  assert.equal(policy.authorizeTerminalApiRequest({ command: 'npm install package', cwd: 'project', approvalId: first.approvalId, approved: true }).allowed, false);
  const second = policy.authorizeTerminalApiRequest({ command: 'npm install', cwd: 'project' });
  const approved = policy.authorizeTerminalApiRequest({ command: 'npm install', cwd: 'project', approvalId: second.approvalId, approved: true });
  assert.equal(approved.allowed, true);
  assert.equal(policy.authorizeTerminalApiRequest({ command: 'npm install', cwd: 'project', approvalId: second.approvalId, approved: true }).allowed, false);
});

test('path guard blocks traversal, symlink escapes and missing descendants through symlinks', () => {
  withWorkspace(root => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'abyx-outside-'));
    try {
      const guard = new PathGuard(root);
      assert.throws(() => guard.resolveSafePath('../outside.txt', { allowCreate: true }));
      const link = path.join(root, 'escape');
      try { fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir'); }
      catch (error) { if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) return; throw error; }
      assert.throws(() => guard.resolveSafePath(path.join('escape', 'new', 'secret.txt'), { allowCreate: true }));
      assert.throws(() => guard.resolveSafePath(link));
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});

test('filesystem writes use exclusive temporary files and refuse symlink destinations', async () => {
  await withWorkspace(async root => {
    const guard = new PathGuard(root);
    const tool = new WorkspaceFsTool(guard);
    const result = await tool.write({ filePath: 'nested/report.txt', content: 'safe' });
    assert.equal(result.success, true);
    assert.equal(fs.readFileSync(path.join(root, 'nested', 'report.txt'), 'utf8'), 'safe');
    const outside = path.join(root, '..', `${path.basename(root)}-outside.txt`);
    fs.writeFileSync(outside, 'keep');
    try {
      fs.symlinkSync(outside, path.join(root, 'linked.txt'), 'file');
      assert.throws(() => guard.resolveSafePath('linked.txt'));
      assert.equal((await tool.write({ filePath: 'linked.txt', content: 'overwrite' })).success, false);
      assert.equal(fs.readFileSync(outside, 'utf8'), 'keep');
    } catch (error) {
      if (!['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) throw error;
    } finally { fs.rmSync(outside, { force: true }); }
  });
});

test('filesystem write revalidation catches a parent swap at the temporary-file boundary', async () => {
  await withWorkspace(async root => {
    const guard = new PathGuard(root);
    const tool = new WorkspaceFsTool(guard);
    const parent = path.join(root, 'folder');
    const outside = path.join(root, 'outside');
    fs.mkdirSync(parent);
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(parent, 'report.txt'), 'workspace-original');
    fs.writeFileSync(path.join(outside, 'report.txt'), 'outside-protected');
    const originalOpen = fs.openSync;
    let swapped = false;
    fs.openSync = function (filePath, ...args) {
      if (!swapped && String(filePath).includes('.abyx-') && String(filePath).endsWith('.tmp')) {
        swapped = true;
        fs.renameSync(parent, path.join(root, 'folder-held'));
        fs.symlinkSync(outside, parent, process.platform === 'win32' ? 'junction' : 'dir');
      }
      return originalOpen.call(fs, filePath, ...args);
    };
    let result;
    try { result = await tool.write({ filePath: 'folder/report.txt', content: 'attack' }); }
    finally { fs.openSync = originalOpen; }
    assert.equal(swapped, true);
    assert.equal(result.success, false);
    assert.equal(fs.readFileSync(path.join(outside, 'report.txt'), 'utf8'), 'outside-protected');
    assert.equal(fs.readFileSync(path.join(root, 'folder-held', 'report.txt'), 'utf8'), 'workspace-original');
  });
});

test('terminal denies unapproved state-changing commands before spawning', async () => {
  await withWorkspace(async root => {
    const policy = new PolicyEngine({ allowTerminal: true });
    const terminal = new ControlledTerminalTool(new PathGuard(root), { policyEngine: policy });
    const result = await terminal.execute({ command: 'npm install', cwd: '.' });
    assert.equal(result.success, false);
    assert.equal(result.requiresApproval, true);
    assert.equal(fs.existsSync(path.join(root, 'node_modules')), false);
  });
});

test('terminal executes an approved exact fixture once and refuses replay', async () => {
  await withWorkspace(async root => {
    fs.writeFileSync(path.join(root, 'fixture.cjs'), "require('node:fs').writeFileSync('marker.txt','ran')", 'utf8');
    const policy = new PolicyEngine({ allowTerminal: true });
    const terminal = new ControlledTerminalTool(new PathGuard(root), { policyEngine: policy, maxTimeoutMs: 5000 });
    const args = { command: 'node fixture.cjs', cwd: '.' };
    const approval = policy.requestApproval({ toolName: 'execute_terminal_command', args, riskLevel: 'REQUIRES_APPROVAL' });
    policy.resolveApproval(approval.id, 'approve');
    const first = await terminal.execute({ ...args, approvalId: approval.id });
    assert.equal(first.success, true);
    assert.equal(fs.readFileSync(path.join(root, 'marker.txt'), 'utf8'), 'ran');
    const replay = await terminal.execute({ ...args, approvalId: approval.id });
    assert.equal(replay.success, false);
    assert.equal(replay.requiresApproval, true);
  });
});

test('provider refuses code execution without an OS isolation provider', async () => {
  let sandbox;
  SandboxPlugin.apply({ provide(name, service) { if (name === 'sandbox') sandbox = service; } });
  const result = await sandbox.runCode({ language: 'javascript', code: 'process.exit(1)' });
  assert.equal(result.success, false);
  assert.equal(result.isolated, false);
});

test('local API rejects hostile Host and Origin values and redacts sensitive errors', () => {
  assert.equal(validateLocalRequest({ headers: { host: 'localhost:1420', origin: 'http://localhost:1420' } }, 1420).ok, true);
  assert.equal(validateLocalRequest({ headers: { host: 'attacker.example:1420' } }, 1420).ok, false);
  assert.equal(validateLocalRequest({ headers: { host: 'localhost:1420', origin: 'http://attacker.example' } }, 1420).ok, false);
  assert.equal(validateLocalRequest({ headers: { host: 'attacker.localhost:1420', origin: 'http://attacker.localhost:1420' } }, 1420).ok, false);
  assert.equal(validateLocalRequest({ headers: { host: 'localhost:1420', origin: 'http://tauri.localhost:1420' } }, 1420).ok, false);
  assert.equal(validateLocalRequest({ headers: { host: 'localhost:8080', origin: 'http://localhost:8080' } }, 1420).ok, false);
  assert.equal(validateLocalRequest({ headers: { host: 'localhost:1420', 'sec-fetch-site': 'cross-site' } }, 1420).ok, false);
  assert.equal(validateLocalRequest({ headers: { host: 'localhost:1420', referer: 'https://attacker.example/' } }, 1420).ok, false);
  assert.equal(redactError(new Error('API key abc123 leaked at C:\\secret\\settings.json')), 'Request failed');
});

test('terminal environment removes credential variables', async () => {
  const policy = new PolicyEngine({ allowTerminal: true });
  const terminal = new ControlledTerminalTool(new PathGuard(os.tmpdir()), { policyEngine: policy });
  const previous = process.env.ABYX_TEST_SECRET_TOKEN;
  process.env.ABYX_TEST_SECRET_TOKEN = 'must-not-be-forwarded';
  try { assert.equal(terminal.getSanitizedEnv().ABYX_TEST_SECRET_TOKEN, undefined); }
  finally {
    if (previous === undefined) delete process.env.ABYX_TEST_SECRET_TOKEN;
    else process.env.ABYX_TEST_SECRET_TOKEN = previous;
  }
});

test('process runner observes abort and terminates the underlying child', async () => {
  const controller = new AbortController();
  const promise = runSilentProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 5000, signal: controller.signal });
  setTimeout(() => controller.abort(), 100);
  const result = await promise;
  assert.equal(result.ok, false);
  assert.equal(result.killed, true);
  assert.equal(result.timedOut, false);
});

test('process runner terminates a spawned child tree on abort', async () => {
  await withWorkspace(async root => {
    const scriptPath = path.join(root, 'tree.cjs');
    fs.writeFileSync(scriptPath, [
      "const fs=require('node:fs');",
      "const {spawn}=require('node:child_process');",
      "const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});",
      "fs.writeFileSync('child.pid',String(child.pid));",
      "setInterval(()=>{},1000);"
    ].join('\n'));
    const controller = new AbortController();
    const execution = runSilentProcess(process.execPath, [scriptPath], { cwd: root, timeoutMs: 5000, signal: controller.signal });
    const pidFile = path.join(root, 'child.pid');
    const waitStart = Date.now();
    while (!fs.existsSync(pidFile) && Date.now() - waitStart < 2000) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(fs.existsSync(pidFile), true, 'child process did not start');
    const childPid = Number(fs.readFileSync(pidFile, 'utf8'));
    controller.abort();
    const result = await execution;
    assert.equal(result.killed, true);
    const stopStart = Date.now();
    let alive = true;
    while (alive && Date.now() - stopStart < 2000) {
      try { process.kill(childPid, 0); } catch (error) { alive = error.code === 'EPERM'; }
      if (alive) await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.equal(alive, false, 'child process survived parent cancellation');
  });
});

test('process runner stops output floods at the configured capture limit', async () => {
  const result = await runSilentProcess(process.execPath, ['-e', "setInterval(() => process.stdout.write('x'.repeat(65536)), 1)"], { timeoutMs: 5000, maxOutputBytes: 1024 });
  assert.equal(result.ok, false);
  assert.equal(result.killed, true);
  assert.ok(result.stdout.length <= 1024);
});

test('current runtime platform and child-process capability are reported for the test record', () => {
  const result = spawnSync(process.execPath, ['--version'], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0);
  assert.ok(process.platform);
});
