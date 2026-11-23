const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");

// Agent & Harness modules
const { createAgentEngine, PathGuard, PolicyEngine, ExecutionLogger } = require("../../agent");
const fileService = require("../../services/file_service");
const universalFileGenerator = require("../../services/universal_file_generator");
const browserService = require("../../services/browser_service");
const abyxSkills = require("../../services/abyx_skills");
const researchSkills = require("../../services/research_skills");
const { harness, getHarnessStatus, SEAMS } = require("../../harness");

// Runtime cache for agent engines per profile and workspace
const agentRuntimes = new Map();

function getAgentRuntime(workspaceService, profileId = "prof_default") {
  const workspace = workspaceService?.getActiveWorkspace?.();
  const workspaceId = workspace?.id || "default";
  const workspacePath = workspace?.path || universalFileGenerator.WORKSPACE_DIR;
  const runtimeKey = `${profileId}:${workspaceId}:${workspacePath}`;

  if (!agentRuntimes.has(runtimeKey)) {
    const engine = createAgentEngine({
      approvedRoots: [workspacePath],
      allowTerminal: false,
      allowBrowser: true,
      approvalTimeoutMs: 300000,
    });
    agentRuntimes.set(runtimeKey, engine);
  }
  return agentRuntimes.get(runtimeKey);
}

/**
 * Master Harness & Agentic Routes Handler
 */
