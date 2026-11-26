'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const VerificationEngine = require('../agent/verification/verification_engine');
const ReviewerAgent = require('../agent/verification/reviewer_agent');
const AutonomousRecovery = require('../agent/verification/autonomous_recovery');
const BenchmarkSuite = require('../agent/verification/benchmark_suite');

const BASE_TEST_DIR = path.resolve(__dirname, '_fixtures_verif_bench');

function safeCleanup(dir) {
  try {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  } catch (_) {}
}

// ==========================================
// 1. VERIFICATION ENGINE TESTS
// ==========================================

test('VerificationEngine: independently asserts file existence, contents, patches, and diffs', async () => {
  const verifDir = path.join(BASE_TEST_DIR, 'verif');
  safeCleanup(verifDir);
  fs.mkdirSync(verifDir, { recursive: true });

  try {
    const engine = new VerificationEngine({ workspaceRoot: verifDir });

    // 1. File existence checks
    const nonExistent = engine.verifyFileExists('missing_file.txt');
    assert.strictEqual(nonExistent.passed, false);
    assert.ok(nonExistent.error.includes('does not exist'));

    const testFile = path.join(verifDir, 'service.js');
    fs.writeFileSync(testFile, 'export function add(a, b) { return a + b; }\n', 'utf8');

    const fileExists = engine.verifyFileExists('service.js', { minSizeBytes: 10 });
    assert.strictEqual(fileExists.passed, true);
    assert.strictEqual(fileExists.isDirectory, false);

    // 2. File content assertions
    const contentCheck = engine.verifyFileContent('service.js', {
      contains: ['function add', 'return a + b'],
      notContains: ['eval', 'var '],
      minLines: 1,
      forbidPlaceholders: true
    });
    assert.strictEqual(contentCheck.passed, true);
    assert.strictEqual(contentCheck.failures.length, 0);

    // Placeholder detection (rejects mock stubs)
    const mockFile = path.join(verifDir, 'mock.js');
    fs.writeFileSync(mockFile, 'function login() {\n  // TODO: implement\n}\n', 'utf8');
    const mockCheck = engine.verifyFileContent('mock.js', { forbidPlaceholders: true });
    assert.strictEqual(mockCheck.passed, false);
    assert.ok(mockCheck.failures.some(f => f.includes('Unimplemented mock placeholder')));

    // 3. Patch validation
    const orig = 'const x = 1;\n';
    const patched = 'const x = 2;\n';
    fs.writeFileSync(testFile, patched, 'utf8');
    const patchCheck = engine.verifyPatch('service.js', orig, 'patch_hunk');
    assert.strictEqual(patchCheck.passed, true);
    assert.strictEqual(patchCheck.modified, true);

    // No-op patch failure
    const noopCheck = engine.verifyPatch('service.js', patched, 'noop');
    assert.strictEqual(noopCheck.passed, false);
    assert.ok(noopCheck.error.includes('no-op patch'));

    // 4. Test execution verification (Invariant: never claim passed without running)
    const noCmd = engine.verifyTests({});
    assert.strictEqual(noCmd.passed, false);
    assert.ok(noCmd.error.includes('Refusing to report tests passed'));

    // Running a small node test assertion command
    const testScript = path.join(verifDir, 'sample.test.js');
    fs.writeFileSync(testScript, 'const test = require("node:test"); const assert = require("node:assert"); test("sample", () => assert.ok(true));\n');
    const passingTests = engine.verifyTests({
      command: `"${process.execPath}" --test --test-reporter=tap sample.test.js`,
      cwd: verifDir
    });
    assert.strictEqual(passingTests.passed, true);
    assert.ok(passingTests.passCount >= 1);

    // 5. Multi-step Suite execution
    const suiteRes = await engine.runSuite({
      steps: [
        { type: 'file_exists', path: 'service.js' },
        { type: 'file_content', path: 'service.js', options: { contains: ['const x = 2;'] } }
      ]
    });
    assert.strictEqual(suiteRes.passed, true);
    assert.strictEqual(suiteRes.passedChecks, 2);
  } finally {
    safeCleanup(verifDir);
  }
});

