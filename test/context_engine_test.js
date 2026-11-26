'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  SessionManager,
  ContextManager,
  AgentSharedMemory
} = require('../agent');

test('Conversation Persistence & Recovery After Restart', () => {
  const testDir = path.join(process.cwd(), 'app', 'data', 'test_context_sessions');
  const sm1 = new SessionManager({ sessionsDir: testDir });

  // Create session and append turns
  const session = sm1.createSession({
    id: 'persist_sess_01',
    goal: 'Build durable context engine',
    model: 'AbyxV2 9B.gguf'
  });

  sm1.recordTurn('persist_sess_01', {
    type: 'tool_execution',
    tool: 'read_file',
    result: { ok: true, content: 'export const ARCH = "Pi";' }
  });

  sm1.addCheckpoint('persist_sess_01', {
    summary: 'Turn 1 completed successfully',
    turnIndex: 1
  });

  // Simulate server restart by creating new SessionManager instance
  const sm2 = new SessionManager({ sessionsDir: testDir });
  const restored = sm2.restoreSession('persist_sess_01');

  assert.ok(restored);
  assert.strictEqual(restored.id, 'persist_sess_01');
  assert.strictEqual(restored.turnsCount, 1);
  assert.strictEqual(restored.turns.length, 1);
  assert.strictEqual(restored.transcript.length, 2); // init + turn 1
  assert.strictEqual(restored.checkpoints.length, 1);
  assert.strictEqual(restored.checkpoints[0].summary, 'Turn 1 completed successfully');

  // Clean up
  sm2.disposeSession('persist_sess_01');
  try { fs.rmSync(testDir, { recursive: true, force: true }); } catch (_) {}
});

test('Session Branching (Forking) preserves parent-child lineage', () => {
  const testDir = path.join(process.cwd(), 'app', 'data', 'test_branch_sessions');
  const sm = new SessionManager({ sessionsDir: testDir });

  // Parent session with 3 turns
  const parent = sm.createSession({
    id: 'parent_sess_01',
    goal: 'Explore architectural patterns'
  });

  sm.recordTurn('parent_sess_01', { type: 'tool', tool: 'search_files', query: 'agent' });
  sm.recordTurn('parent_sess_01', { type: 'tool', tool: 'read_file', path: 'agent/index.js' });
  sm.recordTurn('parent_sess_01', { type: 'final_answer', content: 'Agent index analyzed.' });

  assert.strictEqual(parent.turnsCount, 3);

  // Branch at turn 2
  const child = sm.branchSession('parent_sess_01', {
    fromTurnIndex: 2,
    newSessionId: 'child_branch_01',
    goal: 'Alternative branch from turn 2'
  });

  assert.ok(child);
  assert.strictEqual(child.id, 'child_branch_01');
  assert.strictEqual(child.parentId, 'parent_sess_01');
  assert.strictEqual(child.forkPointTurn, 2);
  assert.strictEqual(child.turns.length, 2);

  // Verify parent records child branch
  const updatedParent = sm.getSession('parent_sess_01');
  assert.ok(updatedParent.branches.includes('child_branch_01'));

  // Clean up
  sm.disposeSession('parent_sess_01');
  sm.disposeSession('child_branch_01');
  try { fs.rmSync(testDir, { recursive: true, force: true }); } catch (_) {}
});

test('Tool-Output Filtering truncates excessive observations', () => {
  const cm = new ContextManager({ maxToolOutputChars: 300 });

  // Small tool output is untouched
  const smallOutput = { ok: true, count: 5 };
  const res1 = cm.filterToolOutput(smallOutput, 'list_directory');
  assert.deepStrictEqual(res1, smallOutput);

  // Large tool output (>300 chars) is filtered cleanly
  const largeContent = 'A'.repeat(1500);
  const largeOutput = { ok: true, path: 'huge.txt', content: largeContent };
  const res2 = cm.filterToolOutput(largeOutput, 'read_file');

  assert.strictEqual(res2.ok, true);
  assert.strictEqual(res2._filtered, true);
  assert.strictEqual(res2._originalBytes > 1000, true);
  assert.ok(res2.preview.includes('chars truncated'));
});

