'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PathGuard,
  PolicyEngine,
  ToolGateway,
  TaskScheduler,
  AgentExecutionLoop,
  Orchestrator
} = require('../agent');

test('QA Failure Scenario 1: PathGuard blocks relative traversal and system paths', () => {
  const guard = new PathGuard({ approvedRoots: [process.cwd()] });

  assert.throws(() => {
    guard.resolveSafePath('../../Windows/explorer.exe');
  }, /outside approved workspace roots|denied/i);

  assert.throws(() => {
    guard.resolveSafePath('C:\\Windows\\System32\\cmd.exe');
  }, /system path denied|outside approved/i);
});

test('QA Failure Scenario 2: TerminalTool blocks dangerous command execution', async () => {
  const guard = new PathGuard({ approvedRoots: [process.cwd()] });
  const policy = new PolicyEngine({ mode: 'build' });
  policy.setPolicy('run_command', 'allow');
  const gateway = new ToolGateway({ pathGuard: guard, policyEngine: policy });

  const dangerousCommands = [
    'rm -rf /',
    'format c:',
    ':(){ :|:& };:',
    'shutdown /s'
  ];

  for (const cmd of dangerousCommands) {
    const res = await gateway.execute('run_command', { command: cmd });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.blocked, true);
  }
});

test('QA Failure Scenario 3: LspTool catches syntax errors with line numbers', async () => {
  const guard = new PathGuard({ approvedRoots: [process.cwd()] });
  const policy = new PolicyEngine({ mode: 'build' });
  const gateway = new ToolGateway({ pathGuard: guard, policyEngine: policy });

  const badJs = `
    const a = 10;
    function broken( {
      return a;
  `;

  const res = await gateway.execute('diagnostics', { content: badJs });
  assert.strictEqual(res.ok, false);
  assert.ok(res.errorsCount > 0);
  assert.ok(res.diagnostics[0].line > 0);
});

test('QA Failure Scenario 4: TaskScheduler detects circular dependency cycles', () => {
  const scheduler = new TaskScheduler({ maxConcurrency: 3 });

  // 3-node cycle: A -> B -> C -> A
  const cyclic = [
    { id: 'A', dependencies: ['C'] },
    { id: 'B', dependencies: ['A'] },
    { id: 'C', dependencies: ['B'] }
  ];

  assert.throws(() => {
    scheduler.validateDAG(cyclic);
  }, /circular dependency/i);
});

test('QA Failure Scenario 5: PolicyEngine denies destructive operations in Plan Mode', async () => {
  const policy = new PolicyEngine({ mode: 'plan' });

  const writeCheck = await policy.evaluate('write_file', { path: 'exploit.js' });
  assert.strictEqual(writeCheck.allowed, false);
  assert.match(writeCheck.reason, /PLAN MODE/i);

  const termCheck = await policy.evaluate('run_command', { command: 'node exploit.js' });
  assert.strictEqual(termCheck.allowed, false);
  assert.match(termCheck.reason, /PLAN MODE/i);
});

test('QA Failure Scenario 6: ExecutionLoop handles AbortSignal cancellation cleanly', async () => {
  const guard = new PathGuard({ approvedRoots: [process.cwd()] });
  const policy = new PolicyEngine({ mode: 'build' });
  const gateway = new ToolGateway({ pathGuard: guard, policyEngine: policy });

  const abortController = new AbortController();
  abortController.abort(); // Pre-aborted

  const loop = new AgentExecutionLoop({
    modelRouter: { chat: async () => ({}) },
    toolGateway: gateway,
    policyEngine: policy
  });

  const res = await loop.run({
    goal: 'Should abort immediately',
    signal: abortController.signal
  });

  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.cancelled, true);
});
