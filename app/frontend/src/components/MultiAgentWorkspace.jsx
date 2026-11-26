import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  Play, Square, RefreshCw, Layers, Cpu, Shield, Search, Terminal, Code2,
  Users, Sliders, ChevronRight, FileCode, Check, X, CheckCircle, AlertTriangle,
  Clock, Plus, Filter, ArrowRight, Eye, Sparkles, AlertCircle, Network,
  Folder, FileText, Database, GitCommit, Settings, Activity, ArrowUpRight,
  Maximize2, Minimize2, CheckCircle2, ChevronDown, Wrench, HardDrive,
  Lock, Unlock, Zap, BookOpen, CheckSquare, Trash2
} from "lucide-react";
import HarnessService from "../services/harness_service";

const STATUS_BADGES = {
  pending: { label: "Pending", bg: "bg-neutral-800/80 text-neutral-400 border-neutral-700/60" },
  ready: { label: "Ready", bg: "bg-blue-950/60 text-blue-300 border-blue-800/60" },
  running: { label: "Running", bg: "bg-cyan-950/70 text-cyan-300 border-cyan-500/60 animate-pulse" },
  verifying: { label: "Verifying", bg: "bg-amber-950/70 text-amber-300 border-amber-500/60" },
  completed: { label: "Completed", bg: "bg-emerald-950/70 text-emerald-300 border-emerald-500/60" },
  failed: { label: "Failed", bg: "bg-rose-950/70 text-rose-300 border-rose-500/60" },
  cancelled: { label: "Cancelled", bg: "bg-neutral-900 text-neutral-500 border-neutral-800" }
};

