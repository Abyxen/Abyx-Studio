'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { createAgentEngine, ModelRouter } = require('../agent');

// Verify that the local model on 127.0.0.1:10086 is reachable
async function isLocalModelOnline() {
  return new Promise((resolve) => {
    const req = http.get('http://127.0.0.1:10086/v1/models', { timeout: 3000 }, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

test('Real Model E2E: Multi-Agent Workflow on AbyxV2 9B (port 10086)', async (t) => {
  const online = await isLocalModelOnline();
  if (!online) {
    t.skip('Local model server (http://127.0.0.1:10086) is offline, skipping live inference test.');
    return;
  }

  const modelRouter = new ModelRouter({
    localEndpoint: 'http://127.0.0.1:10086/v1/chat/completions',
    timeoutMs: 120000
  });

  const engine = createAgentEngine({
    approvedRoots: [process.cwd()],
    modelRouter
  });

  const liveTasks = [
    {
      id: 'task_arch',
      description: 'System Architect: In 1-2 concise bullet points, summarize the security advantage of path guarding.',
      agentId: 'architect',
      dependencies: []
    },
    {
      id: 'task_code',
      description: 'Senior Engineer: In 1 sentence, explain why topological sorting is used in DAG scheduling.',
      agentId: 'coder',
      dependencies: ['task_arch']
    }
  ];

  const events = [];
  const startTime = Date.now();

  const report = await engine.orchestrator.orchestrate({
    goal: 'Demonstrate live multi-agent inference on AbyxV2 9B model',
    customTasks: liveTasks,
    onEvent: (type, data) => events.push({ type, data })
  });

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`Live inference completed in ${durationSec}s. Total tasks: ${report.totalTasks}`);

  assert.strictEqual(report.status, 'success');
  assert.strictEqual(report.completedTasks, 2);
  assert.ok(events.some(e => e.type === 'orchestration:start'));
  assert.ok(events.some(e => e.type === 'task:start'));
  assert.ok(events.some(e => e.type === 'task:complete'));
  assert.ok(events.some(e => e.type === 'orchestration:done'));

  const completedArch = report.tasks.find(t => t.id === 'task_arch');
  const completedCode = report.tasks.find(t => t.id === 'task_code');

  assert.ok(completedArch && completedArch.result.length > 10);
  assert.ok(completedCode && completedCode.result.length > 10);

  console.log(`Architect Result: ${completedArch.result.slice(0, 150)}...`);
  console.log(`Coder Result: ${completedCode.result.slice(0, 150)}...`);
});