// ==========================================
// 2. READ-ONLY REVIEWER AGENT TESTS
// ==========================================

test('ReviewerAgent: audits deliverables for syntax, security, unintended modifications, and coverage', async () => {
  const reviewDir = path.join(BASE_TEST_DIR, 'reviewer');
  safeCleanup(reviewDir);
  fs.mkdirSync(reviewDir, { recursive: true });

  try {
    const reviewer = new ReviewerAgent({ workspaceRoot: reviewDir });

    // 1. Clean deliverable with test coverage
    const cleanSource = path.join(reviewDir, 'math.js');
    const cleanTest = path.join(reviewDir, 'math.test.js');
    fs.writeFileSync(cleanSource, 'function multiply(a, b) { return a * b; }\nmodule.exports = { multiply };\n', 'utf8');
    fs.writeFileSync(cleanTest, 'const { multiply } = require("./math");\n', 'utf8');

    const cleanReview = await reviewer.reviewTaskDeliverable({
      goal: 'Implement math multiplication utility',
      filesModified: ['math.js', 'math.test.js']
    });
    assert.strictEqual(cleanReview.passed, true);
    assert.strictEqual(cleanReview.verdict, 'approved');
    assert.strictEqual(cleanReview.blockerCount, 0);
    assert.strictEqual(cleanReview.score, 100);

    // 2. Syntax Error detection (Blocker)
    const brokenSource = path.join(reviewDir, 'broken.js');
    fs.writeFileSync(brokenSource, 'function error( { return;\n', 'utf8'); // Missing closing paren

    const brokenReview = await reviewer.reviewTaskDeliverable({
      goal: 'Fix broken code',
      filesModified: ['broken.js', 'math.test.js']
    });
    assert.strictEqual(brokenReview.passed, false);
    assert.strictEqual(brokenReview.verdict, 'changes_requested');
    assert.ok(brokenReview.findings.some(f => f.category === 'correctness' && f.severity === 'blocker'));

    // 3. Security Vulnerability detection (Hardcoded AWS token)
    const insecureSource = path.join(reviewDir, 'insecure.js');
    fs.writeFileSync(insecureSource, 'const key = "AKIAIOSFODNN7EXAMPLE";\n', 'utf8');

    const insecureReview = await reviewer.reviewTaskDeliverable({
      goal: 'Add aws config',
      filesModified: ['insecure.js', 'math.test.js']
    });
    assert.strictEqual(insecureReview.passed, false);
    assert.ok(insecureReview.findings.some(f => f.category === 'security' && f.severity === 'blocker'));

    // 4. Missing Tests Warning
    const noTestReview = await reviewer.reviewTaskDeliverable({
      goal: 'Implement utils',
      filesModified: ['math.js'] // no test file included
    });
    assert.ok(noTestReview.findings.some(f => f.category === 'test_coverage' && f.severity === 'warning'));
  } finally {
    safeCleanup(reviewDir);
  }
});

// ==========================================
// 3. AUTONOMOUS SELF-CORRECTION & RECOVERY TESTS
// ==========================================