test('Dynamic Context selectively injects relevant skills and memories', () => {
  const sharedMemory = new AgentSharedMemory();
  sharedMemory.recordFinding({
    agentId: 'security',
    text: 'SQL injection vulnerability discovered in authentication endpoint'
  });
  sharedMemory.recordFinding({
    agentId: 'designer',
    text: 'Dark mode tokens defined for border contrast'
  });

  const cm = new ContextManager({ sharedMemory });

  const availableSkills = [
    { id: 'web-security', name: 'Web Security', description: 'OWASP Top 10 auditing, auth and SQL injection prevention' },
    { id: 'banner-design', name: 'Banner Design', description: 'Social media image designs' },
    { id: 'game-development', name: 'Game Development', description: 'Phaser and canvas 2D game loops' }
  ];

  // Task related to security
  const ctx = cm.constructDynamicContext({
    taskQuery: 'Audit authentication for SQL injection and security flaws',
    availableSkills,
    mode: 'build'
  });

  // Only relevant skill is injected
  assert.deepStrictEqual(ctx.metadata.skillsInjected, ['Web Security']);
  // Only relevant memory finding is injected
  assert.strictEqual(ctx.metadata.memoriesInjectedCount, 1);
  assert.ok(ctx.messages[0].content.includes('SQL injection vulnerability discovered'));
  assert.ok(!ctx.messages[0].content.includes('Banner Design'));
});

test('Immutable Persistent Transcript Invariant', () => {
  const testDir = path.join(process.cwd(), 'app', 'data', 'test_immutable_sessions');
  const sm = new SessionManager({ sessionsDir: testDir });
  const cm = new ContextManager();

  const session = sm.createSession({
    id: 'immutable_sess_01',
    goal: 'Test persistent transcript immutability'
  });

  // Add 10 bulky turns
  for (let i = 1; i <= 10; i++) {
    sm.recordTurn('immutable_sess_01', {
      step: i,
      tool: 'read_file',
      result: `Bulky observation output for step ${i}: ` + 'X'.repeat(500)
    });
  }

  assert.strictEqual(session.transcript.length, 11); // init + 10 turns

  // Construct dynamic context with tight budget (triggers compaction)
  const ctx = cm.constructDynamicContext({
    session,
    taskQuery: session.goal,
    maxContextTokens: 1024
  });

  // The ephemeral working messages are compacted
  assert.ok(ctx.messages.length < session.transcript.length);

  // INVARIANT CHECK: The persistent transcript in session is 100% UNMODIFIED!
  assert.strictEqual(session.transcript.length, 11);
  assert.strictEqual(session.turns.length, 10);
  assert.ok(session.transcript[1].result.includes('Bulky observation output for step 1'));

  // Clean up
  sm.disposeSession('immutable_sess_01');
  try { fs.rmSync(testDir, { recursive: true, force: true }); } catch (_) {}
});

test('Long Conversations & Context Overflow Validation (Exit Condition)', () => {
  const cm = new ContextManager({
    defaultContextLimit: 4096,
    compactionThreshold: 0.75, // 3072 usable tokens
    recentMessagesCount: 4
  });

  // Simulate a 30-message long conversation with large tool observations
  const longMessages = [
    { role: 'system', content: 'You are an autonomous engineering agent.' },
    { role: 'user', content: 'Perform comprehensive refactoring across the repository' }
  ];

  for (let i = 1; i <= 25; i++) {
    longMessages.push({
      role: 'assistant',
      content: `I am analyzing file chunk ${i}`,
      tool_calls: [{ id: `call_${i}`, function: { name: 'read_file', arguments: `{"path": "file_${i}.js"}` } }]
    });
    longMessages.push({
      role: 'tool',
      tool_call_id: `call_${i}`,
      name: 'read_file',
      content: `Contents of file_${i}.js: ` + 'function code() { ... } '.repeat(40) // ~1000 chars per turn
    });
  }

  const rawTokens = cm.estimateTokens(longMessages);
  assert.ok(rawTokens > 6000, `Raw tokens (${rawTokens}) should exceed the 4096 context limit`);

  // Run dynamic context construction with compaction
  const session = { messages: longMessages, goal: 'Perform comprehensive refactoring' };
  const ctx = cm.constructDynamicContext({
    session,
    taskQuery: session.goal,
    maxContextTokens: 4096
  });

  // Context must remain strictly bounded under the usable limit!
  assert.ok(ctx.estimatedTokens <= ctx.budget.usableContext,
    `Compacted tokens (${ctx.estimatedTokens}) must not exceed usable context limit (${ctx.budget.usableContext})`);
  assert.strictEqual(ctx.validation.valid, true);
  assert.strictEqual(ctx.validation.overBudget, 0);

  // Verify recent turns were retained verbatim
  const lastMsg = ctx.messages[ctx.messages.length - 1];
  assert.ok(lastMsg.content.includes('Contents of file_25.js'));

  // Verify summary block exists
  const summaryMsg = ctx.messages.find(m => typeof m.content === 'string' && m.content.includes('[CONVERSATION CHECKPOINT SUMMARY]'));
  assert.ok(summaryMsg, 'Checkpoint summary must be present');
});
