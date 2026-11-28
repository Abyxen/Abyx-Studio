const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");

const StudyService = require("../../services/study_service");
const KnowledgeService = require("../../rag/knowledge_service");
const automationService = require("../../services/automation_service");
const obsidianVault = require("../../services/obsidian_vault");
const subagents = require("../../services/subagents");
const mcpClient = require("../../services/mcp_client");
const db = require("../../db");

db.initDatabase();
const knowledgeService = new KnowledgeService();
const studyService = new StudyService(knowledgeService);

test("Phase 4: Abyx LM / Studybooks Service", async (t) => {
  await t.test("Studybooks lifecycle: create, get, update, list, delete", async () => {
    const created = studyService.createStudybook("prof_default", {
      title: "Test Biology 101",
      description: "Introductory Cellular Biology",
      emoji: "🧬"
    });
    assert.ok(created && created.id, "Studybook created with ID");
    assert.strictEqual(created.title, "Test Biology 101");

    const fetched = studyService.getStudybook(created.id, "prof_default");
    assert.ok(fetched, "Fetched created studybook");
    assert.strictEqual(fetched.title, "Test Biology 101");

    const updated = studyService.updateStudybook(created.id, "prof_default", {
      title: "Advanced Biology 101",
      description: "Updated description"
    });
    assert.strictEqual(updated.title, "Advanced Biology 101");

    const list = studyService.listStudybooks("prof_default");
    assert.ok(list.some(s => s.id === created.id), "Created studybook listed");

    // Add text note source
    const addTextRes = await studyService.addSourceText(created.id, "Mitochondria is the powerhouse of the cell. It generates ATP via oxidative phosphorylation.", "Cell Energy Notes", "prof_default");
    assert.ok(addTextRes && addTextRes.sourceId, "Text source added");

    const sources = studyService.listSources(created.id, "prof_default");
    assert.ok(sources.length > 0, "Sources listed for studybook");

    // Progress
    const progress = studyService.getStudybookProgress(created.id, "prof_default");
    assert.ok(typeof progress === "object", "Progress object returned");

    // Cleanup
    studyService.deleteStudybook(created.id, "prof_default");
    const checkDeleted = studyService.getStudybook(created.id, "prof_default");
    assert.strictEqual(checkDeleted, null, "Studybook deleted successfully");
  });

  await t.test("Study materials and fallback generation", async () => {
    const sb = studyService.createStudybook("prof_default", { title: "Chemistry Fundamentals" });
    await studyService.addSourceText(sb.id, "Water consists of two hydrogen atoms and one oxygen atom (H2O). The covalent bond has an angle of 104.5 degrees.", "Water Structure", "prof_default");

    // Flashcards generation
    const flashcards = await studyService.generateMaterial(sb.id, "flashcards", "prof_default");
    assert.ok(flashcards && flashcards.id, "Flashcards material created");
    assert.strictEqual(flashcards.type, "flashcards");

    // Flashcard mastery recording
    const masteryRes = studyService.recordFlashcardMastery(flashcards.id, ["card_1"], "prof_default");
    assert.ok(masteryRes.ok, "Mastery recorded");

    // Quiz generation
    const quiz = await studyService.generateMaterial(sb.id, "quiz", "prof_default");
    assert.ok(quiz && quiz.id, "Quiz material created");
    assert.strictEqual(quiz.type, "quiz");

    // Quiz score recording
    const scoreRes = studyService.recordQuizScore(quiz.id, { q_1: "B" }, "prof_default");
    assert.ok(scoreRes.ok, "Quiz score recorded");

    // Study chat grounding
    const chatRes = await studyService.chat(sb.id, "What is water composed of?", "prof_default");
    assert.ok(chatRes && chatRes.ok, "Chat response returned");
    assert.ok(chatRes.answer && chatRes.answer.length > 0, "Non-empty grounded answer");

    studyService.deleteStudybook(sb.id, "prof_default");
  });
});

test("Phase 4: Scheduled Automations Engine", async (t) => {
  await t.test("Automations workflow proposal and task management", async () => {
    const proposal = automationService.proposeWorkflow("Summarize tech news every morning at 8 AM");
    assert.ok(proposal, "Workflow proposal generated");
    assert.ok(proposal.proposedAutomation || proposal.name || proposal.trigger, "Has proposal details");

    const task = automationService.createTask({
      name: "Daily Tech Briefing",
      triggerType: "interval",
      intervalMinutes: 1440,
      steps: [{ name: "Extract news", tool: "custom_task" }]
    }, "prof_default");
    assert.ok(task && task.id, "Task created");

    const tasks = automationService.loadTasks("prof_default");
    assert.ok(tasks.some(t => t.id === task.id), "Task present in loadTasks");

    const paused = automationService.pauseTask(task.id, "prof_default");
    assert.strictEqual(paused.status, "paused", "Task paused");

    const resumed = automationService.resumeTask(task.id, "prof_default");
    assert.strictEqual(resumed.enabled, true, "Task resumed");

    // Cleanup
    automationService.deleteTask(task.id, "prof_default");
    const tasksAfter = automationService.loadTasks("prof_default");
    assert.ok(!tasksAfter.some(t => t.id === task.id), "Task deleted");
  });
});

test("Phase 4: Obsidian Second Brain Service", async (t) => {
  await t.test("Obsidian status query and sync validation", () => {
    const status = obsidianVault.getStatus();
    assert.ok(typeof status === "object", "Status object returned");
    assert.ok("vaultName" in status, "Status has vaultName");
    assert.ok("vaultExists" in status, "Status has vaultExists");
    assert.ok("obsidianInstalled" in status, "Status has obsidianInstalled");
    assert.ok(typeof status.noteCount === "number", "Note count is numeric");
  });
});

