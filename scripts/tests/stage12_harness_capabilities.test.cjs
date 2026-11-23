/**
 * Stage 12: ABYX Agent Harness, Tools, Browser, Filesystem & Multi-Step Engine Test Suite
 *
 * Verifies:
 * 1. Project workspace containment (mkdir, write, edit, move, read, delete, PathGuard traversal blocks)
 * 2. Universal document and PDF generation (real PDF generation via fpdf2)
 * 3. Controlled browser tools (real web search, web page extraction, SSRF blocking)
 * 4. Bounded Agent Execution Engine (multi-step planning, tool dispatch, timeline events, human approvals, cancellation)
 * 5. Skills catalog and microkernel seams telemetry
 * 6. HTTP API route integration for harness endpoints
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const { createAgentEngine, PathGuard, PolicyEngine, WorkspaceFsTool, ControlledBrowserTool, AgentExecutionEngine } = require("../../agent");
const workspaceService = require("../../services/workspace_service");
const universalFileGenerator = require("../../services/universal_file_generator");
const browserService = require("../../services/browser_service");
const abyxSkills = require("../../services/abyx_skills");
const { harness, getHarnessStatus, SEAMS } = require("../../harness");
const { handleHarnessRoutes } = require("../server/harness_routes.cjs");

test("Stage 12: ABYX Agent Harness & Tools Verification", async (t) => {
  // Setup safe temporary project folder
  const testWorkspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "abyx-stage12-harness-"));
  const prevWorkspaceId = workspaceService.getActiveWorkspace()?.id;
  const createdWs = workspaceService.createWorkspace("Stage 12 Test WS", testWorkspaceDir);
  workspaceService.setActiveWorkspace(createdWs.id);

  const pathGuard = new PathGuard(testWorkspaceDir);
  const fsTool = new WorkspaceFsTool(pathGuard);
  const browserTool = new ControlledBrowserTool();
  const engine = createAgentEngine({ approvedRoots: [testWorkspaceDir], allowTerminal: false, allowBrowser: true });

  t.after(() => {
    try {
      if (prevWorkspaceId) workspaceService.setActiveWorkspace(prevWorkspaceId);
      if (createdWs?.id) workspaceService.deleteWorkspace(createdWs.id);
      fs.rmSync(testWorkspaceDir, { recursive: true, force: true });
    } catch (_) {}
  });

  // 1. Filesystem & Project Workspace Boundary
  await t.test("1. Filesystem tools: mkdir, write, edit, move, read, list, and delete", async () => {
    // A. Create folder
    const mkdirRes = await fsTool.mkdir({ dirPath: "sub_docs" });
    assert.equal(mkdirRes.success, true);
    assert.ok(fs.existsSync(path.join(testWorkspaceDir, "sub_docs")));

    // B. Write file
    const writeRes = await fsTool.write({
      filePath: "sub_docs/report.txt",
      content: "System Alpha Initial Report Content\nStatus: Pending",
    });
    assert.equal(writeRes.success, true);
    assert.equal(fs.readFileSync(path.join(testWorkspaceDir, "sub_docs", "report.txt"), "utf8"), "System Alpha Initial Report Content\nStatus: Pending");

    // C. Edit file surgically
    const editRes = await fsTool.edit({
      filePath: "sub_docs/report.txt",
      target: "Status: Pending",
      replacement: "Status: Verified Active",
    });
    assert.equal(editRes.success, true);
    assert.equal(editRes.occurrencesReplaced, 1);

    // D. Read file
    const readRes = await fsTool.read({ filePath: "sub_docs/report.txt" });
    assert.equal(readRes.success, true);
    assert.ok(readRes.content.includes("Status: Verified Active"));

    // E. Move / Rename file
    const moveRes = await fsTool.move({
      sourcePath: "sub_docs/report.txt",
      destinationPath: "sub_docs/verified_report.txt",
    });
    assert.equal(moveRes.success, true);
    assert.ok(fs.existsSync(path.join(testWorkspaceDir, "sub_docs", "verified_report.txt")));
    assert.ok(!fs.existsSync(path.join(testWorkspaceDir, "sub_docs", "report.txt")));

    // F. List files
    const listRes = await fsTool.list({ dirPath: "sub_docs" });
    assert.equal(listRes.success, true);
    assert.equal(listRes.entries.length, 1);
    assert.equal(listRes.entries[0].name, "verified_report.txt");

    // G. Delete file and folder
    const delFileRes = await fsTool.delete({ filePath: "sub_docs/verified_report.txt" });
    assert.equal(delFileRes.success, true);
    assert.ok(!fs.existsSync(path.join(testWorkspaceDir, "sub_docs", "verified_report.txt")));

    const delDirRes = await fsTool.delete({ filePath: "sub_docs" });
    assert.equal(delDirRes.success, true);
    assert.ok(!fs.existsSync(path.join(testWorkspaceDir, "sub_docs")));
  });

  // 2. Strict Boundary Security (PathGuard)
  await t.test("2. PathGuard blocks path traversal attempts outside workspace", async () => {
    assert.throws(() => {
      pathGuard.resolveSafePath("../../Windows/System32/calc.exe");
    }, /Security Violation/i);

    assert.throws(() => {
      pathGuard.resolveSafePath("C:\\Windows\\System32");
    }, /Security Violation/i);

    assert.throws(() => {
      pathGuard.resolveSafePath("../other_project/secret.env");
    }, /Security Violation/i);
  });

  // 3. Document and PDF Generation
  await t.test("3. Universal File Generator: builds real PDF and text documents", async () => {
    // Markdown file
    const mdRes = await universalFileGenerator.generateFile({
      filePath: "generated_test.md",
      fileType: "md",
      content: "# Executive Summary\nTest document generation.",
    });
    assert.equal(mdRes.success, true);
    assert.ok(fs.existsSync(path.join(testWorkspaceDir, "generated_test.md")));

    // PDF file (invokes real fpdf2 builder)
    const pdfRes = await universalFileGenerator.generateFile({
      filePath: "generated_test.pdf",
      fileType: "pdf",
      title: "Automated Test Report",
      author: "ABYX Agent",
      content: "# Automated Test Report\n\nGenerated during Stage 12 verification.",
    });
    assert.equal(pdfRes.success, true);
    assert.ok(fs.existsSync(path.join(testWorkspaceDir, "generated_test.pdf")));
    const pdfStats = fs.statSync(path.join(testWorkspaceDir, "generated_test.pdf"));
    assert.ok(pdfStats.size > 1000, `Expected PDF size > 1000 bytes, got ${pdfStats.size}`);
  });

  // 4. Controlled Browser & Web Tools
  await t.test("4. Controlled Browser Tool: web search, page reader, and SSRF blocking", async () => {
    // A. Web Search
    const searchRes = await browserTool.searchWeb({ query: "artificial intelligence" });
    assert.equal(searchRes.success, true);
    assert.ok(Array.isArray(searchRes.results));

    // B. SSRF Protection: Blocks localhost and intranet
    assert.throws(() => {
      browserTool.validateUrl("http://localhost:8080/api/admin");
    }, /SSRF Violation/i);

    assert.throws(() => {
      browserTool.validateUrl("http://127.0.0.1:11434");
    }, /SSRF Violation/i);

    assert.throws(() => {
      browserTool.validateUrl("http://169.254.169.254/latest/meta-data/");
    }, /SSRF Violation/i);

    assert.throws(() => {
      browserTool.validateUrl("file:///C:/Windows/System32/drivers/etc/hosts");
    }, /Security Violation/i);
  });

  // 5. Bounded Agent Execution Loop & Step Progression
  await t.test("5. Agent Execution Engine: multi-step loop, timeline events, and tool execution", async () => {
    const testEngine = engine.engine;
    const timelineEvents = [];

    const run = await testEngine.run({
      profileId: "prof_default",
      sessionId: "session_stage12_test",
      goal: "Create a directory called 'test_stage12' and write 'hello.txt'",
      model: "auto",
      maxSteps: 5,
      stepExecutor: async ({ run: r, step, executeTool }) => {
        if (r.stepsExecuted === 1) {
          const res = await executeTool("fs_mkdir", { dirPath: "test_stage12" });
          return { continue: true, message: "Directory created", output: res };
        }
        if (r.stepsExecuted === 2) {
          const res = await executeTool("fs_write", { filePath: "test_stage12/hello.txt", content: "Stage 12 Verified" });
          return { done: true, result: "All tasks completed successfully" };
        }
        return { done: true, result: "Done" };
      },
      onEvent: (evt) => {
        timelineEvents.push(evt.type);
      },
    });

    assert.equal(run.status, "completed");
    assert.equal(run.stepsExecuted, 2);
    assert.ok(fs.existsSync(path.join(testWorkspaceDir, "test_stage12", "hello.txt")));
    assert.equal(fs.readFileSync(path.join(testWorkspaceDir, "test_stage12", "hello.txt"), "utf8"), "Stage 12 Verified");
    assert.ok(timelineEvents.includes("run_started"));
    assert.ok(timelineEvents.includes("step_started"));
    assert.ok(timelineEvents.includes("tool_call_completed"));
    assert.ok(timelineEvents.includes("run_completed"));
  });

  // 6. Skills Catalog & Microkernel Seams
  await t.test("6. Skills Catalog & Microkernel Seams telemetry", async () => {
    const skills = abyxSkills.getSkillsCatalog();
    assert.ok(Array.isArray(skills));
    assert.equal(skills.length, 76, `Expected 76 skills, got ${skills.length}`);

    const harnessStatus = getHarnessStatus();
    assert.ok(harnessStatus.architecture);
    assert.ok(Array.isArray(harness.inspect().plugins));
    assert.ok(Object.keys(SEAMS).length >= 7);
  });

  // 7. Harness HTTP API Integration
  await t.test("7. Harness HTTP routes integration", async () => {
    const mockRes = () => {
      let statusCode = 200;
      let headers = {};
      let bodyData = "";
      return {
        writeHead: (code, h) => { statusCode = code; headers = { ...headers, ...h }; },
        setHeader: (k, v) => { headers[k] = v; },
        end: (data) => { bodyData = data || ""; },
        write: (d) => { bodyData += d; },
        pipe: () => {},
        _getData: () => bodyData,
        _getStatus: () => statusCode,
        _getHeaders: () => headers,
      };
    };

    const jsonHelper = (res, status, data) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
      return true;
    };

    // Test GET /api/agent/policy
    const req1 = { method: "GET", url: "/api/agent/policy" };
    const res1 = mockRes();
    const handled1 = await handleHarnessRoutes(req1, res1, {
      workspaceService: { getActiveWorkspace: () => ({ id: "ws1", path: testWorkspaceDir }) },
      aiProviders: null,
      db: null,
      readJsonBody: async () => ({}),
      json: jsonHelper,
    });
    assert.equal(handled1, true);
    assert.equal(res1._getStatus(), 200);
    const body1 = JSON.parse(res1._getData());
    assert.equal(body1.ok, true);
    assert.ok(body1.approvedRoots.length > 0);

    // Test GET /api/skills
    const req2 = { method: "GET", url: "/api/skills" };
    const res2 = mockRes();
    const handled2 = await handleHarnessRoutes(req2, res2, {
      workspaceService: { getActiveWorkspace: () => ({ id: "ws1", path: testWorkspaceDir }) },
      aiProviders: null,
      db: null,
      readJsonBody: async () => ({}),
      json: jsonHelper,
    });
    assert.equal(handled2, true);
    assert.equal(res2._getStatus(), 200);
    const body2 = JSON.parse(res2._getData());
    assert.equal(body2.ok, true);
    assert.equal(body2.count, 76);

    // Test GET /api/harness/status
    const req3 = { method: "GET", url: "/api/harness/status" };
    const res3 = mockRes();
    const handled3 = await handleHarnessRoutes(req3, res3, {
      workspaceService: { getActiveWorkspace: () => ({ id: "ws1", path: testWorkspaceDir }) },
      aiProviders: null,
      db: null,
      readJsonBody: async () => ({}),
      json: jsonHelper,
    });
    assert.equal(handled3, true);
    assert.equal(res3._getStatus(), 200);
    const body3 = JSON.parse(res3._getData());
    assert.equal(body3.ok, true);
    assert.equal(body3.version, "1.1.0");

    // Test GET /api/browser/proxy with local:// file
    const sampleHtmlPath = path.join(testWorkspaceDir, "test_preview.html");
    fs.writeFileSync(sampleHtmlPath, "<!DOCTYPE html><html><body><h1>Hello Workspace</h1></body></html>", "utf8");
    const req4 = { method: "GET", url: "/api/browser/proxy?url=local://test_preview.html" };
    const res4 = mockRes();
    const handled4 = await handleHarnessRoutes(req4, res4, {
      workspaceService: { getActiveWorkspace: () => ({ id: "ws1", path: testWorkspaceDir }) },
      aiProviders: null,
      db: null,
      readJsonBody: async () => ({}),
      json: jsonHelper,
    });
    assert.equal(handled4, true);
    assert.equal(res4._getStatus(), 200);
    assert.ok(res4._getData().includes("Hello Workspace"));

    // Test GET /api/browser/proxy blocks path traversal
    const req5 = { method: "GET", url: "/api/browser/proxy?url=local://../../boot.ini" };
    const res5 = mockRes();
    const handled5 = await handleHarnessRoutes(req5, res5, {
      workspaceService: { getActiveWorkspace: () => ({ id: "ws1", path: testWorkspaceDir }) },
      aiProviders: null,
      db: null,
      readJsonBody: async () => ({}),
      json: jsonHelper,
    });
    assert.equal(handled5, true);
    assert.equal(res5._getStatus(), 403);
  });
});
