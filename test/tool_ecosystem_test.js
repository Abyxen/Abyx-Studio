'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const ToolGateway = require('../agent/tool_gateway');
const ToolRegistry = require('../agent/tool_registry');
const PathGuard = require('../agent/path_guard');
const PolicyEngine = require('../agent/policy_engine');
const GitAdapter = require('../agent/git_adapter');

const workspaceRoot = path.resolve(__dirname, '..');
const testSandbox = path.join(workspaceRoot, 'test', '_fixtures_tools');

function setupTestEnvironment() {
  if (!fs.existsSync(testSandbox)) {
    fs.mkdirSync(testSandbox, { recursive: true });
  }

  const pathGuard = new PathGuard(workspaceRoot);
  const policyEngine = new PolicyEngine({ defaultAction: 'allow' });
  const gitAdapter = new GitAdapter(pathGuard);
  const gateway = new ToolGateway({ pathGuard, policyEngine, gitAdapter });

  return { gateway, pathGuard, policyEngine, gitAdapter };
}

test('Tool Ecosystem: Filesystem Native Tools Suite', async () => {
  const { gateway } = setupTestEnvironment();
  const testFileRel = path.relative(workspaceRoot, path.join(testSandbox, 'fs_test.txt'));
  const testSubdirRel = path.relative(workspaceRoot, path.join(testSandbox, 'sub_dir'));

  // 1. write_file
  const writeRes = await gateway.execute('write_file', {
    path: testFileRel,
    content: 'Line 1: Hello ABYX\nLine 2: Multi-agent runtime\nLine 3: Phase 5 Tool Gateway\n'
  });
  assert.equal(writeRes.ok, true, 'write_file should succeed');

  // 2. read_file
  const readRes = await gateway.execute('read_file', { path: testFileRel });
  assert.equal(readRes.ok, true, 'read_file should succeed');
  assert.match(readRes.content, /Hello ABYX/, 'read content should match');

  // 3. file_metadata
  const metaRes = await gateway.execute('file_metadata', { path: testFileRel });
  assert.equal(metaRes.ok, true, 'file_metadata should succeed');
  assert.ok(metaRes.size > 0, 'file size should be greater than 0');
  assert.equal(metaRes.isFile, true, 'should be a regular file');

  // 4. edit_file
  const editRes = await gateway.execute('edit_file', {
    path: testFileRel,
    target: 'Multi-agent runtime',
    replacement: 'Autonomous Multi-Agent Runtime'
  });
  assert.equal(editRes.ok, true, 'edit_file should succeed');

  const verifyEdit = await gateway.execute('read_file', { path: testFileRel });
  assert.match(verifyEdit.content, /Autonomous Multi-Agent Runtime/, 'file content should be updated');

  // 5. apply_patch (unified search/replace hunk)
  const patchContent = '<<<<\nLine 1: Hello ABYX\n====\nLine 1: Hello ABYX Reconstructed\n>>>>';
  const patchRes = await gateway.execute('apply_patch', {
    path: testFileRel,
    patch: patchContent
  });
  assert.equal(patchRes.ok, true, 'apply_patch should succeed');

  const verifyPatch = await gateway.execute('read_file', { path: testFileRel });
  assert.match(verifyPatch.content, /Hello ABYX Reconstructed/, 'patch should be applied');

  // 6. create_directory
  const mkdirRes = await gateway.execute('create_directory', { path: testSubdirRel });
  assert.equal(mkdirRes.ok, true, 'create_directory should succeed');
  assert.ok(fs.existsSync(path.join(workspaceRoot, testSubdirRel)), 'directory should exist');

  // 7. list_directory
  const listRes = await gateway.execute('list_directory', { path: path.relative(workspaceRoot, testSandbox) });
  assert.equal(listRes.ok, true, 'list_directory should succeed');
  assert.ok(Array.isArray(listRes.items), 'items should be an array');
  assert.ok(listRes.items.some(i => i.name === 'fs_test.txt'), 'fs_test.txt should be listed');

  // 8. glob_files
  const globRes = await gateway.execute('glob_files', {
    pattern: '*.txt',
    path: path.relative(workspaceRoot, testSandbox)
  });
  assert.equal(globRes.ok, true, 'glob_files should succeed');
  assert.ok(globRes.files.some(f => f.includes('fs_test.txt')), 'fs_test.txt should match glob');

  // 9. search_content (grep-style search with line numbers)
  const grepRes = await gateway.execute('search_content', {
    query: 'Phase 5',
    path: path.relative(workspaceRoot, testSandbox)
  });
  assert.equal(grepRes.ok, true, 'search_content should succeed');
  assert.ok(grepRes.matches.length > 0, 'should find matches');
  assert.equal(grepRes.matches[0].lineNumber, 3, 'should correctly report line number 3');

  // Clean up fixture file
  try {
    fs.unlinkSync(path.join(workspaceRoot, testFileRel));
    fs.rmdirSync(path.join(workspaceRoot, testSubdirRel));
  } catch (_) {}
});

