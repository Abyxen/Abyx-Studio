import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Cpu, RefreshCw, CheckCircle2, ShieldCheck, Box, Layers, Terminal, Globe,
  HardDrive, Brain, Play, Square, AlertCircle, FileText, FolderPlus, FilePlus,
  Trash2, Move, Download, ExternalLink, Search, Sparkles, Check, X, Eye, FileCode, Users
} from "lucide-react";
import SubagentsHub from "./SubagentsHub";
import {
  getHarnessStatus, getHarnessPlugins, getHarnessSeams,
  startAgentRun, listAgentRuns, getPendingApprovals, resolveAgentApproval, cancelAgentRun,
  listHarnessWorkspaceFiles, saveWorkspaceFile, createWorkspaceFolder, moveWorkspacePath, deleteWorkspacePath,
  generateWorkspaceFile, openWorkspacePath,
  searchBrowserWeb, browseWebPage, openSystemBrowser,
  getSkillsCatalog, executeResearchWorkflow
} from "../services/api";
import "../styles/abyx.css";

export default function HarnessManager({ showAlert, onOpenBrowser, activeProject }) {
  const [activeTab, setActiveTab] = useState("agent");
  const [loading, setLoading] = useState(false);

  // 1. Harness Status & Seams
  const [status, setStatus] = useState(null);
  const [plugins, setPlugins] = useState([]);
  const [seams, setSeams] = useState([]);

  // 2. Agent Tasks
  const [taskInput, setTaskInput] = useState("");
  const [taskModel, setTaskModel] = useState("auto");
  const [maxSteps, setMaxSteps] = useState(8);
  const [activeRun, setActiveRun] = useState(null);
  const [runHistory, setRunHistory] = useState([]);
  const [pendingApprovals, setPendingApprovals] = useState([]);
  const [isExecuting, setIsExecuting] = useState(false);

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

  useEffect(() => {
    loadBaseData();
    loadAgentRuns();
    loadFiles();
    loadSkills();
  }, [loadBaseData, loadAgentRuns, loadFiles, loadSkills]);

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

  // Run Agent Task
  const handleStartTask = async () => {
    if (!taskInput.trim()) {
      showAlert?.({ title: "Required", message: "Please enter a task description.", danger: true });
      return;
    }
    setIsExecuting(true);
    try {
      const res = await startAgentRun({
        task: taskInput.trim(),
        model: taskModel,
        max_steps: maxSteps,
        async: false,
      });

      if (res.ok && res.run) {
        setActiveRun(res.run);
        showAlert?.({ title: "Task Completed", message: `Agent completed task in ${res.run.stepsExecuted || 1} step(s).` });
      } else if (res.ok && res.runId) {
        showAlert?.({ title: "Task Started", message: `Agent task launched (ID: ${res.runId}).` });
      } else {
        showAlert?.({ title: "Task Status", message: res.run?.finalOutput || res.error || "Agent task finished with remarks." });
        if (res.run) setActiveRun(res.run);
      }
      loadAgentRuns();
      loadFiles();
    } catch (err) {
      showAlert?.({ title: "Execution Error", message: err.message, danger: true });
    } finally {
      setIsExecuting(false);
    }
  };

  const handleCancelRun = async () => {
    if (!activeRun?.id) return;
    try {
      await cancelAgentRun(activeRun.id, "Cancelled by user");
      showAlert?.({ title: "Cancelled", message: "Agent run was cancelled." });
      loadAgentRuns();
      setIsExecuting(false);
    } catch (err) {
      showAlert?.({ title: "Error", message: err.message, danger: true });
    }
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
          <button className="abyx-btn" onClick={() => { loadBaseData(); loadAgentRuns(); loadFiles(); loadSkills(); }} disabled={loading}>
            <RefreshCw size={14} className={loading ? "spin" : ""} /> Refresh All
          </button>
        </div>

        {/* Tab Navigation */}
        <div style={{ display: "flex", gap: 8, marginTop: 18, borderBottom: "1px solid var(--border-color)", paddingBottom: 8, overflowX: "auto" }}>
          {[
            { id: "agent", label: "Agent Tasks & Loop", icon: Play },
            { id: "subagents", label: "Subagent Team (7)", icon: Users },
            { id: "skills", label: "Skills (76)", icon: Sparkles },
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
      {/* TAB 1: AGENT TASKS & EXECUTION LOOP                      */}
      {/* ======================================================== */}
      {activeTab === "agent" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Pending Approvals Alert Banner */}
          {pendingApprovals.length > 0 && (
            <div style={{ background: "rgba(234, 179, 8, 0.12)", border: "1px solid #eab308", borderRadius: 8, padding: "16px 20px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 600, color: "#eab308", marginBottom: 8 }}>
                <AlertCircle size={20} /> Human-In-The-Loop Approval Required ({pendingApprovals.length})
              </div>
              <p style={{ fontSize: "0.85rem", color: "var(--md-sys-color-on-surface)", margin: "0 0 12px 0" }}>
                The agent proposes high-impact actions that require your explicit confirmation to proceed.
              </p>
              {pendingApprovals.map((appr) => (
                <div key={appr.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "var(--card-bg)", padding: 12, borderRadius: 6, marginBottom: 8 }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: "0.85rem" }}>Tool: {appr.toolName}</div>
                    <div style={{ fontSize: "0.78rem", color: "var(--md-sys-color-outline)" }}>{appr.reason}</div>
                    {appr.preview && <pre style={{ margin: "4px 0 0 0", fontSize: "0.75rem", background: "rgba(0,0,0,0.3)", padding: 4, borderRadius: 4 }}>{appr.preview}</pre>}
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="abyx-btn" style={{ background: "var(--md-sys-color-success)", color: "#fff", borderColor: "transparent" }} onClick={() => handleResolveApproval(appr.id, true)}>
                      <Check size={14} /> Approve
                    </button>
                    <button className="abyx-btn" style={{ background: "var(--md-sys-color-error)", color: "#fff", borderColor: "transparent" }} onClick={() => handleResolveApproval(appr.id, false)}>
                      <X size={14} /> Deny
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* New Task Dispatcher Card */}
          <div className="abyx-section-card">
            <h2 className="abyx-section-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Play size={18} color="var(--md-sys-color-primary)" /> Bounded Agent Task Dispatcher
            </h2>
            <p style={{ fontSize: "0.85rem", color: "var(--md-sys-color-outline)", marginTop: 4, marginBottom: 16 }}>
              Provide a natural-language goal. The agent plans, calls sandboxed workspace tools (filesystem, document generation, web search), and records every event.
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
                    <span className={`abyx-status-indicator ${activeRun.status === "completed" ? "live" : activeRun.status === "running" ? "warning" : "offline"}`} />
                    Run: {activeRun.goal}
                  </h3>
                  <div style={{ fontSize: "0.78rem", color: "var(--md-sys-color-outline)", marginTop: 4 }}>
                    Status: <strong style={{ textTransform: "uppercase" }}>{activeRun.status}</strong> Â· Steps: {activeRun.stepsExecuted || 0}/{activeRun.maxSteps} Â· Model: {activeRun.model}
                  </div>
                </div>
                <span className="abyx-pill" style={{ textTransform: "capitalize" }}>{activeRun.status}</span>
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
                  <div key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", background: "var(--card-bg)", borderRadius: 6, border: "1px solid var(--border-color)", cursor: "pointer" }} onClick={() => setActiveRun(r)}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: "0.85rem" }}>{r.goal}</div>
                      <div style={{ fontSize: "0.74rem", color: "var(--md-sys-color-outline)" }}>{new Date(r.startTime).toLocaleString()} Â· {r.stepsExecuted || 0} steps Â· {r.model}</div>
                    </div>
                    <span className="abyx-pill" style={{ textTransform: "capitalize" }}>{r.status}</span>
                  </div>
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
              <Globe size={18} color="var(--md-sys-color-primary)" /> Sandboxed Web Search &amp; Browser Reader
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
              {skills.filter(s => !skillFilter || s.id.toLowerCase().includes(skillFilter.toLowerCase()) || (s.name || "").toLowerCase().includes(skillFilter.toLowerCase())).map((skill) => (
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
              <span className="abyx-stat-label">Sandbox Security</span>
              <span className="abyx-stat-value" style={{ fontSize: "1.35rem", color: "var(--md-sys-color-success)" }}>Enforced</span>
              <span className="abyx-stat-meta">Windows DPAPI &amp; Workspace Isolation</span>
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
                      <div style={{ fontSize: "0.75rem", color: "var(--md-sys-color-outline)" }}>{typeof s === "object" ? s.description : "Bound & Sandboxed"}</div>
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
    </div>
  );
}
