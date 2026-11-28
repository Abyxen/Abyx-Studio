const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  AbyxAgentHarness,
  AgentState,
  ActionType,
  TerminalTool,
  SmartFileEditor,
  PlannerTool,
  PermissionMatrix
} = require('../harness/index');

const BENCH_DIR = path.resolve(__dirname, '..', '.bench_sandbox');

describe('ABYX vs OpenHands Three-Input Benchmark Suite', () => {
  before(() => {
    if (fs.existsSync(BENCH_DIR)) {
      fs.rmSync(BENCH_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(BENCH_DIR, { recursive: true });
  });

  after(() => {
    if (fs.existsSync(BENCH_DIR)) {
      fs.rmSync(BENCH_DIR, { recursive: true, force: true });
    }
  });

  test('Benchmark Input 1: Terminal Command Execution & POSIX Printf Output Verification', async () => {
    const ws = path.join(BENCH_DIR, 'bench_input_1');
    fs.mkdirSync(ws, { recursive: true });

    const startTime = Date.now();
    const harness = new AbyxAgentHarness({ workspaceDir: ws, sessionId: 'bench_session_1' });
    await harness.initialize('Run terminal POSIX printf and verify exact token output');

    // 1. Advance through DESIGN
    await harness.executeStep({
      type: ActionType.RUN_TOOL,
      toolName: 'planner',
      args: { action: 'create_plan', title: 'Terminal Benchmark', steps: ['Run POSIX printf', 'Verify output'] },
      stage: 'DESIGN'
    });

    // 2. Execute step: POSIX printf command
    const stepRes = await harness.executeStep({
      type: ActionType.RUN_TOOL,
      toolName: 'terminal',
      args: { command: "printf 'MOCK_LLM_E2E_BASH_OK\\n'" },
      stage: 'IMPLEMENTATION'
    });

    const elapsedMs = Date.now() - startTime;

    assert.equal(stepRes.status, 'ok');
    assert.ok(stepRes.observation.output.includes('MOCK_LLM_E2E_BASH_OK'));

    // Verify verification and handoff
    const handoffRes = await harness.verifyAndHandoff();
    assert.equal(handoffRes.verified, true);
    assert.ok(elapsedMs < 2000, `Execution should be sub-second (took ${elapsedMs}ms)`);

    harness.dispose();
  });

  test('Benchmark Input 2: File Editor Block Replacement & Markdown Preview', async () => {
    const ws = path.join(BENCH_DIR, 'bench_input_2');
    fs.mkdirSync(ws, { recursive: true });

    const startTime = Date.now();
    const harness = new AbyxAgentHarness({ workspaceDir: ws, sessionId: 'bench_session_2' });
    await harness.initialize('Write and edit qa_notes.md with Markdown preview verification');

    // 1. Advance through DESIGN
    await harness.executeStep({
      type: ActionType.RUN_TOOL,
      toolName: 'planner',
      args: { action: 'create_plan', title: 'File Editor QA', steps: ['Write initial file', 'Edit file', 'Preview'] },
      stage: 'DESIGN'
    });

    // 2. Initial write
    const writeRes = await harness.executeStep({
      type: ActionType.RUN_TOOL,
      toolName: 'smart_file_editor',
      args: {
        action: 'write',
        path: 'qa_notes.md',
        content: '# Initial Notes\n- first item\n- second item\n'
      },
      stage: 'IMPLEMENTATION'
    });
    assert.equal(writeRes.status, 'ok');

    // 2. Block replacement edit
    const editRes = await harness.executeStep({
      type: ActionType.RUN_TOOL,
      toolName: 'smart_file_editor',
      args: {
        action: 'edit',
        path: 'qa_notes.md',
        target: '# Initial Notes',
        replacement: '# QA Notes'
      }
    });
    assert.equal(editRes.status, 'ok');

    // 3. Preview markdown
    const previewRes = await harness.executeStep({
      type: ActionType.RUN_TOOL,
      toolName: 'smart_file_editor',
      args: {
        action: 'preview',
        path: 'qa_notes.md'
      }
    });
    assert.equal(previewRes.status, 'ok');
    assert.deepEqual(previewRes.observation.headings, ['# QA Notes']);

    const finalContent = fs.readFileSync(path.join(ws, 'qa_notes.md'), 'utf-8');
    assert.ok(finalContent.includes('# QA Notes'));
    assert.ok(finalContent.includes('- first item'));

    const elapsedMs = Date.now() - startTime;
    assert.ok(elapsedMs < 2000, `Execution should be sub-second (took ${elapsedMs}ms)`);

    harness.dispose();
  });

  test('Benchmark Input 3: Plan Creation, High-Risk Confirmation Interception, and Session Handoff', async () => {
    const ws = path.join(BENCH_DIR, 'bench_input_3');
    fs.mkdirSync(ws, { recursive: true });

    const startTime = Date.now();
    const harness = new AbyxAgentHarness({ workspaceDir: ws, sessionId: 'bench_session_3' });
    await harness.initialize('Plan creation, safety guardrail check, and clean handoff');

    // 1. Create PLAN.md
    const planRes = await harness.executeStep({
      type: ActionType.RUN_TOOL,
      toolName: 'planner',
      args: {
        action: 'create_plan',
        title: 'Safety and Cleanup Operation',
        steps: ['Inspect directory', 'Guardrail verification', 'Complete task']
      },
      stage: 'DESIGN'
    });
    assert.equal(planRes.status, 'ok');
    assert.ok(fs.existsSync(path.join(ws, '.agents_tmp', 'PLAN.md')));

    // 2. Guardrail test: High-risk command interception
    const dangerRes = await harness.executeStep({
      type: ActionType.RUN_TOOL,
      toolName: 'terminal',
      args: { command: 'rm -rf / --no-preserve-root' },
      stage: 'IMPLEMENTATION'
    });
    assert.equal(dangerRes.status, 'awaiting_confirmation');
    assert.ok(dangerRes.prompt.includes('requires explicit confirmation'));

    // 3. Mark step and complete
    await harness.executeStep({
      type: ActionType.RUN_TOOL,
      toolName: 'planner',
      args: { action: 'mark_step', currentStep: 2 }
    });

    const completeRes = await harness.executeStep({
      type: ActionType.COMPLETE,
      toolName: 'complete',
      args: { summary: 'Plan executed safely and guardrails confirmed active' }
    });
    assert.equal(completeRes.status, 'ok');
    assert.equal(harness.state, AgentState.COMPLETED);

    // 4. Verify and clean handoff
    const handoffRes = await harness.verifyAndHandoff();
    assert.equal(handoffRes.verified, true);
    assert.ok(handoffRes.handoffSummary.sessionId, 'bench_session_3');

    const elapsedMs = Date.now() - startTime;
    assert.ok(elapsedMs < 2000, `Execution should be sub-second (took ${elapsedMs}ms)`);

    harness.dispose();
  });
});