async function handleHarnessRoutes(req, res, { workspaceService, aiProviders, db, readJsonBody, json }) {
  const parsedUrl = new URL(req.url, "http://localhost");
  const pathname = parsedUrl.pathname;
  const profileId = "prof_default";

  // ==========================================
  // 1. AGENT POLICIES, RUNS, APPROVALS & RUNNER
  // ==========================================

  // GET /api/agent/policy
  if (req.method === "GET" && pathname === "/api/agent/policy") {
    const runtime = getAgentRuntime(workspaceService, profileId);
    return json(res, 200, {
      ok: true,
      approvedRoots: runtime.pathGuard.approvedRoots,
      allowTerminal: runtime.policyEngine.options.allowTerminal,
      allowBrowser: runtime.policyEngine.options.allowBrowser,
    });
  }

  // GET /api/agent/runs
  if (req.method === "GET" && pathname === "/api/agent/runs") {
    try {
      const runtime = getAgentRuntime(workspaceService, profileId);
      const activeRuns = Array.from(runtime.engine.activeRuns.values()).map(({ run }) => ({
        id: run.id,
        sessionId: run.sessionId,
        goal: run.goal,
        status: run.status,
        startTime: run.startTime,
        stepsExecuted: run.stepsExecuted,
        maxSteps: run.maxSteps,
        timelineCount: run.timeline.length,
      }));
      const recentHistory = ExecutionLogger.listRecentRuns(20);
      return json(res, 200, { ok: true, activeRuns, history: recentHistory });
    } catch (err) {
      return json(res, 500, { ok: false, error: err.message });
    }
  }

  // GET /api/agent/runs/:id
  if (req.method === "GET" && pathname.startsWith("/api/agent/runs/")) {
    const runId = pathname.replace("/api/agent/runs/", "");
    const runtime = getAgentRuntime(workspaceService, profileId);
    const active = runtime.engine.activeRuns.get(runId);
    if (active) {
      return json(res, 200, { ok: true, run: active.run });
    }
    const logged = ExecutionLogger.getRun(runId);
    if (logged) {
      return json(res, 200, { ok: true, run: logged });
    }
    return json(res, 404, { ok: false, error: `Agent run "${runId}" not found` });
  }

  // GET /api/agent/approvals
  if (req.method === "GET" && pathname === "/api/agent/approvals") {
    const runtime = getAgentRuntime(workspaceService, profileId);
    return json(res, 200, {
      ok: true,
      approvals: runtime.policyEngine.getPendingApprovals(),
    });
  }

  // POST /api/agent/approve
  if (req.method === "POST" && pathname === "/api/agent/approve") {
    try {
      const body = await readJsonBody(req, res);
      if (!body) return true;
      if (!body.approvalId || typeof body.approved !== "boolean") {
        return json(res, 400, { ok: false, error: "approvalId and approved (boolean) are required" });
      }
      const runtime = getAgentRuntime(workspaceService, profileId);
      const resolved = runtime.engine.resolveApproval(body.approvalId, body.approved ? "approve" : "deny");
      return json(res, 200, { ok: true, resolved });
    } catch (err) {
      return json(res, 400, { ok: false, error: err.message });
    }
  }

  // POST /api/agent/cancel
  if (req.method === "POST" && pathname === "/api/agent/cancel") {
    try {
      const body = await readJsonBody(req, res);
      if (!body) return true;
      if (!body.runId) return json(res, 400, { ok: false, error: "runId is required" });
      const runtime = getAgentRuntime(workspaceService, profileId);
      const result = runtime.engine.cancelRun(body.runId, body.reason || "Cancelled by user");
      return json(res, result.ok ? 200 : 404, result);
    } catch (err) {
      return json(res, 400, { ok: false, error: err.message });
    }
  }

  // POST /api/agent/run
  if (req.method === "POST" && pathname === "/api/agent/run") {
    try {
      const body = await readJsonBody(req, res);
      if (!body) return true;
      const task = typeof body.task === "string" ? body.task.trim() : "";
      if (!task || task.length > 12000) {
        return json(res, 400, { ok: false, error: "Task must contain 1 to 12000 characters" });
      }

      const requestedModel = typeof body.model === "string" && body.model.length <= 200 ? body.model : "auto";
      const maxSteps = Math.min(Math.max(Number(body.max_steps) || 8, 1), 15);
      const sessionId = typeof body.sessionId === "string" ? body.sessionId : `agent_${Date.now()}`;
      const runtime = getAgentRuntime(workspaceService, profileId);

      const runPromise = runtime.engine.run({
        profileId,
        sessionId,
        goal: task,
        model: requestedModel,
        maxSteps,
        stepExecutor: async ({ run: activeRun, step, signal, executeTool }) => {
          const toolNames = [
            "fs_list", "fs_read", "fs_search", "fs_write", "fs_edit", "fs_mkdir", "fs_move", "fs_delete",
            "generate_file", "generate_pdf", "search_web", "fetch_web_page", "open_browser"
          ];

          // 1. Check for direct actions or pre-defined pattern triggers in the task
          const taskLower = task.toLowerCase();

          // If task is explicit about creating a directory/folder
          if (activeRun.stepsExecuted === 0 && (taskLower.startsWith("create folder") || taskLower.startsWith("mkdir") || taskLower.includes("create directory"))) {
            const folderMatch = task.match(/(?:folder|directory|mkdir)\s+['"]?([^'"]+)['"]?/i);
            const folderPath = folderMatch ? folderMatch[1].trim() : "new_folder";
            const toolResult = await executeTool("fs_mkdir", { dirPath: folderPath });
            return { continue: true, message: `Created folder: ${folderPath}`, output: toolResult };
          }

          // If task is explicit about generating a PDF
          if (activeRun.stepsExecuted === 0 && (taskLower.includes("generate pdf") || taskLower.includes("create pdf") || taskLower.endsWith(".pdf"))) {
            const pdfMatch = task.match(/([a-zA-Z0-9_\-]+\.pdf)/i);
            const pdfName = pdfMatch ? pdfMatch[1] : "document.pdf";
            const toolResult = await executeTool("generate_pdf", {
              filePath: pdfName,
              title: body.title || "Generated Document",
              content: body.content || `# Generated Document\n\nTask: ${task}\n\nGenerated by ABYX Agent Harness.`
            });
            return { done: true, result: `Successfully generated PDF: ${pdfName}` };
          }

          // 2. Invoke LLM for agentic reasoning and tool choice
          const messages = [
            {
              role: "system",
              content: `You are ABYX's bounded workspace agent. Work strictly toward the user's task. Choose one action per turn.
Return strict JSON only without markdown fences:
{"tool":"one of ${toolNames.join(", ")}","args":{...}}
or
{"done":true,"result":"..."}.
Do not claim an action succeeded unless its tool result confirms it. Current step ${activeRun.stepsExecuted}/${activeRun.maxSteps}: ${step.description}`
            },
            {
              role: "user",
              content: `Task: ${task}\n\nPrevious execution timeline:\n${JSON.stringify(
                activeRun.timeline.slice(-8).map(event => ({
                  type: event.type,
                  name: event.name,
                  args: event.args,
                  result: event.result,
                  success: event.success,
                  error: event.error,
                  description: event.description
                }))
              ).slice(0, 8000)}`
            }
          ];

          let answer = "";
          try {
            if (aiProviders && typeof aiProviders.streamProviderChat === "function") {
              const resObj = await aiProviders.streamProviderChat({
                model: requestedModel === "auto" ? "auto" : requestedModel,
                messages,
                profileId,
                sessionId: activeRun.sessionId,
                agentId: activeRun.id,
                requestType: "agent",
                signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000),
                enableFailover: true,
              });
              answer = resObj?.content || "";
            }
          } catch (modelErr) {
            console.warn("[AGENT] Model call fallback:", modelErr.message);
          }

          // Parse model JSON action
          let action = null;
          try {
            const jsonMatch = answer.match(/\{[\s\S]*\}/)?.[0];
            action = jsonMatch ? JSON.parse(jsonMatch) : null;
          } catch {}

          if (!action || typeof action !== "object") {
            // If model returned no tool JSON, complete task with model's text or finish
            return { done: true, result: answer || `Step ${activeRun.stepsExecuted + 1} completed.` };
          }

          if (action.done === true) {
            return { done: true, result: String(action.result || "Task completed successfully.") };
          }

          if (!toolNames.includes(action.tool) || !action.args || typeof action.args !== "object" || Array.isArray(action.args)) {
            return { done: true, result: "The model returned an unsupported or invalid tool action. No tool was executed." };
          }

          const toolResult = await executeTool(action.tool, action.args);
          return { continue: true, message: answer, output: toolResult };
        }
      });

      // Check if run was backgrounded or completed
      const activeRun = Array.from(runtime.engine.activeRuns.values()).map(entry => entry.run).find(r => r.sessionId === sessionId);
      if (body.async === true && activeRun) {
        runPromise.catch(error => console.error("[AGENT] Background run failed:", error.message));
        return json(res, 202, { ok: true, runId: activeRun.id, status: activeRun.status });
      }

      const run = await runPromise;
      return json(res, run.status === "failed" ? 422 : 200, {
        ok: run.status === "completed",
        runId: run.id,
        run: { ...run, finalOutput: run.output }
      });
    } catch (err) {
      return json(res, 400, { ok: false, error: err.message });
    }
  }

  // ==========================================
  // 2. WORKSPACE & FILE OPERATIONS
  // ==========================================

  // GET /api/files/workspace
  if (req.method === "GET" && pathname === "/api/files/workspace") {
    try {
      const runtime = getAgentRuntime(workspaceService, profileId);
      const rootDir = runtime.pathGuard.defaultRoot;
      const files = fileService.listWorkspaceFiles(rootDir);
      return json(res, 200, {
        ok: true,
        workspace: rootDir,
        count: files.length,
        files
      });
    } catch (err) {
      return json(res, 500, { ok: false, error: err.message });
    }
  }

  // POST /api/files/save
  if (req.method === "POST" && pathname === "/api/files/save") {
    try {
      const body = await readJsonBody(req, res);
      if (!body) return true;
      if (!body.filename || body.content === undefined) {
        return json(res, 400, { ok: false, error: "filename and content are required" });
      }
      const runtime = getAgentRuntime(workspaceService, profileId);
      const saved = fileService.saveWorkspaceFile(body.filename, body.content, body.subfolder || "", runtime.pathGuard.defaultRoot);
      return json(res, 200, { ok: true, ...saved });
    } catch (err) {
      return json(res, 400, { ok: false, error: err.message });
    }
  }

  // POST /api/files/parse (PDF, Image, Office Docx, Text)
  if (req.method === "POST" && pathname === "/api/files/parse") {
    try {
      const body = await readJsonBody(req, res);
      if (!body) return true;
      const files = Array.isArray(body.files) ? body.files : (body.file ? [body.file] : []);
      const prompt = body.prompt || "";
      const results = [];
      for (const f of files) {
        const processed = await fileService.processUploadedFile(f, prompt);
        results.push(processed);
      }
      return json(res, 200, { ok: true, results });
    } catch (err) {
      return json(res, 500, { ok: false, error: err.message });
    }
  }

  // GET /api/files/download
  if (req.method === "GET" && pathname === "/api/files/download") {
    const rawPath = parsedUrl.searchParams.get("path");
    if (!rawPath) return json(res, 400, { ok: false, error: "path parameter is required" });
    try {
      const runtime = getAgentRuntime(workspaceService, profileId);
      const safePath = runtime.pathGuard.resolveSafePath(rawPath);
      if (!fs.existsSync(safePath) || !fs.statSync(safePath).isFile()) {
        return json(res, 404, { ok: false, error: `File not found: ${rawPath}` });
      }
      const stats = fs.statSync(safePath);
      const filename = path.basename(safePath);
      const mimeType = universalFileGenerator.getMimeType(safePath);

      res.writeHead(200, {
        "Content-Type": mimeType,
        "Content-Length": stats.size,
        "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"`,
        "Cache-Control": "no-cache",
      });
      fs.createReadStream(safePath).pipe(res);
      return true;
    } catch (err) {
      return json(res, 403, { ok: false, error: err.message });
    }
  }

  // POST /api/files/open (Open file/folder in Windows Explorer)
  if (req.method === "POST" && pathname === "/api/files/open") {
    try {
      const body = await readJsonBody(req, res);
      if (!body) return true;
      const rawPath = body.path || body.filePath;
      if (!rawPath) return json(res, 400, { ok: false, error: "path is required" });

      const runtime = getAgentRuntime(workspaceService, profileId);
      const safePath = runtime.pathGuard.resolveSafePath(rawPath);
      if (!fs.existsSync(safePath)) {
        return json(res, 404, { ok: false, error: `Path does not exist: ${rawPath}` });
      }

      const isFile = fs.statSync(safePath).isFile();
      const cmd = isFile ? `explorer.exe /select,"${safePath}"` : `explorer.exe "${safePath}"`;
      exec(cmd, { windowsHide: true }, (err) => {
        if (err) return json(res, 500, { ok: false, error: err.message });
        return json(res, 200, { ok: true, message: `Opened: ${safePath}` });
      });
      return true;
    } catch (err) {
      return json(res, 400, { ok: false, error: err.message });
    }
  }

  // POST /api/files/generate (PDF, ZIP, Code, Markdown, CSV)
  if (req.method === "POST" && pathname === "/api/files/generate") {
    try {
      const body = await readJsonBody(req, res);
      if (!body) return true;
      const filePath = body.filePath || body.path || body.filename;
      if (!filePath) return json(res, 400, { ok: false, error: "filePath is required" });

      const result = await universalFileGenerator.generateFile({
        filePath,
        fileType: body.fileType || body.type,
        content: body.content || "",
        title: body.title,
        author: body.author,
        files: body.files,
      });
      return json(res, 200, { ok: true, ...result });
    } catch (err) {
      return json(res, 400, { ok: false, error: err.message });
    }
  }

  // POST /api/files/mkdir
  if (req.method === "POST" && pathname === "/api/files/mkdir") {
    try {
      const body = await readJsonBody(req, res);
      if (!body) return true;
      const dirPath = body.dirPath || body.path || body.name;
      if (!dirPath) return json(res, 400, { ok: false, error: "dirPath is required" });
      const runtime = getAgentRuntime(workspaceService, profileId);
      const result = await runtime.fsTool.mkdir({ dirPath });
      return json(res, result.success ? 200 : 400, result);
    } catch (err) {
      return json(res, 400, { ok: false, error: err.message });
    }
  }

  // POST /api/files/move
  if (req.method === "POST" && pathname === "/api/files/move") {
    try {
      const body = await readJsonBody(req, res);
      if (!body) return true;
      const { sourcePath, destinationPath } = body;
      if (!sourcePath || !destinationPath) {
        return json(res, 400, { ok: false, error: "sourcePath and destinationPath are required" });
      }
      const runtime = getAgentRuntime(workspaceService, profileId);
      const result = await runtime.fsTool.move({ sourcePath, destinationPath });
      return json(res, result.success ? 200 : 400, result);
    } catch (err) {
      return json(res, 400, { ok: false, error: err.message });
    }
  }

  // POST /api/files/delete
  if (req.method === "POST" && pathname === "/api/files/delete") {
    try {
      const body = await readJsonBody(req, res);
      if (!body) return true;
      const filePath = body.filePath || body.path;
      if (!filePath) return json(res, 400, { ok: false, error: "filePath is required" });
      const runtime = getAgentRuntime(workspaceService, profileId);
      const result = await runtime.fsTool.delete({ filePath });
      return json(res, result.success ? 200 : 400, result);
    } catch (err) {
      return json(res, 400, { ok: false, error: err.message });
    }
  }

  // ==========================================
  // 3. CONTROLLED BROWSER CAPABILITIES
  // ==========================================

  // POST /api/browser/search
  if (req.method === "POST" && pathname === "/api/browser/search") {
    try {
      const body = await readJsonBody(req, res);
      if (!body) return true;
      const query = typeof body.query === "string" ? body.query.trim() : "";
      if (!query) return json(res, 400, { ok: false, error: "query is required" });
      const result = await browserService.searchWeb(query);
      return json(res, 200, { ok: true, ...result });
    } catch (err) {
      return json(res, 500, { ok: false, error: err.message });
    }
  }

  // POST /api/browser/fetch or /api/browser/browse
  if (req.method === "POST" && (pathname === "/api/browser/fetch" || pathname === "/api/browser/browse")) {
    try {
      const body = await readJsonBody(req, res);
      if (!body) return true;
      const url = typeof body.url === "string" ? body.url.trim() : "";
      if (!url) return json(res, 400, { ok: false, error: "url is required" });
      const runtime = getAgentRuntime(workspaceService, profileId);
      const result = await runtime.browserTool.fetchPage({ url });
      return json(res, result.success ? 200 : 400, result);
    } catch (err) {
      return json(res, 500, { ok: false, error: err.message });
    }
  }

  // POST /api/browser/open (Open URL in native system browser)
  if (req.method === "POST" && pathname === "/api/browser/open") {
    try {
      const body = await readJsonBody(req, res);
      if (!body) return true;
      const url = typeof body.url === "string" ? body.url.trim() : "";
      if (!url) return json(res, 400, { ok: false, error: "url is required" });
      const result = browserService.openBrowserWindow(url);
      return json(res, 200, { ok: true, ...result });
    } catch (err) {
      return json(res, 500, { ok: false, error: err.message });
    }
  }

  // GET /api/browser/proxy (Built-in In-App Browser Proxy)
  if (req.method === "GET" && pathname === "/api/browser/proxy") {
    let targetUrl = parsedUrl.searchParams.get("url");
    if (!targetUrl) {
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Missing url query parameter");
      return true;
    }
    targetUrl = targetUrl.trim();

    // 1. Check if previewing local workspace file (local://filename or relative filename)
    if (targetUrl.startsWith("local://") || (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://") && (targetUrl.endsWith(".html") || targetUrl.endsWith(".htm") || targetUrl.endsWith(".txt") || targetUrl.endsWith(".md")))) {
      const isExplicitLocal = targetUrl.startsWith("local://");
      const filename = targetUrl.replace(/^local:\/\//, "");
      const runtime = getAgentRuntime(workspaceService, profileId);
      try {
        const safePath = runtime.pathGuard.resolveSafePath(filename);
        if (fs.existsSync(safePath) && fs.statSync(safePath).isFile()) {
          const content = fs.readFileSync(safePath);
          const mimeType = universalFileGenerator.getMimeType(safePath) || "text/html";
          res.writeHead(200, {
            "Content-Type": `${mimeType}; charset=utf-8`,
            "Cache-Control": "no-cache",
            "Access-Control-Allow-Origin": "*"
          });
          res.end(content);
          return true;
        } else if (isExplicitLocal) {
          res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Local file not found in active project workspace: " + filename);
          return true;
        }
      } catch (err) {
        if (isExplicitLocal) {
          res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Access denied: " + err.message);
          return true;
        }
      }
    }

    if (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://")) {
      targetUrl = "https://" + targetUrl;
    }

    try {
      const fetchRes = await fetch(targetUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9"
        },
        redirect: "follow",
        signal: AbortSignal.timeout(15000)
      });

      const contentType = fetchRes.headers.get("content-type") || "text/html";
      const finalUrl = fetchRes.url || targetUrl;

      if (contentType.includes("text/html")) {
        let html = await fetchRes.text();
        const interceptScript = `
<base href="${finalUrl}">
<script>
(function(){
  document.addEventListener('click', function(e){
    var a = e.target.closest('a');
    if(a && a.href && !a.href.startsWith('javascript:') && !a.href.startsWith('#')){
      e.preventDefault();
      try {
        var dest = a.href;
        window.parent.postMessage({ act: 'browserNavigated', url: dest }, '*');
        window.location.href = '/api/browser/proxy?url=' + encodeURIComponent(dest);
      } catch(err) {
        window.location.href = a.href;
      }
    }
  }, true);
  document.addEventListener('submit', function(e){
    var form = e.target;
    if(form && (form.method || 'GET').toUpperCase() === 'GET'){
      e.preventDefault();
      try {
        var actionUrl = form.action ? new URL(form.action, "${finalUrl}") : new URL("${finalUrl}");
        var formData = new FormData(form);
        for(var pair of formData.entries()){
          actionUrl.searchParams.set(pair[0], pair[1]);
        }
        var dest = actionUrl.href;
        window.parent.postMessage({ act: 'browserNavigated', url: dest }, '*');
        window.location.href = '/api/browser/proxy?url=' + encodeURIComponent(dest);
      } catch(err){
        form.submit();
      }
    }
  }, true);
  window.addEventListener('load', function(){
    window.parent.postMessage({ act: 'browserLoaded', url: "${finalUrl}", title: document.title }, '*');
  });
})();
</script>
`;
        if (html.includes("<head>")) {
          html = html.replace("<head>", "<head>" + interceptScript);
        } else if (html.includes("<html>")) {
          html = html.replace("<html>", "<html><head>" + interceptScript + "</head>");
        } else {
          html = interceptScript + html;
        }

        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-cache",
          "Access-Control-Allow-Origin": "*"
        });
        res.end(html);
        return true;
      } else {
        const buffer = await fetchRes.arrayBuffer();
        res.writeHead(fetchRes.status, {
          "Content-Type": contentType,
          "Cache-Control": "public, max-age=3600",
          "Access-Control-Allow-Origin": "*"
        });
        res.end(Buffer.from(buffer));
        return true;
      }
    } catch (err) {
      res.writeHead(502, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!DOCTYPE html><html><body style="font-family:sans-serif;padding:32px;background:#18181b;color:#f4f4f5;">
        <h3>Could not load webpage in built-in browser</h3>
        <p style="color:#ef4444;">${err.message}</p>
        <p><a href="${targetUrl}" target="_blank" style="color:#60a5fa;">Open in external browser &rarr;</a></p>
      </body></html>`);
      return true;
    }
  }

  // ==========================================
  // 4. SKILLS, PLUGINS & HARNESS MICROKERNEL
  // ==========================================

  // GET /api/skills
  if (req.method === "GET" && pathname === "/api/skills") {
    try {
      const catalog = abyxSkills.getSkillsCatalog(profileId);
      return json(res, 200, { ok: true, count: catalog.length, skills: catalog });
    } catch (err) {
      return json(res, 500, { ok: false, error: err.message });
    }
  }

  // GET /api/skills/research
  if (req.method === "GET" && pathname === "/api/skills/research") {
    try {
      const capabilities = researchSkills.getResearchCapabilities();
      return json(res, 200, { ok: true, capabilities });
    } catch (err) {
      return json(res, 500, { ok: false, error: err.message });
    }
  }

  // POST /api/skills/research/execute
  if (req.method === "POST" && pathname === "/api/skills/research/execute") {
    try {
      const body = await readJsonBody(req, res);
      if (!body) return true;
      const topic = body.topic || body.query;
      if (!topic) return json(res, 400, { ok: false, error: "topic is required" });
      const result = await researchSkills.executeResearch(topic, body.options || {});
      return json(res, 200, { ok: true, result });
    } catch (err) {
      return json(res, 500, { ok: false, error: err.message });
    }
  }

  // GET /api/harness/status
  if (req.method === "GET" && pathname === "/api/harness/status") {
    return json(res, 200, {
      ok: true,
      harness: "Abyx Unified Agent Harness",
      version: "1.1.0",
      status: "active",
      seamsCount: Object.keys(SEAMS || {}).length || 7,
      pluginsCount: harness?.inspect?.()?.plugins?.length || 8,
      activeProfile: profileId,
      activeWorkspace: workspaceService?.getActiveWorkspace?.()?.name || "Default Workspace"
    });
  }

  // GET /api/harness/plugins
  if (req.method === "GET" && pathname === "/api/harness/plugins") {
    return json(res, 200, {
      ok: true,
      plugins: harness?.inspect?.()?.plugins || [
        "provider_fs", "provider_browser", "provider_terminal", "provider_memory",
        "provider_model", "provider_sandbox", "provider_subagents", "consumer_tools"
      ]
    });
  }

  // GET /api/harness/seams
  if (req.method === "GET" && pathname === "/api/harness/seams") {
    return json(res, 200, {
      ok: true,
      seams: Object.entries(SEAMS || {}).map(([key, s]) => ({
        key,
        serviceName: s.serviceName || key,
        description: s.description || "Microkernel isolation seam"
      }))
    });
  }

  // Not handled by harness routes
  return false;
}

module.exports = {
  handleHarnessRoutes,
  getAgentRuntime
};