export default function MultiAgentWorkspace({ activeProject, onOpenFile }) {
  // Mode: 'build' | 'plan' | 'swarm'
  const [mode, setMode] = useState("build");
  const [goal, setGoal] = useState("");
  const [concurrency, setConcurrency] = useState(4);
  const [model, setModel] = useState("AbyxV2 9B.gguf");
  const [policyMode, setPolicyMode] = useState("auto"); // 'auto' | 'manual' | 'bypass'
  const [permissionMode, setPermissionModeState] = useState("ask"); // 'ask' | 'approve for me' | 'turbo'

  // Right Inspector Tab: 'dag' | 'diffs' | 'terminal' | 'tools' | 'memory' | 'security' | 'verify' | 'settings'
  const [inspectorTab, setInspectorTab] = useState("dag");

  // Multi-Agent & Orchestration State
  const [agents, setAgents] = useState([]);
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [isOrchestrating, setIsOrchestrating] = useState(false);
  const [activeRunId, setActiveRunId] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [events, setEvents] = useState([]);
  const [findings, setFindings] = useState([]);
  const [toolAudits, setToolAudits] = useState([]);
  const [stagedDiffs, setStagedDiffs] = useState([]);
  const [selectedTask, setSelectedTask] = useState(null);
  const [historyRuns, setHistoryRuns] = useState([]);
  const [selectedDiff, setSelectedDiff] = useState(null);
  const [diffContent, setDiffContent] = useState(null);

  // Security, Sandboxing & Approvals State
  const [securityStatus, setSecurityStatus] = useState(null);
  const [securityWorkspaces, setSecurityWorkspaces] = useState([]);
  const [pendingApprovals, setPendingApprovals] = useState([]);

  // Memory & Skills State
  const [memories, setMemories] = useState([]);
  const [memoryStats, setMemoryStats] = useState({});
  const [memorySearch, setMemorySearch] = useState("");
  const [memoryLevel, setMemoryLevel] = useState("all");
  const [skills, setSkills] = useState([]);
  const [toolBundles, setToolBundles] = useState([]);

  // Terminal Console State
  const [terminalInput, setTerminalInput] = useState("");
  const [terminalLogs, setTerminalLogs] = useState([]);
  const [isTerminalRunning, setIsTerminalRunning] = useState(false);

  // Verification & Benchmarks State
  const [verificationResult, setVerificationResult] = useState(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [benchmarkTasks, setBenchmarkTasks] = useState([]);
  const [benchmarkResults, setBenchmarkResults] = useState({});
  const [activeBenchmarkId, setActiveBenchmarkId] = useState(null);

  // Hardware & Model Health
  const [health, setHealth] = useState({ online: true, model: "AbyxV2 9B.gguf" });
  const [specs, setSpecs] = useState(null);
  const [workspaceFiles, setWorkspaceFiles] = useState([]);

  // Model & Inference Parameter Controls
  const [harnessConfig, setHarnessConfig] = useState({
    systemPrompt: "You are Abyx AI, a powerful, precise, autonomous software engineering agent.",
    contextSize: 4096,
    temperature: 0.7,
    maxResponseTokens: "auto",
    maxTokens: 3072,
    seed: -1,
    performanceProfile: "balanced",
    textBackend: "cuda",
    cpuThreads: 16,
    gpuLayers: 50,
    batchSize: 512,
    kvCache: "q8_0",
    ropeScaling: "none",
    ropeFreqScale: 1.0,
    ropeFreqBase: 10000
  });
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [configSaveNotice, setConfigSaveNotice] = useState(null);

  const abortRef = useRef(null);
  const timelineEndRef = useRef(null);
  const terminalEndRef = useRef(null);
  const inputRef = useRef(null);

  // Load baseline on mount
  useEffect(() => {
    loadBaseline();
  }, []);

  useEffect(() => {
    timelineEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events, tasks]);

  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [terminalLogs]);

  const loadBaseline = async () => {
    const [
      loadedAgents,
      loadedHealth,
      loadedSpecs,
      loadedHistory,
      loadedFiles,
      loadedConfig,
      loadedSec,
      loadedSkills,
      loadedBundles,
      loadedMems,
      loadedBench
    ] = await Promise.all([
      HarnessService.fetchAgents(),
      HarnessService.fetchHealth(),
      HarnessService.fetchSpecs(),
      HarnessService.fetchHistory(),
      HarnessService.fetchWorkspaceFiles("."),
      HarnessService.fetchConfig(),
      HarnessService.fetchSecurity(),
      HarnessService.fetchSkills(),
      HarnessService.fetchToolBundles(),
      HarnessService.fetchMemories(),
      HarnessService.fetchBenchmarkTasks()
    ]);

    if (loadedAgents.length > 0) setAgents(loadedAgents);
    if (loadedHealth) setHealth(loadedHealth);
    if (loadedSpecs) setSpecs(loadedSpecs);
    if (loadedHistory) setHistoryRuns(loadedHistory);
    if (loadedFiles) setWorkspaceFiles(loadedFiles);
    if (loadedConfig) setHarnessConfig(prev => ({ ...prev, ...loadedConfig }));
    if (loadedSec) {
      setSecurityStatus(loadedSec.status);
      setSecurityWorkspaces(loadedSec.workspaces);
      setPendingApprovals(loadedSec.approvals);
    }
    if (loadedSkills) setSkills(loadedSkills);
    if (loadedBundles) setToolBundles(loadedBundles);
    if (loadedMems) {
      setMemories(loadedMems.memories || []);
      setMemoryStats(loadedMems.stats || {});
    }
    if (loadedBench) setBenchmarkTasks(loadedBench);
    // Restore permission mode from security status
    if (loadedSec?.status?.permissionMode) {
      setPermissionModeState(loadedSec.status.permissionMode);
    }
  };

  const handleSetPermissionMode = async (newMode) => {
    setPermissionModeState(newMode);
    try { await HarnessService.setPermissionMode(newMode); } catch (_) {}
  };

  // ── Session Switching & Restoration ───────────────────────────────────────

  const handleSelectSession = async (runId) => {
    setActiveRunId(runId);
    const details = await HarnessService.fetchSessionDetails(runId);
    if (details?.run) {
      if (Array.isArray(details.run.tasks)) setTasks(details.run.tasks);
      if (Array.isArray(details.run.findings)) setFindings(details.run.findings);
    }
    if (Array.isArray(details?.events) && details.events.length > 0) {
      setEvents(details.events.map(e => ({
        type: e.type,
        data: e.data,
        timestamp: new Date(e.timestamp || Date.now()).toLocaleTimeString()
      })));
    }
  };

  // ── Swarm Orchestration Execution ─────────────────────────────────────────

  const handleStartOrchestration = async () => {
    if (!goal.trim() || isOrchestrating) return;

    setIsOrchestrating(true);
    setTasks([]);
    setEvents([]);
    setFindings([]);
    setToolAudits([]);
    setStagedDiffs([]);
    setSelectedTask(null);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      await HarnessService.executeSwarm({
        goal: goal.trim(),
        model,
        concurrency,
        mode,
        policyMode,
        permissionMode,
        harnessConfig,
        signal: ctrl.signal,
        onNormalizedEvent: (type, data, timestamp) => {
          setEvents(prev => [...prev.slice(-500), { type, data, timestamp }]);

          if (type === "orchestration:start") {
            setActiveRunId(data.runId);
          } else if (type === "orchestration:dag_formed" && Array.isArray(data.tasks)) {
            setTasks(data.tasks.map(t => ({ ...t, status: "pending" })));
          } else if (type === "task:start") {
            setTasks(prev => prev.map(t => t.id === data.taskId ? { ...t, status: "running", startedAt: data.timestamp, agentRole: data.agentId || data.agentName } : t));
          } else if (type === "task:step") {
            setTasks(prev => prev.map(t => t.id === data.taskId ? { ...t, currentStep: data.step, maxSteps: data.maxSteps } : t));
          } else if (type === "task:tool_call") {
            setToolAudits(prev => [...prev, {
              id: `tool_${Date.now()}_${Math.random().toString(36).substring(7)}`,
              taskId: data.taskId,
              tool: data.tool,
              args: data.args,
              timestamp,
              status: "running"
            }]);
          } else if (type === "task:tool_result") {
            setToolAudits(prev => prev.map(t =>
              t.taskId === data.taskId && t.tool === data.tool && t.status === "running"
                ? { ...t, status: data.success ? "success" : "failed", output: data.output }
                : t
            ));
            if (["fs_write", "fs_edit", "write_file", "edit_file"].includes(data.tool) && data.success) {
              const touchedFile = data.args?.filePath || data.args?.path || "workspace_file";
              setStagedDiffs(prev => {
                if (prev.some(d => d.file === touchedFile)) return prev;
                return [...prev, { file: touchedFile, tool: data.tool, timestamp }];
              });
            }
          } else if (type === "task:complete") {
            setTasks(prev => prev.map(t => t.id === data.taskId ? { ...t, status: "completed", result: data.result } : t));
            if (data.result?.finding) {
              setFindings(prev => [...prev, data.result.finding]);
            }
          } else if (type === "finding:published") {
            setFindings(prev => [...prev, data]);
          } else if (type === "task:retry") {
            setTasks(prev => prev.map(t => t.id === data.taskId ? { ...t, status: "ready", retryCount: data.retryCount, error: data.error } : t));
          } else if (type === "task:fail") {
            setTasks(prev => prev.map(t => t.id === data.taskId ? { ...t, status: "failed", error: data.error } : t));
          } else if (type === "orchestration:done") {
            setIsOrchestrating(false);
            if (Array.isArray(data.tasks)) setTasks(data.tasks);
            HarnessService.fetchHistory().then(setHistoryRuns);
          } else if (type === "orchestration:error") {
            setIsOrchestrating(false);
          }
        }
      });
    } catch (err) {
      if (!ctrl.signal.aborted) {
        setEvents(prev => [...prev, { type: "error", data: { error: err.message }, timestamp: new Date().toLocaleTimeString() }]);
      }
    } finally {
      setIsOrchestrating(false);
    }
  };

  const handleCancel = async () => {
    if (abortRef.current) abortRef.current.abort();
    if (activeRunId) {
      await HarnessService.cancelRun(activeRunId);
    }
    setIsOrchestrating(false);
  };

  const handleRecover = async (e, runId) => {
    e.stopPropagation();
    setIsOrchestrating(true);
    try {
      const res = await HarnessService.recoverRun(runId);
      if (res?.ok) {
        if (Array.isArray(res.tasks)) setTasks(res.tasks);
        HarnessService.fetchHistory().then(setHistoryRuns);
      }
    } catch (err) {
      setEvents(prev => [...prev, { type: "error", data: { error: err.message }, timestamp: new Date().toLocaleTimeString() }]);
    } finally {
      setIsOrchestrating(false);
    }
  };

  // ── Approvals & Security Handlers ─────────────────────────────────────────

  const handleResolveApproval = async (approvalId, approved, persist = false) => {
    try {
      const res = await HarnessService.resolveApproval(approvalId, approved, "Manual resolution from workspace UI", persist);
      if (res?.ok) {
        setPendingApprovals(prev => prev.filter(a => a.id !== approvalId));
      }
    } catch (err) {
      alert(`Approval error: ${err.message}`);
    }
  };

  // ── Terminal Execution ────────────────────────────────────────────────────

  const handleRunTerminal = async (e) => {
    e?.preventDefault();
    if (!terminalInput.trim() || isTerminalRunning) return;

    const cmd = terminalInput.trim();
    setTerminalInput("");
    setIsTerminalRunning(true);
    setTerminalLogs(prev => [...prev, { type: "cmd", text: `$ ${cmd}`, timestamp: new Date().toLocaleTimeString() }]);

    try {
      const res = await HarnessService.runTerminal(cmd, ".");
      if (res.stdout) {
        setTerminalLogs(prev => [...prev, { type: "stdout", text: res.stdout, timestamp: new Date().toLocaleTimeString() }]);
      }
      if (res.stderr) {
        setTerminalLogs(prev => [...prev, { type: "stderr", text: res.stderr, timestamp: new Date().toLocaleTimeString() }]);
      }
      if (!res.stdout && !res.stderr) {
        setTerminalLogs(prev => [...prev, { type: "stdout", text: res.output || `Exited with code ${res.exitCode ?? 0}`, timestamp: new Date().toLocaleTimeString() }]);
      }
    } catch (err) {
      setTerminalLogs(prev => [...prev, { type: "stderr", text: err.message, timestamp: new Date().toLocaleTimeString() }]);
    } finally {
      setIsTerminalRunning(false);
    }
  };

  // ── File Diff Inspection ──────────────────────────────────────────────────

  const handleInspectDiff = async (filePath) => {
    setSelectedDiff(filePath);
    setDiffContent(null);
    const diff = await HarnessService.fetchDiff(filePath);
    setDiffContent(diff);
  };

  // ── Verification & Benchmark Triggers ─────────────────────────────────────

  const handleRunVerification = async () => {
    setIsVerifying(true);
    setVerificationResult(null);
    try {
      const res = await HarnessService.runVerificationSuite({
        files: ["package.json", "agent/index.js", "scripts/server/serve.cjs"],
        runTests: false,
        checkTypes: true
      });
      setVerificationResult(res?.report || res);
    } catch (err) {
      setVerificationResult({ ok: false, error: err.message });
    } finally {
      setIsVerifying(false);
    }
  };

  const handleRunReviewer = async () => {
    setIsVerifying(true);
    setVerificationResult(null);
    try {
      const res = await HarnessService.runReviewerAudit({ workspaceDir: "." });
      setVerificationResult(res?.review || res);
    } catch (err) {
      setVerificationResult({ ok: false, error: err.message });
    } finally {
      setIsVerifying(false);
    }
  };

  const handleRunBenchmark = async (taskId) => {
    setActiveBenchmarkId(taskId);
    try {
      const res = await HarnessService.runBenchmark(taskId);
      if (res?.ok && res.result) {
        setBenchmarkResults(prev => ({ ...prev, [taskId]: res.result }));
      }
    } catch (err) {
      setBenchmarkResults(prev => ({ ...prev, [taskId]: { ok: false, error: err.message } }));
    } finally {
      setActiveBenchmarkId(null);
    }
  };

  // ── Memory Management ─────────────────────────────────────────────────────

  const handleSearchMemory = async () => {
    const res = await HarnessService.fetchMemories({ query: memorySearch, level: memoryLevel });
    setMemories(res.memories || []);
    setMemoryStats(res.stats || {});
  };

  const handleDeleteMemory = async (id) => {
    await HarnessService.removeMemory(id, true);
    setMemories(prev => prev.filter(m => m.id !== id));
  };

  // ── Settings Save ─────────────────────────────────────────────────────────

  const handleSaveSettings = async () => {
    setIsSavingConfig(true);
    setConfigSaveNotice(null);
    try {
      const res = await HarnessService.saveConfig(harnessConfig);
      if (res?.ok) {
        setConfigSaveNotice("Settings updated successfully");
        setTimeout(() => setConfigSaveNotice(null), 3000);
      }
    } catch (err) {
      setConfigSaveNotice(`Failed to save: ${err.message}`);
    } finally {
      setIsSavingConfig(false);
    }
  };

  const handleInsertAgent = (role) => {
    setGoal(prev => `${prev} @${role} `);
    inputRef.current?.focus();
  };

  const completedTasksCount = tasks.filter(t => t.status === "completed").length;
  const progressPercent = tasks.length > 0 ? Math.round((completedTasksCount / tasks.length) * 100) : 0;

  return (
    <div className="flex h-full w-full bg-[#0c0d12] text-[#f0f2f5] font-sans overflow-hidden select-none">
      
      {/* ── LEFT PANE: WORKSPACE, SESSIONS, MODES & HARDWARE SPECS ── */}
      <div className="w-72 flex-shrink-0 bg-[#12141c] border-r border-white/[0.08] flex flex-col justify-between overflow-hidden">
        
        {/* Top: Project Workspace Header */}
        <div className="flex flex-col border-b border-white/[0.08]">
          <div className="p-3.5 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded bg-white/[0.06] border border-white/[0.1] flex items-center justify-center text-white">
                <Folder className="w-4 h-4 text-neutral-300" />
              </div>
              <div className="overflow-hidden">
                <div className="text-xs font-semibold text-white truncate">{activeProject?.name || "Local AI Studio Abyx"}</div>
                <div className="text-[10px] text-neutral-400 font-mono truncate">{activeProject?.path || "C:/Users/.../Abyx"}</div>
              </div>
            </div>
            <button
              onClick={() => HarnessService.fetchWorkspaceFiles(".").then(setWorkspaceFiles)}
              title="Refresh workspace files"
              className="p-1.5 rounded hover:bg-white/[0.06] text-neutral-400 hover:text-white transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Mode Selector (Build / Plan / Swarm) */}
          <div className="px-3 pb-3">
            <div className="grid grid-cols-3 gap-1 bg-[#0c0d12] p-1 rounded-md border border-white/[0.06] text-[11px] font-mono">
              <button
                onClick={() => setMode("build")}
                className={`py-1 rounded text-center transition-colors ${mode === "build" ? "bg-white/[0.12] text-white font-semibold" : "text-neutral-400 hover:text-white"}`}
              >
                Build
              </button>
              <button
                onClick={() => setMode("plan")}
                className={`py-1 rounded text-center transition-colors ${mode === "plan" ? "bg-white/[0.12] text-white font-semibold" : "text-neutral-400 hover:text-white"}`}
              >
                Plan
              </button>
              <button
                onClick={() => setMode("swarm")}
                className={`py-1 rounded text-center transition-colors ${mode === "swarm" ? "bg-white/[0.12] text-white font-semibold" : "text-neutral-400 hover:text-white"}`}
              >
                Swarm
              </button>
            </div>
          </div>
        </div>

        {/* Center: Session / Orchestration Runs History */}
        <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
          <div className="flex items-center justify-between text-[11px] font-mono text-neutral-400 px-1 uppercase tracking-wider">
            <span>Runs &amp; History</span>
            <span className="text-[10px] bg-white/[0.06] px-1.5 py-0.5 rounded">{historyRuns.length}</span>
          </div>

          {historyRuns.length === 0 ? (
            <div className="text-[11px] text-neutral-500 font-mono p-3 bg-white/[0.02] border border-dashed border-white/[0.06] rounded text-center">
              No previous runs recorded.
            </div>
          ) : (
            historyRuns.slice(0, 15).map((run) => (
              <div
                key={run.runId}
                onClick={() => handleSelectSession(run.runId)}
                className={`p-2.5 rounded border transition-all cursor-pointer text-left ${activeRunId === run.runId ? "bg-white/[0.08] border-white/[0.2]" : "bg-white/[0.02] border-white/[0.05] hover:bg-white/[0.05]"}`}
              >
                <div className="flex items-center justify-between text-[10px] font-mono">
                  <span className="text-neutral-300 font-semibold truncate mr-2">{run.runId}</span>
                  <span className={`px-1.5 py-0.5 rounded text-[9px] flex-shrink-0 ${run.status === "completed" ? "bg-emerald-950/80 text-emerald-300 border border-emerald-800" : "bg-neutral-800 text-neutral-400"}`}>
                    {run.status}
                  </span>
                </div>
                <div className="text-[11px] text-neutral-300 line-clamp-1 mt-1 font-sans">
                  {run.goal || "Autonomous multi-agent execution"}
                </div>
                <div className="flex items-center gap-2 text-[9px] font-mono text-neutral-500 mt-1">
                  <span>{run.tasks?.length || 0} tasks</span>
                  <span>•</span>
                  <span>{run.durationMs ? `${Math.round(run.durationMs / 1000)}s` : "live"}</span>
                </div>
                {run.status !== "completed" && (
                  <button
                    onClick={(e) => handleRecover(e, run.runId)}
                    disabled={isOrchestrating}
                    className="mt-1.5 w-full py-1 px-2 rounded bg-cyan-950/50 hover:bg-cyan-900/60 border border-cyan-800/60 text-cyan-300 text-[10px] font-mono flex items-center justify-center gap-1 transition-colors disabled:opacity-50"
                  >
                    <RefreshCw className="w-3 h-3" /> Recover &amp; Resume
                  </button>
                )}
              </div>
            ))
          )}
        </div>

        {/* Bottom: Hardware Specs & Model Status Pill */}
        <div className="p-3 border-t border-white/[0.08] bg-[#0c0d12] flex flex-col gap-2">
          <div className="flex items-center justify-between text-[11px] font-mono">
            <span className="text-neutral-400 flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${health.online ? "bg-emerald-500" : "bg-rose-500"}`} />
              {health.online ? "Backend Online" : "Backend Offline"}
            </span>
            <span className="text-neutral-300 font-semibold">{harnessConfig.textBackend.toUpperCase()}</span>
          </div>
          <div className="text-[10px] font-mono text-neutral-400 bg-white/[0.03] p-2 rounded border border-white/[0.06] flex flex-col gap-1">
            <div className="text-white font-medium truncate">AMD Ryzen 9 8940HX (16c)</div>
            <div className="truncate text-neutral-400">RTX 5060 Laptop (8GB VRAM)</div>
            <div className="truncate text-cyan-400">{model} • Port 10086</div>
          </div>
        </div>

      </div>

      {/* ── CENTER PANE: EXECUTION TIMELINE & STICKY BOTTOM COMPOSER ── */}
      <div className="flex-1 flex flex-col bg-[#0c0d12] overflow-hidden">
        
        {/* Top Header Bar */}
        <div className="h-12 border-b border-white/[0.08] bg-[#12141c] px-4 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Network className="w-4 h-4 text-cyan-400" />
              <span className="text-xs font-semibold text-white tracking-wide">Orchestration Session</span>
            </div>
            {activeRunId && (
              <span className="text-[11px] font-mono bg-white/[0.05] border border-white/[0.08] px-2 py-0.5 rounded text-neutral-300">
                {activeRunId}
              </span>
            )}
            {isOrchestrating && (
              <span className="flex items-center gap-1.5 text-[11px] font-mono bg-cyan-950/60 border border-cyan-500/50 text-cyan-300 px-2 py-0.5 rounded animate-pulse">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" />
                Active • {tasks.length} subtasks
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {tasks.length > 0 && (
              <div className="flex items-center gap-2 text-xs font-mono mr-2">
                <span className="text-neutral-400">{completedTasksCount}/{tasks.length} Completed</span>
                <div className="w-24 h-1.5 bg-neutral-800 rounded-full overflow-hidden">
                  <div className="h-full bg-cyan-400 transition-all duration-300" style={{ width: `${progressPercent}%` }} />
                </div>
              </div>
            )}
            {isOrchestrating ? (
              <button
                onClick={handleCancel}
                className="px-3 py-1.5 rounded bg-rose-950/80 border border-rose-700/80 hover:bg-rose-900 text-rose-300 text-xs font-mono flex items-center gap-1.5 transition-colors"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
                Stop
              </button>
            ) : null}
          </div>
        </div>

        {/* Scrollable Timeline Stream */}
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3 font-mono text-xs">
          
          {events.length === 0 && !isOrchestrating ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8 text-neutral-400">
              <div className="w-12 h-12 rounded-lg bg-white/[0.03] border border-white/[0.08] flex items-center justify-center mb-3">
                <Cpu className="w-6 h-6 text-neutral-300" />
              </div>
              <h3 className="text-sm font-semibold text-white mb-1">OpenCode Multi-Agent Studio — Subsystems Operational</h3>
              <p className="text-xs text-neutral-300 max-w-lg mb-3 font-sans leading-relaxed">
                Rebuilt with OpenCode 3-pane architecture, Pi session lifecycle &amp; context compaction, LangGraph durable StateGraph orchestration, and audited tool gateway with git snapshots.
              </p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 max-w-xl text-left my-3 font-mono text-[10px]">
                <div className="p-2 bg-white/[0.02] border border-emerald-500/30 rounded">
                  <div className="text-emerald-400 font-semibold mb-0.5">Context &amp; Compaction</div>
                  <div className="text-neutral-400">Active • Pi Lifecycle Loop</div>
                </div>
                <div className="p-2 bg-white/[0.02] border border-emerald-500/30 rounded">
                  <div className="text-emerald-400 font-semibold mb-0.5">Shared Memory</div>
                  <div className="text-neutral-400">Active • Findings &amp; Blackboard</div>
                </div>
                <div className="p-2 bg-white/[0.02] border border-emerald-500/30 rounded">
                  <div className="text-emerald-400 font-semibold mb-0.5">Tools Gateway</div>
                  <div className="text-neutral-400">Active • FS, Terminal, LSP, Web</div>
                </div>
                <div className="p-2 bg-white/[0.02] border border-emerald-500/30 rounded">
                  <div className="text-emerald-400 font-semibold mb-0.5">Git Snapshots</div>
                  <div className="text-neutral-400">Active • Atomic Pre-Write Stash</div>
                </div>
                <div className="p-2 bg-white/[0.02] border border-emerald-500/30 rounded">
                  <div className="text-emerald-400 font-semibold mb-0.5">Policy &amp; Boundaries</div>
                  <div className="text-neutral-400">Active • PathGuard &amp; Plan/Build</div>
                </div>
                <div className="p-2 bg-white/[0.02] border border-emerald-500/30 rounded">
                  <div className="text-emerald-400 font-semibold mb-0.5">Agent Loops &amp; DAG</div>
                  <div className="text-neutral-400">Active • 15 Specialized Personas</div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 justify-center max-w-xl mt-2 font-mono text-[11px]">
                <button
                  type="button"
                  onClick={() => setGoal("Analyze project architecture and suggest modular refactoring improvements")}
                  className="px-2.5 py-1.5 bg-white/[0.03] hover:bg-white/[0.08] border border-white/[0.08] text-neutral-300 rounded transition-colors text-left"
                >
                  Architecture Analysis
                </button>
                <button
                  type="button"
                  onClick={() => setGoal("Audit codebase security: check path traversal, command injection, and input sanitization")}
                  className="px-2.5 py-1.5 bg-white/[0.03] hover:bg-white/[0.08] border border-white/[0.08] text-neutral-300 rounded transition-colors text-left"
                >
                  Security Audit
                </button>
                <button
                  type="button"
                  onClick={() => setGoal("Perform code diagnostics and generate comprehensive unit tests")}
                  className="px-2.5 py-1.5 bg-white/[0.03] hover:bg-white/[0.08] border border-white/[0.08] text-neutral-300 rounded transition-colors text-left"
                >
                  Code Diagnostics &amp; Tests
                </button>
              </div>
            </div>
          ) : (
            events.map((evt, idx) => {
              const { type, data, timestamp } = evt;

              if (type === "orchestration:start") {
                return (
                  <div key={idx} className="p-3 rounded bg-white/[0.03] border border-white/[0.08] flex flex-col gap-1.5">
                    <div className="flex items-center justify-between text-[11px] text-neutral-400">
                      <span className="font-semibold text-cyan-400 flex items-center gap-1.5">
                        <Play className="w-3.5 h-3.5" /> Mission Dispatched
                      </span>
                      <span>{timestamp}</span>
                    </div>
                    <div className="text-white text-xs font-sans font-medium">{data.goal}</div>
                    <div className="text-[10px] text-neutral-400 flex items-center gap-3">
                      <span>Model: {data.model}</span>
                      <span>Concurrency: {data.concurrency}</span>
                      <span>ID: {data.runId}</span>
                    </div>
                  </div>
                );
              }

              if (type === "orchestration:dag_formed") {
                return (
                  <div key={idx} className="p-3 rounded bg-blue-950/30 border border-blue-800/40 flex flex-col gap-2">
                    <div className="flex items-center justify-between text-[11px] text-blue-300 font-semibold">
                      <span>DAG Formed • {data.tasksCount || data.tasks?.length} Subtasks</span>
                      <span>{timestamp}</span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-1">
                      {data.tasks?.map((t) => (
                        <div key={t.id} className="p-2 bg-[#0c0d12] border border-white/[0.06] rounded text-[11px] flex flex-col gap-1">
                          <div className="flex items-center justify-between">
                            <span className="text-white font-medium truncate">{t.title || t.description}</span>
                            <span className="px-1.5 py-0.5 rounded bg-white/[0.06] text-[9px] text-neutral-300 uppercase">{t.role || t.agentId}</span>
                          </div>
                          {t.dependsOn?.length > 0 && (
                            <div className="text-[10px] text-neutral-400 truncate">
                              Depends on: {t.dependsOn.join(", ")}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              }

              if (type === "task:start") {
                return (
                  <div key={idx} className="p-2.5 rounded bg-cyan-950/20 border border-cyan-800/30 flex items-center justify-between text-[11px]">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
                      <span className="text-cyan-300 font-semibold uppercase">{data.agentId || data.agentName}</span>
                      <span className="text-white">{data.description || data.title}</span>
                    </div>
                    <span className="text-neutral-400 text-[10px]">{timestamp}</span>
                  </div>
                );
              }

              if (type === "task:tool_call") {
                return (
                  <div key={idx} className="p-2.5 rounded bg-[#141722] border border-white/[0.08] flex flex-col gap-1.5 ml-4">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-amber-400 font-semibold flex items-center gap-1.5">
                        <Wrench className="w-3.5 h-3.5" /> Tool Call: {data.tool}
                      </span>
                      <span className="text-neutral-500 text-[10px]">{timestamp}</span>
                    </div>
                    <div className="p-2 bg-[#0c0d12] rounded border border-white/[0.05] text-[10px] text-neutral-300 overflow-x-auto">
                      {JSON.stringify(data.args, null, 2)}
                    </div>
                  </div>
                );
              }

              if (type === "task:tool_result") {
                return (
                  <div key={idx} className="p-2.5 rounded bg-[#121620] border border-white/[0.08] flex flex-col gap-1 ml-4">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className={data.success ? "text-emerald-400 flex items-center gap-1.5" : "text-rose-400 flex items-center gap-1.5"}>
                        {data.success ? <Check className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
                        {data.tool} {data.success ? "Succeeded" : "Failed"}
                      </span>
                      <span className="text-neutral-500 text-[10px]">{timestamp}</span>
                    </div>
                    <div className="p-2 bg-[#0c0d12] rounded border border-white/[0.05] text-[10px] text-neutral-400 max-h-32 overflow-y-auto">
                      {typeof data.output === "object" ? JSON.stringify(data.output, null, 2) : String(data.output || "")}
                    </div>
                  </div>
                );
              }

              if (type === "task:complete") {
                return (
                  <div key={idx} className="p-3 rounded bg-emerald-950/25 border border-emerald-800/40 flex flex-col gap-1.5">
                    <div className="flex items-center justify-between text-[11px] text-emerald-300 font-semibold">
                      <span className="flex items-center gap-1.5">
                        <CheckCircle className="w-3.5 h-3.5" /> Completed: {data.taskId}
                      </span>
                      <span>{timestamp}</span>
                    </div>
                    <div className="text-neutral-300 text-xs font-sans whitespace-pre-wrap max-h-48 overflow-y-auto p-2 bg-[#0c0d12] rounded border border-white/[0.04]">
                      {data.result?.output || (typeof data.result === "string" ? data.result : "Subtask concluded with verified deliverables.")}
                    </div>
                  </div>
                );
              }

              if (type === "task:fail") {
                return (
                  <div key={idx} className="p-3 rounded bg-rose-950/30 border border-rose-800/50 flex flex-col gap-1">
                    <div className="flex items-center justify-between text-[11px] text-rose-300 font-semibold">
                      <span className="flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5" /> Failed: {data.taskId}
                      </span>
                      <span>{timestamp}</span>
                    </div>
                    <div className="text-rose-400 text-xs">{data.error}</div>
                  </div>
                );
              }

              if (type === "orchestration:done") {
                return (
                  <div key={idx} className="p-3.5 rounded bg-white/[0.04] border border-white/[0.12] flex flex-col gap-2">
                    <div className="flex items-center justify-between text-xs font-semibold text-white">
                      <span className="flex items-center gap-1.5 text-emerald-400">
                        <CheckCircle2 className="w-4 h-4" /> Orchestration Completed Successfully
                      </span>
                      <span className="font-mono text-neutral-400">{timestamp}</span>
                    </div>
                    <div className="text-xs text-neutral-300 font-sans">
                      All DAG dependencies satisfied. Staged modifications reconciled into workspace with independent verification.
                    </div>
                  </div>
                );
              }

              return null;
            })
          )}
          <div ref={timelineEndRef} />
        </div>

        {/* ── STICKY BOTTOM OPENCODE COMPOSER ── */}
        <div className="border-t border-white/[0.08] bg-[#12141c] p-3 flex flex-col gap-2.5">
          
          {/* Quick @agent Delegation Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto text-[11px] font-mono scrollbar-none pb-0.5">
            <span className="text-neutral-500 mr-1 flex items-center gap-1">
              <Users className="w-3 h-3" /> Delegate:
            </span>
            {(agents.length > 0 ? agents.slice(0, 8) : [
              { id: "planner", role: "planner" },
              { id: "developer", role: "developer" },
              { id: "debugger", role: "debugger" },
              { id: "reviewer", role: "reviewer" },
              { id: "tester", role: "tester" },
              { id: "architect", role: "architect" },
              { id: "coder", role: "coder" },
              { id: "security", role: "security" }
            ]).map((ag) => (
              <button
                key={ag.id}
                onClick={() => handleInsertAgent(ag.id || ag.role)}
                className="px-2 py-0.5 rounded bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.08] hover:border-white/[0.2] text-neutral-300 transition-colors"
              >
                @{ag.id || ag.role}
              </button>
            ))}
          </div>

          {/* Composer Textarea */}
          <div className="relative bg-[#0c0d12] border border-white/[0.1] rounded-lg p-2.5 focus-within:border-cyan-500/70 transition-colors">
            <textarea
              ref={inputRef}
              rows={2}
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleStartOrchestration();
                }
              }}
              placeholder="Assign high-level objective to multi-agent swarm... use @agent to delegate directly"
              disabled={isOrchestrating}
              className="w-full bg-transparent text-xs text-white placeholder-neutral-500 outline-none resize-none font-sans"
            />

            {/* Bottom Controls Row inside Composer */}
            <div className="flex items-center justify-between pt-2 border-t border-white/[0.05] mt-1 text-[11px] font-mono">
              <div className="flex items-center gap-3">
                {/* Concurrency Selector */}
                <div className="flex items-center gap-1.5 text-neutral-400">
                  <span>Concurrency:</span>
                  <select
                    value={concurrency}
                    onChange={(e) => setConcurrency(Number(e.target.value))}
                    disabled={isOrchestrating}
                    className="bg-white/[0.06] border border-white/[0.1] rounded px-1.5 py-0.5 text-white outline-none"
                  >
                    {[1, 2, 4, 6, 8].map(n => (
                      <option key={n} value={n} className="bg-[#12141c] text-white">{n} agents</option>
                    ))}
                  </select>
                </div>

                {/* Policy Mode Selector */}
                <div className="flex items-center gap-1.5 text-neutral-400">
                  <span>Policy:</span>
                  <select
                    value={policyMode}
                    onChange={(e) => setPolicyMode(e.target.value)}
                    disabled={isOrchestrating}
                    className="bg-white/[0.06] border border-white/[0.1] rounded px-1.5 py-0.5 text-white outline-none"
                  >
                    <option value="auto" className="bg-[#12141c] text-white">Auto (Autonomous)</option>
                    <option value="manual" className="bg-[#12141c] text-white">Manual Approvals</option>
                    <option value="bypass" className="bg-[#12141c] text-white">Bypass (CI)</option>
                  </select>
                </div>

                {/* Sandbox Permission Mode Selector — Ask | Approve for me | Turbo */}
                <div className="flex items-center gap-1.5 text-neutral-400">
                  <Lock className="w-3 h-3 text-neutral-500" />
                  <select
                    value={permissionMode}
                    onChange={(e) => handleSetPermissionMode(e.target.value)}
                    disabled={isOrchestrating}
                    title="Sandbox permission mode: Ask = human approval required, Approve for me = auto-allow file/terminal ops, Turbo = bypass all non-critical checks"
                    className={`bg-white/[0.06] border rounded px-1.5 py-0.5 text-white outline-none transition-colors ${
                      permissionMode === "turbo"
                        ? "border-amber-500/60 text-amber-300"
                        : permissionMode === "approve for me"
                        ? "border-cyan-500/40 text-cyan-300"
                        : "border-white/[0.1] text-neutral-300"
                    }`}
                  >
                    <option value="ask" className="bg-[#12141c] text-white">Ask</option>
                    <option value="approve for me" className="bg-[#12141c] text-white">Approve for me</option>
                    <option value="turbo" className="bg-[#12141c] text-amber-300">Turbo</option>
                  </select>
                </div>

                {/* Model Selector */}
                <div className="flex items-center gap-1.5 text-neutral-400">
                  <span>Model:</span>
                  <span className="text-cyan-400 font-semibold">{model}</span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2">
                {isOrchestrating ? (
                  <button
                    onClick={handleCancel}
                    className="px-3.5 py-1.5 rounded-md bg-rose-600 hover:bg-rose-500 text-white font-medium flex items-center gap-1.5 transition-colors"
                  >
                    <Square className="w-3.5 h-3.5 fill-current" />
                    Stop Swarm
                  </button>
                ) : (
                  <button
                    onClick={handleStartOrchestration}
                    disabled={!goal.trim()}
                    className={`px-3.5 py-1.5 rounded-md font-medium flex items-center gap-1.5 transition-colors ${goal.trim() ? "bg-white text-black hover:bg-neutral-200" : "bg-white/[0.1] text-neutral-500 cursor-not-allowed"}`}
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    Launch Swarm
                  </button>
                )}
              </div>
            </div>
          </div>

        </div>

      </div>

      {/* ── RIGHT PANE: COMMAND CENTER & MULTI-AGENT INSPECTOR ── */}
      <div className="w-96 flex-shrink-0 bg-[#12141c] border-l border-white/[0.08] flex flex-col overflow-hidden">
        
        {/* Tab Header (Horizontal Scrollable Strip) */}
        <div className="flex items-center overflow-x-auto border-b border-white/[0.08] text-[10px] font-mono scrollbar-none bg-[#12141c]">
          {[
            { id: "dag", label: "DAG" },
            { id: "diffs", label: "Diffs", count: stagedDiffs.length },
            { id: "terminal", label: "Terminal" },
            { id: "tools", label: "Tools", count: toolAudits.length },
            { id: "memory", label: "Memory" },
            { id: "security", label: "Security", badge: pendingApprovals.length },
            { id: "verify", label: "Verify" },
            { id: "settings", label: "Config" }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setInspectorTab(tab.id)}
              className={`px-3 py-2.5 whitespace-nowrap transition-colors flex items-center gap-1.5 ${inspectorTab === tab.id ? "bg-[#0c0d12] text-white font-semibold border-b-2 border-cyan-400" : "text-neutral-400 hover:text-white"}`}
            >
              {tab.label}
              {tab.badge > 0 && (
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              )}
              {tab.count !== undefined && tab.count > 0 && (
                <span className="text-[9px] bg-white/[0.06] px-1 py-0.2 rounded text-neutral-400">{tab.count}</span>
              )}
            </button>
          ))}
        </div>

        {/* Tab Contents */}
        <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3 font-mono text-xs">
          
          {/* TAB 1: DAG TASK FLOW */}
          {inspectorTab === "dag" && (
            <div className="flex flex-col gap-2.5">
              <div className="flex items-center justify-between text-[11px] text-neutral-400 px-1">
                <span>Task Graph ({tasks.length})</span>
                <span>{progressPercent}% Complete</span>
              </div>

              {tasks.length === 0 ? (
                <div className="text-[11px] text-neutral-500 p-4 border border-dashed border-white/[0.06] rounded text-center">
                  No active DAG. Dispatch a goal to generate tasks.
                </div>
              ) : (
                tasks.map((task) => {
                  const badge = STATUS_BADGES[task.status] || STATUS_BADGES.pending;
                  const isSelected = selectedTask?.id === task.id;

                  return (
                    <div
                      key={task.id}
                      onClick={() => setSelectedTask(task)}
                      className={`p-3 rounded border transition-all cursor-pointer ${isSelected ? "bg-white/[0.08] border-white/[0.2]" : "bg-[#0c0d12] border-white/[0.06] hover:border-white/[0.12]"}`}
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-white font-medium text-xs truncate">{task.title || task.description}</span>
                        <span className={`px-1.5 py-0.5 rounded text-[9px] border font-mono ${badge.bg}`}>
                          {badge.label}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 text-[10px] text-neutral-400 mb-1">
                        <span className="bg-white/[0.05] px-1.5 py-0.5 rounded uppercase">{task.agentRole || task.agentId}</span>
                        {task.currentStep && (
                          <span>Step {task.currentStep}/{task.maxSteps || 5}</span>
                        )}
                      </div>

                      {task.dependsOn?.length > 0 && (
                        <div className="text-[10px] text-neutral-500">
                          Depends on: {task.dependsOn.join(", ")}
                        </div>
                      )}

                      {isSelected && (task.result || task.output) && (
                        <div className="mt-2 pt-2 border-t border-white/[0.08] text-[10px] text-neutral-300 whitespace-pre-wrap max-h-36 overflow-y-auto font-sans">
                          {typeof (task.result || task.output) === "object" ? JSON.stringify(task.result || task.output, null, 2) : String(task.result || task.output)}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* TAB 2: DIFF REVIEW */}
          {inspectorTab === "diffs" && (
            <div className="flex flex-col gap-2.5">
              <div className="flex items-center justify-between text-[11px] text-neutral-400 px-1">
                <span>Staged File Diffs ({stagedDiffs.length})</span>
                <span className="text-emerald-400 flex items-center gap-1">
                  <Check className="w-3 h-3" /> LSP Validated
                </span>
              </div>

              {stagedDiffs.length === 0 ? (
                <div className="text-[11px] text-neutral-500 p-4 border border-dashed border-white/[0.06] rounded text-center">
                  No staged modifications pending review.
                </div>
              ) : (
                stagedDiffs.map((diff, idx) => (
                  <div
                    key={idx}
                    onClick={() => handleInspectDiff(diff.file)}
                    className="p-3 bg-[#0c0d12] border border-white/[0.06] hover:border-white/[0.2] rounded flex flex-col gap-1.5 cursor-pointer transition-colors"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-white font-medium truncate">{diff.file}</span>
                      <span className="text-[9px] font-mono text-cyan-400 uppercase">{diff.tool}</span>
                    </div>
                    <div className="text-[10px] text-neutral-400 font-mono">
                      Staged at {diff.timestamp} • Click to inspect unified diff
                    </div>
                  </div>
                ))
              )}

              {/* Diff Viewer Modal/Section */}
              {selectedDiff && (
                <div className="mt-2 p-3 bg-[#0c0d12] border border-cyan-500/30 rounded flex flex-col gap-2">
                  <div className="flex items-center justify-between text-xs text-white border-b border-white/[0.08] pb-1.5">
                    <span className="font-semibold truncate">{selectedDiff}</span>
                    <button onClick={() => setSelectedDiff(null)} className="text-neutral-500 hover:text-white">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  {diffContent?.diffLines ? (
                    <div className="text-[10px] font-mono max-h-48 overflow-y-auto flex flex-col gap-0.5">
                      {diffContent.diffLines.map((line, lIdx) => (
                        <div
                          key={lIdx}
                          className={`px-1 py-0.5 whitespace-pre font-mono ${line.type === "added" ? "bg-emerald-950/40 text-emerald-300" : line.type === "deleted" ? "bg-rose-950/40 text-rose-300" : "text-neutral-400"}`}
                        >
                          {line.type === "added" ? "+" : line.type === "deleted" ? "-" : " "} {line.text}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-[10px] text-neutral-500">Inspecting file diff from repository snapshot...</div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: TERMINAL CONSOLE */}
          {inspectorTab === "terminal" && (
            <div className="flex flex-col gap-2 h-full">
              <div className="flex items-center justify-between text-[11px] text-neutral-400 px-1">
                <span className="flex items-center gap-1.5">
                  <Terminal className="w-3.5 h-3.5 text-cyan-400" /> Sandboxed Terminal
                </span>
                <button
                  onClick={() => setTerminalLogs([])}
                  className="text-[10px] text-neutral-500 hover:text-white"
                >
                  Clear
                </button>
              </div>

              {/* Output Display */}
              <div className="flex-1 bg-[#0c0d12] border border-white/[0.08] rounded p-2.5 overflow-y-auto min-h-[220px] max-h-[380px] flex flex-col gap-1 text-[11px] font-mono">
                {terminalLogs.length === 0 ? (
                  <div className="text-neutral-600 italic">Terminal session ready. Execute PowerShell or safe commands.</div>
                ) : (
                  terminalLogs.map((log, lIdx) => (
                    <div
                      key={lIdx}
                      className={`whitespace-pre-wrap ${log.type === "cmd" ? "text-cyan-300 font-semibold" : log.type === "stderr" ? "text-rose-400" : "text-neutral-300"}`}
                    >
                      {log.text}
                    </div>
                  ))
                )}
                <div ref={terminalEndRef} />
              </div>

              {/* Command Input Form */}
              <form onSubmit={handleRunTerminal} className="flex gap-2">
                <input
                  type="text"
                  value={terminalInput}
                  onChange={(e) => setTerminalInput(e.target.value)}
                  placeholder="powershell command..."
                  disabled={isTerminalRunning}
                  className="flex-1 bg-[#0c0d12] border border-white/[0.1] rounded px-2.5 py-1.5 text-xs text-white outline-none focus:border-cyan-400"
                />
                <button
                  type="submit"
                  disabled={!terminalInput.trim() || isTerminalRunning}
                  className="px-3 py-1.5 bg-white text-black font-semibold rounded text-xs disabled:opacity-50 hover:bg-neutral-200 transition-colors"
                >
                  {isTerminalRunning ? "..." : "Run"}
                </button>
              </form>
            </div>
          )}

          {/* TAB 4: TOOL AUDIT & BUNDLES */}
          {inspectorTab === "tools" && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between text-[11px] text-neutral-400 px-1">
                <span>Native Tool Bundles</span>
                <span className="text-[10px] text-neutral-500">35 Audited Tools</span>
              </div>

              {/* Tool Bundles Grid */}
              <div className="grid grid-cols-2 gap-1.5">
                {(toolBundles.length > 0 ? toolBundles : [
                  { id: "filesystem", name: "Filesystem (10)", enabled: true },
                  { id: "terminal", name: "Terminal (3)", enabled: true },
                  { id: "developer", name: "Developer (9)", enabled: true },
                  { id: "lsp", name: "LSP Analyzer (5)", enabled: true },
                  { id: "browser", name: "Browser (8)", enabled: true }
                ]).map((b) => (
                  <div key={b.id} className="p-2 bg-[#0c0d12] border border-white/[0.06] rounded flex items-center justify-between text-[11px]">
                    <span className="text-white truncate">{b.name}</span>
                    <button
                      onClick={async () => {
                        await HarnessService.toggleToolBundle(b.id, !b.enabled);
                        HarnessService.fetchToolBundles().then(setToolBundles);
                      }}
                      className={`w-3 h-3 rounded-full border ${b.enabled ? "bg-emerald-500 border-emerald-400" : "bg-neutral-800 border-neutral-700"}`}
                    />
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between text-[11px] text-neutral-400 px-1 mt-1">
                <span>Live Audit Stream ({toolAudits.length})</span>
              </div>

              {toolAudits.length === 0 ? (
                <div className="text-[11px] text-neutral-500 p-4 border border-dashed border-white/[0.06] rounded text-center">
                  No tool calls captured in this session.
                </div>
              ) : (
                toolAudits.map((audit) => (
                  <div key={audit.id} className="p-2.5 bg-[#0c0d12] border border-white/[0.06] rounded flex flex-col gap-1 text-[11px]">
                    <div className="flex items-center justify-between">
                      <span className="text-amber-300 font-semibold">{audit.tool}</span>
                      <span className={`text-[9px] px-1 rounded ${audit.status === "success" ? "bg-emerald-950 text-emerald-300" : "bg-neutral-800 text-neutral-400"}`}>
                        {audit.status}
                      </span>
                    </div>
                    <div className="text-[10px] text-neutral-400 truncate">
                      {JSON.stringify(audit.args)}
                    </div>
                    {audit.output && (
                      <div className="text-[10px] text-neutral-500 max-h-16 overflow-y-auto">
                        {typeof audit.output === "object" ? JSON.stringify(audit.output) : String(audit.output).slice(0, 150)}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}

          {/* TAB 5: 3-TIER MEMORY & FINDINGS */}
          {inspectorTab === "memory" && (
            <div className="flex flex-col gap-2.5">
              <div className="flex items-center justify-between text-[11px] text-neutral-400 px-1">
                <span>3-Tier Memory Architecture</span>
                <span className="text-[10px] text-cyan-400">{memories.length} entries</span>
              </div>

              {/* Memory Search & Level Filter */}
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={memorySearch}
                  onChange={(e) => setMemorySearch(e.target.value)}
                  placeholder="Search SQLite FTS memory..."
                  className="flex-1 bg-[#0c0d12] border border-white/[0.1] rounded px-2 py-1 text-[11px] text-white outline-none"
                />
                <select
                  value={memoryLevel}
                  onChange={(e) => setMemoryLevel(e.target.value)}
                  className="bg-[#0c0d12] border border-white/[0.1] rounded px-1.5 py-1 text-[11px] text-white outline-none"
                >
                  <option value="all">All</option>
                  <option value="session">Session</option>
                  <option value="project">Project</option>
                  <option value="persistent">Persistent</option>
                </select>
                <button
                  onClick={handleSearchMemory}
                  className="px-2 py-1 bg-white/[0.08] hover:bg-white/[0.15] text-white rounded text-[11px]"
                >
                  Filter
                </button>
              </div>

              {/* Memory Stats Pill */}
              <div className="grid grid-cols-3 gap-1 text-[9px] text-neutral-400 bg-white/[0.02] p-1.5 rounded border border-white/[0.05] text-center">
                <div>Session: <span className="text-white font-semibold">{memoryStats.sessionActive || 0}</span></div>
                <div>Project: <span className="text-white font-semibold">{memoryStats.projectCount || 0}</span></div>
                <div>Persistent: <span className="text-white font-semibold">{memoryStats.persistentCount || 0}</span></div>
              </div>

              {/* Memory Entries */}
              {memories.length === 0 ? (
                <div className="text-[11px] text-neutral-500 p-4 border border-dashed border-white/[0.06] rounded text-center">
                  No memories match current filter.
                </div>
              ) : (
                memories.slice(0, 15).map((mem) => (
                  <div key={mem.id} className="p-2.5 bg-[#0c0d12] border border-white/[0.06] rounded flex flex-col gap-1 text-[11px]">
                    <div className="flex items-center justify-between">
                      <span className="text-cyan-300 font-semibold truncate mr-2">{mem.topic || mem.title || mem.category}</span>
                      <span className="text-[9px] bg-white/[0.06] px-1 rounded text-neutral-400 uppercase">{mem.level || "project"}</span>
                    </div>
                    <div className="text-xs text-neutral-300 font-sans line-clamp-2">
                      {mem.content || mem.conclusion || mem.text}
                    </div>
                    <div className="flex items-center justify-between text-[9px] text-neutral-500 mt-1">
                      <span>Score: {mem.relevanceScore ? Number(mem.relevanceScore).toFixed(2) : "1.00"}</span>
                      <button
                        onClick={() => handleDeleteMemory(mem.id)}
                        className="text-neutral-500 hover:text-rose-400 transition-colors"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* TAB 6: SECURITY, SANDBOX & APPROVALS */}
          {inspectorTab === "security" && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between text-[11px] text-neutral-400 px-1">
                <span>Security Engine &amp; Isolation</span>
                <span className="text-emerald-400 font-semibold flex items-center gap-1">
                  <Shield className="w-3 h-3" /> {securityStatus?.mode?.toUpperCase() || "BUILD"}
                </span>
              </div>

              {/* Sandbox Card */}
              <div className="p-3 bg-[#0c0d12] border border-white/[0.08] rounded flex flex-col gap-1.5 text-[11px]">
                <div className="flex items-center justify-between font-semibold text-white">
                  <span>Isolation Tier:</span>
                  <span className="text-cyan-300 font-mono">
                    {securityStatus?.sandbox?.isolationTier || "host_restricted_process"}
                  </span>
                </div>
                <div className="text-[10px] text-neutral-400">
                  Backend: {securityStatus?.sandbox?.backend || "native_windows"} • WSL2 Docker: {securityStatus?.sandbox?.dockerAvailable ? "Available" : "Restricted native"}
                </div>
                <div className="text-[9px] text-neutral-500 font-mono mt-0.5">
                  PathGuard Root: {securityStatus?.approvedRoots?.[0] || "C:/Users/.../Abyx"}
                </div>
              </div>

              {/* Pending Human-In-The-Loop Approvals */}
              <div className="flex items-center justify-between text-[11px] text-neutral-400 px-1 mt-1">
                <span className="font-semibold text-white flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400" /> Pending Approvals ({pendingApprovals.length})
                </span>
                <button
                  onClick={() => HarnessService.fetchSecurity().then(s => setPendingApprovals(s.approvals))}
                  className="text-[10px] text-neutral-500 hover:text-white"
                >
                  Refresh
                </button>
              </div>

              {pendingApprovals.length === 0 ? (
                <div className="text-[11px] text-neutral-500 p-3 bg-white/[0.02] border border-dashed border-white/[0.06] rounded text-center">
                  Zero pending authorization gates. All operations within policy.
                </div>
              ) : (
                pendingApprovals.map((app) => (
                  <div key={app.id} className="p-3 bg-amber-950/20 border border-amber-800/40 rounded flex flex-col gap-2 text-[11px]">
                    <div className="flex items-center justify-between text-amber-300 font-semibold">
                      <span>Tool: {app.tool}</span>
                      <span className="text-[9px] bg-amber-950 px-1 rounded">{app.operation || "execute"}</span>
                    </div>
                    <div className="text-neutral-300 font-mono text-[10px] truncate">
                      {app.target || JSON.stringify(app.args)}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <button
                        onClick={() => handleResolveApproval(app.id, true, true)}
                        className="flex-1 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-[10px] font-semibold transition-colors"
                      >
                        Allow &amp; Remember
                      </button>
                      <button
                        onClick={() => handleResolveApproval(app.id, false, false)}
                        className="flex-1 py-1 bg-rose-600 hover:bg-rose-500 text-white rounded text-[10px] font-semibold transition-colors"
                      >
                        Deny
                      </button>
                    </div>
                  </div>
                ))
              )}

              {/* Active Workspaces & Locks */}
              <div className="flex items-center justify-between text-[11px] text-neutral-400 px-1 mt-1">
                <span>Task Workspaces ({securityWorkspaces.length})</span>
              </div>
              <div className="flex flex-col gap-1 max-h-32 overflow-y-auto">
                {securityWorkspaces.map((ws, wIdx) => (
                  <div key={wIdx} className="p-2 bg-[#0c0d12] border border-white/[0.06] rounded flex items-center justify-between text-[10px] font-mono">
                    <span className="text-white truncate mr-2">{ws.taskId}</span>
                    <span className="text-cyan-400">{ws.ownerAgentId}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 7: VERIFICATION & BENCHMARKS */}
          {inspectorTab === "verify" && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between text-[11px] text-neutral-400 px-1">
                <span>Independent Verification Engine</span>
              </div>

              {/* Action Buttons */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={handleRunVerification}
                  disabled={isVerifying}
                  className="py-2 bg-white/[0.08] hover:bg-white/[0.15] border border-white/[0.1] text-white rounded text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
                >
                  <CheckSquare className="w-3.5 h-3.5" />
                  {isVerifying ? "Verifying..." : "Run Test Suite"}
                </button>
                <button
                  onClick={handleRunReviewer}
                  disabled={isVerifying}
                  className="py-2 bg-white/[0.08] hover:bg-white/[0.15] border border-white/[0.1] text-white rounded text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
                >
                  <Eye className="w-3.5 h-3.5" />
                  {isVerifying ? "Auditing..." : "Reviewer Audit"}
                </button>
              </div>

              {/* Verification Result Display */}
              {verificationResult && (
                <div className="p-3 bg-[#0c0d12] border border-cyan-500/40 rounded flex flex-col gap-1 text-[11px]">
                  <div className="flex items-center justify-between font-semibold">
                    <span className={verificationResult.ok ? "text-emerald-400" : "text-rose-400"}>
                      {verificationResult.ok ? "Verification Passed" : "Verification Failed"}
                    </span>
                    <span className="text-[10px] text-neutral-500">{verificationResult.summary || "Complete"}</span>
                  </div>
                  <div className="text-[10px] text-neutral-300 whitespace-pre-wrap max-h-36 overflow-y-auto mt-1 font-mono">
                    {JSON.stringify(verificationResult, null, 2)}
                  </div>
                </div>
              )}

              {/* 12 Standard Benchmark Tasks */}
              <div className="flex items-center justify-between text-[11px] text-neutral-400 px-1 mt-2">
                <span>Repeatable Benchmark Suite (12)</span>
              </div>
              <div className="flex flex-col gap-1.5 max-h-64 overflow-y-auto">
                {benchmarkTasks.map((t) => {
                  const res = benchmarkResults[t.id];
                  const isRunning = activeBenchmarkId === t.id;

                  return (
                    <div key={t.id} className="p-2.5 bg-[#0c0d12] border border-white/[0.06] rounded flex flex-col gap-1 text-[11px]">
                      <div className="flex items-center justify-between">
                        <span className="text-white font-medium truncate mr-2">{t.name}</span>
                        <button
                          onClick={() => handleRunBenchmark(t.id)}
                          disabled={isRunning}
                          className="px-2 py-0.5 bg-cyan-950/70 hover:bg-cyan-900 border border-cyan-700/60 text-cyan-300 text-[10px] rounded transition-colors disabled:opacity-50"
                        >
                          {isRunning ? "Running..." : "Profile"}
                        </button>
                      </div>
                      <div className="text-[10px] text-neutral-400 line-clamp-1">{t.description}</div>
                      {res && (
                        <div className="mt-1 pt-1 border-t border-white/[0.05] text-[9px] font-mono text-emerald-400 flex items-center justify-between">
                          <span>Elapsed: {res.durationMs}ms</span>
                          <span>Tokens: {res.metrics?.tokenConsumption?.total || 0}</span>
                          <span>RAM: {res.metrics?.memoryUsage?.rssMb || 0}MB</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 8: HARDWARE & MODEL SETTINGS */}
          {inspectorTab === "settings" && (
            <div className="flex flex-col gap-3 font-sans text-xs">
              
              {/* Profile Bar */}
              <div className="p-2.5 bg-[#0c0d12] border border-white/[0.08] rounded flex flex-col gap-1.5">
                <div className="flex items-center justify-between font-mono text-[11px]">
                  <span className="text-white font-semibold flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-400" /> Balanced PC
                  </span>
                  <span className="text-neutral-400">Profile: {harnessConfig.performanceProfile}</span>
                </div>
                <div className="text-[10px] font-mono text-neutral-400">
                  AMD Ryzen 9 8940HX • 16 cores • 31.05 GB RAM • NVIDIA RTX 5060 (7.93 GB VRAM)
                </div>
                <div className="text-[9px] font-mono text-neutral-500">
                  Recommended: Context 4096, Threads 8, KV q8_0, Batch 512, Profile balanced
                </div>
              </div>

              {/* System Prompt */}
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-medium text-white">System Prompt</label>
                <textarea
                  rows={2}
                  value={harnessConfig.systemPrompt}
                  onChange={(e) => setHarnessConfig({ ...harnessConfig, systemPrompt: e.target.value })}
                  className="bg-[#0c0d12] border border-white/[0.1] rounded p-2 text-xs text-white outline-none resize-none"
                />
              </div>

              {/* Context Size */}
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-white font-medium">Context Size</span>
                  <span className="font-mono text-cyan-400">{harnessConfig.contextSize}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={32768}
                  step={1024}
                  value={harnessConfig.contextSize}
                  onChange={(e) => setHarnessConfig({ ...harnessConfig, contextSize: Number(e.target.value) })}
                  className="w-full accent-cyan-400"
                />
                <span className="text-[10px] text-neutral-500">0 uses model default (up to 256k / 262,144 for Abyx)</span>
              </div>

              {/* Temperature */}
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-white font-medium">Temperature</span>
                  <span className="font-mono text-cyan-400">{harnessConfig.temperature}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1.5}
                  step={0.05}
                  value={harnessConfig.temperature}
                  onChange={(e) => setHarnessConfig({ ...harnessConfig, temperature: Number(e.target.value) })}
                  className="w-full accent-cyan-400"
                />
                <span className="text-[10px] text-neutral-500">Lower is focused, higher is more creative. Recommended 0.7</span>
              </div>

              {/* Performance Profile */}
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-white">Performance Profile</span>
                <div className="grid grid-cols-4 gap-1 text-[10px] font-mono">
                  {["potato", "balanced", "high", "custom"].map((p) => (
                    <button
                      key={p}
                      onClick={() => setHarnessConfig({ ...harnessConfig, performanceProfile: p })}
                      className={`py-1 rounded capitalize border transition-colors ${harnessConfig.performanceProfile === p ? "bg-white/[0.15] border-white/[0.3] text-white" : "bg-[#0c0d12] border-white/[0.06] text-neutral-400"}`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              {/* Text Backend */}
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-white">Text Backend</span>
                <div className="grid grid-cols-3 gap-1 text-[10px] font-mono">
                  {["cuda", "vulkan", "cpu"].map((b) => (
                    <button
                      key={b}
                      onClick={() => setHarnessConfig({ ...harnessConfig, textBackend: b })}
                      className={`py-1 rounded uppercase border transition-colors ${harnessConfig.textBackend === b ? "bg-white/[0.15] border-white/[0.3] text-white" : "bg-[#0c0d12] border-white/[0.06] text-neutral-400"}`}
                    >
                      {b}
                    </button>
                  ))}
                </div>
              </div>

              {/* Save Settings Button */}
              <div className="pt-2 flex flex-col gap-1">
                <button
                  onClick={handleSaveSettings}
                  disabled={isSavingConfig}
                  className="w-full py-2 bg-white text-black font-semibold rounded text-xs hover:bg-neutral-200 transition-colors"
                >
                  {isSavingConfig ? "Saving..." : "Save Harness Settings"}
                </button>
                {configSaveNotice && (
                  <div className="text-[10px] text-emerald-400 font-mono text-center">
                    {configSaveNotice}
                  </div>
                )}
              </div>

            </div>
          )}

        </div>

      </div>

    </div>
  );
}
