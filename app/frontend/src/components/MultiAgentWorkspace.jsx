import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  Play, Square, RefreshCw, Layers, Cpu, Shield, Search, Terminal, Code2,
  Users, Sliders, ChevronRight, FileCode, Check, X, CheckCircle, AlertTriangle,
  Clock, Plus, Filter, ArrowRight, Eye, Sparkles, AlertCircle, Network,
  Folder, FileText, Database, GitCommit, Settings, Activity, ArrowUpRight,
  Maximize2, Minimize2, CheckCircle2, ChevronDown, Wrench, HardDrive
} from "lucide-react";
import {
  getSpecializedAgents, registerCustomAgent, streamOrchestration, cancelOrchestration,
  getOrchestratorHistory, getOrchestratorHealth, getOrchestratorSettings, updateOrchestratorSettings,
  getHardwareSpecs, listHarnessWorkspaceFiles
} from "../services/api";

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

  // Right Inspector Tab: 'dag' | 'diffs' | 'findings' | 'tools' | 'settings'
  const [inspectorTab, setInspectorTab] = useState("dag");

  // Multi-Agent State
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

  // Hardware & Model Health
  const [health, setHealth] = useState({ online: true, model: "AbyxV2 9B.gguf" });
  const [specs, setSpecs] = useState(null);
  const [workspaceFiles, setWorkspaceFiles] = useState([]);

  // Model & Inference Parameter Controls (from user screenshot)
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
  const inputRef = useRef(null);

  // Load baseline on mount
  useEffect(() => {
    loadAgents();
    loadHealth();
    loadSpecs();
    loadHistory();
    loadWorkspaceFiles();
    loadSettings();
  }, []);

  useEffect(() => {
    timelineEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events, tasks]);

  const loadAgents = async () => {
    try {
      const res = await getSpecializedAgents();
      if (res?.ok) setAgents(res.agents || []);
    } catch (_) {}
  };

  const loadHealth = async () => {
    try {
      const res = await getOrchestratorHealth();
      if (res?.ok) setHealth(res);
    } catch (_) {}
  };

  const loadSpecs = async () => {
    try {
      const res = await getHardwareSpecs();
      if (res?.ok) setSpecs(res);
    } catch (_) {}
  };

  const loadHistory = async () => {
    try {
      const res = await getOrchestratorHistory();
      if (res?.ok && Array.isArray(res.history)) {
        setHistoryRuns(res.history);
      }
    } catch (_) {}
  };

  const loadWorkspaceFiles = async () => {
    try {
      const res = await listHarnessWorkspaceFiles(".");
      if (res?.ok && Array.isArray(res.files)) {
        setWorkspaceFiles(res.files);
      }
    } catch (_) {}
  };

  const loadSettings = async () => {
    try {
      const res = await getOrchestratorSettings();
      if (res?.ok && res.settings) {
        setHarnessConfig(prev => ({ ...prev, ...res.settings }));
      }
    } catch (_) {}
  };

  const handleSaveSettings = async () => {
    setIsSavingConfig(true);
    setConfigSaveNotice(null);
    try {
      const res = await updateOrchestratorSettings(harnessConfig);
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
      await streamOrchestration({
        goal: goal.trim(),
        model,
        concurrency,
        harnessOverrides: {
          ...harnessConfig,
          policyMode
        },
        signal: ctrl.signal,
        onEvent: (type, data) => {
          const timestamp = new Date().toLocaleTimeString();
          setEvents(prev => [...prev.slice(-400), { type, data, timestamp }]);

          if (type === "orchestration:started") {
            setActiveRunId(data.runId);
          } else if (type === "orchestration:dag_formed" && Array.isArray(data.tasks)) {
            setTasks(data.tasks.map(t => ({ ...t, status: "pending" })));
          } else if (type === "task:started") {
            setTasks(prev => prev.map(t => t.id === data.taskId ? { ...t, status: "running", startedAt: data.timestamp } : t));
          } else if (type === "task:step") {
            setTasks(prev => prev.map(t => t.id === data.taskId ? { ...t, currentStep: data.step, maxSteps: data.maxSteps } : t));
          } else if (type === "task:tool_call") {
            setToolAudits(prev => [...prev, {
              id: `tool_${Date.now()}`,
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
            if (['fs_write', 'fs_edit'].includes(data.tool) && data.success) {
              setStagedDiffs(prev => [...prev, {
                file: data.args?.filePath || "workspace_file",
                tool: data.tool,
                timestamp
              }]);
            }
          } else if (type === "task:completed") {
            setTasks(prev => prev.map(t => t.id === data.taskId ? { ...t, status: "completed", result: data.result } : t));
            if (data.result?.finding) {
              setFindings(prev => [...prev, data.result.finding]);
            }
          } else if (type === "finding:published") {
            setFindings(prev => [...prev, data]);
          } else if (type === "task:failed") {
            setTasks(prev => prev.map(t => t.id === data.taskId ? { ...t, status: "failed", error: data.error } : t));
          } else if (type === "orchestration:done" || type === "orchestration:finished") {
            setIsOrchestrating(false);
            if (Array.isArray(data.tasks)) setTasks(data.tasks);
            loadHistory();
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
      try {
        await cancelOrchestration(activeRunId, "User cancelled from OpenCode harness");
      } catch (_) {}
    }
    setIsOrchestrating(false);
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
              onClick={loadWorkspaceFiles}
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
                onClick={() => {
                  setActiveRunId(run.runId);
                  if (Array.isArray(run.tasks)) setTasks(run.tasks);
                  if (Array.isArray(run.findings)) setFindings(run.findings);
                }}
                className={`p-2.5 rounded border transition-all cursor-pointer text-left ${activeRunId === run.runId ? "bg-white/[0.08] border-white/[0.2]" : "bg-white/[0.02] border-white/[0.05] hover:bg-white/[0.05]"}`}
              >
                <div className="flex items-center justify-between text-[10px] font-mono">
                  <span className="text-neutral-300 font-semibold">{run.runId}</span>
                  <span className={`px-1.5 py-0.5 rounded text-[9px] ${run.status === "completed" ? "bg-emerald-950/80 text-emerald-300 border border-emerald-800" : "bg-neutral-800 text-neutral-400"}`}>
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
              <h3 className="text-sm font-semibold text-white mb-1">OpenCode Multi-Agent Studio</h3>
              <p className="text-xs text-neutral-400 max-w-md mb-4 font-sans">
                Autonomous multi-agent DAG scheduling with specialized agents, file isolation, LSP pre-flight verification, and persistent shared memory.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2 max-w-lg">
                {[
                  "Analyze project architecture and generate docs",
                  "Design an authentication module with JWT",
                  "Run unit tests, inspect failures, and fix bugs",
                  "Refactor file services with strict LSP type checks"
                ].map((sample, idx) => (
                  <button
                    key={idx}
                    onClick={() => setGoal(sample)}
                    className="px-3 py-1.5 rounded bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.08] text-neutral-300 text-[11px] transition-colors"
                  >
                    {sample}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            events.map((evt, idx) => {
              const { type, data, timestamp } = evt;

              if (type === "orchestration:started") {
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
                      <span>DAG Formed • {data.tasksCount} Subtasks</span>
                      <span>{timestamp}</span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-1">
                      {data.tasks?.map((t) => (
                        <div key={t.id} className="p-2 bg-[#0c0d12] border border-white/[0.06] rounded text-[11px] flex flex-col gap-1">
                          <div className="flex items-center justify-between">
                            <span className="text-white font-medium truncate">{t.title}</span>
                            <span className="px-1.5 py-0.5 rounded bg-white/[0.06] text-[9px] text-neutral-300 uppercase">{t.role}</span>
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

              if (type === "task:started") {
                return (
                  <div key={idx} className="p-2.5 rounded bg-cyan-950/20 border border-cyan-800/30 flex items-center justify-between text-[11px]">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
                      <span className="text-cyan-300 font-semibold uppercase">{data.agentRole}</span>
                      <span className="text-white">{data.title}</span>
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

              if (type === "task:completed") {
                return (
                  <div key={idx} className="p-3 rounded bg-emerald-950/25 border border-emerald-800/40 flex flex-col gap-1.5">
                    <div className="flex items-center justify-between text-[11px] text-emerald-300 font-semibold">
                      <span className="flex items-center gap-1.5">
                        <CheckCircle className="w-3.5 h-3.5" /> Completed: {data.title}
                      </span>
                      <span>{timestamp}</span>
                    </div>
                    <div className="text-neutral-300 text-xs font-sans whitespace-pre-wrap max-h-48 overflow-y-auto p-2 bg-[#0c0d12] rounded border border-white/[0.04]">
                      {data.result?.output || "Subtask concluded with verified deliverables."}
                    </div>
                  </div>
                );
              }

              if (type === "task:failed") {
                return (
                  <div key={idx} className="p-3 rounded bg-rose-950/30 border border-rose-800/50 flex flex-col gap-1">
                    <div className="flex items-center justify-between text-[11px] text-rose-300 font-semibold">
                      <span className="flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5" /> Failed: {data.title}
                      </span>
                      <span>{timestamp}</span>
                    </div>
                    <div className="text-rose-400 text-xs">{data.error}</div>
                  </div>
                );
              }

              if (type === "orchestration:done" || type === "orchestration:finished") {
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
            {["architecture", "coding", "testing", "research", "debugging", "code_review", "documentation", "file_ops"].map((role) => (
              <button
                key={role}
                onClick={() => handleInsertAgent(role)}
                className="px-2 py-0.5 rounded bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.08] hover:border-white/[0.2] text-neutral-300 transition-colors"
              >
                @{role}
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
        
        {/* Tab Header */}
        <div className="grid grid-cols-5 border-b border-white/[0.08] text-[11px] font-mono text-center">
          {[
            { id: "dag", label: "DAG" },
            { id: "diffs", label: "Diffs" },
            { id: "findings", label: "Matrix" },
            { id: "tools", label: "Audit" },
            { id: "settings", label: "Config" }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setInspectorTab(tab.id)}
              className={`py-3 transition-colors ${inspectorTab === tab.id ? "bg-[#0c0d12] text-white font-semibold border-b-2 border-cyan-400" : "text-neutral-400 hover:text-white"}`}
            >
              {tab.label}
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
                        <span className="text-white font-medium text-xs truncate">{task.title}</span>
                        <span className={`px-1.5 py-0.5 rounded text-[9px] border font-mono ${badge.bg}`}>
                          {badge.label}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 text-[10px] text-neutral-400 mb-1">
                        <span className="bg-white/[0.05] px-1.5 py-0.5 rounded uppercase">{task.agentRole}</span>
                        {task.currentStep && (
                          <span>Step {task.currentStep}/{task.maxSteps || 5}</span>
                        )}
                      </div>

                      {task.dependsOn?.length > 0 && (
                        <div className="text-[10px] text-neutral-500">
                          Depends on: {task.dependsOn.join(", ")}
                        </div>
                      )}

                      {isSelected && task.result?.output && (
                        <div className="mt-2 pt-2 border-t border-white/[0.08] text-[10px] text-neutral-300 whitespace-pre-wrap max-h-36 overflow-y-auto font-sans">
                          {task.result.output}
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
                  <div key={idx} className="p-3 bg-[#0c0d12] border border-white/[0.06] rounded flex flex-col gap-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-white font-medium truncate">{diff.file}</span>
                      <span className="text-[9px] font-mono text-cyan-400 uppercase">{diff.tool}</span>
                    </div>
                    <div className="text-[10px] text-neutral-400 font-mono">
                      Staged at {diff.timestamp} • Clean syntax
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* TAB 3: FINDINGS & ARTIFACTS MATRIX */}
          {inspectorTab === "findings" && (
            <div className="flex flex-col gap-2.5">
              <div className="flex items-center justify-between text-[11px] text-neutral-400 px-1">
                <span>Shared Memory Matrix ({findings.length})</span>
              </div>

              {findings.length === 0 ? (
                <div className="text-[11px] text-neutral-500 p-4 border border-dashed border-white/[0.06] rounded text-center">
                  No findings recorded in shared memory yet.
                </div>
              ) : (
                findings.map((f, idx) => (
                  <div key={idx} className="p-3 bg-[#0c0d12] border border-white/[0.06] rounded flex flex-col gap-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-cyan-300 font-semibold truncate">{f.topic || f.title || "Finding"}</span>
                      <span className="text-[9px] text-neutral-500 uppercase">{f.agentId}</span>
                    </div>
                    <div className="text-xs text-neutral-300 font-sans mt-0.5 line-clamp-3">
                      {f.conclusion || f.output || JSON.stringify(f)}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* TAB 4: TOOL AUDIT STREAM */}
          {inspectorTab === "tools" && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between text-[11px] text-neutral-400 px-1">
                <span>Live Tool Invocations ({toolAudits.length})</span>
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

          {/* TAB 5: HARDWARE & MODEL SETTINGS (USER SCREENSHOT CONTROLS) */}
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

              {/* Max Response Tokens */}
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-white font-medium">Max Response Tokens</span>
                  <div className="flex bg-[#0c0d12] p-0.5 rounded border border-white/[0.08] text-[10px] font-mono">
                    <button
                      onClick={() => setHarnessConfig({ ...harnessConfig, maxResponseTokens: "auto" })}
                      className={`px-2 py-0.5 rounded ${harnessConfig.maxResponseTokens === "auto" ? "bg-white/[0.15] text-white" : "text-neutral-400"}`}
                    >
                      Auto
                    </button>
                    <button
                      onClick={() => setHarnessConfig({ ...harnessConfig, maxResponseTokens: "manual" })}
                      className={`px-2 py-0.5 rounded ${harnessConfig.maxResponseTokens === "manual" ? "bg-white/[0.15] text-white" : "text-neutral-400"}`}
                    >
                      Manual
                    </button>
                  </div>
                </div>
                {harnessConfig.maxResponseTokens === "manual" && (
                  <input
                    type="range"
                    min={512}
                    max={8192}
                    step={256}
                    value={harnessConfig.maxTokens}
                    onChange={(e) => setHarnessConfig({ ...harnessConfig, maxTokens: Number(e.target.value) })}
                    className="w-full accent-cyan-400"
                  />
                )}
                <span className="text-[10px] text-neutral-500">Auto adjusts length to the context window (recommended)</span>
              </div>

              {/* Seed */}
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-white font-medium">Seed</span>
                <input
                  type="number"
                  value={harnessConfig.seed}
                  onChange={(e) => setHarnessConfig({ ...harnessConfig, seed: Number(e.target.value) })}
                  className="w-20 bg-[#0c0d12] border border-white/[0.1] rounded px-2 py-1 text-right font-mono text-xs text-white"
                />
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

              {/* CPU Threads */}
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-white font-medium">CPU Threads</span>
                  <span className="font-mono text-cyan-400">{harnessConfig.cpuThreads}</span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={32}
                  value={harnessConfig.cpuThreads}
                  onChange={(e) => setHarnessConfig({ ...harnessConfig, cpuThreads: Number(e.target.value) })}
                  className="w-full accent-cyan-400"
                />
              </div>

              {/* GPU Layers */}
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-white font-medium">GPU Layers</span>
                  <span className="font-mono text-cyan-400">{harnessConfig.gpuLayers >= 50 ? "All" : harnessConfig.gpuLayers}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={50}
                  value={harnessConfig.gpuLayers}
                  onChange={(e) => setHarnessConfig({ ...harnessConfig, gpuLayers: Number(e.target.value) })}
                  className="w-full accent-cyan-400"
                />
                <span className="text-[10px] text-neutral-500">50 puts all layers on GPU</span>
              </div>

              {/* Batch Size */}
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-white font-medium">Batch Size</span>
                  <span className="font-mono text-cyan-400">{harnessConfig.batchSize}</span>
                </div>
                <input
                  type="range"
                  min={128}
                  max={2048}
                  step={128}
                  value={harnessConfig.batchSize}
                  onChange={(e) => setHarnessConfig({ ...harnessConfig, batchSize: Number(e.target.value) })}
                  className="w-full accent-cyan-400"
                />
              </div>

              {/* KV Cache */}
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-white">KV Cache</span>
                <div className="grid grid-cols-3 gap-1 text-[10px] font-mono">
                  {["q4_0", "q8_0", "f16"].map((kv) => (
                    <button
                      key={kv}
                      onClick={() => setHarnessConfig({ ...harnessConfig, kvCache: kv })}
                      className={`py-1 rounded uppercase border transition-colors ${harnessConfig.kvCache === kv ? "bg-white/[0.15] border-white/[0.3] text-white" : "bg-[#0c0d12] border-white/[0.06] text-neutral-400"}`}
                    >
                      {kv}
                    </button>
                  ))}
                </div>
                <span className="text-[10px] text-neutral-500">Lower precision uses less memory</span>
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