test("Phase 4: Subagents Hub & Teamwork", async (t) => {
  await t.test("Subagent persona catalog and invocation", async () => {
    const roster = subagents.getSubagents();
    assert.strictEqual(roster.length, 7, "7 specialized subagents available");
    const ids = roster.map(s => s.id);
    assert.ok(ids.includes("research"), "Includes research subagent");
    assert.ok(ids.includes("browser"), "Includes browser subagent");
    assert.ok(ids.includes("coder"), "Includes coder subagent");
    assert.ok(ids.includes("designer"), "Includes designer subagent");
    assert.ok(ids.includes("security"), "Includes security subagent");
    assert.ok(ids.includes("reviewer"), "Includes reviewer subagent");
    assert.ok(ids.includes("swarm"), "Includes swarm subagent");

    // Subagent invocation test
    const invokeRes = await subagents.invokeSubagent({
      subagentId: "coder",
      taskPrompt: "Validate unit test coverage for project modules",
      context: "Phase 4 unified migration"
    });
    assert.ok(invokeRes, "Subagent invocation returned a result");
    assert.strictEqual(invokeRes.subagent.id, "coder");
    if (invokeRes.ok) {
      assert.ok(invokeRes.response && invokeRes.response.length > 0, "A live provider response was received");
    } else {
      assert.strictEqual(invokeRes.status, "blocked");
      assert.match(invokeRes.error, /provider/i);
    }
  });
});

test("Phase 4: MCP Client & Tool Registry", async (t) => {
  await t.test("MCP config loading and tool listing", () => {
    const cfg = mcpClient.loadConfig("prof_default");
    assert.ok(cfg && cfg.mcpServers, "MCP config loaded");

    const tools = mcpClient.getAllTools("prof_default");
    assert.ok(Array.isArray(tools) && tools.length > 0, "MCP tools returned");

    // Test add and delete custom server
    const addRes = mcpClient.addServer("test-server", {
      description: "Test MCP Server",
      command: "node",
      args: ["test.js"]
    }, "prof_default");
    assert.ok(addRes.ok && addRes.server, "Server added");

    const toggleRes = mcpClient.toggleServer("test-server", false, "prof_default");
    assert.strictEqual(toggleRes.server.enabled, false, "Server toggled to disabled");

    mcpClient.deleteServer("test-server", "prof_default");
    const cfgAfter = mcpClient.loadConfig("prof_default");
    assert.ok(!cfgAfter.mcpServers["test-server"], "Server deleted");
  });
});

test("Phase 4: HTTP Routes Handler Integration", async (t) => {
  const { handlePhase4Routes } = require("../server/phase4_routes.cjs");

  function createMockRes() {
    let statusCode = null;
    let headers = null;
    let body = null;
    return {
      writeHead: (code, hdrs) => { statusCode = code; headers = hdrs; },
      end: (data) => { body = data; },
      get output() {
        return { statusCode, headers, json: body ? JSON.parse(body) : null };
      }
    };
  }

  function json(res, code, obj) {
    res.writeHead(code, { "Content-Type": "application/json" });
    res.end(JSON.stringify(obj));
  }

  async function readJsonBody(req) {
    return req._body || {};
  }

  await t.test("GET /api/study/studybooks route", async () => {
    const res = createMockRes();
    const handled = await handlePhase4Routes(
      { method: "GET", url: "/api/study/studybooks", headers: {} },
      res,
      { studyService, automationService, obsidianVault, subagents, mcpClient, readJsonBody, json }
    );
    assert.strictEqual(handled, undefined); // executed json() and ended
    assert.strictEqual(res.output.statusCode, 200);
    assert.ok(res.output.json.ok);
    assert.ok(Array.isArray(res.output.json.studybooks));
  });

  await t.test("GET /api/automations route", async () => {
    const res = createMockRes();
    const handled = await handlePhase4Routes(
      { method: "GET", url: "/api/automations", headers: {} },
      res,
      { studyService, automationService, obsidianVault, subagents, mcpClient, readJsonBody, json }
    );
    assert.strictEqual(res.output.statusCode, 200);
    assert.ok(res.output.json.ok);
    assert.ok(Array.isArray(res.output.json.tasks));
  });

  await t.test("GET /api/obsidian/status route", async () => {
    const res = createMockRes();
    const handled = await handlePhase4Routes(
      { method: "GET", url: "/api/obsidian/status", headers: {} },
      res,
      { studyService, automationService, obsidianVault, subagents, mcpClient, readJsonBody, json }
    );
    assert.strictEqual(res.output.statusCode, 200);
    assert.ok(res.output.json.ok);
    assert.ok("vaultName" in res.output.json);
  });

  await t.test("GET /api/subagents route", async () => {
    const res = createMockRes();
    const handled = await handlePhase4Routes(
      { method: "GET", url: "/api/subagents", headers: {} },
      res,
      { studyService, automationService, obsidianVault, subagents, mcpClient, readJsonBody, json }
    );
    assert.strictEqual(res.output.statusCode, 200);
    assert.ok(res.output.json.ok);
    assert.strictEqual(res.output.json.total_subagents, 7);
  });

  await t.test("GET /api/mcp/servers route", async () => {
    const res = createMockRes();
    const handled = await handlePhase4Routes(
      { method: "GET", url: "/api/mcp/servers", headers: {} },
      res,
      { studyService, automationService, obsidianVault, subagents, mcpClient, readJsonBody, json }
    );
    assert.strictEqual(res.output.statusCode, 200);
    assert.ok(res.output.json.ok);
    assert.ok(res.output.json.servers);
  });
});