test('Tool Ecosystem: Terminal Tools Suite (PowerShell, WSL, Timeouts & Cancellation)', async () => {
  const { gateway } = setupTestEnvironment();

  // 1. run_command
  const cmdRes = await gateway.execute('run_command', {
    command: 'node -e "console.log(\'terminal:ok\')"'
  });
  assert.equal(cmdRes.ok, true, 'run_command should succeed');
  assert.match(cmdRes.stdout, /terminal:ok/);
  assert.equal(cmdRes.exitCode, 0, 'exit code should be 0');

  // 2. run_powershell
  const psRes = await gateway.execute('run_powershell', {
    command: 'Write-Output "powershell:ok"'
  });
  assert.equal(psRes.ok, true, 'run_powershell should succeed');
  assert.match(psRes.stdout, /powershell:ok/);
  assert.equal(psRes.exitCode, 0, 'exit code should be 0');

  // 3. run_wsl (graceful response if not installed or command execution)
  const wslRes = await gateway.execute('run_wsl', {
    command: 'echo "wsl:ok"'
  });
  assert.ok(typeof wslRes.ok === 'boolean', 'run_wsl should return boolean ok status');

  // 4. Command timeout handling
  const timeoutRes = await gateway.execute('run_command', {
    command: 'node -e "setTimeout(() => console.log(\'done\'), 2000)"',
    timeout: 200
  });
  assert.equal(timeoutRes.ok, false, 'timed out command should fail');
  assert.ok(timeoutRes.killed || /timed out|Command failed/i.test(timeoutRes.error), 'should report timeout error');
});

test('Tool Ecosystem: Developer Tools Suite (Git, Tests, Build, Lint, TypeCheck)', async () => {
  const { gateway } = setupTestEnvironment();

  // 1. git_status
  const gitStatusRes = await gateway.execute('git_status', {});
  assert.equal(gitStatusRes.ok, true, 'git_status should succeed');
  assert.ok(typeof gitStatusRes.branch === 'string', 'should report branch');

  // 2. git_branch
  const branchRes = await gateway.execute('git_branch', {});
  assert.equal(branchRes.ok, true, 'git_branch should succeed');
  assert.ok(Array.isArray(branchRes.branches), 'branches should be array');

  // 3. git_log
  const logRes = await gateway.execute('git_log', { limit: 3 });
  assert.equal(logRes.ok, true, 'git_log should succeed');
  assert.ok(Array.isArray(logRes.commits), 'commits should be array');
  assert.ok(logRes.commits.length > 0, 'should have recent commits');

  // 4. git_diff
  const diffRes = await gateway.execute('git_diff', {});
  assert.equal(diffRes.ok, true, 'git_diff should succeed');

  // 5. git_worktree list
  const wtRes = await gateway.execute('git_worktree', { action: 'list' });
  assert.equal(wtRes.ok, true, 'git_worktree list should succeed');
  assert.ok(Array.isArray(wtRes.worktrees), 'worktrees should be array');

  // 6. run_tests (quick subtest)
  const testRunRes = await gateway.execute('run_tests', {
    command: 'node -e "process.exit(0)"'
  });
  assert.equal(testRunRes.ok, true, 'run_tests should succeed');
  assert.equal(testRunRes.exitCode, 0, 'exit code should be 0');

  // 7. run_build
  const buildRunRes = await gateway.execute('run_build', {
    command: 'node -e "console.log(\'build:done\'); process.exit(0)"'
  });
  assert.equal(buildRunRes.ok, true, 'run_build should succeed');
  assert.match(buildRunRes.stdout, /build:done/);

  // 8. lint_code
  const lintRes = await gateway.execute('lint_code', {
    command: 'node -e "console.log(\'lint:clean\'); process.exit(0)"'
  });
  assert.equal(lintRes.ok, true, 'lint_code should succeed');

  // 9. type_check
  const typeRes = await gateway.execute('type_check', {
    command: 'node -e "console.log(\'types:valid\'); process.exit(0)"'
  });
  assert.equal(typeRes.ok, true, 'type_check should succeed');
});

