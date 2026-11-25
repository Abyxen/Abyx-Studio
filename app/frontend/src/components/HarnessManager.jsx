import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Cpu, RefreshCw, CheckCircle2, ShieldCheck, Box, Layers, Terminal, Globe, Wrench,
  HardDrive, Brain, Play, Square, AlertCircle, FileText, FolderPlus, FilePlus, Plug,
  Trash2, Move, Download, ExternalLink, Search, Sparkles, Check, X, Eye, FileCode, Users, Sliders, Network
} from "lucide-react";
import SubagentsHub from "./SubagentsHub";
import TerminalConsole from "./TerminalConsole";
import DiffViewer from "./DiffViewer";
import HarnessControlsDrawer from "./HarnessControlsDrawer";
import MultiAgentWorkspace from "./MultiAgentWorkspace";
import {
  getHarnessStatus, getHarnessPlugins, getHarnessSeams,
  startAgentRun, streamAgentRun, listAgentRuns, getPendingApprovals, resolveAgentApproval, cancelAgentRun,
  listHarnessWorkspaceFiles, saveWorkspaceFile, createWorkspaceFolder, moveWorkspacePath, deleteWorkspacePath,
  generateWorkspaceFile, openWorkspacePath,
  searchBrowserWeb, browseWebPage, openSystemBrowser,
  getSkillsCatalog, executeResearchWorkflow, getAgentTools, setAgentToolEnabled, getAgentToolBundles, setAgentToolBundleEnabled,
  getMcpServers, addMcpServer, toggleMcpServer, deleteMcpServer, connectMcpServer, disconnectMcpServer,
  getExtensions, inspectExtension, installExtension, updateExtension, setExtensionEnabled, uninstallExtension
} from "../services/api";
import "../styles/abyx.css";

const RUN_STATUS_LABELS = {
  pending: "Queued",
  running: "Working",
  waiting_approval: "Waiting for your approval",
  paused: "Paused",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled"
};

const RUN_STATUS_COLORS = {
  completed: "var(--md-sys-color-success)",
  waiting_approval: "#eab308",
  failed: "var(--md-sys-color-error)",
  cancelled: "var(--md-sys-color-outline)",
  running: "var(--md-sys-color-primary)",
  pending: "var(--md-sys-color-outline)",
  paused: "var(--md-sys-color-outline)"
};

