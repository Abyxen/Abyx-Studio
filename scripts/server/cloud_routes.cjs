const fs = require("fs");
const path = require("path");
const { exec, execFile } = require("child_process");
const { promisify } = require("util");
const execFileAsync = promisify(execFile);

const { PathGuard } = require("../../agent");
const { WorkspaceFsTool } = require("../../harness/plugins/provider_fs");

/**
 * Helper to get active project workspace context with PathGuard boundary enforcement
 */
function getActiveWorkspaceFsContext(workspaceService) {
  if (!workspaceService) throw new Error("Workspace service is unavailable");
  const ws = workspaceService.getActiveWorkspace();
  if (!ws) throw new Error("No active workspace found");
  if (!fs.existsSync(ws.path) || !fs.statSync(ws.path).isDirectory()) {
    throw new Error(`The active project folder "${ws.path}" does not exist on disk or is unavailable.`);
  }
  const guard = new PathGuard([ws.path]);
  const fsTool = new WorkspaceFsTool(guard);
  return { workspace: ws, guard, fsTool };
}

/**
 * Cloud Providers, Usage Analytics, Living Memory, and Workspace/Project APIs
 */
async function handleCloudRoutes(req, res, { db, aiProviders, freeApisService, workspaceService, readJsonBody, json }) {
  const parsedUrl = new URL(req.url, "http://localhost");
  const pathname = parsedUrl.pathname;

  // ── ABYX Cloud Providers & Connections API ───────────────────────
  if (req.method === "GET" && pathname === "/api/providers") {
    return json(res, 200, aiProviders ? aiProviders.getProviderStatusList("prof_default") : { providers: [] });
  }

  if (req.method === "POST" && pathname === "/api/providers/save") {
    try {
      const body = await readJsonBody(req, res);
      if (!body) return true;
      const result = aiProviders ? aiProviders.saveProvidersConfig(body, "prof_default") : {};
      return json(res, 200, { ok: true, success: true, ...result });
    } catch (e) {
      return json(res, 400, { ok: false, error: e.message });
    }
  }

  if (req.method === "POST" && pathname === "/api/providers/test") {
    try {
      const body = await readJsonBody(req, res);
      if (!body) return true;
      const providerId = body.provider_id || body.providerId;
      const apiKey = body.api_key || body.apiKey || "";
      const customBaseUrl = body.custom_url || body.baseUrl || "";
      const customModel = body.custom_model || body.customModel || "";
      const testRes = aiProviders
        ? await aiProviders.testProviderConnection(providerId, apiKey, customBaseUrl, customModel, "prof_default")
        : { ok: false, error: "AI Providers not initialized" };
      return json(res, 200, testRes);
    } catch (e) {
      return json(res, 500, { ok: false, error: e.message });
    }
  }

  if (req.method === "GET" && pathname === "/api/free-apis") {
    return json(res, 200, freeApisService ? freeApisService.getCatalog("prof_default") : { providers: [] });
  }

  // ── ABYX Cloud Image Models & Generation API ─────────────────────────────
  if (req.method === "GET" && pathname === "/api/cloud/image-models") {
    const profileId = "prof_default";
    const openaiKey = aiProviders ? aiProviders.getEffectiveKey("openai", profileId) : "";
    const geminiKey = aiProviders ? aiProviders.getEffectiveKey("gemini", profileId) : "";
    const openrouterKey = aiProviders ? aiProviders.getEffectiveKey("openrouter", profileId) : "";

    const cloudImageModels = [
      {
        id: "cloud:dall-e-3",
        name: "DALL-E 3",
        provider: "OpenAI",
        providerId: "openai",
        configured: Boolean(openaiKey),
        desc: "Ultra-high fidelity & prompt adherence (1024x1024)"
      },
      {
        id: "cloud:dall-e-2",
        name: "DALL-E 2",
        provider: "OpenAI",
        providerId: "openai",
        configured: Boolean(openaiKey),
        desc: "Fast standard generation (512x512)"
      },
      {
        id: "cloud:imagen-3.0-generate-002",
        name: "Imagen 3",
        provider: "Google Gemini",
        providerId: "gemini",
        configured: Boolean(geminiKey),
        desc: "Photorealistic styling & rich textures from Google DeepMind"
      },
      {
        id: "cloud:flux-1.1-pro",
        name: "FLUX 1.1 Pro",
        provider: "BFL / OpenRouter",
        providerId: "openrouter",
        configured: Boolean(openrouterKey),
        desc: "Frontier 12B diffusion quality with sharp details"
      }
    ];
    return json(res, 200, { ok: true, models: cloudImageModels });
  }

  if (req.method === "POST" && pathname === "/api/cloud/image-generate") {
    try {
      const body = await readJsonBody(req, res);
      if (!body) return true;
      const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
      if (!prompt) return json(res, 400, { ok: false, error: "Prompt is required" });

      const model = String(body.model || "dall-e-3").replace(/^cloud:/, "");
      const profileId = "prof_default";

      // 1. OpenAI DALL-E 3 / DALL-E 2
      if (model.includes("dall-e")) {
        const key = aiProviders ? aiProviders.getEffectiveKey("openai", profileId) : "";
        if (!key) {
          return json(res, 400, {
            ok: false,
            error: "OpenAI API key is required for DALL-E. Configure it in Settings > Cloud AI Providers, or select a local model."
          });
        }
        const resp = await fetch("https://api.openai.com/v1/images/generations", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${key}`
          },
          body: JSON.stringify({
            prompt,
            model: model.includes("dall-e-2") ? "dall-e-2" : "dall-e-3",
            size: model.includes("dall-e-2") ? "512x512" : "1024x1024",
            response_format: "b64_json",
            n: 1
          })
        });
        const data = await resp.json();
        if (!resp.ok || !data.data?.[0]?.b64_json) {
          throw new Error(data.error?.message || `OpenAI returned status ${resp.status}`);
        }
        return json(res, 200, {
          ok: true,
          image: `data:image/png;base64,${data.data[0].b64_json}`,
          seed: body.seed || Math.floor(Math.random() * 1000000),
          provider: "OpenAI",
          model
        });
      }

      // 2. Google Gemini Imagen 3
      if (model.includes("imagen")) {
        const key = aiProviders ? aiProviders.getEffectiveKey("gemini", profileId) : "";
        if (!key) {
          return json(res, 400, {
            ok: false,
            error: "Google Gemini API key is required for Imagen 3. Configure it in Settings > Cloud AI Providers, or select a local model."
          });
        }
        const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${key}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            instances: [{ prompt }],
            parameters: { sampleCount: 1, aspectRatio: "1:1" }
          })
        });
        const data = await resp.json();
        if (!resp.ok || !data.predictions?.[0]?.bytesBase64Encoded) {
          throw new Error(data.error?.message || `Google Imagen returned status ${resp.status}`);
        }
        return json(res, 200, {
          ok: true,
          image: `data:image/png;base64,${data.predictions[0].bytesBase64Encoded}`,
          seed: body.seed || Math.floor(Math.random() * 1000000),
          provider: "Google",
          model
        });
      }

      return json(res, 400, {
        ok: false,
        error: `Cloud model "${model}" requires an active provider key. Configure it in Settings > Cloud AI Providers.`
      });
    } catch (err) {
      return json(res, 500, { ok: false, error: err.message || "Cloud image generation failed" });
    }
  }

  // ── ABYX Usage Analytics & Budgets API ─────────────────────────────
  if (req.method === "GET" && pathname === "/api/usage") {
    if (!db) return json(res, 200, { totalRequestsToday: 0, totalTokensToday: 0, providers: {}, usage: {}, monitoring: { summary: {} } });
    const monitoring = db.getAiUsageAnalytics("prof_default", {
      start: `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`
    });
    const quotaSnapshots = db.listProviderQuotaSnapshots("prof_default");
    const providers = Object.fromEntries(monitoring.byProvider.map(provider => {
      const quota = quotaSnapshots.filter(item => item.provider_id === provider.provider_id);
      const requestQuota = quota.find(item => item.quota_kind === "requests");
      const tokenQuota = quota.find(item => item.quota_kind === "tokens");
      const availableQuota = requestQuota || tokenQuota;
      return [provider.provider_id, {
        id: provider.provider_id,
        requestsToday: provider.requests,
        tokensToday: provider.total_tokens,
        remaining: availableQuota ? `${availableQuota.remaining_value ?? "—"} ${availableQuota.quota_kind}` : null,
        maxRequests: requestQuota?.limit_value ?? null,
        percentUsed: requestQuota?.limit_value > 0 && requestQuota.remaining_value != null ? Math.round((1 - requestQuota.remaining_value / requestQuota.limit_value) * 100) : null,
        quotaStatus: availableQuota?.source || "unavailable",
        quotaResetAt: availableQuota?.reset_at || null,
        source: availableQuota?.source || "locally tracked usage"
      }];
    }));
    return json(res, 200, {
      totalRequestsToday: monitoring.summary.requests,
      totalTokensToday: monitoring.summary.total_tokens,
      providers,
      usage: db.getTokenUsageStats("prof_default"),
      monitoring
    });
  }

  if (req.method === "GET" && pathname === "/api/usage/details") {
    if (!db) return json(res, 200, { ok: true, summary: { requests: 0 }, events: [], byProvider: [], byModel: [], budgets: [], providerQuotas: [] });
    const start = parsedUrl.searchParams.get("start") || undefined;
    const end = parsedUrl.searchParams.get("end") || undefined;
    const datePattern = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)?$/;
    if ((start && !datePattern.test(start)) || (end && !datePattern.test(end))) {
      return json(res, 400, { ok: false, error: "Date filters must be ISO dates or UTC timestamps" });
    }
    const filters = {
      start, end,
      provider: parsedUrl.searchParams.get("provider") || undefined,
      model: parsedUrl.searchParams.get("model") || undefined,
      requestType: parsedUrl.searchParams.get("requestType") || undefined,
      limit: parsedUrl.searchParams.get("limit") ? Number(parsedUrl.searchParams.get("limit")) : 50
    };
    return json(res, 200, {
      ok: true,
      ...db.getAiUsageAnalytics("prof_default", filters),
      budgets: db.listAiUsageBudgets("prof_default"),
      providerQuotas: db.listProviderQuotaSnapshots("prof_default")
    });
  }

  if (req.method === "GET" && pathname === "/api/usage/budgets") {
    return json(res, 200, { ok: true, budgets: db ? db.listAiUsageBudgets("prof_default") : [] });
  }

  if (req.method === "POST" && pathname === "/api/usage/budgets") {
    try {
      const body = await readJsonBody(req, res);
      if (!body) return true;
      const budget = db ? db.saveAiUsageBudget("prof_default", body) : null;
      return json(res, 200, { ok: true, budget });
    } catch (error) {
      return json(res, 400, { ok: false, error: error.message });
    }
  }

  if (req.method === "POST" && pathname === "/api/usage/reset") {
    if (freeApisService) {
      freeApisService.saveUsageData({ date: new Date().toISOString().slice(0, 10), providers: {} });
    }
    return json(res, 200, { ok: true });
  }

  if (req.method === "GET" && pathname === "/api/analytics/dashboard") {
    if (!db) return json(res, 200, { profileId: "prof_default", activity: {}, usage: {} });
    const start = parsedUrl.searchParams.get("start") || undefined;
    const end = parsedUrl.searchParams.get("end") || undefined;
    const datePattern = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)?$/;
    if ((start && !datePattern.test(start)) || (end && !datePattern.test(end)) || (start && end && start >= end)) {
      return json(res, 400, { ok: false, error: "Date filters must be a valid ISO range" });
    }
    const activity = db.getDashboardStats("prof_default", { start, end });
    return json(res, 200, {
      profileId: "prof_default",
      activity,
      usage: db.getTokenUsageStats("prof_default")
    });
  }

  // ── ABYX Conversation Auto-Titling API ────────────────────────────
  if (req.method === "POST" && pathname === "/api/conversation/title") {
    try {
      const body = await readJsonBody(req, res);
      if (!body) return true;
      const userPrompt = (body.prompt || body.text || "").trim();
      if (!userPrompt) {
        return json(res, 400, { ok: false, error: "Prompt is required" });
      }

      let generatedTitle = userPrompt.split("\n")[0].replace(/[^a-zA-Z0-9\s-]/g, " ").replace(/\s+/g, " ").trim();
      if (generatedTitle.length > 36) {
        generatedTitle = generatedTitle.slice(0, 35).trim();
      }
      return json(res, 200, { ok: true, title: generatedTitle || "Conversation" });
    } catch (err) {
      return json(res, 500, { ok: false, error: err.message });
    }
  }

  // ── ABYX Living Memory & Profile Knowledge API ────────────────────
  if (req.method === "GET" && (pathname === "/api/memories" || pathname === "/api/memory/profile")) {
    if (!db) return json(res, 200, []);
    const rows = db.getAllProfileMemory ? db.getAllProfileMemory("prof_default") : [];
    if (pathname === "/api/memory/profile") {
      return json(res, 200, {
        count: rows.length,
        profile: rows,
        snapshot: db.getProfileSnapshot ? db.getProfileSnapshot("prof_default") : null,
        context_block: db.formatProfileContext ? db.formatProfileContext(rows, "prof_default") : ""
      });
    }
    return json(res, 200, rows.map((r, i) => ({
      id: r.id || String(i + 1),
      key: r.key,
      value: r.value,
      category: r.category,
      confidence: r.confidence_score,
      reasoning: r.reasoning,
      text: `[${r.category}] ${r.key}: ${r.value}`,
      createdAt: r.created_at || r.timestamp
    })));
  }

  if (req.method === "POST" && pathname === "/api/memory/actions") {
    if (!db) return json(res, 500, { error: "Database not initialized" });
    try {
      const body = await readJsonBody(req, res);
      if (!body) return true;
      const actions = Array.isArray(body.actions) ? body.actions : [body];
      const stats = db.applyMemoryActions ? db.applyMemoryActions(actions, body.session_id, body.summary, "prof_default") : { applied: actions.length };
      return json(res, 200, { success: true, stats, current_memory: db.getAllProfileMemory ? db.getAllProfileMemory("prof_default") : [] });
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
  }

  // ── ABYX Projects & Workspace Subsystem ───────────────────────────
  if (req.method === "GET" && (pathname === "/api/workspaces" || pathname === "/api/projects")) {
    if (!workspaceService) return json(res, 503, { ok: false, error: "Workspace service unavailable" });
    const workspaces = workspaceService.getWorkspaces();
    const activeWorkspace = workspaceService.getActiveWorkspace();
    return json(res, 200, {
      ok: true,
      workspaces,
      activeWorkspace: activeWorkspace?.id || null,
      activeProject: activeWorkspace
    });
  }

  if (req.method === "POST" && (pathname === "/api/workspaces" || pathname === "/api/projects")) {
    if (!workspaceService) return json(res, 503, { ok: false, error: "Workspace service unavailable" });
    try {
      const body = await readJsonBody(req, res);
      if (!body) return true;
      const workspace = workspaceService.createWorkspace(body.name, body.path);
      return json(res, 201, {
        ok: true,
        workspace,
        activeWorkspace: workspace.id,
        activeProject: workspace
      });
    } catch (err) {
      return json(res, 400, { ok: false, error: err.message });
    }
  }

  if (req.method === "POST" && (pathname === "/api/workspaces/active" || pathname === "/api/projects/active")) {
    if (!workspaceService) return json(res, 503, { ok: false, error: "Workspace service unavailable" });
    try {
      const body = await readJsonBody(req, res);
      if (!body?.id) return json(res, 400, { ok: false, error: "Project ID is required" });
      const targetWorkspace = workspaceService.getWorkspaces().find(w => w.id === body.id);
      if (!targetWorkspace) return json(res, 404, { ok: false, error: "Project not found" });
      if (!targetWorkspace.available) {
        return json(res, 409, { ok: false, error: `The project folder "${targetWorkspace.path}" does not exist on disk or is unavailable.` });
      }
      const success = workspaceService.setActiveWorkspace(body.id);
      if (!success) {
        return json(res, 409, { ok: false, error: "Could not activate this project (folder may be inaccessible)" });
      }
      const active = workspaceService.getActiveWorkspace();
      return json(res, 200, {
        ok: true,
        activeWorkspace: active?.id || null,
        activeProject: active
      });
    } catch (err) {
      return json(res, 500, { ok: false, error: err.message });
    }
  }

  const projectDeleteMatch = pathname.match(/^\/api\/(?:workspaces|projects)\/([^/?]+)$/);
  if (req.method === "DELETE" && projectDeleteMatch) {
    if (!workspaceService) return json(res, 503, { ok: false, error: "Workspace service unavailable" });
    const projectId = decodeURIComponent(projectDeleteMatch[1]);
    try {
      if (workspaceService.getWorkspaces().length <= 1) {
        return json(res, 409, { ok: false, error: "Keep at least one project in ABYX" });
      }
      const deleted = workspaceService.deleteWorkspace(projectId);
      if (!deleted) {
        return json(res, 404, { ok: false, error: "Project not found" });
      }
      return json(res, 200, {
        ok: true,
        workspaces: workspaceService.getWorkspaces(),
        activeWorkspace: workspaceService.getActiveWorkspace()?.id || null,
        activeProject: workspaceService.getActiveWorkspace()
      });
    } catch (err) {
      return json(res, 500, { ok: false, error: err.message });
    }
  }

  if (req.method === "POST" && (pathname === "/api/workspaces/select-folder" || pathname === "/api/projects/select-folder")) {
    if (process.platform !== "win32") {
      return json(res, 501, { ok: false, error: "Folder selection dialog is available on Windows" });
    }
    try {
      const pickerScript = "Add-Type -AssemblyName System.Windows.Forms; $dialog = New-Object System.Windows.Forms.FolderBrowserDialog; $dialog.Description = 'Choose the project folder for the AI workspace'; $dialog.ShowNewFolderButton = $true; if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::WriteLine($dialog.SelectedPath) }";
      const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-Command", pickerScript], { windowsHide: true, timeout: 120000 });
      const selectedPath = (stdout || "").trim();
      if (!selectedPath) return json(res, 200, { ok: true, cancelled: true });
      const realPath = fs.realpathSync(selectedPath);
      if (!fs.statSync(realPath).isDirectory()) {
        return json(res, 400, { ok: false, error: "The selected path is not a folder" });
      }
      return json(res, 200, { ok: true, path: realPath });
    } catch (err) {
      return json(res, 500, { ok: false, error: err.message });
    }
  }

  if (req.method === "POST" && (pathname === "/api/workspaces/open-folder" || pathname === "/api/projects/open-folder")) {
    try {
      const body = (await readJsonBody(req, res)) || {};
      const ws = body?.id
        ? workspaceService.getWorkspaces().find(w => w.id === body.id)
        : workspaceService.getActiveWorkspace();
      const folderPath = ws?.path || body?.path;
      if (!folderPath || !fs.existsSync(folderPath)) {
        return json(res, 404, { ok: false, error: "Project folder does not exist on disk" });
      }
      exec(`explorer.exe "${folderPath}"`, { windowsHide: true }, (err) => {
        if (err) return json(res, 500, { ok: false, error: err.message });
        return json(res, 200, { ok: true, message: `Opened: ${folderPath}` });
      });
      return true;
    } catch (err) {
      return json(res, 500, { ok: false, error: err.message });
    }
  }

  if ((pathname.startsWith("/api/workspaces/files") || pathname.startsWith("/api/projects/files")) && (req.method === "GET" || req.method === "POST")) {
    try {
      const { fsTool, workspace } = getActiveWorkspaceFsContext(workspaceService);
      let dirPath = ".";
      let maxEntries = 150;
      if (req.method === "POST") {
        const body = (await readJsonBody(req, res)) || {};
        dirPath = body.dirPath || body.dir || dirPath;
        maxEntries = Number(body.maxEntries) || maxEntries;
      } else {
        dirPath = parsedUrl.searchParams.get("dir") || parsedUrl.searchParams.get("dirPath") || dirPath;
        maxEntries = Number(parsedUrl.searchParams.get("maxEntries")) || maxEntries;
      }
      const listRes = await fsTool.list({ dirPath, maxEntries });
      return json(res, listRes.success ? 200 : 400, {
        ok: listRes.success,
        ...listRes,
        workspace: { id: workspace.id, name: workspace.name, path: workspace.path }
      });
    } catch (err) {
      return json(res, 400, { ok: false, error: err.message });
    }
  }

  if (req.method === "POST" && (pathname === "/api/workspaces/file/read" || pathname === "/api/projects/file/read")) {
    try {
      const body = await readJsonBody(req, res);
      if (!body) return true;
      const filePath = body.filePath || body.path;
      if (!filePath) return json(res, 400, { ok: false, error: "filePath is required" });
      const { fsTool } = getActiveWorkspaceFsContext(workspaceService);
      const readRes = await fsTool.read({ filePath, maxBytes: Number(body.maxBytes) || 200000 });
      return json(res, readRes.success ? 200 : 400, { ok: readRes.success, ...readRes });
    } catch (err) {
      return json(res, 400, { ok: false, error: err.message });
    }
  }

  if (req.method === "POST" && (pathname === "/api/workspaces/file/write" || pathname === "/api/projects/file/write")) {
    try {
      const body = await readJsonBody(req, res);
      if (!body) return true;
      const filePath = body.filePath || body.path;
      if (!filePath) return json(res, 400, { ok: false, error: "filePath is required" });
      const { fsTool } = getActiveWorkspaceFsContext(workspaceService);
      const writeRes = await fsTool.write({ filePath, content: body.content ?? "" });
      return json(res, writeRes.success ? 200 : 400, { ok: writeRes.success, ...writeRes });
    } catch (err) {
      return json(res, 400, { ok: false, error: err.message });
    }
  }

  if (req.method === "POST" && (pathname === "/api/workspaces/file/edit" || pathname === "/api/projects/file/edit")) {
    try {
      const body = await readJsonBody(req, res);
      if (!body) return true;
      const filePath = body.filePath || body.path;
      if (!filePath) return json(res, 400, { ok: false, error: "filePath is required" });
      if (body.target === undefined || body.target === null) return json(res, 400, { ok: false, error: "target string is required" });
      if (body.replacement === undefined || body.replacement === null) return json(res, 400, { ok: false, error: "replacement string is required" });
      const { fsTool } = getActiveWorkspaceFsContext(workspaceService);
      const editRes = await fsTool.edit({ filePath, target: body.target, replacement: body.replacement });
      return json(res, editRes.success ? 200 : 400, { ok: editRes.success, ...editRes });
    } catch (err) {
      return json(res, 400, { ok: false, error: err.message });
    }
  }

  if (req.method === "POST" && (pathname === "/api/workspaces/file/search" || pathname === "/api/projects/file/search")) {
    try {
      const body = await readJsonBody(req, res);
      if (!body) return true;
      const query = body.query || "";
      const { fsTool } = getActiveWorkspaceFsContext(workspaceService);
      const searchRes = await fsTool.search({ query, baseDir: body.baseDir || ".", maxResults: Number(body.maxResults) || 25 });
      return json(res, searchRes.success ? 200 : 400, { ok: searchRes.success, ...searchRes });
    } catch (err) {
      return json(res, 400, { ok: false, error: err.message });
    }
  }

  if (req.method === "POST" && (pathname === "/api/workspaces/file/delete" || pathname === "/api/projects/file/delete")) {
    try {
      const body = await readJsonBody(req, res);
      if (!body) return true;
      const filePath = body.filePath || body.path;
      if (!filePath) return json(res, 400, { ok: false, error: "filePath is required" });
      const { fsTool } = getActiveWorkspaceFsContext(workspaceService);
      const delRes = await fsTool.delete({ filePath });
      return json(res, delRes.success ? 200 : 400, { ok: delRes.success, ...delRes });
    } catch (err) {
      return json(res, 400, { ok: false, error: err.message });
    }
  }

  return false;
}

module.exports = {
  handleCloudRoutes,
  getActiveWorkspaceFsContext
};