test('Tool Ecosystem: LSP Subsystem (Diagnostics, Symbols, References, Definitions, Formatting)', async () => {
  const { gateway } = setupTestEnvironment();

  const sampleJsPath = path.relative(workspaceRoot, path.join(testSandbox, 'lsp_sample.js'));
  const sampleContent = `
/**
 * Sample service for LSP testing
 */
class PaymentProcessor {
  constructor(apiKey) {
    this.apiKey = apiKey;
  }

  processTransaction(amount) {
    return { status: 'approved', amount };
  }
}

function calculateFee(amount) {
  return amount * 0.02;
}

module.exports = { PaymentProcessor, calculateFee };
`;
  await gateway.execute('write_file', { path: sampleJsPath, content: sampleContent });

  // 1. diagnostics (clean code)
  const diagClean = await gateway.execute('diagnostics', { path: sampleJsPath });
  assert.equal(diagClean.ok, true, 'diagnostics should report valid code');
  assert.equal(diagClean.valid, true, 'syntax should be valid');

  // 2. diagnostics (syntax error)
  const diagErr = await gateway.execute('diagnostics', {
    content: 'class Broken { constructor( { missingParen }'
  });
  assert.equal(diagErr.valid, false, 'should catch syntax error');
  assert.ok(diagErr.diagnostics.length > 0, 'diagnostics array should not be empty');
  assert.ok(typeof diagErr.diagnostics[0].line === 'number', 'should report line number');

  // 3. symbols
  const symRes = await gateway.execute('symbols', { path: sampleJsPath });
  assert.equal(symRes.ok, true, 'symbols should succeed');
  assert.ok(Array.isArray(symRes.symbols), 'symbols should be array');
  const classSym = symRes.symbols.find(s => s.name === 'PaymentProcessor');
  assert.ok(classSym, 'should extract PaymentProcessor class');
  const fnSym = symRes.symbols.find(s => s.name === 'calculateFee');
  assert.ok(fnSym, 'should extract calculateFee function');

  // 4. find_definition
  const defRes = await gateway.execute('find_definition', {
    identifier: 'PaymentProcessor',
    path: path.relative(workspaceRoot, testSandbox)
  });
  assert.equal(defRes.ok, true, 'find_definition should succeed');
  assert.ok(defRes.matches.length > 0, 'should locate declaration site');

  // 5. find_references
  const refRes = await gateway.execute('find_references', {
    identifier: 'calculateFee',
    path: path.relative(workspaceRoot, testSandbox)
  });
  assert.equal(refRes.ok, true, 'find_references should succeed');
  assert.ok(refRes.references.length > 0, 'should locate reference occurrences');

  // 6. format_document
  const formatRes = await gateway.execute('format_document', { path: sampleJsPath });
  assert.equal(formatRes.ok, true, 'format_document should succeed');

  // Clean up
  try {
    fs.unlinkSync(path.join(workspaceRoot, sampleJsPath));
  } catch (_) {}
});

test('Tool Ecosystem: Browser Automation Subsystem (Sessions, DOM, Content, Tasks)', async () => {
  const { gateway } = setupTestEnvironment();

  // 1. create_browser_session
  const sessionRes = await gateway.execute('create_browser_session', {
    sessionId: 'test_session_p5',
    startUrl: 'http://localhost:1420'
  });
  assert.equal(sessionRes.ok, true, 'create_browser_session should succeed');
  assert.equal(sessionRes.sessionId, 'test_session_p5');

  // 2. navigate_browser (fetch against local running server)
  const navRes = await gateway.execute('navigate_browser', {
    url: 'http://localhost:1420',
    sessionId: 'test_session_p5'
  });
  assert.equal(navRes.ok, true, 'navigate_browser against port 1420 should succeed');
  assert.equal(navRes.statusCode, 200, 'HTTP status should be 200');
  assert.ok(navRes.content.length > 0, 'should have fetched page markdown');

  // 3. inspect_dom
  const domRes = await gateway.execute('inspect_dom', {
    url: 'http://localhost:1420',
    selector: 'body'
  });
  assert.equal(domRes.ok, true, 'inspect_dom should succeed');
  assert.ok(domRes.contentPreview.length > 0, 'contentPreview should not be empty');

  // 4. extract_browser_content
  const extRes = await gateway.execute('extract_browser_content', {
    url: 'http://localhost:1420',
    selector: 'body'
  });
  assert.equal(extRes.ok, true, 'extract_browser_content should succeed');
  assert.ok(extRes.extractedContent.length > 0, 'extracted content should not be empty');

  // 5. interact_browser
  const interactRes = await gateway.execute('interact_browser', {
    action: 'scroll',
    url: 'http://localhost:1420'
  });
  assert.equal(interactRes.ok, true, 'interact_browser should succeed');

  // 6. execute_browser_task
  const taskRes = await gateway.execute('execute_browser_task', {
    task: 'Verify dashboard title and layout',
    url: 'http://localhost:1420'
  });
  assert.equal(taskRes.ok, true, 'execute_browser_task should succeed');
  assert.equal(taskRes.status, 'completed');

  // 7. close_browser_session
  const closeRes = await gateway.execute('close_browser_session', {
    sessionId: 'test_session_p5'
  });
  assert.equal(closeRes.ok, true, 'close_browser_session should succeed');
  assert.equal(closeRes.status, 'closed');
});

