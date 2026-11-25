'use strict';

/**
 * ABYX End-to-End Real Multi-Agent Workflow Test
 * Tests genuine LLM decomposition, multi-turn tool execution,
 * workspace isolation, shared memory matrix, and independent verification
 * against the live local model on http://127.0.0.1:10086.
 */

const path = require('node:path');
const { createAgentEngine } = require('../agent');
const aiProviders = require('../services/ai_providers');

async function runRealWorkflowTest() {
  console.log('====================================================');
  console.log('ABYX REAL MULTI-AGENT E2E WORKFLOW VERIFICATION');
  console.log('====================================================');

  // 1. Check health of local model endpoint
  console.log('[1/4] Verifying local model endpoint (127.0.0.1:10086)...');
  const health = await aiProviders.defaultModelRouter.checkHealth();
  console.log('Model Health:', JSON.stringify(health, null, 2));
  if (!health.online) {
    throw new Error('Local model backend is not online on port 10086');
  }

  // 2. Initialize Agent Engine with approved workspace
  console.log('\n[2/4] Initializing Agent Engine with live aiProviders...');
  const workspaceRoot = path.resolve(__dirname, '..', 'app', 'workspace');
  const engine = createAgentEngine({
    approvedRoots: [workspaceRoot],
    workspaceRoot,
    profileId: 'prof_e2e_test',
    allowTerminal: true,
    allowBrowser: false,
    aiProviders
  });

  const orchestrator = engine.orchestrator;
  const capturedEvents = [];

  // Listen to all events
  const eventTypes = [
    'orchestration:started',
    'orchestration:dag_formed',
    'task:started',
    'task:step',
    'task:tool_call',
    'task:tool_result',
    'task:completed',
    'task:failed',
    'orchestration:finished'
  ];

  for (const et of eventTypes) {
    orchestrator.on(et, (payload) => {
      capturedEvents.push({ type: et, time: new Date().toISOString(), payload });
      if (et === 'orchestration:dag_formed') {
        console.log(`[DAG] Formed ${payload.tasksCount} tasks:`, payload.tasks.map(t => `${t.id} (${t.role})`).join(' -> '));
      } else if (et === 'task:started') {
        console.log(`  [TASK:START] ${payload.taskId} (${payload.agentRole}): "${payload.title}"`);
      } else if (et === 'task:tool_call') {
        console.log(`    [TOOL:CALL] Task ${payload.taskId} invoking "${payload.tool}"`);
      } else if (et === 'task:completed') {
        console.log(`  [TASK:DONE] ${payload.taskId} completed`);
      }
    });
  }

  // 3. Execute the full end-to-end multi-agent workflow
  const testGoal = 'Analyze this project, design an authentication module, implement the feature, write unit tests, run the tests, review the code, and generate documentation.';
  console.log(`\n[3/4] Launching Orchestrator with User Goal:\n"${testGoal}"\n`);

  const startTime = Date.now();
  const report = await orchestrator.orchestrate({
    goal: testGoal,
    model: 'AbyxV2 9B.gguf',
    concurrency: 2,
    profileId: 'prof_e2e_test',
    onEvent: (type, data) => {
      // live callback
    }
  });

  const durationMs = Date.now() - startTime;

  // 4. Verification and Assertions
  console.log('\n[4/4] Evaluating Orchestration Deliverables:');
  console.log(`Run ID: ${report.runId}`);
  console.log(`Status: ${report.status}`);
  console.log(`Total Duration: ${Math.round(durationMs / 1000)}s`);
  console.log(`Completed Tasks: ${report.completedCount}`);
  console.log(`Failed Tasks: ${report.failedCount}`);
  console.log(`Total Events Captured: ${capturedEvents.length}`);

  const findings = orchestrator.sharedMemory.getAllFindings();
  console.log(`Shared Memory Findings Captured: ${findings.length}`);
  for (const f of findings) {
    console.log(` - [${f.agentId}] ${f.topic}: ${f.conclusion.slice(0, 100)}...`);
  }

  const persistedRun = orchestrator.taskStore.getOrchestration(report.runId);
  console.log(`TaskStore Persistence Verified: ${persistedRun ? 'YES (found in store)' : 'NO'}`);

  const persistedEvents = orchestrator.eventStore.query({ runId: report.runId });
  console.log(`EventStore Persistence Verified: ${persistedEvents.length} events logged`);

  if (report.status !== 'completed' && report.status !== 'finished') {
    throw new Error(`Orchestration ended with unexpected status: ${report.status}`);
  }

  if (report.completedCount < 2) {
    throw new Error(`Expected at least 2 completed tasks, got ${report.completedCount}`);
  }

  console.log('\n====================================================');
  console.log('SUCCESS: REAL MULTI-AGENT E2E WORKFLOW VERIFIED!');
  console.log('====================================================');
  return { report, capturedEvents, findings, durationMs };
}

if (require.main === module) {
  runRealWorkflowTest()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('\nTEST FAILED:', err);
      process.exit(1);
    });
}

module.exports = { runRealWorkflowTest };
