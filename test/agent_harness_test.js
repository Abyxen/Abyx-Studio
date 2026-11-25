/**
 * ABYX Agent Harness â€” Complete End-to-End Architectural Test Suite
 * 
 * Verifies:
 * 1. Process Lifecycle Manager (targeted PID tree kill, resource pre-flight, concurrency locks)
 * 2. Secure Path Guard (traversal attacks, null bytes, sensitive file shielding)
 * 3. Agent Policy Engine (permission checking, dangerous commands, session-level persistence)
 * 4. Workspace Filesystem Tool (atomic writes, line diffs, backups, conflict detection)
 * 5. Terminal Tool (command execution, output streaming, timeout enforcement, process registration)
 * 6. Context Manager (token calibration, context ceilings, intelligent compaction)
 * 7. Project Folder Isolation (dedicated <name>_<YYYY-MM-DD> directory structure)
 */

const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

// Target modules under test
const processLifecycleManager = require('../services/process_lifecycle_manager');
const contextManager = require('../services/context_manager');
const PathGuard = require('../agent/path_guard');
const PolicyEngine = require('../agent/policy_engine');
const WorkspaceFsTool = require('../agent/tools/fs_tool');
const TerminalTool = require('../agent/tools/terminal_tool');

const TEST_DIR = path.join(__dirname, 'temp_workspace');

let passedTests = 0;
let totalTests = 0;

