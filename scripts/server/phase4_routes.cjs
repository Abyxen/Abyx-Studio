const fs = require("fs");
const path = require("path");

/**
 * Phase 4 API Route Handler for Abyx
 * Handles: Studybooks (Abyx LM), Automations, Obsidian Second Brain, Subagents Hub, MCP Servers
 */
async function handlePhase4Routes(req, res, { studyService, automationService, obsidianVault, subagents, mcpClient, readJsonBody, json }) {
  const parsedUrl = new URL(req.url, "http://localhost");
  const pathname = parsedUrl.pathname;

  // ==========================================
  // 1. ABYX LM / STUDYBOOKS (NOTEBOOKLM)
  // ==========================================

  // GET /api/study/studybooks
  if (req.method === "GET" && pathname === "/api/study/studybooks") {
    if (!studyService) return json(res, 503, { ok: false, error: "Study service unavailable" });
    try {
      const studybooks = studyService.listStudybooks("prof_default");
      return json(res, 200, { ok: true, profileId: "prof_default", studybooks });
    } catch (err) {
      return json(res, 500, { ok: false, error: err.message });
    }
  }

  // POST /api/study/studybooks
  if (req.method === "POST" && pathname === "/api/study/studybooks") {
    if (!studyService) return json(res, 503, { ok: false, error: "Study service unavailable" });
    try {
      const body = await readJsonBody(req, res);
      if (!body) return true;
      const studybook = studyService.createStudybook("prof_default", body);
      return json(res, 201, { ok: true, studybook });
    } catch (err) {
      return json(res, 400, { ok: false, error: err.message });
    }
  }

  // GET /api/study/studybooks/:id
  const studybookGetMatch = pathname.match(/^\/api\/study\/studybooks\/([^\/]+)$/);
  if (req.method === "GET" && studybookGetMatch) {
    if (!studyService) return json(res, 503, { ok: false, error: "Study service unavailable" });
    const id = decodeURIComponent(studybookGetMatch[1]);
    try {
      const studybook = studyService.getStudybook(id, "prof_default");
      if (!studybook) return json(res, 404, { ok: false, error: "Studybook not found" });
      return json(res, 200, { ok: true, studybook });
    } catch (err) {
      return json(res, 500, { ok: false, error: err.message });
    }
  }

  // PUT /api/study/studybooks/:id
  if (req.method === "PUT" && studybookGetMatch) {
    if (!studyService) return json(res, 503, { ok: false, error: "Study service unavailable" });
    const id = decodeURIComponent(studybookGetMatch[1]);
    try {
      const body = await readJsonBody(req, res);
      if (!body) return true;
      const updated = studyService.updateStudybook(id, "prof_default", body);
      return json(res, 200, { ok: true, studybook: updated });
    } catch (err) {
      return json(res, 400, { ok: false, error: err.message });
    }
  }

  // DELETE /api/study/studybooks/:id
  if (req.method === "DELETE" && studybookGetMatch) {
    if (!studyService) return json(res, 503, { ok: false, error: "Study service unavailable" });
    const id = decodeURIComponent(studybookGetMatch[1]);
    try {
      studyService.deleteStudybook(id, "prof_default");
      return json(res, 200, { ok: true, message: `Studybook ${id} deleted.` });
    } catch (err) {
      return json(res, 500, { ok: false, error: err.message });
    }
  }

  // GET /api/study/studybooks/:id/progress
  const progressMatch = pathname.match(/^\/api\/study\/studybooks\/([^\/]+)\/progress$/);
  if (req.method === "GET" && progressMatch) {
    if (!studyService) return json(res, 503, { ok: false, error: "Study service unavailable" });
    const id = decodeURIComponent(progressMatch[1]);
    try {
      const progress = studyService.getStudybookProgress(id, "prof_default");
      return json(res, 200, { ok: true, progress });
    } catch (err) {
      return json(res, 500, { ok: false, error: err.message });
    }
  }

  // GET /api/study/studybooks/:id/sources
  const sourcesMatch = pathname.match(/^\/api\/study\/studybooks\/([^\/]+)\/sources$/);
  if (req.method === "GET" && sourcesMatch) {
    if (!studyService) return json(res, 503, { ok: false, error: "Study service unavailable" });
    const id = decodeURIComponent(sourcesMatch[1]);
    try {
      const sources = studyService.listSources(id, "prof_default");
      return json(res, 200, { ok: true, sources });
    } catch (err) {
      return json(res, 500, { ok: false, error: err.message });
    }
  }

  // POST /api/study/studybooks/:id/sources
  if (req.method === "POST" && sourcesMatch) {
    if (!studyService) return json(res, 503, { ok: false, error: "Study service unavailable" });
    const id = decodeURIComponent(sourcesMatch[1]);
    const contentType = req.headers["content-type"] || "";

    if (contentType.includes("multipart/form-data")) {
      const chunks = [];
      req.on("data", chunk => chunks.push(chunk));
      req.on("end", async () => {
        try {
          const buffer = Buffer.concat(chunks);
          const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
          const boundary = boundaryMatch ? (boundaryMatch[1] || boundaryMatch[2]) : null;
          if (!boundary) return json(res, 400, { ok: false, error: "Multipart boundary missing" });

          const boundaryBuffer = Buffer.from(`--${boundary}`);
          let offset = 0;
          let uploadedSource = null;

          while (offset < buffer.length) {
            const bStart = buffer.indexOf(boundaryBuffer, offset);
            if (bStart === -1) break;
            const headerStart = bStart + boundaryBuffer.length + 2;
            const headerEnd = buffer.indexOf(Buffer.from("\r\n\r\n"), headerStart);
            if (headerEnd === -1) break;
            const headerStr = buffer.toString("utf8", headerStart, headerEnd);
            const nextBoundary = buffer.indexOf(boundaryBuffer, headerEnd + 4);
            if (nextBoundary === -1) break;
            const dataEnd = nextBoundary - 2;
            const fileData = buffer.subarray(headerEnd + 4, dataEnd);

            const fnMatch = headerStr.match(/filename="([^"]+)"/i);
            if (fnMatch && fnMatch[1] && fileData.length > 0) {
              const safeName = path.basename(fnMatch[1]);
              const profileDir = studyService._getProfileSourcesDir("prof_default");
              const savePath = path.join(profileDir, safeName);
              fs.writeFileSync(savePath, fileData);
              uploadedSource = await studyService.addSourceFile(id, savePath, "prof_default");
            }
            offset = nextBoundary;
          }

          if (uploadedSource) {
            return json(res, 201, { ok: true, source: uploadedSource });
          } else {
            return json(res, 400, { ok: false, error: "No valid file found in upload" });
          }
        } catch (err) {
          return json(res, 500, { ok: false, error: err.message });
        }
      });
      return true;
    } else {
      try {
        const body = await readJsonBody(req, res);
        if (!body) return true;
        let result;
        if (body.type === "url") {
          result = await studyService.addSourceUrl(id, body.url, "prof_default", { title: body.title });
        } else if (body.type === "text") {
          result = await studyService.addSourceText(id, body.text, body.title || "Study Note", "prof_default");
        } else if (body.type === "file" || body.filePath) {
          result = await studyService.addSourceFile(id, body.filePath, "prof_default");
        } else {
          return json(res, 400, { ok: false, error: 'Invalid source type. Specify "url", "text", or "file".' });
        }
        return json(res, 201, { ok: true, source: result });
      } catch (err) {
        return json(res, 400, { ok: false, error: err.message });
      }
    }
  }

  // DELETE /api/study/studybooks/:id/sources/:sourceId
  const sourceDeleteMatch = pathname.match(/^\/api\/study\/studybooks\/([^\/]+)\/sources\/([^\/]+)$/);
  if (req.method === "DELETE" && sourceDeleteMatch) {
    if (!studyService) return json(res, 503, { ok: false, error: "Study service unavailable" });
    const studybookId = decodeURIComponent(sourceDeleteMatch[1]);
    const sourceId = decodeURIComponent(sourceDeleteMatch[2]);
    try {
      studyService.removeSource(studybookId, sourceId, "prof_default");
      return json(res, 200, { ok: true, message: "Source unlinked from studybook." });
    } catch (err) {
      return json(res, 500, { ok: false, error: err.message });
    }
  }

  // GET /api/study/sources/:sourceId/preview
  const previewMatch = pathname.match(/^\/api\/study\/sources\/([^\/]+)\/preview$/);
  if (req.method === "GET" && previewMatch) {
    if (!studyService) return json(res, 503, { ok: false, error: "Study service unavailable" });
    const sourceId = decodeURIComponent(previewMatch[1]);
    try {
      const srcData = studyService.knowledgeService.getSource(sourceId, "prof_default");
      if (!srcData) return json(res, 404, { ok: false, error: "Source not found" });
      return json(res, 200, {
        ok: true,
        source: {
          id: srcData.id,
          name: srcData.name,
          chunk_count: srcData.chunk_count,
          total_chars: srcData.total_chars,
          file_type: srcData.file_type,
          file_size: srcData.file_size
        },
        chunks: (srcData.chunks || []).slice(0, 10)
      });
    } catch (err) {
      return json(res, 500, { ok: false, error: err.message });
    }
  }

  // GET /api/study/studybooks/:id/messages
  const messagesMatch = pathname.match(/^\/api\/study\/studybooks\/([^\/]+)\/messages$/);
  if (req.method === "GET" && messagesMatch) {
    if (!studyService) return json(res, 503, { ok: false, error: "Study service unavailable" });
    const id = decodeURIComponent(messagesMatch[1]);
    try {
      const messages = studyService.listMessages(id, "prof_default");
      return json(res, 200, { ok: true, messages });
    } catch (err) {
      return json(res, 500, { ok: false, error: err.message });
    }
  }

  // DELETE /api/study/studybooks/:id/messages
  if (req.method === "DELETE" && messagesMatch) {
    if (!studyService) return json(res, 503, { ok: false, error: "Study service unavailable" });
    const id = decodeURIComponent(messagesMatch[1]);
    try {
      studyService.clearMessages(id, "prof_default");
      return json(res, 200, { ok: true, message: "Study messages cleared." });
    } catch (err) {
      return json(res, 500, { ok: false, error: err.message });
    }
  }

  // POST /api/study/studybooks/:id/chat
  const chatMatch = pathname.match(/^\/api\/study\/studybooks\/([^\/]+)\/chat$/);
  if (req.method === "POST" && chatMatch) {
    if (!studyService) return json(res, 503, { ok: false, error: "Study service unavailable" });
    const id = decodeURIComponent(chatMatch[1]);
    try {
      const body = await readJsonBody(req, res);
      if (!body) return true;
      const question = body.question || body.prompt || body.message;
      if (!question || !question.trim()) {
        return json(res, 400, { ok: false, error: "Question is required" });
      }
      const result = await studyService.chat(id, question, "prof_default", {
        model: body.model || "auto",
        topK: body.topK || 6
      });
      return json(res, 200, result);
    } catch (err) {
      return json(res, 500, { ok: false, error: err.message });
    }
  }

  // GET /api/study/studybooks/:id/materials
  const materialsMatch = pathname.match(/^\/api\/study\/studybooks\/([^\/]+)\/materials$/);
  if (req.method === "GET" && materialsMatch) {
    if (!studyService) return json(res, 503, { ok: false, error: "Study service unavailable" });
    const id = decodeURIComponent(materialsMatch[1]);
    const type = parsedUrl.searchParams.get("type") || null;
    try {
      const materials = studyService.listMaterials(id, "prof_default", type);
      return json(res, 200, { ok: true, materials });
    } catch (err) {
      return json(res, 500, { ok: false, error: err.message });
    }
  }

  // POST /api/study/studybooks/:id/materials/generate
  const materialsGenMatch = pathname.match(/^\/api\/study\/studybooks\/([^\/]+)\/materials\/generate$/);
  if (req.method === "POST" && materialsGenMatch) {
    if (!studyService) return json(res, 503, { ok: false, error: "Study service unavailable" });
    const id = decodeURIComponent(materialsGenMatch[1]);
    try {
      const body = await readJsonBody(req, res);
      if (!body) return true;
      const type = body.type || "guide";
      const material = await studyService.generateMaterial(id, type, "prof_default", body.options || {});
      return json(res, 201, { ok: true, material });
    } catch (err) {
      return json(res, 500, { ok: false, error: err.message });
    }
  }

  // GET /api/study/materials/:id
  const singleMaterialMatch = pathname.match(/^\/api\/study\/materials\/([^\/]+)$/);
  if (req.method === "GET" && singleMaterialMatch) {
    if (!studyService) return json(res, 503, { ok: false, error: "Study service unavailable" });
    const matId = decodeURIComponent(singleMaterialMatch[1]);
    try {
      const material = studyService.getMaterial(matId, "prof_default");
      if (!material) return json(res, 404, { ok: false, error: "Material not found" });
      return json(res, 200, { ok: true, material });
    } catch (err) {
      return json(res, 500, { ok: false, error: err.message });
    }
  }

  // PUT /api/study/materials/:id
  if (req.method === "PUT" && singleMaterialMatch) {
    if (!studyService) return json(res, 503, { ok: false, error: "Study service unavailable" });
    const matId = decodeURIComponent(singleMaterialMatch[1]);
    try {
      const body = await readJsonBody(req, res);
      if (!body) return true;
      const updated = studyService.updateMaterial(matId, "prof_default", body);
      return json(res, 200, { ok: true, material: updated });
    } catch (err) {
      return json(res, 400, { ok: false, error: err.message });
    }
  }

  // DELETE /api/study/materials/:id
  if (req.method === "DELETE" && singleMaterialMatch) {
    if (!studyService) return json(res, 503, { ok: false, error: "Study service unavailable" });
    const matId = decodeURIComponent(singleMaterialMatch[1]);
    try {
      studyService.deleteMaterial(matId, "prof_default");
      return json(res, 200, { ok: true, message: "Material deleted." });
    } catch (err) {
      return json(res, 500, { ok: false, error: err.message });
    }
  }

  // POST /api/study/materials/:id/quiz-score
  const quizScoreMatch = pathname.match(/^\/api\/study\/materials\/([^\/]+)\/quiz-score$/);
  if (req.method === "POST" && quizScoreMatch) {
    if (!studyService) return json(res, 503, { ok: false, error: "Study service unavailable" });
    const matId = decodeURIComponent(quizScoreMatch[1]);
    try {
      const body = await readJsonBody(req, res);
      if (!body) return true;
      const result = studyService.recordQuizScore(matId, body.answers || {}, "prof_default");
      return json(res, 200, result);
    } catch (err) {
      return json(res, 400, { ok: false, error: err.message });
    }
  }

  // POST /api/study/materials/:id/flashcard-mastery
  const flashcardMasteryMatch = pathname.match(/^\/api\/study\/materials\/([^\/]+)\/flashcard-mastery$/);
  if (req.method === "POST" && flashcardMasteryMatch) {
    if (!studyService) return json(res, 503, { ok: false, error: "Study service unavailable" });
    const matId = decodeURIComponent(flashcardMasteryMatch[1]);
    try {
      const body = await readJsonBody(req, res);
      if (!body) return true;
      const result = studyService.recordFlashcardMastery(matId, body.masteredCardIds || [], "prof_default");
      return json(res, 200, result);
    } catch (err) {
      return json(res, 400, { ok: false, error: err.message });
    }
  }

  // ==========================================
  // 2. SCHEDULED AUTOMATIONS HUB
  // ==========================================

  // GET /api/automations
  if (req.method === "GET" && pathname === "/api/automations") {
    if (!automationService) return json(res, 503, { ok: false, error: "Automation service unavailable" });
    try {
      const tasks = automationService.loadTasks("prof_default");
      return json(res, 200, { ok: true, tasks });
    } catch (e) {
      return json(res, 500, { ok: false, error: `Could not load automations: ${e.message}` });
    }
  }

  // POST /api/automations
  if (req.method === "POST" && pathname === "/api/automations") {
    if (!automationService) return json(res, 503, { ok: false, error: "Automation service unavailable" });
    try {
      const body = await readJsonBody(req, res);
      if (!body) return true;
      const task = automationService.createTask(body, "prof_default");
      return json(res, 201, { ok: true, task });
    } catch (err) {
      return json(res, 400, { ok: false, error: err.message });
    }
  }

  // POST /api/automations/run
  if (req.method === "POST" && pathname === "/api/automations/run") {
    if (!automationService) return json(res, 503, { ok: false, error: "Automation service unavailable" });
    try {
      const body = await readJsonBody(req, res);
      if (!body) return true;
      if (typeof body.id !== "string" || !body.id.trim()) {
        return json(res, 400, { ok: false, error: "Automation id is required" });
      }
      const result = await automationService.runTask(body.id, "prof_default");
      return json(res, result.success ? 200 : 422, { ok: result.success, ...result });
    } catch (err) {
      const status = /not found/i.test(err.message) ? 404 : 500;
      return json(res, status, { ok: false, error: err.message });
    }
  }

  // POST /api/automations/propose
  if (req.method === "POST" && pathname === "/api/automations/propose") {
    if (!automationService) return json(res, 503, { ok: false, error: "Automation service unavailable" });
    try {
      const body = await readJsonBody(req, res);
      if (!body) return true;
      const rawProposal = automationService.proposeWorkflow(body.prompt || "");
      const auto = rawProposal.proposedAutomation || rawProposal;
      const steps = auto.plan?.steps || rawProposal.reviewSummary?.steps || [];
      const proposal = { ...auto, steps };
      return json(res, 200, { ok: true, proposedAutomation: proposal, proposal });
    } catch (err) {
      return json(res, 400, { ok: false, error: err.message });
    }
  }

  // POST /api/automations/pause
  if (req.method === "POST" && pathname === "/api/automations/pause") {
    if (!automationService) return json(res, 503, { ok: false, error: "Automation service unavailable" });
    try {
      const body = await readJsonBody(req, res);
      if (!body) return true;
      const task = automationService.pauseTask(body.id, "prof_default");
      return json(res, 200, { ok: true, task });
    } catch (err) {
      return json(res, 400, { ok: false, error: err.message });
    }
  }

  // POST /api/automations/resume
  if (req.method === "POST" && pathname === "/api/automations/resume") {
    if (!automationService) return json(res, 503, { ok: false, error: "Automation service unavailable" });
    try {
      const body = await readJsonBody(req, res);
      if (!body) return true;
      const task = automationService.resumeTask(body.id, "prof_default");
      return json(res, 200, { ok: true, task });
    } catch (err) {
      return json(res, 400, { ok: false, error: err.message });
    }
  }

  // DELETE /api/automations/:id
  if (req.method === "DELETE" && pathname.startsWith("/api/automations/")) {
    if (!automationService) return json(res, 503, { ok: false, error: "Automation service unavailable" });
    const id = decodeURIComponent(pathname.replace("/api/automations/", ""));
    try {
      automationService.deleteTask(id, "prof_default");
      return json(res, 200, { ok: true, message: `Task ${id} deleted` });
    } catch (err) {
      return json(res, 500, { ok: false, error: err.message });
    }
  }

  // ==========================================
  // 3. OBSIDIAN SECOND BRAIN INTEGRATION
  // ==========================================

  // GET /api/obsidian/status
  if (req.method === "GET" && pathname === "/api/obsidian/status") {
    if (!obsidianVault) return json(res, 503, { ok: false, error: "Obsidian vault unavailable" });
    try {
      const status = obsidianVault.getStatus();
      return json(res, 200, { ok: true, ...status });
    } catch (err) {
      return json(res, 500, { ok: false, error: err.message });
    }
  }

  // POST /api/obsidian/sync
  if (req.method === "POST" && pathname === "/api/obsidian/sync") {
    if (!obsidianVault) return json(res, 503, { ok: false, error: "Obsidian vault unavailable" });
    try {
      const syncRes = obsidianVault.syncAll();
      const status = obsidianVault.getStatus();
      return json(res, 200, { ok: true, success: true, ...syncRes, ...status });
    } catch (err) {
      return json(res, 500, { ok: false, error: err.message });
    }
  }

  // POST /api/obsidian/open
  if (req.method === "POST" && pathname === "/api/obsidian/open") {
    if (!obsidianVault) return json(res, 503, { ok: false, error: "Obsidian vault unavailable" });
    try {
      const launchRes = obsidianVault.launchObsidian();
      return json(res, 200, { ok: true, ...launchRes });
    } catch (err) {
      return json(res, 500, { ok: false, error: err.message });
    }
  }

  // ==========================================
  // 4. SUBAGENTS HUB & TEAMWORK
  // ==========================================

  // GET /api/subagents
  if (req.method === "GET" && pathname === "/api/subagents") {
    if (!subagents) return json(res, 503, { ok: false, error: "Subagents service unavailable" });
    return json(res, 200, {
      ok: true,
      total_subagents: subagents.SUBAGENTS.length,
      subagents: subagents.getSubagents()
    });
  }

  // POST /api/subagents/invoke
  if (req.method === "POST" && pathname === "/api/subagents/invoke") {
    if (!subagents) return json(res, 503, { ok: false, error: "Subagents service unavailable" });
    try {
      const body = await readJsonBody(req, res);
      if (!body) return true;
      const subagentId = body.subagent_id || body.subagentId || "coder";
      const taskPrompt = body.task || body.taskPrompt || body.prompt || "";
      const context = body.context || "";
      const model = body.model || "auto";

      if (!taskPrompt.trim()) {
        return json(res, 400, { ok: false, error: "Empty task prompt provided" });
      }

      const result = await subagents.invokeSubagent({
        subagentId,
        taskPrompt,
        context,
        model
      });

      return json(res, 200, result);
    } catch (err) {
      return json(res, 500, { ok: false, error: err.message });
    }
  }

  // ==========================================
  // 5. MCP CLIENT & TOOL REGISTRY
  // ==========================================

  // GET /api/mcp/servers & /api/mcp/status
  if (req.method === "GET" && (pathname === "/api/mcp/servers" || pathname === "/api/mcp/status")) {
    if (!mcpClient) return json(res, 503, { ok: false, error: "MCP client unavailable" });
    try {
      const cfg = mcpClient.loadConfig("prof_default");
      return json(res, 200, {
        ok: true,
        servers: cfg.mcpServers || {},
        tools: mcpClient.getAllTools("prof_default")
      });
    } catch (err) {
      return json(res, 500, { ok: false, error: err.message });
    }
  }

  // POST /api/mcp/servers/add
  if (req.method === "POST" && pathname === "/api/mcp/servers/add") {
    if (!mcpClient) return json(res, 503, { ok: false, error: "MCP client unavailable" });
    try {
      const body = await readJsonBody(req, res);
      if (!body) return true;
      const name = (body.name || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-");
      if (!name) return json(res, 400, { ok: false, error: "Server name is required" });

      const serverDef = {
        description: body.description || `Custom MCP Server (${name})`,
        enabled: true,
        command: body.command || "npx",
        args: Array.isArray(body.args) ? body.args : (body.args ? String(body.args).split(" ") : []),
        env: body.env || {},
        tools: Array.isArray(body.tools) ? body.tools : []
      };

      if (body.path) serverDef.path = body.path;

      const result = mcpClient.addServer(name, serverDef, "prof_default");
      return json(res, 200, {
        ok: true,
        server: result.server,
        servers: mcpClient.loadConfig("prof_default").mcpServers,
        tools: mcpClient.getAllTools("prof_default")
      });
    } catch (err) {
      return json(res, 400, { ok: false, error: err.message });
    }
  }

  // POST /api/mcp/servers/toggle
  if (req.method === "POST" && pathname === "/api/mcp/servers/toggle") {
    if (!mcpClient) return json(res, 503, { ok: false, error: "MCP client unavailable" });
    try {
      const body = await readJsonBody(req, res);
      if (!body) return true;
      if (!body.name) return json(res, 400, { ok: false, error: "Missing server name" });
      const result = mcpClient.toggleServer(body.name, body.enabled !== false, "prof_default");
      return json(res, 200, result);
    } catch (err) {
      return json(res, 400, { ok: false, error: err.message });
    }
  }

  // POST /api/mcp/servers/delete
  if (req.method === "POST" && pathname === "/api/mcp/servers/delete") {
    if (!mcpClient) return json(res, 503, { ok: false, error: "MCP client unavailable" });
    try {
      const body = await readJsonBody(req, res);
      if (!body) return true;
      if (!body.name) return json(res, 400, { ok: false, error: "Missing server name" });
      const result = mcpClient.deleteServer(body.name, "prof_default");
      return json(res, 200, result);
    } catch (err) {
      return json(res, 400, { ok: false, error: err.message });
    }
  }

  return false;
}

module.exports = { handlePhase4Routes };
