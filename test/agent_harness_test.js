'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const PathGuard = require('../agent/path_guard');
const PolicyEngine = require('../agent/policy_engine');
const GitAdapter = require('../agent/git_adapter');
const ToolGateway = require('../agent/tool_gateway');
const AgentExecutionLoop = require('../agent/execution_loop');

test('PathGuard prevents directory traversal and protects system directories', () => {
  const guard = new PathGuard({ approvedRoots: [process.cwd()] });
  
  // Safe path resolves
  const safe = guard.resolveSafePath('package.json');
  assert.ok(safe.startsWith(process.cwd()));

  // Directory traversal outside root throws
  assert.throws(() => {
    guard.resolveSafePath('../../../Windows/System32');
  }, /outside approved workspace roots|denied/i);

  // System blacklist throws
  assert.throws(() => {
    guard.resolveSafePath('C:\\Windows\\System32\\cmd.exe');
  }, /system path denied|outside approved/i);
});

test('PolicyEngine enforces plan mode vs build mode', async () => {
  const policy = new PolicyEngine({ mode: 'plan' });

  // Read tools allowed in plan mode
  const readEval = await policy.evaluate('read_file', { path: 'test.txt' });
  assert.strictEqual(readEval.allowed, true);

  // Write tools denied in plan mode
  const writeEval = await policy.evaluate('write_file', { path: 'test.txt', content: 'hello' });
  assert.strictEqual(writeEval.allowed, false);
  assert.match(writeEval.reason, /PLAN MODE/i);

  // Switch to build mode
  policy.setMode('build');
  policy.setPolicy('write_file', 'allow');
  const buildEval = await policy.evaluate('write_file', { path: 'test.txt', content: 'hello' });
  assert.strictEqual(buildEval.allowed, true);
});

test('ToolGateway executes registered tools safely', async () => {
  const guard = new PathGuard({ approvedRoots: [process.cwd()] });
  const policy = new PolicyEngine({ mode: 'build' });
  policy.setPolicy('read_file', 'allow');
  policy.setPolicy('write_file', 'allow');
  policy.setPolicy('run_command', 'allow');
  policy.setPolicy('diagnostics', 'allow');

  const gateway = new ToolGateway({ pathGuard: guard, policyEngine: policy });

  // Test list_directory
  const listRes = await gateway.execute('list_directory', { path: '.' });
  assert.strictEqual(listRes.ok, true);
  assert.ok(listRes.count > 0);

  // Test LSP diagnostics on valid JS
  const diagRes = await gateway.execute('diagnostics', { content: 'const a = 10; function test() { return a * 2; }' });
  assert.strictEqual(diagRes.ok, true);
  assert.strictEqual(diagRes.errorsCount, 0);

  // Test LSP diagnostics on invalid JS
  const badDiag = await gateway.execute('diagnostics', { content: 'const a = ; function bad({' });
  assert.strictEqual(badDiag.ok, false);
  assert.ok(badDiag.errorsCount > 0);

  // Test Terminal blocked command
  const blockRes = await gateway.execute('run_command', { command: 'rm -rf /' });
  assert.strictEqual(blockRes.ok, false);
  assert.strictEqual(blockRes.blocked, true);
});

test('AgentExecutionLoop handles state transitions and compaction', async () => {
  const guard = new PathGuard({ approvedRoots: [process.cwd()] });
  const policy = new PolicyEngine({ mode: 'build' });
  const gateway = new ToolGateway({ pathGuard: guard, policyEngine: policy });

  // Mock model router for testing
  const mockModelRouter = {
    chat: async ({ messages }) => {
      return {
        choices: [
          {
            message: {
              content: 'Execution completed successfully.',
              reasoning_content: 'Thought process verified.'
            }
          }
        ]
      };
    }
  };

  const loop = new AgentExecutionLoop({
    modelRouter: mockModelRouter,
    toolGateway: gateway,
    policyEngine: policy,
    options: { maxSteps: 3 }
  });

  const events = [];
  const res = await loop.run({
    goal: 'Test single agent turn',
    onEvent: (type, data) => events.push(type)
  });

  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.completed, true);
  assert.strictEqual(res.result, 'Execution completed successfully.');
  assert.ok(events.includes('step:start'));
  assert.ok(events.includes('reasoning:start'));
  assert.ok(events.includes('step:answer'));
  assert.ok(events.includes('run:completed'));
});