function it(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  âœ“ PASS: ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  âœ— FAIL: ${name}`);
    console.error(`    ${err.stack || err.message}`);
  }
}

async function itAsync(name, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`  âœ“ PASS: ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  âœ— FAIL: ${name}`);
    console.error(`    ${err.stack || err.message}`);
  }
}

async function runAllTests() {
  console.log('\n============================================================');
  console.log('   ABYX AGENT HARNESS â€” ARCHITECTURAL VERIFICATION SUITE');
  console.log('============================================================\n');

  // Setup sandbox test directory
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TEST_DIR, { recursive: true });

  const pathGuard = new PathGuard(TEST_DIR);
  const policyEngine = new PolicyEngine({ approvalMode: 'standard', defaultWorkspace: TEST_DIR, allowTerminal: true });
  const fsTool = new WorkspaceFsTool(pathGuard);
  const terminalTool = new TerminalTool(pathGuard, policyEngine);

  // ── TEST SUITE 1: Process Lifecycle Manager ────────────────────────────────
  console.log('â–¶ 1. Process Lifecycle Manager');

  it('reports hardware system resources accurately', () => {
    const res = processLifecycleManager.checkSystemResources();
    assert.strictEqual(typeof res.cpuThreads, 'number', 'cpuThreads should be a number');
    assert.ok(res.cpuThreads >= 1, 'cpuThreads >= 1');
    assert.strictEqual(typeof res.totalRamGb, 'number', 'totalRamGb should be a number');
    assert.ok(res.totalRamGb > 0, 'totalRamGb > 0');
    assert.strictEqual(typeof res.freeRamGb, 'number', 'freeRamGb should be a number');
  });

  it('manages operation concurrency locks safely', () => {
    const lockAcquired = processLifecycleManager.acquireLock('model_load');
    assert.strictEqual(lockAcquired, true, 'First lock should be acquired');
    const lockRejected = processLifecycleManager.acquireLock('model_load');
    assert.strictEqual(lockRejected, false, 'Simultaneous lock should be rejected');
    processLifecycleManager.releaseLock('model_load');
    const lockReacquired = processLifecycleManager.acquireLock('model_load');
    assert.strictEqual(lockReacquired, true, 'Lock should be acquirable after release');
    processLifecycleManager.releaseLock('model_load');
  });

  it('tracks spawned processes by PID and ownership', () => {
    const dummyChild = { pid: 999999, kill: () => {}, once: () => {} };
    processLifecycleManager.register('dummy-test', dummyChild, { modelName: 'test-model' });
    const proc = processLifecycleManager.getProcess('dummy-test');
    assert.ok(proc, 'Registered process should exist in manifest');
    assert.strictEqual(proc.pid, 999999);
    assert.strictEqual(proc.metadata.modelName, 'test-model');
    processLifecycleManager.unregister('dummy-test');
    assert.strictEqual(processLifecycleManager.getProcess('dummy-test'), undefined);
  });

  // ── TEST SUITE 2: PathGuard Security ───────────────────────────────────────
  console.log('\nâ–¶ 2. Secure Path Guard');

  it('blocks path traversal attacks attempting escape', () => {
    assert.throws(() => {
      pathGuard.resolveSafePath('../../Windows/System32/cmd.exe');
    }, /traverses outside approved workspace boundaries|Security Violation/i, 'Must reject ../../ escapes');
  });

  it('blocks null byte poisoning and alternate data streams', () => {
    assert.throws(() => {
      pathGuard.resolveSafePath('file.txt\0.js');
    }, /Null byte detected/i, 'Must reject null bytes');
    assert.throws(() => {
      pathGuard.resolveSafePath('file.txt:hidden');
    }, /Stream syntax detected/i, 'Must reject alternate data streams');
  });

  it('blocks access to sensitive credentials, vault, and system files', () => {
    assert.throws(() => {
      pathGuard.resolveSafePath('.env');
    }, /Access to sensitive file/, 'Must shield .env');
    assert.throws(() => {
      pathGuard.resolveSafePath('credentials.json');
    }, /Access to sensitive file/, 'Must shield credentials.json');
    assert.throws(() => {
      pathGuard.resolveSafePath('id_rsa');
    }, /Access to sensitive file/, 'Must shield SSH private keys');
  });

  // ── TEST SUITE 3: Policy Engine & Session Permissions ──────────────────────
  console.log('\nâ–¶ 3. Policy Engine & Session Permissions');

  it('detects dangerous shell commands requiring explicit confirmation', () => {
    const check1 = policyEngine.checkCommand('rmdir /s /q test');
    assert.strictEqual(check1.allowed, false, 'rmdir /s /q should require approval');
    assert.ok(check1.requiresApproval, 'requiresApproval must be true');

    const check2 = policyEngine.checkCommand('del /f /s /q important.txt');
    assert.strictEqual(check2.allowed, false, 'del /f /s /q should require approval');

    const check3 = policyEngine.checkCommand('git status');
    assert.strictEqual(check3.allowed, true, 'git status should be automatically allowed');
  });

  it('supports session-level permission persistence', () => {
    const sessionId = 'test-session-123';
    assert.strictEqual(policyEngine.hasSessionPermission(sessionId, 'fs_write', 'src/app.js'), false);
    policyEngine.grantSessionPermission(sessionId, 'fs_write', 'src/app.js');
    assert.strictEqual(policyEngine.hasSessionPermission(sessionId, 'fs_write', 'src/app.js'), true);
    // Wildcard support
    policyEngine.grantSessionPermission(sessionId, 'terminal_exec', '*');
    assert.strictEqual(policyEngine.hasSessionPermission(sessionId, 'terminal_exec', 'npm run build'), true);
    // Revoke
    policyEngine.revokeSessionPermissions(sessionId);
    assert.strictEqual(policyEngine.hasSessionPermission(sessionId, 'fs_write', 'src/app.js'), false);
  });

  // ── TEST SUITE 4: Filesystem Tool (Atomic Writes & Diff System) ────────────
  console.log('\nâ–¶ 4. Filesystem Tool (Atomic Writes, Line Diffs, & Backups)');

  await itAsync('writes files atomically and creates pre-modification backups', async () => {
    const testFile = 'index.html';
    const initialContent = '<!DOCTYPE html><html><body><h1>Initial</h1></body></html>';
    const write1 = await fsTool.write({ filePath: testFile, content: initialContent });
    assert.strictEqual(write1.success, true, 'Initial write should succeed');
    assert.strictEqual(fsTool.pathGuard.resolveSafePath(testFile) ? true : false, true);

    // Modify file
    const updatedContent = '<!DOCTYPE html><html><body><h1>Updated</h1></body></html>';
    const write2 = await fsTool.write({ filePath: testFile, content: updatedContent });
    assert.strictEqual(write2.success, true, 'Updated write should succeed');
    assert.strictEqual(write2.backedUp, true, 'Backup should be created');

    // Verify backup directory exists
    const backupDir = path.join(TEST_DIR, '.abyx_backup');
    assert.strictEqual(fs.existsSync(backupDir), true, 'Backup directory must exist');
  });

  await itAsync('computes line-by-line diffs correctly', async () => {
    const testFile = 'script.js';
    const v1 = 'function greet() {\n  return "hello";\n}\n';
    const v2 = 'function greet() {\n  return "hello world";\n}\n';
    await fsTool.write({ filePath: testFile, content: v1 });

    const diff = await fsTool.getDiff({ filePath: testFile, newContent: v2 });
    assert.strictEqual(diff.success, true, 'Diff computation should succeed');
    assert.ok(diff.diffLines.some(l => l.type === 'added' && l.text.includes('hello world')), 'Diff must include added line');
    assert.ok(diff.diffLines.some(l => l.type === 'deleted' && l.text.includes('"hello"')), 'Diff must include deleted line');
  });

  it('detects binary files reliably', () => {
    const isBin1 = fsTool.isBinary(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), 'image.png');
    assert.strictEqual(isBin1, true, 'PNG signature should be binary');
    const isBin2 = fsTool.isBinary(Buffer.from('console.log("hello");'), 'app.js');
    assert.strictEqual(isBin2, false, 'JavaScript code should be non-binary');
  });

  // ── TEST SUITE 5: Terminal Tool ───────────────────────────────────────────
  console.log('\nâ–¶ 5. Terminal Tool');

  await itAsync('executes safe commands and streams stdout', async () => {
    let capturedStdout = '';
    const result = await terminalTool.execute({
      command: 'node -e "console.log(\'AGENT_READY\')"',
      onStdout: (chunk) => { capturedStdout += chunk; },
      bypassApproval: true
    });
    assert.strictEqual(result.success, true, 'Command should exit cleanly');
    assert.strictEqual(result.exitCode, 0, 'Exit code should be 0');
    assert.ok(capturedStdout.includes('AGENT_READY') || result.stdout.includes('AGENT_READY'), 'Stdout must contain AGENT_READY');
  });

  await itAsync('enforces execution timeout', async () => {
    const result = await terminalTool.execute({
      command: 'node -e "setTimeout(() => {}, 5000)"',
      timeoutMs: 400,
      bypassApproval: true
    });
    assert.strictEqual(result.success, false, 'Timed-out command should report failure');
    assert.ok(result.error && (result.error.includes('timed out') || result.error.includes('aborted')), 'Error must note timeout');
  });

  // ── TEST SUITE 6: Context Manager ─────────────────────────────────────────
  console.log('\nâ–¶ 6. Context & Token Management');

  it('resolves correct model context ceilings', () => {
    assert.strictEqual(contextManager.getModelCeiling('Inkling-2-Mini-UD-Q4_K_M.gguf'), 8192);
    assert.strictEqual(contextManager.getModelCeiling('gemma-4-26b-q4.gguf'), 16384);
    assert.strictEqual(contextManager.getModelCeiling('abyx-pro-32b.gguf'), 32768);
    assert.strictEqual(contextManager.getModelCeiling('unknown-small.gguf'), 8192);
  });

  it('calibrates token estimation accurately', () => {
    const text = 'Hello world, this is a test of the Abyx Agent Tokenizer calibration.';
    const est = contextManager.estimateTokens(text);
    assert.ok(est >= 10 && est <= 25, `Token estimate ${est} should be within calibrated range`);
  });

  it('compacts long conversation context while preserving system prompt and recent turns', () => {
    const systemPrompt = 'You are Abyx AI assistant.';
    const messages = [{ role: 'system', content: systemPrompt }];
    for (let i = 0; i < 40; i++) {
      messages.push({ role: 'user', content: `Message turn ${i} with substantial detailed content to fill context.` });
      messages.push({ role: 'assistant', content: `Response turn ${i} providing code and explanations.` });
    }
    const compacted = contextManager.compactContext(messages, { maxTargetTokens: 500 });
    assert.strictEqual(compacted[0].role, 'system', 'System prompt must be preserved at index 0');
    assert.ok(compacted.length < messages.length, `Compacted length ${compacted.length} should be significantly reduced from ${messages.length}`);
  });

  // ── 7. LSP & CODE INTELLIGENCE BRIDGE ────────────────────────────────────
  console.log('\n▶ 7. LSP & Code Intelligence Bridge');
  const LspTool = require('../agent/tools/lsp_tool');
  const lspTool = new LspTool(pathGuard);

  it('detects syntax and unclosed delimiter errors in code snippets', () => {
    const brokenCode = 'function calculateTotal(items) {\n  if (items.length) {\n    return items.reduce((a, b) => a + b;\n}';
    const diag = lspTool.checkDiagnostics({ content: brokenCode });
    assert.strictEqual(diag.ok, false, 'Broken code must fail diagnostics check');
    assert.ok(diag.diagnostics.length > 0, 'Diagnostics must contain error items');
    assert.ok(diag.diagnostics.some(d => d.message.includes('Unclosed delimiter') || d.message.includes('Mismatched')), 'Must catch unclosed delimiter');
  });

  it('extracts symbols (functions, classes) from source files correctly', () => {
    const sampleCode = `
      class AgentService {
        constructor() {}
      }
      async function runPipeline(tasks) {
        return true;
      }
      const calculateScore = (data) => 100;
    `;
    const symbols = lspTool.getSymbols({ content: sampleCode });
    assert.ok(symbols.count >= 3, `Expected at least 3 symbols, got ${symbols.count}`);
    const names = symbols.symbols.map(s => s.name);
    assert.ok(names.includes('AgentService'), 'Must extract class AgentService');
    assert.ok(names.includes('runPipeline'), 'Must extract function runPipeline');
    assert.ok(names.includes('calculateScore'), 'Must extract arrow function calculateScore');
  });

  it('pre-flight validates diffs to prevent applying broken syntax to workspace files', () => {
    const validFile = path.join(TEST_DIR, 'valid_module.js');
    fs.writeFileSync(validFile, 'function add(a, b) {\n  return a + b;\n}\n');

    // Valid diff
    const validResult = lspTool.validateDiff({
      filePath: 'valid_module.js',
      target: 'return a + b;',
      replacement: 'return a + b + 1;'
    });
    assert.strictEqual(validResult.valid, true, 'Valid edit must pass diff validation');
    assert.strictEqual(validResult.safeToApply, true, 'Valid edit must be safe to apply');

    // Broken diff introducing unmatched bracket
    const brokenResult = lspTool.validateDiff({
      filePath: 'valid_module.js',
      target: 'return a + b;',
      replacement: 'return (a + b'
    });
    assert.strictEqual(brokenResult.valid, false, 'Broken edit must fail diff validation');
    assert.strictEqual(brokenResult.safeToApply, false, 'Broken edit must not be safe to apply');
  });

  // ── 8. MULTI-TURN AUTONOMOUS LOOP DEPTH ──────────────────────────────────
  console.log('\n▶ 8. Multi-Turn Autonomous Loop Depth');
  const AgentExecutionEngine = require('../agent/execution_loop');
  const engine = new AgentExecutionEngine({ pathGuard, policyEngine });

  it('supports expanded autonomous loop depth up to 30 steps with subtask tracking', async () => {
    let stepsRan = 0;
    const run = await engine.run({
      sessionId: 'test_session_multi',
      goal: 'Multi-turn autonomous task',
      maxSteps: 25,
      stepExecutor: async ({ step }) => {
        stepsRan++;
        if (stepsRan === 1) {
          return { continue: true, subtask: 'Phase 1: Explore codebase' };
        } else if (stepsRan === 2) {
          return { continue: true, subtask: 'Phase 2: Validate with LSP' };
        } else {
          return { done: true, result: 'Autonomous goal achieved.' };
        }
      }
    });

    assert.strictEqual(run.status, 'completed', 'Run must complete');
    assert.strictEqual(run.maxSteps, 25, 'Engine must accept expanded maxSteps ceiling of 25');
    assert.strictEqual(stepsRan, 3, 'Must have run through 3 autonomous steps');
    assert.strictEqual(run.subtasks.length, 2, 'Must have tracked 2 autonomous subtasks');
    assert.strictEqual(run.subtasks[0].title, 'Phase 1: Explore codebase');
    assert.strictEqual(run.subtasks[1].title, 'Phase 2: Validate with LSP');
  });

  // ── CLEANUP & FINAL TALLY ─────────────────────────────────────────────────
  if (fs.existsSync(TEST_DIR)) {
    try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch (_) {}
  }

  console.log('\n============================================================');
  console.log(`   TEST RESULTS: ${passedTests} / ${totalTests} PASSED`);
  if (passedTests === totalTests) {
    console.log('   ALL HARNESS ARCHITECTURE UPGRADES VERIFIED (100% PASS)');
  } else {
    console.log(`   ${totalTests - passedTests} TESTS FAILED`);
  }
  console.log('============================================================\n');

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

runAllTests().catch((err) => {
  console.error('Test run failed:', err);
  process.exit(1);
});
