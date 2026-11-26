// harness_service.js — Central Service Layer for MultiAgentWorkspace & OpenCode Frontend
// Encapsulates all backend runtime integration, event normalization, and state fetching.
// Invariant: Business logic remains strictly decoupled from React presentation components.

import {
  getSpecializedAgents,
  getOrchestratorHistory,
  getOrchestratorRun,
  getOrchestratorEvents,
  getOrchestratorHealth,
  getOrchestratorSettings,
  updateOrchestratorSettings,
  streamOrchestration,
  cancelOrchestration,
  recoverOrchestration,
  getHardwareSpecs,
  listHarnessWorkspaceFiles,
  getHarnessRuntimeConfig,
  updateHarnessRuntimeConfig,
  getSecurityStatus,
  setSecurityMode,
  getSecurityWorkspaces,
  getPendingApprovals,
  resolveAgentApproval,
  getAgentMemory,
  createAgentMemory,
  reviewAgentMemory,
  deleteAgentMemory,
  getAgentSkills,
  toggleAgentSkill,
  approveAgentSkill,
  getAgentPlugins,
  toggleAgentPlugin,
  getAgentToolBundles,
  setAgentToolBundleEnabled,
  executeTerminalCommand,
  getFileDiff,
  runVerification,
  runReviewerAudit,
  getBenchmarkTasks,
  runBenchmarkTask,
  getHardwareProfile
} from "./api";

export class HarnessService {
  // ── 1. Agents & Personas ──────────────────────────────────────────────────

  static async fetchAgents() {
    try {
      const res = await getSpecializedAgents();
      return res?.ok && Array.isArray(res.agents) ? res.agents : [];
    } catch (err) {
      console.warn("[HarnessService] fetchAgents error:", err.message);
      return [];
    }
  }

  // ── 2. Health & Hardware Specs ────────────────────────────────────────────

  static async fetchHealth() {
    try {
      const res = await getOrchestratorHealth();
      return res?.ok ? res : { ok: true, online: true, model: "AbyxV2 9B.gguf" };
    } catch (_) {
      return { ok: false, online: false, model: "Unknown" };
    }
  }

  static async fetchSpecs() {
    try {
      const res = await getHardwareSpecs();
      return res || null;
    } catch (_) {
      return null;
    }
  }

  // ── 3. Sessions & Orchestration History ───────────────────────────────────

  static async fetchHistory() {
    try {
      const res = await getOrchestratorHistory();
      return res?.ok && Array.isArray(res.history) ? res.history : [];
    } catch (err) {
      console.warn("[HarnessService] fetchHistory error:", err.message);
      return [];
    }
  }

  static async fetchSessionDetails(runId) {
    if (!runId) return null;
    try {
      const [runRes, eventsRes] = await Promise.all([
        getOrchestratorRun(runId).catch(() => null),
        getOrchestratorEvents(runId).catch(() => null)
      ]);
      return {
        run: runRes?.run || null,
        events: eventsRes?.events || []
      };
    } catch (err) {
      console.warn("[HarnessService] fetchSessionDetails error:", err.message);
      return null;
    }
  }

  // ── 4. Workspace Files ────────────────────────────────────────────────────

  static async fetchWorkspaceFiles(dir = ".") {
    try {
      const res = await listHarnessWorkspaceFiles(dir);
      return res?.ok && Array.isArray(res.files) ? res.files : [];
    } catch (_) {
      return [];
    }
  }

  // ── 5. Runtime Configuration & Model Inference Settings ───────────────────

  static async fetchConfig() {
    try {
      const res = await getHarnessRuntimeConfig();
      if (res?.ok) return res;
      const fallback = await getOrchestratorSettings();
      return fallback?.settings || null;
    } catch (_) {
      return null;
    }
  }

  static async saveConfig(settings) {
    try {
      const res = await updateHarnessRuntimeConfig(settings);
      if (res?.ok) return res;
      return await updateOrchestratorSettings(settings);
    } catch (err) {
      throw new Error(`Failed to save runtime configuration: ${err.message}`);
    }
  }

  // ── 6. Swarm Stream Execution & Event Normalizer ──────────────────────────

  static async executeSwarm({
    goal,
    model = "auto",
    concurrency = 4,
    mode = "build",
    policyMode = "auto",
    harnessConfig = {},
    signal,
    onNormalizedEvent
  }) {
    if (!goal || !goal.trim()) {
      throw new Error("A non-empty mission goal is required");
    }

    const payload = {
      goal: goal.trim(),
      model,
      concurrency,
      harnessOverrides: {
        ...harnessConfig,
        mode,
        policyMode
      },
      signal,
      onEvent: (rawType, rawData) => {
        const normalized = this._normalizeEvent(rawType, rawData);
        if (typeof onNormalizedEvent === "function") {
          onNormalizedEvent(normalized.type, normalized.data, normalized.timestamp);
        }
      }
    };

    return await streamOrchestration(payload);
  }

