import React, { useState, useEffect } from "react";
import {
  CalendarClock,
  Play,
  Pause,
  RotateCcw,
  Plus,
  Trash2,
  Sparkles,
  CheckCircle,
  AlertCircle,
  Clock,
  Activity,
  Workflow,
  ArrowRight,
  Terminal,
  Settings
} from "lucide-react";
import {
  listAutomations,
  createAutomation,
  runAutomation,
  pauseAutomation,
  resumeAutomation,
  deleteAutomation,
  proposeAutomation
} from "../services/api";

export default function AutomationsManager() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);

  // Proposal state
  const [proposalPrompt, setProposalPrompt] = useState("");
  const [proposing, setProposing] = useState(false);
  const [proposal, setProposal] = useState(null);

  // Manual create modal
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newTrigger, setNewTrigger] = useState("interval"); // 'interval', 'manual'
  const [newMinutes, setNewMinutes] = useState(60);
  const [newStepTool, setNewStepTool] = useState("system_info");
  const [newStepName, setNewStepName] = useState("Inspect System Specs");

  // Run execution state
  const [runningTaskId, setRunningTaskId] = useState(null);
  const [runLogModal, setRunLogModal] = useState(null);

  useEffect(() => {
    loadTasks();
  }, []);

  const loadTasks = async () => {
    setLoading(true);
    try {
      const res = await listAutomations();
      if (res?.ok && Array.isArray(res.tasks)) {
        setTasks(res.tasks);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handlePropose = async (e) => {
    e.preventDefault();
    if (!proposalPrompt.trim() || proposing) return;
    setProposing(true);
    setError(null);
    try {
      const res = await proposeAutomation(proposalPrompt.trim());
      if (res?.ok && res.proposedAutomation) {
        setProposal(res.proposedAutomation);
      } else {
        setError(res?.error || "Could not synthesize workflow proposal.");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setProposing(false);
    }
  };

  const handleAcceptProposal = async () => {
    if (!proposal) return;
    try {
      const res = await createAutomation({
        name: proposal.name || "AI Suggested Workflow",
        description: proposal.description || proposalPrompt,
        triggerType: proposal.trigger?.type || "interval",
        intervalMinutes: proposal.trigger?.intervalMinutes || 60,
        steps: proposal.steps || [{ name: "Automated Task", tool: "custom_task" }]
      });
      if (res?.ok && res.task) {
        setTasks(prev => [res.task, ...prev]);
        setProposal(null);
        setProposalPrompt("");
        setSuccessMessage(`Automation "${res.task.name}" created and scheduled!`);
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const handleManualCreate = async (e) => {
    e.preventDefault();
    if (!newName.trim()) return;
    try {
      const res = await createAutomation({
        name: newName.trim(),
        description: newDesc.trim(),
        triggerType: newTrigger,
        intervalMinutes: newTrigger === "interval" ? Number(newMinutes) || 60 : 0,
        steps: [{ name: newStepName.trim() || "Step 1", tool: newStepTool }]
      });
      if (res?.ok && res.task) {
        setTasks(prev => [res.task, ...prev]);
        setCreateModalOpen(false);
        setNewName("");
        setNewDesc("");
        setSuccessMessage(`Automation "${res.task.name}" created successfully!`);
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const handleRunTask = async (id) => {
    setRunningTaskId(id);
    try {
      const res = await runAutomation(id);
      setRunLogModal(res);
      loadTasks();
    } catch (err) {
      setError(err.message);
    } finally {
      setRunningTaskId(null);
    }
  };

  const handleTogglePause = async (task) => {
    try {
      if (task.enabled) {
        await pauseAutomation(task.id);
      } else {
        await resumeAutomation(task.id);
      }
      loadTasks();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDeleteTask = async (id) => {
    if (!window.confirm("Delete this scheduled automation?")) return;
    try {
      await deleteAutomation(id);
      setTasks(prev => prev.filter(t => t.id !== id));
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="abyx-page-container">
      {/* Header */}
      <div className="abyx-page-header">
        <div className="abyx-page-title-row">
          <div className="abyx-page-title-wrap">
            <CalendarClock className="abyx-header-icon" size={26} />
            <div>
              <h1 className="abyx-page-title">Scheduled Automations Hub</h1>
              <p className="abyx-page-subtitle">
                Background task execution and autonomous routines. Schedule interval tasks, trigger manual runs, or let AI generate multi-step workflows.
              </p>
            </div>
          </div>
          <div className="abyx-header-actions">
            <button
              type="button"
              className="abyx-btn abyx-btn-secondary"
              onClick={loadTasks}
              title="Refresh task list"
            >
              <RotateCcw size={15} />
              <span>Refresh</span>
            </button>
            <button
              type="button"
              className="abyx-btn abyx-btn-primary"
              onClick={() => setCreateModalOpen(true)}
            >
              <Plus size={16} />
              <span>Create Task</span>
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="abyx-banner error" style={{ marginBottom: 16 }}>
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} style={{ background: "none", border: "none", color: "inherit", cursor: "pointer" }}>×</button>
        </div>
      )}

      {successMessage && (
        <div className="abyx-banner success" style={{ marginBottom: 16 }}>
          <span>{successMessage}</span>
          <button type="button" onClick={() => setSuccessMessage(null)} style={{ background: "none", border: "none", color: "inherit", cursor: "pointer" }}>×</button>
        </div>
      )}

      {/* AI Natural Language Workflow Proposer Card */}
      <div className="abyx-card" style={{ padding: 18, marginBottom: 24, backgroundColor: "var(--md-sys-color-surface-variant, #1e1e24)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <Sparkles size={18} style={{ color: "var(--accent-color, #ff6a3d)" }} />
          <span style={{ fontSize: "0.95rem", fontWeight: 600 }}>Natural Language Workflow Generator</span>
        </div>
        <p style={{ fontSize: "0.85rem", color: "var(--md-sys-color-outline)", margin: "0 0 12px" }}>
          Describe what you want to automate in plain English (e.g., "Check machine telemetry every 30 minutes and warn on high memory").
        </p>
        <form onSubmit={handlePropose} style={{ display: "flex", gap: 10 }}>
          <input
            type="text"
            placeholder="e.g. Inspect git changes and summarize project diffs daily"
            value={proposalPrompt}
            onChange={(e) => setProposalPrompt(e.target.value)}
            style={{
              flex: 1,
              padding: "10px 14px",
              borderRadius: 6,
              border: "1px solid var(--border-color, #444)",
              backgroundColor: "var(--md-sys-color-background)",
              color: "inherit",
              fontSize: "0.9rem"
            }}
            disabled={proposing}
          />
          <button
            type="submit"
            className="abyx-btn abyx-btn-primary"
            disabled={proposing || !proposalPrompt.trim()}
          >
            <Sparkles size={15} />
            <span>{proposing ? "Synthesizing..." : "Propose Workflow"}</span>
          </button>
        </form>

        {/* Generated Proposal Preview */}
        {proposal && (
          <div style={{ marginTop: 16, padding: 14, borderRadius: 8, backgroundColor: "var(--md-sys-color-surface)", border: "1px solid var(--accent-color, #ff6a3d)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div style={{ fontWeight: 600, fontSize: "0.95rem" }}>
                Proposed: {proposal.name}
              </div>
              <span style={{ fontSize: "0.8rem", color: "var(--accent-color, #ff6a3d)", fontWeight: 500 }}>
                {proposal.trigger?.summary || "Scheduled interval"}
              </span>
            </div>
            <p style={{ fontSize: "0.85rem", color: "var(--md-sys-color-outline)", margin: "0 0 10px" }}>
              {proposal.description || "Generated multi-step workflow"}
            </p>
            {Array.isArray(proposal.steps) && proposal.steps.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
                {proposal.steps.map((st, sIdx) => (
                  <div key={sIdx} style={{ fontSize: "0.82rem", display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ backgroundColor: "var(--border-color)", padding: "1px 6px", borderRadius: 4 }}>{sIdx + 1}</span>
                    <span>{st.name || st.tool}</span>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button type="button" className="abyx-btn abyx-btn-secondary" onClick={() => setProposal(null)}>Discard</button>
              <button type="button" className="abyx-btn abyx-btn-primary" onClick={handleAcceptProposal}>Accept & Save Task</button>
            </div>
          </div>
        )}
      </div>

      {/* Automations List */}
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: "0.95rem", fontWeight: 600 }}>Active & Scheduled Tasks ({tasks.length})</span>
        </div>

        {tasks.length === 0 ? (
          <div className="abyx-card" style={{ padding: 40, textAlign: "center", color: "var(--md-sys-color-outline)" }}>
            <Workflow size={40} style={{ margin: "0 auto 12px", opacity: 0.5 }} />
            <h3 style={{ margin: "0 0 6px", color: "var(--md-sys-color-on-background)" }}>No Automations Configured</h3>
            <p style={{ fontSize: "0.88rem", maxWidth: 440, margin: "0 auto 16px" }}>
              Automations run repetitive tasks, background checks, and scheduled workflows locally on your PC.
            </p>
            <button type="button" className="abyx-btn abyx-btn-primary" onClick={() => setCreateModalOpen(true)}>
              <Plus size={16} />
              <span>Create Your First Automation</span>
            </button>
          </div>
        ) : (
          tasks.map(task => (
            <div
              key={task.id}
              className="abyx-card"
              style={{
                padding: 18,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 16
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <div
                  style={{
                    width: 42,
                    height: 42,
                    borderRadius: "50%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: task.enabled ? "rgba(34, 197, 94, 0.15)" : "rgba(239, 68, 68, 0.15)",
                    color: task.enabled ? "#22c55e" : "#ef4444",
                    flexShrink: 0
                  }}
                >
                  <Clock size={20} />
                </div>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontWeight: 600, fontSize: "1rem" }}>{task.name}</span>
                    <span
                      style={{
                        fontSize: "0.72rem",
                        padding: "2px 8px",
                        borderRadius: 10,
                        backgroundColor: task.enabled ? "rgba(34, 197, 94, 0.2)" : "rgba(245, 158, 11, 0.2)",
                        color: task.enabled ? "#22c55e" : "#f59e0b",
                        fontWeight: 600,
                        textTransform: "uppercase"
                      }}
                    >
                      {task.status || (task.enabled ? "active" : "paused")}
                    </span>
                  </div>
                  <div style={{ fontSize: "0.84rem", color: "var(--md-sys-color-outline)", marginTop: 4 }}>
                    {task.trigger?.summary || (task.trigger?.type === "manual" ? "Manual trigger" : `Every ${task.trigger?.intervalMinutes || 60}m`)}
                    {" • "}
                    {task.steps?.length || 1} steps
                    {task.lastRun && ` • Last ran ${new Date(task.lastRun).toLocaleTimeString()}`}
                  </div>
                  {task.lastLog && (
                    <div style={{ fontSize: "0.78rem", color: "var(--md-sys-color-outline)", marginTop: 4, fontFamily: "monospace" }}>
                      Log: {task.lastLog.slice(0, 90)}
                    </div>
                  )}
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button
                  type="button"
                  className="abyx-btn abyx-btn-secondary"
                  onClick={() => handleRunTask(task.id)}
                  disabled={runningTaskId === task.id}
                  title="Run this automation immediately"
                >
                  <Play size={14} />
                  <span>{runningTaskId === task.id ? "Running..." : "Run Now"}</span>
                </button>
                <button
                  type="button"
                  className="abyx-btn abyx-btn-secondary"
                  onClick={() => handleTogglePause(task)}
                  title={task.enabled ? "Pause schedule" : "Resume schedule"}
                >
                  {task.enabled ? <Pause size={14} /> : <Play size={14} />}
                  <span>{task.enabled ? "Pause" : "Resume"}</span>
                </button>
                <button
                  type="button"
                  className="abyx-btn abyx-btn-secondary"
                  style={{ color: "#ef4444" }}
                  onClick={() => handleDeleteTask(task.id)}
                  title="Delete automation"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Modal: Manual Task Creation */}
      {createModalOpen && (
        <div className="abyx-modal-backdrop" onClick={() => setCreateModalOpen(false)}>
          <div className="abyx-modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <h3 style={{ margin: "0 0 16px" }}>Create Scheduled Automation</h3>
            <form onSubmit={handleManualCreate} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label style={{ fontSize: "0.85rem", fontWeight: 600, display: "block", marginBottom: 6 }}>Task Name</label>
                <input
                  type="text"
                  placeholder="e.g. Daily Spec Inspection"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--border-color, #444)", backgroundColor: "var(--md-sys-color-background)", color: "inherit" }}
                  required
                />
              </div>

              <div>
                <label style={{ fontSize: "0.85rem", fontWeight: 600, display: "block", marginBottom: 6 }}>Trigger Type</label>
                <select
                  value={newTrigger}
                  onChange={(e) => setNewTrigger(e.target.value)}
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--border-color, #444)", backgroundColor: "var(--md-sys-color-background)", color: "inherit" }}
                >
                  <option value="interval">Recurring Interval</option>
                  <option value="manual">Manual Execution Only</option>
                </select>
              </div>

              {newTrigger === "interval" && (
                <div>
                  <label style={{ fontSize: "0.85rem", fontWeight: 600, display: "block", marginBottom: 6 }}>Interval (Minutes)</label>
                  <input
                    type="number"
                    min="1"
                    value={newMinutes}
                    onChange={(e) => setNewMinutes(e.target.value)}
                    style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--border-color, #444)", backgroundColor: "var(--md-sys-color-background)", color: "inherit" }}
                  />
                </div>
              )}

              <div>
                <label style={{ fontSize: "0.85rem", fontWeight: 600, display: "block", marginBottom: 6 }}>Step 1: Action Tool</label>
                <select
                  value={newStepTool}
                  onChange={(e) => setNewStepTool(e.target.value)}
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--border-color, #444)", backgroundColor: "var(--md-sys-color-background)", color: "inherit" }}
                >
                  <option value="system_info">System Specs & Hardware Telemetry</option>
                  <option value="calculate_or_eval">Math & Python Computation Engine</option>
                  <option value="custom_task">Custom Workspace Script</option>
                </select>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 10 }}>
                <button type="button" className="abyx-btn abyx-btn-secondary" onClick={() => setCreateModalOpen(false)}>Cancel</button>
                <button type="submit" className="abyx-btn abyx-btn-primary" disabled={!newName.trim()}>Create Automation</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Run Log Viewer */}
      {runLogModal && (
        <div className="abyx-modal-backdrop" onClick={() => setRunLogModal(null)}>
          <div className="abyx-modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
            <h3 style={{ margin: "0 0 12px", display: "flex", alignItems: "center", gap: 8 }}>
              <Terminal size={18} />
              <span>Automation Run Log</span>
            </h3>
            <div style={{ backgroundColor: "#111", padding: 14, borderRadius: 6, fontFamily: "monospace", fontSize: "0.82rem", maxHeight: 260, overflowY: "auto", whiteSpace: "pre-wrap" }}>
              {runLogModal.log || JSON.stringify(runLogModal, null, 2)}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
              <button type="button" className="abyx-btn abyx-btn-secondary" onClick={() => setRunLogModal(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
