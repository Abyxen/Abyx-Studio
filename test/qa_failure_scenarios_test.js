'use strict';

/**
 * ABYX QA Failure Scenarios & Edge Cases Verification Suite
 * Verifies system resilience against:
 * 1. DAG dependency cycles (A -> B -> A)
 * 2. Path traversal / escape attempts
 * 3. File ownership write collision detection
 * 4. LSP syntax pre-flight diff rejection
 * 5. Event store query filtering & persistence
 * 6. Task store recovery
 */

const assert = require('node:assert');
const path = require('node:path');
const {
  TaskScheduler,
  PathGuard,
  WorkspaceIsolationManager,
  LspTool,
  EventStore,
  TaskStore
} = require('../agent');

async function runQATests() {
  console.log('====================================================');
  console.log('ABYX QA FAILURE SCENARIOS & HARDENING SUITE');
  console.log('====================================================\n');

  let passed = 0;

  // 1. DAG Cycle Detection
  console.log('Test 1: DAG Dependency Cycle Rejection');
  const scheduler = new TaskScheduler({ maxConcurrency: 2 });
  scheduler.addTask({ id: 'task_a', title: 'Task A', dependsOn: ['task_b'] });
  scheduler.addTask({ id: 'task_b', title: 'Task B', dependsOn: ['task_a'] });
  try {
    await scheduler.execute();
    assert.fail('Expected scheduler to throw cycle error');
  } catch (err) {
    const isCycle = err.message.toLowerCase().includes('circular') || err.message.toLowerCase().includes('cycle');
    assert(isCycle, `Expected circular/cycle message, got: ${err.message}`);
    console.log('  PASS: Cycle successfully caught:', err.message);
    passed++;
  }

  // 2. Path Traversal Guard
  console.log('\nTest 2: Path Traversal Attack Rejection');
  const workspaceRoot = path.resolve(__dirname, '..', 'app', 'workspace');
  const pathGuard = new PathGuard([workspaceRoot]);
  const maliciousPaths = [
    '../../etc/passwd',
    '..\\..\\Windows\\System32',
    'C:/Windows/win.ini',
    'safe/../../secret.key'
  ];
  for (const mPath of maliciousPaths) {
    try {
      pathGuard.resolveSafePath(mPath);
      assert.fail(`PathGuard failed to block: ${mPath}`);
    } catch (err) {
      assert(err.message.includes('outside') || err.message.includes('Restricted') || err.message.includes('traversal') || err.message.includes('Access denied'), `Blocked as expected: ${err.message}`);
    }
  }
  console.log(`  PASS: Blocked ${maliciousPaths.length} path traversal attempts`);
  passed++;

  // 3. File Ownership Collision
  console.log('\nTest 3: File Ownership Lock Collision');
  const isolation = new WorkspaceIsolationManager(pathGuard);
  const lock1 = isolation.acquireLock('src/auth.js', 'task_1', 'write');
  assert.strictEqual(lock1.ok, true, 'First lock should succeed');
  const lock2 = isolation.acquireLock('src/auth.js', 'task_2', 'write');
  assert.strictEqual(lock2.ok, false, 'Second write lock on same file must fail');
  console.log('  PASS: Collision prevented with error:', lock2.error);
  isolation.releaseLocks('task_1');
  const lock3 = isolation.acquireLock('src/auth.js', 'task_2', 'write');
  assert.strictEqual(lock3.ok, true, 'Lock should succeed after release');
  isolation.releaseLocks('task_2');
  console.log('  PASS: File ownership lock release verified');
  passed++;

  // 4. LSP Pre-Flight Syntax Check Rejection
  console.log('\nTest 4: LSP Pre-Flight Diff Syntax Verification');
  const lsp = new LspTool(pathGuard);
  const invalidCode = 'function brokenSyntax() {\n  const x = [1, 2, 3;\n  return x;\n';
  const diag = lsp.checkDiagnostics({ content: invalidCode, filePath: 'test.js' });
  assert.strictEqual(diag.ok, false, 'LSP diagnostics must detect unclosed bracket');
  assert(diag.diagnostics.length > 0, 'Must have at least one diagnostic error');
  console.log('  PASS: LSP successfully detected syntax error:', diag.diagnostics[0]?.message);
  passed++;

  // 5. Event Store Persistence and Querying
  console.log('\nTest 5: Event Store In-Memory & Disk Querying');
  const eventStore = new EventStore({ maxMemoryBuffer: 50 });
  const testRunId = `test_run_${Date.now()}`;
  eventStore.append('task:started', { runId: testRunId, taskId: 't1' });
  eventStore.append('task:tool_call', { runId: testRunId, taskId: 't1', tool: 'fs_write' });
  eventStore.append('task:completed', { runId: testRunId, taskId: 't1' });

  const queryAll = eventStore.query({ runId: testRunId });
  assert.strictEqual(queryAll.length, 3, 'Must return all 3 events for runId');
  const queryTools = eventStore.query({ runId: testRunId, type: 'task:tool_call' });
  assert.strictEqual(queryTools.length, 1, 'Must filter by type');
  assert.strictEqual(queryTools[0].tool, 'fs_write');
  console.log('  PASS: Event Store query filter verified with 3 events');
  passed++;

  // 6. Task Store Recovery
  console.log('\nTest 6: Task Store Upsert and Retrieval');
  const taskStore = new TaskStore();
  const testOrch = {
    runId: `orch_qa_${Date.now()}`,
    goal: 'QA Persistence Test',
    status: 'completed',
    completedCount: 3,
    failedCount: 0
  };
  taskStore.saveOrchestration(testOrch);
  const retrieved = taskStore.getOrchestration(testOrch.runId);
  assert.strictEqual(retrieved.runId, testOrch.runId);
  assert.strictEqual(retrieved.status, 'completed');
  taskStore.deleteOrchestration(testOrch.runId);
  const afterDelete = taskStore.getOrchestration(testOrch.runId);
  assert.strictEqual(afterDelete, null);
  console.log('  PASS: Task Store save, get, and delete verified');
  passed++;

  console.log('\n====================================================');
  console.log(`ALL ${passed} QA FAILURE SCENARIOS VERIFIED (100% PASS)`);
  console.log('====================================================');
  return { passed };
}

if (require.main === module) {
  runQATests()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('\nQA TEST FAILED:', err);
      process.exit(1);
    });
}

module.exports = { runQATests };
