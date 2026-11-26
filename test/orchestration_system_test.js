'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const Orchestrator = require('../agent/orchestrator');
const AgentRegistry = require('../agent/agent_registry');
const TaskScheduler = require('../agent/scheduler');
const WorkflowCheckpointer = require('../agent/workflow_checkpointer');
const PathGuard = require('../agent/path_guard');
const GitAdapter = require('../agent/git_adapter');
const ToolGateway = require('../agent/tool_gateway');

const workspaceRoot = path.resolve(__dirname, '..');
const testSandbox = path.join(workspaceRoot, 'test', '_fixtures_orch');

// Mock model router for deterministic orchestration testing
class MockModelRouter {
  constructor() {
    this.calls = [];
  }

  async chat(params) {
    this.calls.push(params);
    const userPrompt = params.messages?.find(m => m.role === 'user')?.content || '';
    
    // Simulate failure on specific test tasks
    if (userPrompt.includes('TRIGGER_FAILURE')) {
      throw new Error('Simulated task execution failure');
    }

    return {
      choices: [
        {
          message: {
            content: `Completed: ${userPrompt.slice(0, 50)}... Implementation verified.`,
            reasoning_content: 'Step 1: Analyzed input. Step 2: Generated solution.'
          }
        }
      ]
    };
  }
}

function setupOrchestrationEnvironment() {
  if (!fs.existsSync(testSandbox)) {
    fs.mkdirSync(testSandbox, { recursive: true });
  }

  const pathGuard = new PathGuard(workspaceRoot);
  const gitAdapter = new GitAdapter(pathGuard);
  const gateway = new ToolGateway({ pathGuard, gitAdapter });
  const modelRouter = new MockModelRouter();

  const orchestrator = new Orchestrator({
    modelRouter,
    toolGateway: gateway,
    options: {
      workspaceRoot: testSandbox,
      concurrency: 2
    }
  });

  return { orchestrator, modelRouter };
}

test('Orchestrator: Specialist Roles Registration (Planner, Researcher, Developer, Debugger, Reviewer, Tester)', () => {
  const registry = new AgentRegistry();
  const requiredRoles = ['planner', 'researcher', 'developer', 'debugger', 'reviewer', 'tester'];

  for (const roleId of requiredRoles) {
    const agent = registry.get(roleId);
    assert.ok(agent, `Role '${roleId}' must exist in AgentRegistry`);
    assert.ok(typeof agent.name === 'string' && agent.name.length > 0, `${roleId} must have name`);
    assert.ok(typeof agent.systemPrompt === 'string' && agent.systemPrompt.length > 0, `${roleId} must have systemPrompt`);
    assert.ok(typeof agent.description === 'string', `${roleId} must have description`);
  }

  // Verify core specialist roles exist
  assert.ok(registry.get('planner'), 'planner role must exist');
  assert.ok(registry.get('developer'), 'developer role must exist');
  assert.ok(registry.get('tester'), 'tester role must exist');
  assert.ok(registry.get('reviewer'), 'reviewer role must exist');
  assert.ok(registry.get('debugger'), 'debugger role must exist');
  assert.ok(registry.get('researcher'), 'researcher role must exist');
});

test('Orchestrator: Single-Agent vs Multi-Agent Execution Routing', async () => {
  const { orchestrator } = setupOrchestrationEnvironment();

  // Simple, focused goal -> single-agent execution without DAG overhead
  const simpleReport = await orchestrator.orchestrate({
    goal: 'Read and explain package.json configuration'
  });
  assert.equal(simpleReport.status, 'success');
  assert.equal(simpleReport.mode, 'single_agent', 'should use single_agent mode for simple tasks');
  assert.equal(simpleReport.totalTasks, 1);

  // Complex multi-step goal -> decomposes into multi-agent DAG
  const multiReport = await orchestrator.orchestrate({
    goal: 'Build and test multi-agent payment processing pipeline with full architecture review'
  });
  assert.equal(multiReport.status, 'success');
  assert.ok(multiReport.totalTasks >= 3, 'should decompose into multi-agent DAG');
  assert.equal(multiReport.completedTasks, multiReport.totalTasks);
});

test('Orchestrator: Dependency-Aware DAG Execution & Topological Sequencing', async () => {
  const { orchestrator } = setupOrchestrationEnvironment();

  const customTasks = [
    { id: 'step_1', description: 'Step 1: Schema design', agentId: 'planner', dependencies: [] },
    { id: 'step_2', description: 'Step 2: Database migration', agentId: 'developer', dependencies: ['step_1'] },
    { id: 'step_3a', description: 'Step 3a: Unit tests', agentId: 'tester', dependencies: ['step_2'] },
    { id: 'step_3b', description: 'Step 3b: Code review', agentId: 'reviewer', dependencies: ['step_2'] }
  ];

  const executionOrder = [];
  const report = await orchestrator.orchestrate({
    goal: 'Custom DAG execution',
    customTasks,
    onEvent: (type, data) => {
      if (type === 'task:complete') executionOrder.push(data.taskId);
    }
  });

  assert.equal(report.status, 'success');
  assert.equal(report.completedTasks, 4);

  // Verify dependency ordering: step_1 before step_2, step_2 before 3a & 3b
  const idx1 = executionOrder.indexOf('step_1');
  const idx2 = executionOrder.indexOf('step_2');
  const idx3a = executionOrder.indexOf('step_3a');
  const idx3b = executionOrder.indexOf('step_3b');

  assert.ok(idx1 < idx2, 'step_1 must complete before step_2');
  assert.ok(idx2 < idx3a, 'step_2 must complete before step_3a');
  assert.ok(idx2 < idx3b, 'step_2 must complete before step_3b');
});