test('AutonomousRecovery: manages bounded self-correction loop and honest failure reporting', async () => {
  const recovery = new AutonomousRecovery({ maxAttempts: 3 });

  // 1. Successful Recovery on Attempt 2
  let attemptCounter = 0;
  const recoveredRun = await recovery.executeWithSelfCorrection({
    task: { goal: 'Fix parser function' },
    executor: async (feedback, attempt) => {
      attemptCounter = attempt;
      if (attempt === 1) {
        return { code: 'function parse( { return null; }' }; // Syntax error on first try
      }
      return { code: 'function parse() { return null; }' }; // Corrected on second try
    },
    verifier: async (result) => {
      if (result.code.includes('parse( {')) {
        return { passed: false, failures: ['SyntaxError: Unexpected token'] };
      }
      return { passed: true };
    }
  });

  assert.strictEqual(recoveredRun.ok, true);
  assert.strictEqual(recoveredRun.recovered, true);
  assert.strictEqual(recoveredRun.attempts, 2);
  assert.strictEqual(recoveredRun.verification.passed, true);

  // 2. Honest Failure Reporting when attempts exhausted
  const failedRun = await recovery.executeWithSelfCorrection({
    task: { goal: 'Mission impossible' },
    executor: async () => ({ unfixable: true }),
    verifier: async () => ({ passed: false, failures: ['Assertion error: Expected value not found'] })
  });

  assert.strictEqual(failedRun.ok, false);
  assert.strictEqual(failedRun.recovered, false);
  assert.strictEqual(failedRun.attempts, 3);
  assert.strictEqual(failedRun.maxAttempts, 3);
  assert.ok(failedRun.error.includes('failed verification after 3 bounded correction attempts'));
  assert.strictEqual(failedRun.history.length, 3);
});

// ==========================================
// 4. BENCHMARK SUITE & EVALUATION METRICS TESTS
// ==========================================

test('BenchmarkSuite: catalogs 12 standard tasks, records resource metrics, and persists evaluation report', async () => {
  const benchDir = path.join(BASE_TEST_DIR, 'bench_results');
  safeCleanup(benchDir);
  fs.mkdirSync(benchDir, { recursive: true });

  try {
    const suite = new BenchmarkSuite({
      workspaceRoot: BASE_TEST_DIR,
      resultsDir: benchDir
    });

    // 1. Verify 12 Standard Tasks Cataloged
    const taskList = suite.getTaskList();
    assert.strictEqual(taskList.length, 12, 'BenchmarkSuite must catalog all 12 standard evaluation tasks');
    
    const taskIds = taskList.map(t => t.id);
    assert.ok(taskIds.includes('bench_01_exploration'));
    assert.ok(taskIds.includes('bench_02_file_mod'));
    assert.ok(taskIds.includes('bench_03_bug_fixing'));
    assert.ok(taskIds.includes('bench_04_refactoring'));
    assert.ok(taskIds.includes('bench_05_test_creation'));
    assert.ok(taskIds.includes('bench_06_build_repair'));
    assert.ok(taskIds.includes('bench_07_browser'));
    assert.ok(taskIds.includes('bench_08_research'));
    assert.ok(taskIds.includes('bench_09_long_context'));
    assert.ok(taskIds.includes('bench_10_multi_agent'));
    assert.ok(taskIds.includes('bench_11_recovery'));
    assert.ok(taskIds.includes('bench_12_permissions'));

    // 2. Execute Benchmark Task with Metrics Collection
    const result = await suite.runBenchmarkTask('bench_01_exploration', async (inst) => {
      inst.recordModelCall({ prompt: 250, completion: 60 });
      inst.recordToolCall('fs_list', true);
      inst.recordToolCall('fs_search', true);

      return {
        filesFound: ['package.json', 'README.md', 'serve.cjs']
      };
    });

    assert.strictEqual(result.passed, true);
    assert.strictEqual(result.taskId, 'bench_01_exploration');
    assert.strictEqual(result.metrics.modelCalls, 1);
    assert.strictEqual(result.metrics.toolCalls, 2);
    assert.strictEqual(result.metrics.tokenConsumption.total, 310);
    assert.ok(result.durationMs >= 0);
    assert.ok(result.metrics.ramHeapUsedBytes > 0);
    assert.ok(result.metrics.cpuUsageUserMicroseconds >= 0);
    assert.ok(result.systemInfo.cpus > 0);

    // 3. Verify Report Persistence
    const files = fs.readdirSync(benchDir);
    assert.strictEqual(files.length, 1);
    const persisted = JSON.parse(fs.readFileSync(path.join(benchDir, files[0]), 'utf8'));
    assert.strictEqual(persisted.taskId, 'bench_01_exploration');
    assert.strictEqual(persisted.passed, true);
  } finally {
    safeCleanup(benchDir);
  }
});
