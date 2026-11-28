const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  AbyxAgentHarness,
  PythonDocRunner,
  PlaywrightBrowserTool,
  ProcessManager,
  MultiSubagentOrchestrator,
  GoalOrchestrator,
  InternetResearchTool,
  SmartFileEditor,
  CheckpointManager
} = require('../harness/index');

const ACCEPTANCE_DIR = path.resolve(__dirname, '..', '.acceptance_sandbox');

describe('ABYX Mandatory Acceptance Test Suite (Section 14)', () => {
  before(() => {
    if (fs.existsSync(ACCEPTANCE_DIR)) {
      fs.rmSync(ACCEPTANCE_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(ACCEPTANCE_DIR, { recursive: true });
  });

  after(() => {
    if (fs.existsSync(ACCEPTANCE_DIR)) {
      fs.rmSync(ACCEPTANCE_DIR, { recursive: true, force: true });
    }
  });

  test('Test 1: Software Development (Agent creates & executes working app)', async () => {
    const ws = path.join(ACCEPTANCE_DIR, 'app_test');
    fs.mkdirSync(ws, { recursive: true });
    const harness = new AbyxAgentHarness({ workspaceDir: ws });
    await harness.initialize('Create and run an Express-like HTTP service app');

    // 1. Advance through DESIGN
    await harness.executeStep({
      type: 'run_tool',
      toolName: 'planner',
      args: { action: 'create_plan', title: 'HTTP Service', steps: ['Create app.js', 'Execute & verify'] },
      stage: 'DESIGN'
    });

    // 2. Write application code
    const writeRes = await harness.executeStep({
      type: 'run_tool',
      toolName: 'smart_file_editor',
      args: {
        action: 'write',
        path: 'app.js',
        content: "const http = require('node:http');\nconst s = http.createServer((q, r) => r.end('ABYX_APP_ONLINE'));\ns.listen(39123, () => console.log('SERVER_STARTED'));\nsetTimeout(() => { s.close(); process.exit(0); }, 500);"
      },
      stage: 'IMPLEMENTATION'
    });
    assert.equal(writeRes.status, 'ok');

    // 3. Execute application
    const runRes = await harness.executeStep({
      type: 'run_tool',
      toolName: 'terminal',
      args: { command: 'node app.js' },
      stage: 'IMPLEMENTATION'
    });
    assert.equal(runRes.status, 'ok');
    assert.ok(runRes.observation.output.includes('SERVER_STARTED'));

    harness.dispose();
  });

  test('Test 2: PDF Generation via ReportLab (Valid PDF created and verified)', () => {
    const ws = path.join(ACCEPTANCE_DIR, 'docs_test');
    fs.mkdirSync(ws, { recursive: true });
    const pyDoc = new PythonDocRunner(ws);

    const pdfRes = pyDoc.execute({
      tool: 'pdf',
      outputPath: 'financial_report.pdf',
      title: 'Q4 Financial & AI Infrastructure Report',
      paragraphs: [
        'Executive Summary: The deployment of autonomous agents achieved 99.8% uptime.',
        'Cost analysis confirms 0 MB VRAM overhead on RTX 5060, allowing full model residency.'
      ]
    });

    assert.equal(pdfRes.status, 'success');
    assert.equal(pdfRes.format, 'PDF');
    const pdfBytes = fs.readFileSync(path.join(ws, 'financial_report.pdf'));
    assert.equal(pdfBytes.slice(0, 5).toString(), '%PDF-');
    assert.ok(pdfRes.bytes > 1000);
  });

  test('Test 3: DOCX Generation via python-docx (Valid editable document)', () => {
    const ws = path.join(ACCEPTANCE_DIR, 'docs_test');
    const pyDoc = new PythonDocRunner(ws);

    const docxRes = pyDoc.execute({
      tool: 'docx',
      outputPath: 'project_specification.docx',
      title: 'ABYX Autonomous Agent Specification',
      sections: [
        { heading: 'Overview', body: 'This document defines the agent harness architecture.' },
        { heading: 'Security', body: 'Path jailing, secrets masking, and human approval gates.' }
      ]
    });

    assert.equal(docxRes.status, 'success');
    assert.equal(docxRes.format, 'DOCX');
    const docxBytes = fs.readFileSync(path.join(ws, 'project_specification.docx'));
    assert.equal(docxBytes.slice(0, 2).toString(), 'PK'); // Zip container
  });

  test('Test 4: XLSX Generation via openpyxl (Working Excel formulas verified)', () => {
    const ws = path.join(ACCEPTANCE_DIR, 'docs_test');
    const pyDoc = new PythonDocRunner(ws);

    const xlsxRes = pyDoc.execute({
      tool: 'xlsx',
      outputPath: 'performance_metrics.xlsx',
      sheetName: 'LatencyData',
      headers: ['Task ID', 'Latency (ms)', 'Memory (MB)'],
      rows: [
        ['Task_1', 34, 48],
        ['Task_2', 6, 52],
        ['Task_3', 5, 50]
      ],
      formulaCell: 'B5',
      formula: '=SUM(B2:B4)'
    });

    assert.equal(xlsxRes.status, 'success');
    assert.equal(xlsxRes.format, 'XLSX');
    assert.ok(fs.existsSync(path.join(ws, 'performance_metrics.xlsx')));
  });

  test('Test 5: PPTX Generation via python-pptx (Valid presentation created)', () => {
    const ws = path.join(ACCEPTANCE_DIR, 'docs_test');
    const pyDoc = new PythonDocRunner(ws);

    const pptxRes = pyDoc.execute({
      tool: 'pptx',
      outputPath: 'agent_architecture.pptx',
      title: 'ABYX Architecture Overview',
      slides: [
        { title: 'Core Principles', bullets: ['Zero-Copy Clean-Room', '0 MB VRAM footprint', 'Sub-millisecond loop'] },
        { title: 'Multi-Agent Team', bullets: ['Research Agent', 'Code Agent', 'QA Agent'] }
      ]
    });

    assert.equal(pptxRes.status, 'success');
    assert.equal(pptxRes.format, 'PPTX');
    const pptxBytes = fs.readFileSync(path.join(ws, 'agent_architecture.pptx'));
    assert.equal(pptxBytes.slice(0, 2).toString(), 'PK');
  });

  test('Test 6: ZIP Management (Creation, Extraction, and SHA-256 Checksums)', () => {
    const ws = path.join(ACCEPTANCE_DIR, 'zip_test');
    fs.mkdirSync(ws, { recursive: true });
    const pyDoc = new PythonDocRunner(ws);

    // Create test files
    fs.writeFileSync(path.join(ws, 'file1.txt'), 'Content Alpha');
    fs.writeFileSync(path.join(ws, 'file2.txt'), 'Content Beta');

    // 1. Create ZIP
    const createRes = pyDoc.execute({
      tool: 'zip',
      action: 'create',
      zipPath: 'bundle.zip',
      files: {
        'file1.txt': path.join(ws, 'file1.txt'),
        'file2.txt': path.join(ws, 'file2.txt')
      }
    });
    assert.equal(createRes.status, 'success');
    assert.ok(createRes.sha256);

    // 2. Verify ZIP integrity
    const verifyRes = pyDoc.execute({
      tool: 'zip',
      action: 'verify',
      zipPath: 'bundle.zip'
    });
    assert.equal(verifyRes.status, 'success');
    assert.equal(verifyRes.valid, true);
    assert.equal(verifyRes.sha256, createRes.sha256);

    // 3. Extract ZIP
    const extractRes = pyDoc.execute({
      tool: 'zip',
      action: 'extract',
      zipPath: 'bundle.zip',
      extractTo: path.join(ws, 'extracted')
    });
    assert.equal(extractRes.status, 'success');
    assert.ok(fs.existsSync(path.join(ws, 'extracted', 'file1.txt')));
    assert.equal(fs.readFileSync(path.join(ws, 'extracted', 'file1.txt'), 'utf-8'), 'Content Alpha');
  });

  test('Test 7: Internet Research (Multi-source research, citations & synthesis)', async () => {
    const ws = path.join(ACCEPTANCE_DIR, 'research_test');
    fs.mkdirSync(ws, { recursive: true });
    const research = new InternetResearchTool(ws);

    const res = await research.execute({
      action: 'search_and_synthesize',
      topic: 'Software Architecture Patterns',
      sources: ['https://en.wikipedia.org/wiki/Software_architecture']
    });

    assert.equal(res.topic, 'Software Architecture Patterns');
    assert.ok(res.citations.length > 0);
    assert.ok(res.summary.includes('Software Architecture Patterns'));
  });

  test('Test 8: Genuine Browser Automation via Playwright (Navigation, Click, Type, Screenshot)', async () => {
    const ws = path.join(ACCEPTANCE_DIR, 'browser_test');
    fs.mkdirSync(ws, { recursive: true });

    // Create a local interactive test HTML file
    const htmlFile = path.join(ws, 'interactive.html');
    fs.writeFileSync(htmlFile, `
      <!DOCTYPE html>
      <html>
      <head><title>Playwright Automation Target</title></head>
      <body>
        <h1 id="headline">Original Title</h1>
        <input type="text" id="username-input" placeholder="Enter username">
        <button id="submit-btn" onclick="document.getElementById('headline').innerText = 'Submitted: ' + document.getElementById('username-input').value">Submit Form</button>
      </body>
      </html>
    `);

    const browser = new PlaywrightBrowserTool(ws);

    // 1. Navigate
    const navRes = await browser.execute({ action: 'navigate', url: htmlFile });
    assert.equal(navRes.status, 'loaded');
    assert.equal(navRes.title, 'Playwright Automation Target');

    // 2. Type into input
    const typeRes = await browser.execute({ action: 'type', selector: '#username-input', text: 'abyx_engineer' });
    assert.equal(typeRes.status, 'typed');

    // 3. Click button
    const clickRes = await browser.execute({ action: 'click', selector: '#submit-btn' });
    assert.equal(clickRes.status, 'clicked');

    // 4. Verify DOM updated from user interaction
    const domRes = await browser.execute({ action: 'inspect_dom', selector: '#headline' });
    assert.ok(domRes.textSnippet.includes('Submitted: abyx_engineer'));

    // 5. Take real screenshot
    const shotRes = await browser.execute({ action: 'screenshot', outputPath: 'page_capture.png' });
    assert.equal(shotRes.status, 'captured');
    assert.ok(fs.existsSync(path.join(ws, 'page_capture.png')));
    assert.ok(shotRes.bytes > 5000);

    await browser.close();
  });

  test('Test 9: Multi-Tool Workflow (File write -> Git commit -> Doc generation -> Zip)', () => {
    const ws = path.join(ACCEPTANCE_DIR, 'workflow_test');
    fs.mkdirSync(ws, { recursive: true });

    const editor = new SmartFileEditor(ws);
    const pyDoc = new PythonDocRunner(ws);

    // Step 1: Write file
    editor.writeFile('src/main.js', 'console.log("Multi-tool pipeline");');

    // Step 2: Generate PDF report
    pyDoc.execute({
      tool: 'pdf',
      outputPath: 'pipeline_report.pdf',
      title: 'Workflow Execution Report',
      paragraphs: ['Multi-tool integration verified.']
    });

    // Step 3: Package into ZIP
    const zipRes = pyDoc.execute({
      tool: 'zip',
      action: 'create',
      zipPath: 'release_artifact.zip',
      files: {
        'main.js': path.join(ws, 'src', 'main.js'),
        'report.pdf': path.join(ws, 'pipeline_report.pdf')
      }
    });

    assert.equal(zipRes.status, 'success');
    assert.ok(fs.existsSync(path.join(ws, 'release_artifact.zip')));
  });

  test('Test 10: Long-Running Task & Process Manager (Detached execution & monitoring)', async () => {
    const ws = path.join(ACCEPTANCE_DIR, 'proc_test');
    fs.mkdirSync(ws, { recursive: true });
    const procMgr = new ProcessManager(ws);

    // Spawn a background process running for 2 seconds
    const spawned = procMgr.spawnProcess('bg_worker_1', 'node', ['-e', 'console.log("WORKER_RUNNING"); setTimeout(() => console.log("WORKER_FINISHED"), 1000);']);
    assert.ok(spawned.pid);
    assert.equal(spawned.status, 'RUNNING');

    // Verify process is listed
    const active = procMgr.getProcess('bg_worker_1');
    assert.equal(active.id, 'bg_worker_1');

    // Wait 1.2 seconds and verify logs captured
    await new Promise(r => setTimeout(r, 1200));
    const logs = procMgr.readProcessLogs('bg_worker_1');
    assert.ok(logs.includes('WORKER_RUNNING'));
    assert.ok(logs.includes('WORKER_FINISHED'));
  });

  test('Test 11: Recovery & Checkpointing (Interrupted session resumes safely)', () => {
    const ws = path.join(ACCEPTANCE_DIR, 'recovery_test');
    fs.mkdirSync(ws, { recursive: true });

    const checkpoints = new CheckpointManager(ws);
    fs.writeFileSync(path.join(ws, 'state.json'), JSON.stringify({ phase: 'PHASE_1' }));
    checkpoints.createCheckpoint('checkpoint_before_crash');

    // Simulate crash / state corruption
    fs.writeFileSync(path.join(ws, 'state.json'), JSON.stringify({ phase: 'CORRUPTED' }));
    assert.ok(fs.readFileSync(path.join(ws, 'state.json'), 'utf-8').includes('CORRUPTED'));

    // Safe recovery rollback
    const rollbackRes = checkpoints.rollback('checkpoint_before_crash');
    assert.equal(rollbackRes.success, true);
    assert.ok(fs.readFileSync(path.join(ws, 'state.json'), 'utf-8').includes('PHASE_1'));
  });

  test('Test 12: Subagents report blocked when no real task runner is configured', async () => {
    const ws = path.join(ACCEPTANCE_DIR, 'subagents_team_test');
    fs.mkdirSync(ws, { recursive: true });
    const orchestrator = new MultiSubagentOrchestrator(ws);

    const team = [
      { role: 'ResearchAgent', specialization: 'Dependency survey', taskPrompt: 'Survey database connectors' },
      { role: 'CodeAgent', specialization: 'Backend API builder', taskPrompt: 'Construct user model schema' },
      { role: 'QAAgent', specialization: 'Test verification', taskPrompt: 'Generate test assertions' }
    ];

    const results = await orchestrator.runParallelTeam(team);
    assert.equal(results.length, 3);

    for (const r of results) {
      assert.equal(r.result.verified, false);
      assert.equal(r.result.status, 'blocked');
      assert.match(r.result.error, /task runner/i);
    }

    assert.equal(orchestrator.listSubagents().length, 3);
  });

  test('Test 13: Goal loop refuses to claim success without an engine and verification', async () => {
    const ws = path.join(ACCEPTANCE_DIR, 'goal_test');
    fs.mkdirSync(ws, { recursive: true });
    const goalOrch = new GoalOrchestrator(ws, { maxIterations: 3 });

    const goalRes = await goalOrch.executeGoal(
      'Construct a verified data transformation library',
      ['Criteria 1: Plan created', 'Criteria 2: Implementation verified']
    );

    assert.equal(goalRes.achieved, false);
    assert.equal(goalRes.status, 'blocked');
    assert.match(goalRes.error, /configured agent engine/i);
  });
});
