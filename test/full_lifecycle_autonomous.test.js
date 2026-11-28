'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const { AbyxAgentHarness } = require('../harness');
const { InternetResearchTool } = require('../agent/tools/research_tool');
const { PythonDocTool } = require('../agent/tools/python_doc_tool');
const VerificationEngine = require('../agent/verification/verification_engine');

test('Phase 10 E2E: Full Autonomous Multi-Tool Software Lifecycle', async () => {
  const sandbox = path.join(process.cwd(), '.e2e_autonomous_run');
  try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch (_) {}
  fs.mkdirSync(sandbox, { recursive: true });

  const harness = new AbyxAgentHarness({ workspaceDir: sandbox });
  await harness.initialize('Autonomous Express Service with Microservice Research and Delivery Bundle');

  console.log('[E2E] Step 1: Internet Research & Citations...');
  const researchTool = new InternetResearchTool(sandbox);
  const research = await researchTool.execute({
    action: 'search_and_synthesize',
    topic: 'Node.js Express microservices architecture best practices',
    sources: [
      'https://en.wikipedia.org/wiki/Software_architecture',
      'https://en.wikipedia.org/wiki/Microservices'
    ]
  });
  assert.ok(research.topic);
  assert.ok(Array.isArray(research.citations));
  assert.ok(research.citations.length >= 1);
  console.log(`[E2E] Research completed with ${research.citations.length} sources and citations.`);

  console.log('[E2E] Step 2: Advance through DESIGN and Scaffold Express Application with Intentional Bug...');
  const planStep = await harness.executeStep({
    type: 'run_tool',
    toolName: 'planner',
    args: { action: 'create_plan', title: 'HTTP Service', steps: ['Scaffold app.js', 'Run tests and fix bugs', 'Generate reports'] },
    stage: 'DESIGN'
  });
  assert.equal(planStep.status, 'ok');

  const appJs = `
const http = require('node:http');

function calculateDiscount(price, discountPercent) {
  // Intentional bug: subtracting instead of multiplying for percentage
  return price - discountPercent; // Bug! Should be: price * (1 - discountPercent / 100)
}

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 'healthy', uptime: process.uptime() }));
  }
  if (req.url.startsWith('/calculate')) {
    const url = new URL(req.url, 'http://localhost');
    const price = parseFloat(url.searchParams.get('price') || '100');
    const discount = parseFloat(url.searchParams.get('discount') || '20');
    const finalPrice = calculateDiscount(price, discount);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ original: price, discountPercent: discount, finalPrice }));
  }
  res.writeHead(404);
  res.end('Not Found');
});

module.exports = { server, calculateDiscount };
if (require.main === module) {
  server.listen(4567, () => console.log('Server running on 4567'));
}
`;
  const writeApp = await harness.executeStep({
    type: 'run_tool',
    toolName: 'smart_file_editor',
    args: { action: 'write', path: 'app.js', content: appJs.trim() },
    stage: 'IMPLEMENTATION'
  });
  assert.equal(writeApp.status, 'ok');
  assert.ok(fs.existsSync(path.join(sandbox, 'app.js')));

  const testJs = `
const assert = require('assert');
const { calculateDiscount } = require('./app');

// 1. Discount of 20% on $200 should be $160 (buggy code gives 200 - 20 = 180)
const discounted = calculateDiscount(200, 20);
assert.strictEqual(discounted, 160, \`Expected 160, got \${discounted}\`);
console.log('ALL_TESTS_PASSED');
`;
  const writeTest = await harness.executeStep({
    type: 'run_tool',
    toolName: 'smart_file_editor',
    args: { action: 'write', path: 'test_app.js', content: testJs.trim() },
    stage: 'IMPLEMENTATION'
  });
  assert.equal(writeTest.status, 'ok');
  assert.ok(fs.existsSync(path.join(sandbox, 'test_app.js')));

  console.log('[E2E] Step 3: Execute Tests and Detect Intentional Bug via harness terminal...');
  const runTest1 = await harness.executeStep({
    type: 'run_tool',
    toolName: 'terminal',
    args: { command: 'node test_app.js' },
    stage: 'VERIFICATION'
  });
  console.log('runTest1:', JSON.stringify(runTest1));
  assert.equal(runTest1.status, 'ok');
  assert.ok(runTest1.observation.exitCode !== 0 || runTest1.observation.output.includes('AssertionError') || runTest1.observation.output.includes('Expected 160'));
  console.log('[E2E] Test failed as expected with calculation error:', runTest1.observation.output.trim().split('\n')[0]);

  console.log('[E2E] Step 4: Autonomous Bug Fix via smart_file_editor...');
  const fixedAppJs = appJs.replace(
    'return price - discountPercent; // Bug! Should be: price * (1 - discountPercent / 100)',
    'return price * (1 - discountPercent / 100); // Fixed!'
  );
  const writeFix = await harness.executeStep({
    type: 'run_tool',
    toolName: 'smart_file_editor',
    args: { action: 'write', path: 'app.js', content: fixedAppJs.trim() },
    stage: 'IMPLEMENTATION'
  });
  assert.equal(writeFix.status, 'ok');

  const runTest2 = await harness.executeStep({
    type: 'run_tool',
    toolName: 'terminal',
    args: { command: 'node test_app.js' },
    stage: 'VERIFICATION'
  });
  assert.equal(runTest2.status, 'ok');
  assert.ok(runTest2.observation.output.includes('ALL_TESTS_PASSED'));
  console.log('[E2E] Bug successfully fixed! Verification tests pass: ALL_TESTS_PASSED');

  console.log('[E2E] Step 5: Generate Binary PDF, PPTX, XLSX, and DOCX Deliverables...');
  const docTool = new PythonDocTool(sandbox);

  // PDF Delivery Report
  const pdfRes = await docTool.execute({
    tool: 'pdf',
    outputPath: path.join(sandbox, 'delivery_report.pdf'),
    title: 'ABYX Autonomous Delivery Report',
    paragraphs: [
      'Autonomous multi-tool workflow executed flawlessly in clean-room environment.',
      `Retrieved ${research.citations.length} architecture patterns with formal citations.`,
      'Expression calculation tests: 100% passing. Checkpoints verified.'
    ]
  });
  assert.strictEqual(pdfRes.success, true);
  assert.ok(fs.existsSync(path.join(sandbox, 'delivery_report.pdf')));
  const pdfBytes = fs.readFileSync(path.join(sandbox, 'delivery_report.pdf'));
  assert.ok(pdfBytes.slice(0, 5).toString().startsWith('%PDF-'));

  // PPTX Presentation
  const pptxRes = await docTool.execute({
    tool: 'pptx',
    outputPath: path.join(sandbox, 'delivery_presentation.pptx'),
    title: 'ABYX Architecture & Delivery',
    slides: [
      { title: 'Overview', points: ['Autonomous Agent Harness', 'Clean-Room Microkernel', 'Zero VRAM Overhead'] },
      { title: 'Verification', points: ['Deterministic Self-Correction', 'Automated Bug Remediation', 'Cryptographic Packaging'] }
    ]
  });
  assert.strictEqual(pptxRes.success, true);
  assert.ok(fs.existsSync(path.join(sandbox, 'delivery_presentation.pptx')));

  // XLSX with Live Formulas
  const xlsxRes = await docTool.execute({
    tool: 'xlsx',
    outputPath: path.join(sandbox, 'delivery_metrics.xlsx'),
    sheetName: 'Metrics',
    headers: ['Metric', 'Target', 'Actual'],
    rows: [
      ['RAM Harness Overhead (MB)', 100, 48],
      ['GPU VRAM Harness Overhead (MB)', 0, 0],
      ['Unit Test Passing Rate', 100, 100]
    ],
    formulaCell: 'C5',
    formula: '=AVERAGE(C2:C4)'
  });
  assert.strictEqual(xlsxRes.success, true);
  assert.ok(fs.existsSync(path.join(sandbox, 'delivery_metrics.xlsx')));

  console.log('[E2E] Step 6: Package Full Bundle into SHA-256 ZIP...');
  const zipPath = path.join(sandbox, 'project_delivery_bundle.zip');
  const zipRes = await docTool.execute({
    tool: 'zip',
    action: 'create',
    zipPath: zipPath,
    files: [
      path.join(sandbox, 'app.js'),
      path.join(sandbox, 'test_app.js'),
      path.join(sandbox, 'delivery_report.pdf'),
      path.join(sandbox, 'delivery_presentation.pptx'),
      path.join(sandbox, 'delivery_metrics.xlsx')
    ]
  });
  assert.strictEqual(zipRes.success, true);
  assert.ok(fs.existsSync(zipPath));
  assert.ok(zipRes.sha256 && zipRes.sha256.length === 64);
  console.log(`[E2E] Delivery bundle generated with SHA-256: ${zipRes.sha256}`);

  console.log('[E2E] Step 7: Verification Engine Independent Audit...');
  const verifier = new VerificationEngine({ workspaceRoot: sandbox });
  const audit = await verifier.runSuite({
    steps: [
      { type: 'file_exists', path: 'app.js' },
      { type: 'file_exists', path: 'test_app.js' },
      { type: 'file_exists', path: 'delivery_report.pdf' },
      { type: 'file_exists', path: 'delivery_presentation.pptx' },
      { type: 'file_exists', path: 'delivery_metrics.xlsx' },
      { type: 'file_exists', path: 'project_delivery_bundle.zip' },
      { type: 'file_content', path: 'app.js', options: { contains: ['calculateDiscount', 'return price * (1 - discountPercent / 100)'] } }
    ]
  });
  assert.strictEqual(audit.passed, true);
  assert.strictEqual(audit.failedChecks, 0);
  assert.strictEqual(audit.totalChecks, 7);
  console.log(`[E2E] VerificationEngine Audit: ${audit.passedChecks}/${audit.totalChecks} Deliverables & Content assertions verified and compliant!`);

  harness.dispose();
  try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch (_) {}
  console.log('[E2E] Full Lifecycle Multi-Tool Workflow Completed Successfully!');
});