  static _normalizeEvent(rawType, rawData) {
    const timestamp = new Date().toLocaleTimeString();
    let type = rawType;
    let data = rawData || {};

    // Standardize present vs past tense event variants
    if (type === "orchestration:started") type = "orchestration:start";
    if (type === "task:started") type = "task:start";
    if (type === "task:completed") type = "task:complete";
    if (type === "task:failed") type = "task:fail";
    if (type === "orchestration:finished") type = "orchestration:done";

    return { type, data, timestamp };
  }

  static async cancelRun(runId, reason = "User cancelled from workspace") {
    if (!runId) return { ok: false };
    return await cancelOrchestration(runId, reason);
  }

  static async recoverRun(runId) {
    if (!runId) throw new Error("runId is required for recovery");
    return await recoverOrchestration(runId);
  }

  // ── 7. Security, Sandboxing & Approvals ────────────────────────────────────

  static async fetchSecurity() {
    try {
      const [secRes, wsRes, appRes] = await Promise.all([
        getSecurityStatus().catch(() => null),
        getSecurityWorkspaces().catch(() => null),
        getPendingApprovals().catch(() => null)
      ]);
      return {
        status: secRes?.ok ? secRes : null,
        workspaces: wsRes?.ok ? wsRes.workspaces : [],
        activeLocks: wsRes?.ok ? wsRes.activeLocks : [],
        approvals: appRes?.ok && Array.isArray(appRes.approvals) ? appRes.approvals : []
      };
    } catch (_) {
      return { status: null, workspaces: [], activeLocks: [], approvals: [] };
    }
  }

  static async resolveApproval(approvalId, approved, reason = "", persist = false) {
    return await resolveAgentApproval(approvalId, approved, reason, persist);
  }

  static async setPermissionMode(permissionMode) {
    try {
      return await setSecurityMode({ permissionMode });
    } catch (_) {
      return { ok: false };
    }
  }

  static async fetchHardwareProfile() {
    try {
      const res = await getHardwareProfile();
      return res?.ok ? res.hardware : null;
    } catch (_) {
      return null;
    }
  }

  // ── 8. 3-Tier Memory Management ───────────────────────────────────────────

  static async fetchMemories({ query = "", level = "all", category = null, projectId = null } = {}) {
    try {
      const res = await getAgentMemory({ query, level, category, projectId });
      return res?.ok ? { memories: res.memories || [], stats: res.stats || {} } : { memories: [], stats: {} };
    } catch (_) {
      return { memories: [], stats: {} };
    }
  }

  static async addMemory(entry) {
    return await createAgentMemory(entry);
  }

  static async reviewMemory(id, { approved = true, reviewer = "user", notes = "" } = {}) {
    return await reviewAgentMemory(id, { approved, reviewer, notes });
  }

  static async removeMemory(id, hard = false) {
    return await deleteAgentMemory(id, hard);
  }

  // ── 9. Skills & Plugins ───────────────────────────────────────────────────

  static async fetchSkills() {
    try {
      const res = await getAgentSkills();
      return res?.ok && Array.isArray(res.skills) ? res.skills : [];
    } catch (_) {
      return [];
    }
  }

  static async toggleSkill(id, enabled) {
    return await toggleAgentSkill(id, enabled);
  }

  static async approveSkill(id) {
    return await approveAgentSkill(id);
  }

  static async fetchPlugins() {
    try {
      const res = await getAgentPlugins();
      return res?.ok && Array.isArray(res.plugins) ? res.plugins : [];
    } catch (_) {
      return [];
    }
  }

  static async togglePlugin(id, enabled) {
    return await toggleAgentPlugin(id, enabled);
  }

  // ── 10. Tool Bundles & Terminal Execution ─────────────────────────────────

  static async fetchToolBundles() {
    try {
      const res = await getAgentToolBundles();
      return res?.ok && Array.isArray(res.bundles) ? res.bundles : [];
    } catch (_) {
      return [];
    }
  }

  static async toggleToolBundle(id, enabled) {
    return await setAgentToolBundleEnabled(id, enabled);
  }

  static async runTerminal(command, cwd = ".") {
    if (!command || !command.trim()) throw new Error("Command cannot be empty");
    return await executeTerminalCommand(command.trim(), cwd);
  }

  // ── 11. Staged File Diffs ─────────────────────────────────────────────────

  static async fetchDiff(filePath) {
    if (!filePath) return null;
    try {
      const res = await getFileDiff(filePath);
      return res?.ok ? res : null;
    } catch (_) {
      return null;
    }
  }

  // ── 12. Verification & Benchmark Suites ───────────────────────────────────

  static async runVerificationSuite(options = {}) {
    return await runVerification(options);
  }

  static async runReviewerAudit(options = {}) {
    return await runReviewerAudit(options);
  }

  static async fetchBenchmarkTasks() {
    try {
      const res = await getBenchmarkTasks();
      return res?.ok && Array.isArray(res.tasks) ? res.tasks : [];
    } catch (_) {
      return [];
    }
  }

  static async runBenchmark(taskId) {
    if (!taskId) throw new Error("taskId is required");
    return await runBenchmarkTask(taskId);
  }
}

export default HarnessService;
