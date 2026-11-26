'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createAgentEngine,
  TaskScheduler,
  TaskStore,
  AgentSharedMemory,
  MessageBus,
  AgentRegistry,
  Orchestrator
} = require('../agent');

test('TaskScheduler validates DAG, detects cycles, and sorts topologically', () => {
  const scheduler = new TaskScheduler({ maxConcurrency: 2 });

  // Valid DAG: task_1 -> task_2 -> task_3
  const validTasks = [
    { id: 'task_1', dependencies: [] },
    { id: 'task_2', dependencies: ['task_1'] },
    { id: 'task_3', dependencies: ['task_2'] }
  ];

  assert.doesNotThrow(() => {
    scheduler.validateDAG(validTasks);
  });

  const sorted = scheduler.topologicalSort(validTasks);
  assert.deepStrictEqual(sorted.map(t => t.id), ['task_1', 'task_2', 'task_3']);

  // Circular dependency: task_1 -> task_2 -> task_1
  const cyclicTasks = [
    { id: 'task_1', dependencies: ['task_2'] },
    { id: 'task_2', dependencies: ['task_1'] }
  ];

  assert.throws(() => {
    scheduler.validateDAG(cyclicTasks);
  }, /circular dependency/i);
});

test('AgentRegistry lists 12 specialized agents and supports custom registration', () => {
  const registry = new AgentRegistry();
  const list = registry.list();
  assert.ok(list.length >= 12, 'should list at least 12 specialized agents');
  
  const architect = registry.get('architect');
  assert.ok(architect);
  assert.strictEqual(architect.role, 'Architecture & System Design');

  const custom = registry.registerCustom({
    id: 'crypto_analyst',
    name: 'Crypto Analyst',
    role: 'Cryptographic Security'
  });

  assert.strictEqual(custom.id, 'crypto_analyst');
  assert.ok(registry.list().length >= 13);
});

test('AgentSharedMemory and MessageBus support multi-agent communication', () => {
  const memory = new AgentSharedMemory();
  const bus = new MessageBus();

  // Test shared memory
  memory.set('db_schema', { users: 'id, name, email' }, 'architect');
  assert.deepStrictEqual(memory.get('db_schema'), { users: 'id, name, email' });

  const finding = memory.recordFinding({
    agentId: 'security',
    text: 'SQL injection potential discovered in query'
  });
  assert.ok(finding.id);
  assert.strictEqual(memory.getAllFindings().length, 1);

  const searchRes = memory.search('SQL injection');
  assert.strictEqual(searchRes.findings.length, 1);

  // Test MessageBus direct message
  let received = null;
  bus.on('message:coder', (msg) => { received = msg; });
  bus.sendDirect({ from: 'architect', to: 'coder', message: 'Proceed with table creation' });

  assert.ok(received);
  assert.strictEqual(received.from, 'architect');
  assert.strictEqual(received.message, 'Proceed with table creation');
});

test('Orchestrator executes multi-agent DAG workflow to completion', async () => {
  const mockModel = {
    chat: async ({ messages }) => {
      const prompt = messages[messages.length - 1].content;
      return {
        choices: [
          {
            message: {
              content: `Plan approved for: ${prompt.slice(0, 30)}`,
              reasoning_content: 'Verified step dependencies.'
            }
          }
        ]
      };
    }
  };

  const engine = createAgentEngine({
    approvedRoots: [process.cwd()],
    modelRouter: mockModel
  });

  const customTasks = [
    { id: 't1', description: 'Design API contract', agentId: 'architect', dependencies: [] },
    { id: 't2', description: 'Implement endpoints', agentId: 'coder', dependencies: ['t1'] }
  ];

  const events = [];
  const report = await engine.orchestrator.orchestrate({
    goal: 'Build secure authentication API',
    customTasks,
    onEvent: (type, data) => events.push(type)
  });

  assert.strictEqual(report.status, 'success');
  assert.strictEqual(report.totalTasks, 2);
  assert.strictEqual(report.completedTasks, 2);
  assert.ok(events.includes('orchestration:start'));
  assert.ok(events.includes('orchestration:plan'));
  assert.ok(events.includes('task:complete'));
  assert.ok(events.includes('orchestration:done'));
});