test('Tool Ecosystem: Schema Validation, Role Scoping, Policy & MCP Registration', async () => {
  const { gateway, policyEngine } = setupTestEnvironment();

  // 1. Schema Validation: Missing required parameter
  const missingArgRes = await gateway.execute('write_file', { path: 'test.txt' }); // missing content
  assert.equal(missingArgRes.ok, false, 'should fail schema validation when required arg is missing');
  assert.match(missingArgRes.error, /Missing required argument 'content'/);

  // 2. Schema Validation: Invalid parameter type
  const badTypeRes = await gateway.execute('read_file', { path: 12345 }); // path should be string
  assert.equal(badTypeRes.ok, false, 'should fail schema validation for wrong parameter type');
  assert.match(badTypeRes.error, /must be a string/);

  // 3. Role Scoping: Architect vs Coder vs Researcher
  const registry = gateway.registry;
  const architectTools = registry.getToolsForAgent('architect').map(t => t.name);
  const coderTools = registry.getToolsForAgent('coder').map(t => t.name);
  const researcherTools = registry.getToolsForAgent('researcher').map(t => t.name);

  // Architect must have read-only tools and analysis, but NOT destructive terminal tools
  assert.ok(architectTools.includes('read_file'), 'architect should have read_file');
  assert.ok(architectTools.includes('diagnostics'), 'architect should have diagnostics');
  assert.ok(!architectTools.includes('run_command'), 'architect should not have run_command');

  // Coder must have write, edit, terminal, git, lsp
  assert.ok(coderTools.includes('write_file'), 'coder should have write_file');
  assert.ok(coderTools.includes('run_command'), 'coder should have run_command');
  assert.ok(coderTools.includes('run_tests'), 'coder should have run_tests');

  // Researcher must have browser tools
  assert.ok(researcherTools.includes('navigate_browser'), 'researcher should have navigate_browser');
  assert.ok(!researcherTools.includes('write_file'), 'researcher should not have write_file');

  // 4. Plan Mode filtering
  const planTools = registry.getToolsForAgent('coder', 'plan').map(t => t.name);
  assert.ok(planTools.includes('read_file'), 'plan mode allows read_file');
  assert.ok(!planTools.includes('write_file'), 'plan mode blocks write_file');
  assert.ok(!planTools.includes('run_command'), 'plan mode blocks run_command');

  // 5. PolicyEngine denial in Plan Mode
  policyEngine.setMode('plan');
  const deniedWrite = await gateway.execute('write_file', { path: 'plan_test.txt', content: 'hello' });
  assert.equal(deniedWrite.ok, false, 'write_file must be denied in Plan Mode');
  assert.equal(deniedWrite.denied, true, 'denied flag must be true');
  policyEngine.setMode('build'); // restore

  // 6. External MCP tool registration & execution
  const externalTool = gateway.registerExternalTool({
    name: 'custom_mcp_analyzer',
    description: 'Custom external MCP analysis tool',
    parameters: {
      type: 'object',
      properties: {
        metric: { type: 'string' }
      },
      required: ['metric']
    },
    handler: async (args) => {
      return { ok: true, metricReport: `Analyzed metric: ${args.metric}` };
    }
  });

  assert.ok(gateway.registry.has('custom_mcp_analyzer'), 'custom MCP tool should be registered');
  const mcpExecRes = await gateway.execute('custom_mcp_analyzer', { metric: 'latency' });
  assert.equal(mcpExecRes.ok, true, 'external MCP tool should execute cleanly');
  assert.equal(mcpExecRes.metricReport, 'Analyzed metric: latency');

  // 7. Tool catalog and bundle discovery
  const bundles = gateway.registry.listBundles();
  assert.ok(bundles.length >= 4, 'should categorize tools into bundles');
  assert.ok(bundles.some(b => b.id === 'filesystem'), 'filesystem bundle must exist');
  assert.ok(bundles.some(b => b.id === 'developer'), 'developer bundle must exist');
  assert.ok(bundles.some(b => b.id === 'browser'), 'browser bundle must exist');
});