export default function HarnessManager({ showAlert, onOpenBrowser, activeProject }) {
  const [activeTab, setActiveTab] = useState("multiagent");
  const [loading, setLoading] = useState(false);

  // 1. Harness Status & Seams
  const [status, setStatus] = useState(null);
  const [plugins, setPlugins] = useState([]);
  const [seams, setSeams] = useState([]);

  // 2. Agent Tasks
  const [isControlsOpen, setIsControlsOpen] = useState(false);
  const [taskInput, setTaskInput] = useState("");
  const [taskModel, setTaskModel] = useState("auto");
  const [maxSteps, setMaxSteps] = useState(8);
  const [activeRun, setActiveRun] = useState(null);
  const [runHistory, setRunHistory] = useState([]);
  const [pendingApprovals, setPendingApprovals] = useState([]);
  const [isExecuting, setIsExecuting] = useState(false);
  const agentAbortRef = useRef(null);

  // 3. Workspace Files
  const [workspaceFiles, setWorkspaceFiles] = useState([]);
  const [fileFilter, setFileFilter] = useState("");
  const [showNewFolderModal, setShowNewFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [showNewFileModal, setShowNewFileModal] = useState(false);
  const [newFileName, setNewFileName] = useState("");
  const [newFileContent, setNewFileContent] = useState("");
  const [showGenerateDocModal, setShowGenerateDocModal] = useState(false);
  const [docTitle, setDocTitle] = useState("");
  const [docFormat, setDocFormat] = useState("pdf");
  const [docContent, setDocContent] = useState("");
  const [docFileName, setDocFileName] = useState("document.pdf");

  // 4. Browser & Web
  const [browserQuery, setBrowserQuery] = useState("");
  const [browserUrl, setBrowserUrl] = useState("https://en.wikipedia.org/wiki/Artificial_intelligence");
  const [searchResults, setSearchResults] = useState([]);
  const [pageContent, setPageContent] = useState(null);
  const [browserLoading, setBrowserLoading] = useState(false);

  // 5. Skills & Research
  const [skills, setSkills] = useState([]);
  const [registeredTools, setRegisteredTools] = useState([]);
  const [registeredBundles, setRegisteredBundles] = useState([]);
  const [mcpState, setMcpState] = useState({ servers: {}, tools: [], status: {} });
  const [mcpName, setMcpName] = useState("");
  const [mcpCommand, setMcpCommand] = useState("");
  const [mcpArgs, setMcpArgs] = useState("");
  const [extensions, setExtensions] = useState([]);
  const [skillFilter, setSkillFilter] = useState("");
  const [researchTopic, setResearchTopic] = useState("");
  const [researchResult, setResearchResult] = useState(null);
  const [researchLoading, setResearchLoading] = useState(false);

  // Polling ref
  const pollTimerRef = useRef(null);

  // Initial Data Load
  const loadBaseData = useCallback(async () => {
    try {
      const [statusRes, pluginsRes, seamsRes] = await Promise.all([
        getHarnessStatus().catch(() => ({ ok: true, harness: "Abyx Agent Harness", version: "1.1.0" })),
        getHarnessPlugins().catch(() => ({ ok: true, plugins: [] })),
        getHarnessSeams().catch(() => ({ ok: true, seams: [] })),
      ]);
      setStatus(statusRes);
      setPlugins(pluginsRes.plugins || []);
      setSeams(seamsRes.seams || []);
      const mcpRes = await getMcpServers().catch(() => ({ servers: {}, tools: [], status: {} }));
      setMcpState({ servers: mcpRes.servers || {}, tools: mcpRes.tools || [], status: mcpRes.status || {} });
      const extensionRes = await getExtensions().catch(() => ({ extensions: [] }));
      setExtensions(extensionRes.extensions || []);
    } catch (err) {
      console.warn("Base harness telemetry load warning:", err.message);
    }
  }, []);

  const loadAgentRuns = useCallback(async () => {
    try {
      const [runsRes, apprRes] = await Promise.all([
        listAgentRuns().catch(() => ({ ok: true, activeRuns: [], history: [] })),
        getPendingApprovals().catch(() => ({ ok: true, approvals: [] })),
      ]);
      setRunHistory(runsRes.history || []);
      setPendingApprovals(apprRes.approvals || []);
      if (runsRes.activeRuns && runsRes.activeRuns.length > 0 && !activeRun) {
        setActiveRun(runsRes.activeRuns[0]);
      }
    } catch (err) {
      console.warn("Agent runs load error:", err.message);
    }
  }, [activeRun]);

  const loadFiles = useCallback(async () => {
    try {
      const res = await listHarnessWorkspaceFiles();
      if (res.ok) setWorkspaceFiles(res.files || res.entries || []);
    } catch (err) {
      console.warn("Workspace files load error:", err.message);
    }
  }, []);

  const loadSkills = useCallback(async () => {
    try {
      const res = await getSkillsCatalog();
      if (res.ok) setSkills(res.skills || []);
    } catch (err) {
      console.warn("Skills catalog load error:", err.message);
    }
  }, []);

  const loadTools = useCallback(async () => {
    try {
      const [res, bundleRes] = await Promise.all([getAgentTools(), getAgentToolBundles()]);
      if (res.ok) setRegisteredTools(res.tools || []);
      if (bundleRes.ok) setRegisteredBundles(bundleRes.bundles || []);
    } catch (err) {
      console.warn("Tool registry load error:", err.message);
    }
  }, []);

  useEffect(() => {
    loadBaseData();
    loadAgentRuns();
    loadFiles();
    loadSkills();
    loadTools();
  }, [loadBaseData, loadAgentRuns, loadFiles, loadSkills, loadTools]);

  // Periodic polling for active run / approvals
  useEffect(() => {
    if (isExecuting) {
      pollTimerRef.current = setInterval(() => {
        loadAgentRuns();
      }, 1500);
    }
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [isExecuting, loadAgentRuns]);

  // Run Agent Task with Real-time SSE Streaming
  const handleStartTask = async () => {
    if (!taskInput.trim()) {
      showAlert?.({ title: "Required", message: "Please enter a task description.", danger: true });
      return;
    }
    setIsExecuting(true);
    const abortCtrl = new AbortController();
    agentAbortRef.current = abortCtrl;

    const initialRun = {
      id: `run_${Date.now()}`,
      goal: taskInput.trim(),
      model: taskModel,
      status: "running",
      startTime: new Date().toISOString(),
      steps: [],
      finalOutput: ""
    };
    setActiveRun(initialRun);

    try {
      await streamAgentRun({
        task: taskInput.trim(),
        model: taskModel,
        max_steps: maxSteps,
        sessionId: `studio_${Date.now()}`,
        signal: abortCtrl.signal,
        onEvent: (eventType, eventData) => {
          if (!eventData || typeof eventData !== "object") return;
          const event = { ...eventData, type: eventType };
        const runStatusByEvent = {
          run_started: "running",
          approval_required: "waiting_approval",
          approval_granted: "running",
          run_completed: event.status,
          run_cancelled: "cancelled",
          run_error: "failed",
          error: "failed"
        };
        setActiveRun((prev) => {
          if (!prev) return prev;
          const timeline = event.type === "token"
            ? (prev.timeline || [])
            : [...(prev.timeline || []), event].slice(-150);
          return {
            ...prev,
            timeline,
            status: runStatusByEvent[event.type] || prev.status,
            stepsExecuted: event.stepsExecuted ?? prev.stepsExecuted,
            toolsExecuted: event.toolsExecuted ?? prev.toolsExecuted,
            finalOutput: event.output || prev.finalOutput,
            error: event.error || prev.error
          };
        });
          if (event.type === "token" && event.token) {
            setActiveRun((prev) => prev ? { ...prev, finalOutput: (prev.finalOutput || "") + event.token } : prev);
          } else if (event.type === "step_started") {
            setActiveRun((prev) => {
              if (!prev) return prev;
              const steps = [...(prev.steps || []), {
                stepIndex: event.stepIndex || (prev.steps?.length || 0) + 1,
                thought: event.thought || "",
                status: "running",
                toolCalls: []
              }];
              return { ...prev, steps };
            });
          } else if (event.type === "tool_call") {
            setActiveRun((prev) => {
              if (!prev) return prev;
              const steps = [...(prev.steps || [])];
              const lastStep = steps[steps.length - 1] || { stepIndex: 1, toolCalls: [] };
              lastStep.toolCalls = [...(lastStep.toolCalls || []), {
                name: event.toolName,
                args: event.args,
                status: "running"
              }];
              if (!steps.length) steps.push(lastStep);
              return { ...prev, steps };
            });
          } else if (event.type === "tool_result") {
            setActiveRun((prev) => {
              if (!prev) return prev;
              const steps = [...(prev.steps || [])];
              const lastStep = steps[steps.length - 1];
              if (lastStep && lastStep.toolCalls && lastStep.toolCalls.length > 0) {
                const lastCall = lastStep.toolCalls[lastStep.toolCalls.length - 1];
                lastCall.status = "completed";
                lastCall.result = event.result;
              }
              return { ...prev, steps };
            });
          } else if (event.type === "run_done") {
            setActiveRun((prev) => prev ? {
              ...prev,
              status: event.status || "completed",
              stepsExecuted: event.stepsExecuted,
              toolsExecuted: event.toolsExecuted,
              finalOutput: event.output || prev.finalOutput,
              error: event.error || prev.error
            } : prev);
            if (event.status === "completed") {
              showAlert?.({ title: "Task Completed", message: "Agent completed task successfully." });
            } else if (event.status === "failed") {
              showAlert?.({ title: "Task Failed", message: event.error || "The agent run failed.", danger: true });
            }
          }
        }
      });
      loadAgentRuns();
      loadFiles();
    } catch (err) {
      if (err.name !== "AbortError") {
        showAlert?.({ title: "Execution Error", message: err.message, danger: true });
      }
    } finally {
      setIsExecuting(false);
      agentAbortRef.current = null;
    }
  };

  const handleCancelRun = async () => {
    if (agentAbortRef.current) {
      agentAbortRef.current.abort();
      agentAbortRef.current = null;
    }
    if (activeRun?.id) {
      try {
        await cancelAgentRun(activeRun.id, "Cancelled by user");
      } catch (_) {}
    }
    setActiveRun((prev) => prev ? { ...prev, status: "cancelled" } : null);
    setIsExecuting(false);
    showAlert?.({ title: "Cancelled", message: "Agent task was cancelled." });
    loadAgentRuns();
  };

  const handleResolveApproval = async (approvalId, approved) => {
    try {
      await resolveAgentApproval(approvalId, approved);
      showAlert?.({ title: approved ? "Approved" : "Denied", message: `Tool execution request ${approved ? "granted" : "denied"}.` });
      loadAgentRuns();
    } catch (err) {
      showAlert?.({ title: "Error", message: err.message, danger: true });
    }
  };

  // Files Actions
  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;
    try {
      const res = await createWorkspaceFolder(newFolderName.trim());
      if (res.ok) {
        showAlert?.({ title: "Folder Created", message: `Directory created: ${res.path}` });
        setNewFolderName("");
        setShowNewFolderModal(false);
        loadFiles();
      } else {
        showAlert?.({ title: "Failed", message: res.error, danger: true });
      }
    } catch (err) {
      showAlert?.({ title: "Error", message: err.message, danger: true });
    }
  };

  const handleCreateFile = async () => {
    if (!newFileName.trim()) return;
    try {
      const res = await saveWorkspaceFile(newFileName.trim(), newFileContent);
      if (res.ok) {
        showAlert?.({ title: "File Created", message: `File saved: ${res.filename}` });
        setNewFileName("");
        setNewFileContent("");
        setShowNewFileModal(false);
        loadFiles();
      } else {
        showAlert?.({ title: "Failed", message: res.error, danger: true });
      }
    } catch (err) {
      showAlert?.({ title: "Error", message: err.message, danger: true });
    }
  };

  const handleGenerateDoc = async () => {
    if (!docFileName.trim()) return;
    try {
      const res = await generateWorkspaceFile({
        filePath: docFileName.trim(),
        fileType: docFormat,
        title: docTitle || "Executive Report",
        content: docContent || "# Document\nGenerated by ABYX.",
      });
      if (res.ok) {
        showAlert?.({ title: "Document Generated", message: `Generated ${docFormat.toUpperCase()} at: ${res.relative_path}` });
        setShowGenerateDocModal(false);
        setDocTitle("");
        setDocContent("");
        loadFiles();
      } else {
        showAlert?.({ title: "Generation Failed", message: res.error, danger: true });
      }
    } catch (err) {
      showAlert?.({ title: "Error", message: err.message, danger: true });
    }
  };

  const handleDeleteFile = async (filePath) => {
    if (!window.confirm(`Are you sure you want to delete "${filePath}" from the workspace?`)) return;
    try {
      const res = await deleteWorkspacePath(filePath);
      if (res.ok) {
        showAlert?.({ title: "Deleted", message: `Deleted ${filePath}` });
        loadFiles();
      } else {
        showAlert?.({ title: "Error", message: res.error, danger: true });
      }
    } catch (err) {
      showAlert?.({ title: "Error", message: err.message, danger: true });
    }
  };

  // Browser Actions
  const handleSearchWeb = async () => {
    if (!browserQuery.trim()) return;
    setBrowserLoading(true);
    try {
      const res = await searchBrowserWeb(browserQuery.trim());
      if (res.ok) {
        setSearchResults(res.results || []);
        showAlert?.({ title: "Web Search", message: `Found ${res.results?.length || 0} results for "${browserQuery}".` });
      }
    } catch (err) {
      showAlert?.({ title: "Search Error", message: err.message, danger: true });
    } finally {
      setBrowserLoading(false);
    }
  };

  const handleBrowsePage = async (targetUrl = browserUrl) => {
    if (!targetUrl.trim()) return;
    setBrowserLoading(true);
    try {
      const res = await browseWebPage(targetUrl.trim());
      if (res.ok) {
        setPageContent(res);
      } else {
        showAlert?.({ title: "Browse Error", message: res.error, danger: true });
      }
    } catch (err) {
      showAlert?.({ title: "Browse Error", message: err.message, danger: true });
    } finally {
      setBrowserLoading(false);
    }
  };

  const handleOpenSystemBrowser = async (targetUrl = browserUrl) => {
    if (!targetUrl.trim()) return;
    try {
      await openSystemBrowser(targetUrl.trim());
      showAlert?.({ title: "Browser Launched", message: `Opened ${targetUrl} in system browser.` });
    } catch (err) {
      showAlert?.({ title: "Launch Error", message: err.message, danger: true });
    }
  };

  // Research Action
  const handleExecuteResearch = async () => {
    if (!researchTopic.trim()) return;
    setResearchLoading(true);
    try {
      const res = await executeResearchWorkflow(researchTopic.trim());
      if (res.ok) {
        setResearchResult(res.result);
      }
    } catch (err) {
      showAlert?.({ title: "Research Error", message: err.message, danger: true });
    } finally {
      setResearchLoading(false);
    }
  };

  const seamIcons = {
    model: Cpu,
    browser: Globe,
    fs: HardDrive,
    memory: Brain,
    sandbox: Box,
    terminal: Terminal,
    subagents: Layers,
  };

  return (
    <div className="abyx-page-container">
      {/* Page Header */}
      <div className="abyx-page-header">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1 className="abyx-page-title" style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Cpu size={26} color="var(--md-sys-color-primary)" /> Agent Harness &amp; Tooling Studio
            </h1>
            <p className="abyx-page-subtitle">
              Unified Abyx microkernel runtime, workspace file tools, bounded agent task loop, web browser, and skills engine.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              className="abyx-btn"
              onClick={() => setIsControlsOpen(true)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                background: "rgba(59, 130, 246, 0.12)",
                border: "1px solid rgba(59, 130, 246, 0.3)",
                color: "#60a5fa"
              }}
              title="Configure context window, temperature, RoPE scaling, and agent loop depth"
            >
              <Sliders size={14} /> Model &amp; Harness Controls
            </button>
            <button className="abyx-btn" onClick={() => { loadBaseData(); loadAgentRuns(); loadFiles(); loadSkills(); }} disabled={loading}>
              <RefreshCw size={14} className={loading ? "spin" : ""} /> Refresh All
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div style={{ display: "flex", gap: 8, marginTop: 18, borderBottom: "1px solid var(--border-color)", paddingBottom: 8, overflowX: "auto" }}>
          {[
            { id: "multiagent", label: "Multi-Agent Swarm (12)", icon: Network },
            { id: "agent", label: "Agent Tasks & Loop", icon: Play },
            { id: "terminal", label: "Terminal Runner", icon: Terminal },
            { id: "subagents", label: "Subagent Team (7)", icon: Users },
            { id: "skills", label: `Skills (${skills.length})`, icon: Sparkles },
            { id: "tools", label: "Tools & Capabilities", icon: Wrench },
            { id: "mcp", label: "MCP Servers", icon: Plug },
            { id: "extensions", label: "Extensions", icon: Box },
            { id: "files", label: "Workspace & Documents", icon: HardDrive },
            { id: "browser", label: "Browser & Web", icon: Globe },
            { id: "seams", label: "Microkernel Seams", icon: Layers },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 16px",
                  borderRadius: 6,
                  border: "none",
                  cursor: "pointer",
                  fontWeight: 500,
                  fontSize: "0.88rem",
                  background: isActive ? "var(--md-sys-color-primary)" : "transparent",
                  color: isActive ? "#ffffff" : "var(--md-sys-color-on-surface)",
                  transition: "all 0.15s ease",
                }}
              >
                <Icon size={16} /> {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ======================================================== */}
      {/* TAB 0: MULTI-AGENT SWARM & ORCHESTRATION (12 AGENTS)     */}
      {/* ======================================================== */}
      {activeTab === "multiagent" && (
        <div style={{ marginTop: 4, height: "calc(100vh - 130px)", flex: 1, display: "flex", flexDirection: "column" }}>
          <MultiAgentWorkspace activeProject={activeProject} onOpenFile={openWorkspacePath} />
        </div>
      )}

      {/* ======================================================== */}
      {/* TAB 1: AGENT TASKS & EXECUTION LOOP                      */}
      {/* ======================================================== */}
      {activeTab === "agent" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Pending Approvals Alert Banner */}
          {pendingApprovals.length > 0 && (
            <section aria-labelledby="harness-approval-heading" style={{ background: "rgba(234, 179, 8, 0.12)", border: "1px solid #eab308", borderRadius: 8, padding: "16px 20px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 600, color: "#eab308", marginBottom: 8 }}>
                <AlertCircle size={20} /> <span id="harness-approval-heading">Review requested actions ({pendingApprovals.length})</span>
              </div>
                <p style={{ fontSize: "0.85rem", color: "var(--md-sys-color-on-surface)", margin: "0 0 12px 0" }}>
                Review each action and its arguments before allowing it to run. Denying an action leaves it unexecuted.
              </p>
              {pendingApprovals.map((appr) => (
                <div key={appr.id} style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap", background: "var(--card-bg)", padding: 12, borderRadius: 6, marginBottom: 8 }}>
                  <div style={{ flex: "1 1 300px", minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: "0.85rem" }}>Requested action: {appr.toolName}</div>
                    <div style={{ fontSize: "0.78rem", color: "var(--md-sys-color-outline)" }}>{appr.reason}</div>
                    {appr.preview && <pre style={{ margin: "4px 0 0 0", fontSize: "0.75rem", background: "rgba(0,0,0,0.3)", padding: 4, borderRadius: 4 }}>{appr.preview}</pre>}
                    <details style={{ marginTop: 8 }}>
                      <summary style={{ cursor: "pointer", fontSize: "0.78rem" }}>Review exact arguments</summary>
                      <pre style={{ maxHeight: 220, overflow: "auto", whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: "0.75rem" }}>{JSON.stringify(appr.args || {}, null, 2)}</pre>
                    </details>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="abyx-btn" style={{ background: "var(--md-sys-color-success)", color: "#fff", borderColor: "transparent" }} onClick={() => handleResolveApproval(appr.id, true)} aria-label={`Approve ${appr.toolName}`}>
                      <Check size={14} /> Allow once
                    </button>
                    <button className="abyx-btn" style={{ background: "var(--md-sys-color-error)", color: "#fff", borderColor: "transparent" }} onClick={() => handleResolveApproval(appr.id, false)} aria-label={`Deny ${appr.toolName}`}>
                      <X size={14} /> Deny
                    </button>
                  </div>
                </div>
              ))}
            </section>
          )}

          {/* New Task Dispatcher Card */}
          <div className="abyx-section-card">
            <h2 className="abyx-section-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Play size={18} color="var(--md-sys-color-primary)" /> Bounded Agent Task Dispatcher
            </h2>
            <p style={{ fontSize: "0.85rem", color: "var(--md-sys-color-outline)", marginTop: 4, marginBottom: 16 }}>
              Provide a natural-language goal. The agent plans, calls policy-checked workspace tools (filesystem, document generation, web search), and records every event.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <textarea
                className="abyx-input"
                style={{ minHeight: 90, fontFamily: "inherit", fontSize: "0.9rem", resize: "vertical" }}
                placeholder="Example: Create a folder called 'reports', generate an executive summary PDF 'reports/exec_summary.pdf', and search the web for latest AI release notes."
                value={taskInput}
                onChange={(e) => setTaskInput(e.target.value)}
                disabled={isExecuting}
              />

              <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                  <div>
                    <label style={{ fontSize: "0.78rem", color: "var(--md-sys-color-outline)", display: "block", marginBottom: 4 }}>Model Selection</label>
                    <select className="abyx-input" style={{ width: 170, height: 36, padding: "0 10px" }} value={taskModel} onChange={(e) => setTaskModel(e.target.value)} disabled={isExecuting}>
                      <option value="auto">Auto (Best Model)</option>
                      <option value="gpt-4o">OpenAI GPT-4o</option>
                      <option value="claude-3-5-sonnet">Claude 3.5 Sonnet</option>
                      <option value="gemini-2.0-flash">Gemini 2.0 Flash</option>
                      <option value="abyx:1.1">Local Abyx (Ollama)</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: "0.78rem", color: "var(--md-sys-color-outline)", display: "block", marginBottom: 4 }}>Max Steps ({maxSteps})</label>
                    <input type="range" min="1" max="15" value={maxSteps} onChange={(e) => setMaxSteps(Number(e.target.value))} disabled={isExecuting} style={{ width: 120 }} />
                  </div>
                </div>

                <div style={{ display: "flex", gap: 10 }}>
                  {isExecuting && (
                    <button className="abyx-btn" style={{ background: "var(--md-sys-color-error)", color: "#fff", borderColor: "transparent" }} onClick={handleCancelRun}>
                      <Square size={14} /> Stop / Cancel
                    </button>
                  )}
                  <button className="abyx-btn primary" onClick={handleStartTask} disabled={isExecuting || !taskInput.trim()}>
                    {isExecuting ? <RefreshCw size={14} className="spin" /> : <Play size={14} />} {isExecuting ? "Executing Agent Loop..." : "Run Agent Task"}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Active Run Timeline & Event Log */}
          {activeRun && (
            <div className="abyx-section-card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: "1.05rem", display: "flex", alignItems: "center", gap: 8 }}>
                    <span className={`abyx-status-indicator ${activeRun.status === "completed" ? "live" : activeRun.status === "running" || activeRun.status === "waiting_approval" ? "warning" : "offline"}`} aria-hidden="true" />
                    Run: {activeRun.goal}
                  </h3>
                  <div aria-live="polite" role="status" style={{ fontSize: "0.82rem", color: "var(--md-sys-color-outline)", marginTop: 6 }}>
                    <strong style={{ color: RUN_STATUS_COLORS[activeRun.status] || "var(--md-sys-color-outline)" }}>{RUN_STATUS_LABELS[activeRun.status] || "Run status unavailable"}</strong>
                    <span> · Steps: {activeRun.stepsExecuted || 0}/{activeRun.maxSteps || maxSteps} · Tools: {activeRun.toolsExecuted || 0} · Model: {activeRun.model || "Not reported"}</span>
                  </div>
                  {activeRun.error && <div role="alert" style={{ marginTop: 6, color: "var(--md-sys-color-error)", fontSize: "0.82rem" }}>{activeRun.error}</div>}
                </div>
                <span className="abyx-pill" style={{ color: RUN_STATUS_COLORS[activeRun.status], textTransform: "none" }}>{RUN_STATUS_LABELS[activeRun.status] || "Unknown"}</span>
              </div>

              {/* Timeline Stream */}
              <div style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: 420, overflowY: "auto", background: "var(--card-bg)", padding: 14, borderRadius: 8, border: "1px solid var(--border-color)" }}>
                {activeRun.timeline && activeRun.timeline.length > 0 ? (
                  activeRun.timeline.map((evt, idx) => (
                    <div key={idx} style={{ display: "flex", gap: 12, alignItems: "flex-start", fontSize: "0.85rem", borderBottom: idx < activeRun.timeline.length - 1 ? "1px solid rgba(255,255,255,0.06)" : "none", paddingBottom: 8 }}>
                      <span style={{ fontSize: "0.72rem", color: "var(--md-sys-color-outline)", width: 55, flexShrink: 0, marginTop: 2 }}>
                        {new Date(evt.timestamp || Date.now()).toLocaleTimeString()}
                      </span>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontWeight: 600, color: evt.type?.includes("error") || evt.success === false ? "var(--md-sys-color-error)" : evt.type?.includes("tool") ? "var(--md-sys-color-primary)" : "var(--md-sys-color-on-surface)" }}>
                            [{evt.type}] {evt.name || evt.description || ""}
                          </span>
                          {evt.durationMs != null && <span style={{ fontSize: "0.72rem", color: "var(--md-sys-color-outline)" }}>({evt.durationMs}ms)</span>}
                        </div>
                        {evt.args && (
                          <pre style={{ margin: "4px 0 0 0", padding: "6px 8px", background: "rgba(0,0,0,0.25)", borderRadius: 4, fontSize: "0.75rem", overflowX: "auto" }}>
                            {JSON.stringify(evt.args, null, 2)}
                          </pre>
                        )}
                        {evt.result && (
                          <div style={{ marginTop: 4, fontSize: "0.8rem", color: "var(--md-sys-color-on-surface-variant)" }}>
                            Result: {typeof evt.result === "string" ? evt.result : JSON.stringify(evt.result)}
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  <div style={{ color: "var(--md-sys-color-outline)", fontSize: "0.85rem", textAlign: "center", padding: 20 }}>No events recorded for this run.</div>
                )}
              </div>

              {activeRun.finalOutput && (
                <div style={{ marginTop: 14, padding: 12, borderRadius: 6, background: "rgba(56, 189, 248, 0.08)", border: "1px solid rgba(56, 189, 248, 0.2)", fontSize: "0.88rem" }}>
                  <strong>Final Agent Result:</strong> {activeRun.finalOutput}
                </div>
              )}
            </div>
          )}

          {/* Recent History Table */}
          {runHistory.length > 0 && (
            <div className="abyx-section-card">
              <h3 style={{ margin: "0 0 12px 0", fontSize: "0.95rem" }}>Past Agent Runs History</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {runHistory.slice(0, 5).map((r) => (
                  <button type="button" key={r.id} aria-label={`View run: ${r.goal}`} style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "10px 14px", background: "var(--card-bg)", color: "var(--md-sys-color-on-surface)", textAlign: "left", borderRadius: 6, border: "1px solid var(--border-color)", cursor: "pointer" }} onClick={() => setActiveRun(r)}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: "0.85rem" }}>{r.goal}</div>
                      <div style={{ fontSize: "0.74rem", color: "var(--md-sys-color-outline)" }}>{new Date(r.startTime).toLocaleString()} Â· {r.stepsExecuted || 0} steps Â· {r.model}</div>
                    </div>
                    <span className="abyx-pill" style={{ textTransform: "capitalize" }}>{r.status}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ======================================================== */}
      {/* TAB 2: WORKSPACE & DOCUMENT GENERATOR                     */}
      {/* ======================================================== */}
      {activeTab === "files" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Action Toolbar */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <input
                className="abyx-input"
                style={{ width: 240, height: 36, padding: "0 12px" }}
                placeholder="Filter workspace files..."
                value={fileFilter}
                onChange={(e) => setFileFilter(e.target.value)}
              />
              <span style={{ fontSize: "0.8rem", color: "var(--md-sys-color-outline)" }}>({workspaceFiles.length} items)</span>
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <button className="abyx-btn" onClick={() => setShowNewFolderModal(true)}>
                <FolderPlus size={14} /> New Folder
              </button>
              <button className="abyx-btn" onClick={() => setShowNewFileModal(true)}>
                <FilePlus size={14} /> New File
              </button>
              <button className="abyx-btn primary" onClick={() => setShowGenerateDocModal(true)}>
                <Sparkles size={14} /> Generate PDF / Archive
              </button>
              <button className="abyx-btn" onClick={() => openWorkspacePath("")}>
                <ExternalLink size={14} /> Open in Explorer
              </button>
            </div>
          </div>

          {/* Files List Table */}
          <div className="abyx-section-card" style={{ padding: 0, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
              <thead>
                <tr style={{ background: "rgba(255,255,255,0.03)", borderBottom: "1px solid var(--border-color)", textAlign: "left", color: "var(--md-sys-color-outline)" }}>
                  <th style={{ padding: "12px 16px" }}>Name / Path</th>
                  <th style={{ padding: "12px 16px" }}>Size</th>
                  <th style={{ padding: "12px 16px" }}>Modified</th>
                  <th style={{ padding: "12px 16px", textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {workspaceFiles.filter(f => !fileFilter || (f.relativePath || f.name).toLowerCase().includes(fileFilter.toLowerCase())).length > 0 ? (
                  workspaceFiles.filter(f => !fileFilter || (f.relativePath || f.name).toLowerCase().includes(fileFilter.toLowerCase())).map((file, idx) => (
                    <tr key={idx} style={{ borderBottom: "1px solid var(--border-color)", transition: "background 0.1s ease" }}>
                      <td style={{ padding: "12px 16px", display: "flex", alignItems: "center", gap: 8 }}>
                        {file.name.endsWith(".pdf") ? <FileText size={16} color="#ef4444" /> : file.name.endsWith(".zip") ? <Box size={16} color="#eab308" /> : <FileCode size={16} color="#38bdf8" />}
                        <span style={{ fontWeight: 500 }}>{file.relativePath || file.name}</span>
                      </td>
                      <td style={{ padding: "12px 16px", color: "var(--md-sys-color-outline)" }}>
                        {file.sizeBytes != null ? (file.sizeBytes < 1024 ? `${file.sizeBytes} B` : `${(file.sizeBytes / 1024).toFixed(1)} KB`) : "-"}
                      </td>
                      <td style={{ padding: "12px 16px", color: "var(--md-sys-color-outline)" }}>
                        {file.modified ? new Date(file.modified).toLocaleString() : "-"}
                      </td>
                      <td style={{ padding: "12px 16px", textAlign: "right" }}>
                        <div style={{ display: "inline-flex", gap: 6 }}>
                          <a
                            href={`/api/files/download?path=${encodeURIComponent(file.relativePath || file.name)}`}
                            download
                            className="abyx-btn"
                            style={{ padding: "4px 8px", fontSize: "0.75rem", textDecoration: "none" }}
                          >
                            <Download size={12} /> Download
                          </a>
                          <button
                            className="abyx-btn"
                            style={{ padding: "4px 8px", fontSize: "0.75rem" }}
                            onClick={() => openWorkspacePath(file.relativePath || file.name)}
                          >
                            <Eye size={12} /> View
                          </button>
                          <button
                            className="abyx-btn"
                            style={{ padding: "4px 8px", fontSize: "0.75rem", color: "var(--md-sys-color-error)" }}
                            onClick={() => handleDeleteFile(file.relativePath || file.name)}
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="4" style={{ textAlign: "center", padding: 30, color: "var(--md-sys-color-outline)" }}>
                      No files found matching filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Modal: New Folder */}
          {showNewFolderModal && (
            <div className="abyx-modal-backdrop">
              <div className="abyx-modal-content" style={{ maxWidth: 400 }}>
                <h3 style={{ margin: "0 0 12px 0" }}>Create New Folder</h3>
                <input
                  className="abyx-input"
                  style={{ width: "100%", marginBottom: 16 }}
                  placeholder="Folder path (e.g. reports/finance)"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                />
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                  <button className="abyx-btn" onClick={() => setShowNewFolderModal(false)}>Cancel</button>
                  <button className="abyx-btn primary" onClick={handleCreateFolder}>Create Folder</button>
                </div>
              </div>
            </div>
          )}

          {/* Modal: New File */}
          {showNewFileModal && (
            <div className="abyx-modal-backdrop">
              <div className="abyx-modal-content" style={{ maxWidth: 500 }}>
                <h3 style={{ margin: "0 0 12px 0" }}>Create New File</h3>
                <input
                  className="abyx-input"
                  style={{ width: "100%", marginBottom: 12 }}
                  placeholder="File path (e.g. notes.txt or config.json)"
                  value={newFileName}
                  onChange={(e) => setNewFileName(e.target.value)}
                />
                <textarea
                  className="abyx-input"
                  style={{ width: "100%", minHeight: 120, marginBottom: 16, fontFamily: "monospace" }}
                  placeholder="Enter file text content..."
                  value={newFileContent}
                  onChange={(e) => setNewFileContent(e.target.value)}
                />
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                  <button className="abyx-btn" onClick={() => setShowNewFileModal(false)}>Cancel</button>
                  <button className="abyx-btn primary" onClick={handleCreateFile}>Save File</button>
                </div>
              </div>
            </div>
          )}

          {/* Modal: Generate Document (PDF / ZIP) */}
          {showGenerateDocModal && (
            <div className="abyx-modal-backdrop">
              <div className="abyx-modal-content" style={{ maxWidth: 540 }}>
                <h3 style={{ margin: "0 0 12px 0" }}>Generate Document / Archive</h3>
                <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: "0.78rem", color: "var(--md-sys-color-outline)", display: "block", marginBottom: 4 }}>Format</label>
                    <select className="abyx-input" style={{ width: "100%", height: 36 }} value={docFormat} onChange={(e) => {
                      setDocFormat(e.target.value);
                      if (e.target.value === "pdf") setDocFileName("document.pdf");
                      else if (e.target.value === "zip") setDocFileName("archive.zip");
                      else setDocFileName("report.md");
                    }}>
                      <option value="pdf">PDF Document (.pdf)</option>
                      <option value="zip">ZIP Archive (.zip)</option>
                      <option value="md">Markdown (.md)</option>
                      <option value="html">HTML Page (.html)</option>
                    </select>
                  </div>
                  <div style={{ flex: 2 }}>
                    <label style={{ fontSize: "0.78rem", color: "var(--md-sys-color-outline)", display: "block", marginBottom: 4 }}>File Path</label>
                    <input className="abyx-input" style={{ width: "100%", height: 36 }} value={docFileName} onChange={(e) => setDocFileName(e.target.value)} />
                  </div>
                </div>
                {docFormat === "pdf" && (
                  <div style={{ marginBottom: 12 }}>
                    <label style={{ fontSize: "0.78rem", color: "var(--md-sys-color-outline)", display: "block", marginBottom: 4 }}>Document Title</label>
                    <input className="abyx-input" style={{ width: "100%", height: 36 }} placeholder="Executive Intelligence Report" value={docTitle} onChange={(e) => setDocTitle(e.target.value)} />
                  </div>
                )}
                <div style={{ marginBottom: 16 }}>
                  <label style={{ fontSize: "0.78rem", color: "var(--md-sys-color-outline)", display: "block", marginBottom: 4 }}>Document Markdown / Content</label>
                  <textarea
                    className="abyx-input"
                    style={{ width: "100%", minHeight: 140, fontFamily: "inherit" }}
                    placeholder="# Executive Summary&#10;&#10;Key findings and system deliverables."
                    value={docContent}
                    onChange={(e) => setDocContent(e.target.value)}
                  />
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                  <button className="abyx-btn" onClick={() => setShowGenerateDocModal(false)}>Cancel</button>
                  <button className="abyx-btn primary" onClick={handleGenerateDoc}>Generate Document</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ======================================================== */}
      {/* TAB 3: CONTROLLED WEB BROWSER                            */}
      {/* ======================================================== */}
      {activeTab === "browser" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Search & URL Bar */}
          <div className="abyx-section-card">
            <h2 className="abyx-section-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Globe size={18} color="var(--md-sys-color-primary)" /> Web Search &amp; Browser Reader
            </h2>
            <p style={{ fontSize: "0.85rem", color: "var(--md-sys-color-outline)", marginTop: 4, marginBottom: 14 }}>
              Execute live web search without tracking or browse public web pages with automated readability extraction and SSRF protection.
            </p>

            <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
              <input
                className="abyx-input"
                style={{ flex: 1, height: 40, padding: "0 14px", fontSize: "0.9rem" }}
                placeholder="Search queries or enter URL (e.g. 'local ai models' or 'https://example.com')..."
                value={browserQuery || browserUrl}
                onChange={(e) => {
                  setBrowserQuery(e.target.value);
                  if (e.target.value.startsWith("http")) setBrowserUrl(e.target.value);
                }}
                onKeyDown={(e) => e.key === "Enter" && (browserQuery.startsWith("http") ? handleBrowsePage(browserQuery) : handleSearchWeb())}
              />
              <button className="abyx-btn" onClick={handleSearchWeb} disabled={browserLoading || !browserQuery}>
                <Search size={14} /> Search Web
              </button>
              <button className="abyx-btn primary" onClick={() => handleBrowsePage(browserUrl)} disabled={browserLoading || !browserUrl}>
                <Eye size={14} /> Browse Page
              </button>
              {onOpenBrowser && (
                <button className="abyx-btn" onClick={() => onOpenBrowser(browserUrl)} title="Open in Built-in Browser">
                  <Globe size={14} /> Built-in Browser
                </button>
              )}
              <button className="abyx-btn" onClick={() => handleOpenSystemBrowser(browserUrl)} title="Open in Edge/Chrome">
                <ExternalLink size={14} /> Launch Browser
              </button>
            </div>

            {/* Search Results */}
            {searchResults.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <h3 style={{ fontSize: "0.95rem", marginBottom: 10 }}>Search Results ({searchResults.length})</h3>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {searchResults.map((item, idx) => (
                    <div key={idx} style={{ padding: 12, background: "var(--card-bg)", borderRadius: 6, border: "1px solid var(--border-color)" }}>
                      <a
                        href={item.url}
                        onClick={(e) => { e.preventDefault(); setBrowserUrl(item.url); handleBrowsePage(item.url); }}
                        style={{ color: "var(--md-sys-color-primary)", fontWeight: 600, fontSize: "0.9rem", textDecoration: "none" }}
                      >
                        {item.title}
                      </a>
                      <div style={{ fontSize: "0.75rem", color: "var(--md-sys-color-outline)", marginBottom: 4 }}>{item.url}</div>
                      <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--md-sys-color-on-surface-variant)" }}>{item.snippet}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Extracted Page Content */}
            {pageContent && (
              <div style={{ marginTop: 18, padding: 16, background: "var(--card-bg)", borderRadius: 8, border: "1px solid var(--border-color)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: "1rem" }}>{pageContent.url}</h3>
                    <div style={{ fontSize: "0.75rem", color: "var(--md-sys-color-outline)" }}>Domain: {pageContent.domain} Â· Status: HTTP {pageContent.status}</div>
                  </div>
                  <button className="abyx-btn" onClick={() => handleOpenSystemBrowser(pageContent.url)}>
                    <ExternalLink size={12} /> Open in Chrome/Edge
                  </button>
                </div>
                <div style={{ maxHeight: 360, overflowY: "auto", background: "rgba(0,0,0,0.3)", padding: 14, borderRadius: 6, fontSize: "0.85rem", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
                  {pageContent.content}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* TAB SUBAGENTS: SPECIALIZED AGENT TEAM                   */}
      {/* ======================================================== */}
      {activeTab === "subagents" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <SubagentsHub />
        </div>
      )}

      {/* ======================================================== */}
      {/* TAB 4: SKILLS & RESEARCH ENGINE                          */}
      {/* ======================================================== */}
      {activeTab === "skills" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Deep Research Skill Card */}
          <div className="abyx-section-card">
            <h2 className="abyx-section-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Brain size={18} color="var(--md-sys-color-primary)" /> Deep Research &amp; Academic Synthesis Skill
            </h2>
            <p style={{ fontSize: "0.85rem", color: "var(--md-sys-color-outline)", marginTop: 4, marginBottom: 14 }}>
              Execute multi-perspective research, citation alignment, and technical literature synthesis.
            </p>

            <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
              <input
                className="abyx-input"
                style={{ flex: 1, height: 40, padding: "0 14px" }}
                placeholder="Enter research topic (e.g. 'State of local quantized LLM inference on consumer GPUs')..."
                value={researchTopic}
                onChange={(e) => setResearchTopic(e.target.value)}
              />
              <button className="abyx-btn primary" onClick={handleExecuteResearch} disabled={researchLoading || !researchTopic}>
                {researchLoading ? <RefreshCw size={14} className="spin" /> : <Sparkles size={14} />} {researchLoading ? "Researching..." : "Execute Research"}
              </button>
            </div>

            {researchResult && (
              <div style={{ padding: 16, background: "var(--card-bg)", borderRadius: 8, border: "1px solid var(--border-color)", marginTop: 12 }}>
                <h4 style={{ margin: "0 0 10px 0" }}>Synthesis Report: {researchResult.topic || researchTopic}</h4>
                <div style={{ fontSize: "0.85rem", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                  {researchResult.synthesis || JSON.stringify(researchResult, null, 2)}
                </div>
              </div>
            )}
          </div>

          {/* Installed Skills Catalog */}
          <div className="abyx-section-card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <h3 style={{ margin: 0, fontSize: "1rem" }}>Installed Abyx Skills Catalog ({skills.length})</h3>
              <input
                className="abyx-input"
                style={{ width: 220, height: 34, padding: "0 10px", fontSize: "0.82rem" }}
                placeholder="Search skills..."
                value={skillFilter}
                onChange={(e) => setSkillFilter(e.target.value)}
              />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12, maxHeight: 450, overflowY: "auto" }}>
              {skills.length === 0 ? (
                <div style={{ padding: "32px 16px", color: "var(--md-sys-color-outline)", fontSize: "0.85rem", textAlign: "center", gridColumn: "1 / -1" }}>
                  No custom skills installed. Custom skills can be added via <code>data/extensions/installed/skills/</code>.
                </div>
              ) : skills.filter(s => !skillFilter || s.id.toLowerCase().includes(skillFilter.toLowerCase()) || (s.name || "").toLowerCase().includes(skillFilter.toLowerCase())).map((skill) => (
                <div key={skill.id} style={{ padding: "12px 14px", background: "var(--card-bg)", borderRadius: 6, border: "1px solid var(--border-color)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                    <div style={{ fontWeight: 600, fontSize: "0.88rem" }}>{skill.name || skill.id}</div>
                    <span className="abyx-pill" style={{ fontSize: "0.7rem" }}>{skill.category || "Skill"}</span>
                  </div>
                  <p style={{ margin: 0, fontSize: "0.78rem", color: "var(--md-sys-color-outline)", lineHeight: 1.4 }}>
                    {skill.description ? (skill.description.length > 120 ? skill.description.slice(0, 120) + "..." : skill.description) : "Specialized agent capability."}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {activeTab === "tools" && (
        <div className="abyx-section-card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div>
              <h2 className="abyx-section-title" style={{ margin: 0 }}>Registered Tools</h2>
              <p style={{ margin: "6px 0 0", color: "var(--md-sys-color-outline)", fontSize: "0.82rem" }}>
                Agent capabilities pass through the shared registry and authorization gateway. Individual settings and bundles are saved to this profile.
              </p>
            </div>
            <button className="abyx-btn" onClick={loadTools}><RefreshCw size={14} /> Refresh</button>
          </div>
          <h3 style={{ margin: "22px 0 8px" }}>Capability bundles</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10, marginBottom: 18 }}>
            {registeredBundles.map(bundle => (
              <div key={bundle.id} style={{ padding: 12, borderRadius: 8, background: "var(--card-bg)", border: "1px solid var(--border-color)" }}>
                <strong>{bundle.name}</strong>
                <div style={{ color: "var(--md-sys-color-outline)", fontSize: "0.78rem", margin: "5px 0 10px" }}>{bundle.description}</div>
                <button className="abyx-btn" onClick={async () => {
                  try { await setAgentToolBundleEnabled(bundle.id, !bundle.enabled); await loadTools(); }
                  catch (err) { showAlert?.({ title: "Bundle setting failed", message: err.message, danger: true }); }
                }}>{bundle.enabled ? "Disable bundle" : "Enable bundle"} · {bundle.toolIds.length} tools</button>
              </div>
            ))}
          </div>
          <div style={{ display: "grid", gap: 10 }}>
            {registeredTools.map((tool) => (
              <div key={tool.id} style={{ display: "grid", gridTemplateColumns: "minmax(180px, 1fr) auto", gap: 12, alignItems: "center", padding: 12, borderRadius: 8, background: "var(--card-bg)", border: "1px solid var(--border-color)" }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600 }}>
                    <code>{tool.id}</code><span className="abyx-pill">{tool.riskCategory}</span>
                  </div>
                  <div style={{ fontSize: "0.8rem", color: "var(--md-sys-color-outline)", marginTop: 4 }}>{tool.description}</div>
                  <div style={{ fontSize: "0.72rem", color: "var(--md-sys-color-outline)", marginTop: 5 }}>
                    v{tool.version} · {tool.provenance?.source} · {tool.permissions?.join(", ") || "no declared permissions"}
                  </div>
                </div>
                <button className="abyx-btn" onClick={async () => {
                  try {
                    await setAgentToolEnabled(tool.id, !tool.enabled);
                    await loadTools();
                  } catch (err) {
                    showAlert?.({ title: "Tool setting failed", message: err.message, danger: true });
                  }
                }}>{tool.enabled ? "Disable" : "Enable"}</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === "mcp" && (
        <div style={{ display: "grid", gap: 16 }}>
          <div className="abyx-section-card">
            <h2 className="abyx-section-title">Add an MCP stdio server</h2>
            <p style={{ color: "var(--md-sys-color-outline)", fontSize: "0.82rem" }}>
              Starting a server runs its configured program with your account permissions. It is a separate process, not an OS sandbox. Plaintext environment variables are not saved or passed through.
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <input className="abyx-input" placeholder="Server ID (for example, docs-server)" value={mcpName} onChange={event => setMcpName(event.target.value)} />
              <input className="abyx-input" placeholder="Program (for example, node)" value={mcpCommand} onChange={event => setMcpCommand(event.target.value)} />
              <input className="abyx-input" style={{ gridColumn: "1 / -1" }} placeholder='Arguments as JSON array (for example, ["server.js"])' value={mcpArgs} onChange={event => setMcpArgs(event.target.value)} />
            </div>
            <button className="abyx-btn primary" style={{ marginTop: 10 }} disabled={!mcpName.trim() || !mcpCommand.trim()} onClick={async () => {
              try {
                const parsedArgs = mcpArgs.trim() ? JSON.parse(mcpArgs) : [];
                if (!Array.isArray(parsedArgs) || parsedArgs.some(arg => typeof arg !== "string")) throw new Error("Arguments must be a JSON array of strings.");
                if (!window.confirm(`Save ${mcpName} with the mcp:call capability? Every external tool call will still require Abyx approval. Starting it later runs the configured program with your account permissions.`)) return;
                await addMcpServer({ name: mcpName, command: mcpCommand, args: parsedArgs, grantedPermissions: ["mcp:call"] });
                setMcpName(""); setMcpCommand(""); setMcpArgs("");
                await loadBaseData();
              } catch (err) {
                showAlert?.({ title: "MCP server setup failed", message: err.message, danger: true });
              }
            }}><Plug size={14} /> Save server</button>
          </div>
          <div className="abyx-section-card">
            <h2 className="abyx-section-title">Configured servers</h2>
            <div style={{ display: "grid", gap: 10 }}>
              {Object.entries(mcpState.servers).filter(([id]) => id !== "local_tools").map(([id, server]) => {
                const state = mcpState.status[id] || {};
                return <div key={id} style={{ padding: 14, borderRadius: 8, border: "1px solid var(--border-color)", background: "var(--card-bg)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                    <div><strong>{id}</strong><div style={{ fontSize: "0.78rem", color: "var(--md-sys-color-outline)", marginTop: 4 }}>{server.command} {(server.args || []).join(" ")}</div><div style={{ fontSize: "0.75rem", marginTop: 4 }}>Status: {state.status || "disconnected"} · {state.transport || server.transport || "stdio"}</div></div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {state.status === "connected" ? <button className="abyx-btn" onClick={async () => { await disconnectMcpServer(id); await loadBaseData(); }}>Disconnect</button> : <button className="abyx-btn primary" onClick={async () => {
                        const commandPreview = `${server.command} ${(server.args || []).join(" ")}`;
                        if (!window.confirm(`Start this MCP server as a separate process with your account permissions?\n\n${commandPreview}\n\nIt will not be OS-isolated.`)) return;
                        try { await connectMcpServer(id, true); await loadBaseData(); await loadTools(); }
                        catch (err) { showAlert?.({ title: "MCP connection failed", message: err.message, danger: true }); }
                      }}>Connect</button>}
                      <button className="abyx-btn" onClick={async () => { await toggleMcpServer(id, !server.enabled); await loadBaseData(); }}>{server.enabled === false ? "Enable" : "Disable"}</button>
                      <button className="abyx-btn danger" onClick={async () => { if (window.confirm(`Remove MCP server ${id}?`)) { await deleteMcpServer(id); await loadBaseData(); } }}>Remove</button>
                    </div>
                  </div>
                  {(mcpState.tools || []).filter(tool => tool.function?.name.startsWith(`mcp.${id}.`)).map(tool => <div key={tool.function.name} style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--border-color)", fontSize: "0.78rem" }}><code>{tool.function.name}</code> — {tool.function.description}</div>)}
                </div>;
              })}
              {Object.keys(mcpState.servers).filter(id => id !== "local_tools").length === 0 && <p style={{ color: "var(--md-sys-color-outline)" }}>No MCP servers configured.</p>}
            </div>
          </div>
        </div>
      )}

      {activeTab === "extensions" && (
        <div className="abyx-section-card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <div>
              <h2 className="abyx-section-title" style={{ margin: 0 }}>Skills and extensions</h2>
              <p style={{ color: "var(--md-sys-color-outline)", fontSize: "0.82rem" }}>
                Installing a package is code or instruction ingestion. Instruction skills receive no tool permissions. Executable extensions remain disabled because Abyx has no isolated extension host.
              </p>
            </div>
            <button className="abyx-btn primary" onClick={async () => {
              const source = window.prompt("Enter a local package path or supported GitHub source:");
              if (!source) return;
              try {
                const inspected = await inspectExtension(source);
                const permissions = inspected.permissions || [];
                const manifest = inspected.manifest || {};
                const message = `Install ${manifest.kind || "extension"} ${manifest.name || manifest.id} v${manifest.version}?\n\nRequested permissions: ${permissions.length ? permissions.join(", ") : "none"}\n\n${manifest.kind === "skill" ? "Skill text can influence model output but cannot grant tool permissions." : "Executable code will be stored but remains disabled; no OS-isolated runner is configured."}`;
                if (!window.confirm(message)) return;
                await installExtension(source, permissions, inspected.contentHash, true);
                const refreshed = await getExtensions();
                setExtensions(refreshed.extensions || []);
                showAlert?.({ title: "Package installed", message: "The package was recorded with its provenance and reviewed permissions." });
              } catch (err) {
                showAlert?.({ title: "Package installation failed", message: err.message, danger: true });
              }
            }}>Install package</button>
          </div>
          <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
            {extensions.map(extension => (
              <div key={extension.id} style={{ display: "grid", gridTemplateColumns: "minmax(180px, 1fr) auto", gap: 12, alignItems: "center", padding: 12, borderRadius: 8, background: "var(--card-bg)", border: "1px solid var(--border-color)" }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600 }}>{extension.name} <span className="abyx-pill">{extension.kind}</span><span className="abyx-pill">{extension.status}</span></div>
                  <div style={{ color: "var(--md-sys-color-outline)", fontSize: "0.78rem", marginTop: 4 }}>{extension.description}</div>
                  <div style={{ color: "var(--md-sys-color-outline)", fontSize: "0.72rem", marginTop: 4 }}>v{extension.version} · {extension.trustLevel || "unverified"} · {extension.provenance?.contentHash || "no content hash"}</div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="abyx-btn" onClick={async () => {
                    const source = window.prompt(`Enter the updated package path or supported GitHub source for ${extension.id}:`);
                    if (!source) return;
                    try {
                      const inspected = await inspectExtension(source);
                      const permissions = inspected.permissions || [];
                      if (inspected.manifest?.id !== extension.id) throw new Error("The update package ID does not match this installed package.");
                      const approved = window.confirm(`Update ${extension.name} to v${inspected.manifest?.version}?\n\nRequested permissions: ${permissions.length ? permissions.join(", ") : "none"}\n\nContent hash: ${inspected.contentHash}`);
                      if (!approved) return;
                      await updateExtension(extension.id, source, permissions, inspected.contentHash, true);
                      const refreshed = await getExtensions(); setExtensions(refreshed.extensions || []);
                    } catch (err) { showAlert?.({ title: "Package update failed", message: err.message, danger: true }); }
                  }}>Update</button>
                  {extension.kind === "skill" && <button className="abyx-btn" onClick={async () => { try { await setExtensionEnabled(extension.id, extension.status !== "enabled"); const r = await getExtensions(); setExtensions(r.extensions || []); } catch (err) { showAlert?.({ title: "Skill update failed", message: err.message, danger: true }); } }}>{extension.status === "enabled" ? "Deactivate" : "Activate"}</button>}
                  <button className="abyx-btn danger" onClick={async () => { if (window.confirm(`Uninstall ${extension.name}?`)) { try { await uninstallExtension(extension.id); const r = await getExtensions(); setExtensions(r.extensions || []); } catch (err) { showAlert?.({ title: "Uninstall failed", message: err.message, danger: true }); } } }}>Uninstall</button>
                </div>
              </div>
            ))}
            {!extensions.length && <p style={{ color: "var(--md-sys-color-outline)" }}>No installed extension packages.</p>}
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* TAB 5: MICROKERNEL SEAMS & ARCHITECTURE                 */}
      {/* ======================================================== */}
      {activeTab === "seams" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Telemetry Stat Cards */}
          <div className="abyx-stats-grid">
            <div className="abyx-stat-card">
              <span className="abyx-stat-label">Harness Engine</span>
              <span className="abyx-stat-value" style={{ fontSize: "1.35rem" }}>{status?.harness || "Abyx Unified Agent"}</span>
              <span className="abyx-stat-meta">Version {status?.version || "1.1.0"} Â· Active</span>
            </div>
            <div className="abyx-stat-card">
              <span className="abyx-stat-label">Execution Seams</span>
              <span className="abyx-stat-value">{seams.length || 7}</span>
              <span className="abyx-stat-meta">Microkernel isolation contracts</span>
            </div>
            <div className="abyx-stat-card">
              <span className="abyx-stat-label">Active Plugins</span>
              <span className="abyx-stat-value">{plugins.length || 8}</span>
              <span className="abyx-stat-meta">Live capability providers</span>
            </div>
            <div className="abyx-stat-card">
              <span className="abyx-stat-label">OS Isolation</span>
              <span className="abyx-stat-value" style={{ fontSize: "1.15rem", color: "var(--md-sys-color-error)" }}>Unavailable</span>
              <span className="abyx-stat-meta">Untrusted code execution is disabled; approved terminal commands run on this host.</span>
            </div>
          </div>

          {/* Seams Architecture Grid */}
          <div className="abyx-section-card">
            <h2 className="abyx-section-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Layers size={18} /> Architectural Execution Seams
            </h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14, marginTop: 14 }}>
              {seams.map((s) => {
                const key = typeof s === "string" ? s : s.key;
                const Icon = seamIcons[key] || Box;
                return (
                  <div key={key} style={{ background: "var(--md-sys-color-background)", border: "1px solid var(--border-color)", borderRadius: 6, padding: "14px 16px", display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{ width: 36, height: 36, borderRadius: 8, background: "rgba(56, 189, 248, 0.12)", color: "var(--md-sys-color-primary)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <Icon size={18} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>seam:{key}</div>
                      <div style={{ fontSize: "0.75rem", color: "var(--md-sys-color-outline)" }}>{typeof s === "object" ? s.description : "Policy checked"}</div>
                    </div>
                    <CheckCircle2 size={16} color="var(--md-sys-color-success)" />
                  </div>
                );
              })}
            </div>
          </div>

          {/* Capability Plugins Grid */}
          <div className="abyx-section-card">
            <h2 className="abyx-section-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Box size={18} /> Registered Capability Plugins
            </h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14, marginTop: 14 }}>
              {plugins.map((pluginName) => (
                <div key={pluginName} style={{ background: "var(--md-sys-color-background)", border: "1px solid var(--border-color)", borderRadius: 6, padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span className="abyx-status-indicator live" />
                    <span style={{ fontSize: "0.85rem", fontWeight: 500, fontFamily: "monospace" }}>{pluginName}</span>
                  </div>
                  <span style={{ fontSize: "0.75rem", color: "var(--md-sys-color-outline)" }}>Active</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Terminal Runner Tab */}
      {activeTab === "terminal" && (
        <div style={{ marginTop: 18 }}>
          <TerminalConsole />
        </div>
      )}

      {/* Harness & Model Runtime Controls Drawer */}
      <HarnessControlsDrawer
        isOpen={isControlsOpen}
        onClose={() => setIsControlsOpen(false)}
        onConfigSaved={() => {
          loadBaseData();
          loadAgentRuns();
        }}
      />
    </div>
  );
}