test('Orchestrator: DAG Cycle Detection Rejection', () => {
  const scheduler = new TaskScheduler();
  const cyclicTasks = [
    { id: 't1', dependencies: ['t3'] },
    { id: 't2', dependencies: ['t1'] },
    { id: 't3', dependencies: ['t2'] }
  ];

  assert.throws(() => {
    scheduler.validateDAG(cyclicTasks);
  }, /Circular dependency detected/);
});

test('Orchestrator: Retry Policy & Downstream Failure Propagation', async () => {
  const { orchestrator } = setupOrchestrationEnvironment();

  const customTasks = [
    { id: 'task_ok', description: 'Independent healthy task', agentId: 'developer', dependencies: [] },
    { id: 'task_fail', description: 'Failing task TRIGGER_FAILURE', agentId: 'developer', dependencies: [], maxRetries: 1 },
    { id: 'task_downstream', description: 'Downstream dependent task', agentId: 'tester', dependencies: ['task_fail'] }
  ];

  const skippedTasks = [];
  const retriedTasks = [];

  const report = await orchestrator.orchestrate({
    goal: 'Test failure propagation',
    customTasks,
    onEvent: (type, data) => {
      if (type === 'task:retry') retriedTasks.push(data.taskId);
      if (type === 'task:skipped') skippedTasks.push(data.taskId);
    }
  });

  assert.equal(report.status, 'failed_with_errors');
  assert.ok(retriedTasks.includes('task_fail'), 'task_fail should have been retried');
  assert.ok(skippedTasks.includes('task_downstream'), 'downstream task must be skipped when dependency fails');

  const downstreamTask = report.tasks.find(t => t.id === 'task_downstream');
  assert.equal(downstreamTask.status, 'skipped');
  assert.match(downstreamTask.error, /Upstream failure/i);

  // Independent task should have succeeded
  const okTask = report.tasks.find(t => t.id === 'task_ok');
  assert.equal(okTask.status, 'completed', 'independent task must succeed despite peer failure');
});

test('Orchestrator: Durable SQLite Checkpointing & Interrupted Workflow Recovery', async () => {
  const { orchestrator } = setupOrchestrationEnvironment();
  const runId = `recovery_test_${Date.now()}`;

  const customTasks = [
    { id: 't_init', description: 'Initial setup', agentId: 'planner', dependencies: [] },
    { id: 't_pending', description: 'Pending follow-up task', agentId: 'developer', dependencies: ['t_init'] }
  ];

  // 1. Manually simulate an interrupted run by persisting partial tasks and a checkpoint
  const checkpointer = orchestrator.checkpointer;
  checkpointer.saveOrchestration(runId, 'Interrupted Workflow Goal', 'running');
  checkpointer.saveTask({
    id: 't_init',
    description: 'Initial setup',
    agentId: 'planner',
    dependencies: [],
    status: 'completed',
    result: 'Initial setup completed successfully'
  }, runId);
  checkpointer.saveTask({
    id: 't_pending',
    description: 'Pending follow-up task',
    agentId: 'developer',
    dependencies: ['t_init'],
    status: 'running' // Was running when server died
  }, runId);

  checkpointer.saveCheckpoint(runId, 1, {
    goal: 'Interrupted Workflow Goal',
    step: 1
  });

  // 2. Recover the interrupted workflow
  const recoveredReport = await orchestrator.recoverWorkflow(runId);

  assert.equal(recoveredReport.status, 'success', 'recovered workflow should run to completion');
  assert.equal(recoveredReport.completedTasks, 2, 'all tasks including recovered one should be completed');

  // Verify the previously completed task preserved its result
  const tInit = recoveredReport.tasks.find(t => t.id === 't_init');
  assert.equal(tInit.status, 'completed');
  assert.match(tInit.result, /Initial setup completed/);

  // Verify the interrupted task completed on resume
  const tPending = recoveredReport.tasks.find(t => t.id === 't_pending');
  assert.equal(tPending.status, 'completed');
});

test('Orchestrator: Shared Memory Findings & Structured Result Aggregation', async () => {
  const { orchestrator } = setupOrchestrationEnvironment();

  const report = await orchestrator.orchestrate({
    goal: 'Build authentication microservice',
    customTasks: [
      { id: 't_auth_1', description: 'Analyze JWT structure', agentId: 'planner', dependencies: [] },
      { id: 't_auth_2', description: 'Implement token verification', agentId: 'developer', dependencies: ['t_auth_1'] }
    ]
  });

  assert.equal(report.status, 'success');
  assert.ok(typeof report.summary === 'string', 'report must have formatted summary');
  assert.match(report.summary, /Multi-Agent Execution Summary/);
  assert.match(report.summary, /PLANNER/);
  assert.match(report.summary, /DEVELOPER/);

  // Shared findings verified
  const findings = orchestrator.sharedMemory.getAllFindings();
  assert.ok(findings.length >= 2, 'shared memory must store findings from each agent');
});
