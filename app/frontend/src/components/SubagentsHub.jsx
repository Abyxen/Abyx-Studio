import React, { useState, useEffect } from "react";
import {
  Users,
  Search,
  Globe,
  Code2,
  Palette,
  ShieldAlert,
  CheckCircle2,
  Zap,
  Play,
  RotateCcw,
  Clock,
  Cpu,
  Copy,
  Check,
  Terminal,
  Bot
} from "lucide-react";
import { listSubagents, invokeSubagent } from "../services/api";

const ICON_MAP = {
  search: Search,
  globe: Globe,
  code: Code2,
  sun: Palette,
  shield: ShieldAlert,
  check: CheckCircle2,
  zap: Zap
};

export default function SubagentsHub() {
  const [subagents, setSubagents] = useState([]);
  const [selectedAgentId, setSelectedAgentId] = useState("coder");
  const [taskPrompt, setTaskPrompt] = useState("");
  const [context, setContext] = useState("");
  const [model, setModel] = useState("auto");
  const [loading, setLoading] = useState(false);
  const [executionResult, setExecutionResult] = useState(null);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    loadSubagents();
  }, []);

  const loadSubagents = async () => {
    try {
      const res = await listSubagents();
      if (res?.ok && Array.isArray(res.subagents)) {
        setSubagents(res.subagents);
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const handleInvoke = async (e) => {
    e.preventDefault();
    if (!taskPrompt.trim() || loading) return;
    setLoading(true);
    setError(null);
    setExecutionResult(null);

    try {
      const res = await invokeSubagent({
        subagentId: selectedAgentId,
        taskPrompt: taskPrompt.trim(),
        context: context.trim(),
        model: model || "auto"
      });
      if (res?.ok) {
        setExecutionResult(res);
      } else {
        setError(res?.error || "Subagent execution failed.");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    if (!executionResult?.response) return;
    navigator.clipboard.writeText(executionResult.response);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const selectedAgent = subagents.find(s => s.id === selectedAgentId);

  return (
    <div className="abyx-page-container">
      {/* Header */}
      <div className="abyx-page-header">
        <div className="abyx-page-title-row">
          <div className="abyx-page-title-wrap">
            <Users className="abyx-header-icon" size={26} />
            <div>
              <h1 className="abyx-page-title">Subagents Hub & Teamwork</h1>
              <p className="abyx-page-subtitle">
                Deploy specialized agent personas inspired by Antigravity Swarm architecture. Dispatch focused tasks to dedicated expert agents.
              </p>
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="abyx-banner error" style={{ marginBottom: 16 }}>
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} style={{ background: "none", border: "none", color: "inherit", cursor: "pointer" }}>×</button>
        </div>
      )}

      {/* Personas Grid */}
      <div style={{ marginBottom: 24 }}>
        <h3 style={{ fontSize: "0.95rem", fontWeight: 600, margin: "0 0 12px" }}>Specialized Agent Roster</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 14 }}>
          {subagents.map(agent => {
            const IconComponent = ICON_MAP[agent.icon] || Bot;
            const isSelected = agent.id === selectedAgentId;
            return (
              <div
                key={agent.id}
                onClick={() => setSelectedAgentId(agent.id)}
                className="abyx-card"
                style={{
                  padding: 16,
                  cursor: "pointer",
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  borderColor: isSelected ? "var(--accent-color, #ff6a3d)" : "var(--border-color, #333)",
                  backgroundColor: isSelected ? "var(--md-sys-color-surface-variant, #24242c)" : "var(--md-sys-color-surface)"
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 8,
                      backgroundColor: isSelected ? "rgba(255, 106, 61, 0.2)" : "rgba(255,255,255,0.06)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: isSelected ? "var(--accent-color, #ff6a3d)" : "inherit"
                    }}
                  >
                    <IconComponent size={18} />
                  </div>
                  <div>
                    <div style={{ fontSize: "0.9rem", fontWeight: 600 }}>{agent.name}</div>
                    <div style={{ fontSize: "0.74rem", color: "var(--accent-color, #ff6a3d)", fontWeight: 500 }}>
                      {agent.role}
                    </div>
                  </div>
                </div>
                <p style={{ fontSize: "0.8rem", color: "var(--md-sys-color-outline)", margin: 0, lineHeight: 1.4 }}>
                  {agent.description}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Task Dispatcher & Output Split View */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, alignItems: "start" }}>
        {/* Left: Dispatch Form */}
        <div className="abyx-card" style={{ padding: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
            <Terminal size={18} style={{ color: "var(--accent-color, #ff6a3d)" }} />
            <h3 style={{ margin: 0, fontSize: "1rem" }}>
              Dispatch Task to {selectedAgent ? selectedAgent.name : "Subagent"}
            </h3>
          </div>

          <form onSubmit={handleInvoke} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <label style={{ fontSize: "0.85rem", fontWeight: 600, display: "block", marginBottom: 6 }}>
                Task Assignment / Prompt
              </label>
              <textarea
                rows={4}
                placeholder={`Describe the assignment for the ${selectedAgent?.role || "agent"}...`}
                value={taskPrompt}
                onChange={(e) => setTaskPrompt(e.target.value)}
                style={{
                  width: "100%",
                  padding: "10px 14px",
                  borderRadius: 6,
                  border: "1px solid var(--border-color, #444)",
                  backgroundColor: "var(--md-sys-color-background)",
                  color: "inherit",
                  fontSize: "0.9rem",
                  resize: "vertical"
                }}
                required
              />
            </div>

            <div>
              <label style={{ fontSize: "0.85rem", fontWeight: 600, display: "block", marginBottom: 6 }}>
                Context (Optional code, diff, or documents)
              </label>
              <textarea
                rows={3}
                placeholder="Paste code snippet, documentation, or relevant background details..."
                value={context}
                onChange={(e) => setContext(e.target.value)}
                style={{
                  width: "100%",
                  padding: "10px 14px",
                  borderRadius: 6,
                  border: "1px solid var(--border-color, #444)",
                  backgroundColor: "var(--md-sys-color-background)",
                  color: "inherit",
                  fontSize: "0.85rem",
                  resize: "vertical"
                }}
              />
            </div>

            <div>
              <label style={{ fontSize: "0.85rem", fontWeight: 600, display: "block", marginBottom: 6 }}>
                Execution Routing
              </label>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  borderRadius: 6,
                  border: "1px solid var(--border-color, #444)",
                  backgroundColor: "var(--md-sys-color-background)",
                  color: "inherit",
                  fontSize: "0.88rem"
                }}
              >
                <option value="auto">Auto (Best Model Routing via Cloud / Ollama)</option>
                <option value="abyx:1.1">Ollama Native (abyx:1.1)</option>
                <option value="deepseek-r1:latest">Ollama Reasoning (deepseek-r1)</option>
              </select>
            </div>

            <button
              type="submit"
              className="abyx-btn abyx-btn-primary"
              style={{ marginTop: 6 }}
              disabled={loading || !taskPrompt.trim()}
            >
              <Play size={15} />
              <span>{loading ? "Agent Working..." : "Dispatch Subagent"}</span>
            </button>
          </form>
        </div>

        {/* Right: Execution Output & Telemetry */}
        <div className="abyx-card" style={{ padding: 20, minHeight: 380, display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <h3 style={{ margin: 0, fontSize: "1rem" }}>Execution Telemetry & Report</h3>
            {executionResult && (
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <span style={{ fontSize: "0.78rem", color: "var(--md-sys-color-outline)" }}>
                  {executionResult.duration_ms} ms
                </span>
                <button
                  type="button"
                  className="abyx-btn abyx-btn-secondary"
                  style={{ padding: "4px 8px", fontSize: "0.75rem" }}
                  onClick={handleCopy}
                >
                  {copied ? <Check size={12} /> : <Copy size={12} />}
                  <span>{copied ? "Copied" : "Copy"}</span>
                </button>
              </div>
            )}
          </div>

          <div style={{ flex: 1, backgroundColor: "var(--md-sys-color-background)", borderRadius: 6, border: "1px solid var(--border-color, #333)", padding: 16, overflowY: "auto" }}>
            {loading ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--md-sys-color-outline)", gap: 10 }}>
                <RotateCcw size={24} className="spin" />
                <span style={{ fontSize: "0.88rem" }}>Subagent reasoning and executing directives...</span>
              </div>
            ) : executionResult ? (
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, paddingBottom: 8, borderBottom: "1px solid var(--border-color, #333)" }}>
                  <span style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--accent-color, #ff6a3d)" }}>
                    {executionResult.subagent?.name}
                  </span>
                  <span style={{ fontSize: "0.75rem", color: "var(--md-sys-color-outline)" }}>
                    Model: {executionResult.model}
                  </span>
                </div>
                <div style={{ whiteSpace: "pre-wrap", fontSize: "0.88rem", lineHeight: 1.6 }}>
                  {executionResult.response}
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--md-sys-color-outline)", textAlign: "center" }}>
                <Bot size={36} style={{ opacity: 0.4, marginBottom: 8 }} />
                <span style={{ fontSize: "0.88rem" }}>No subagent task dispatched yet.</span>
                <span style={{ fontSize: "0.78rem", marginTop: 4 }}>
                  Select an agent persona on the left and dispatch an assignment to view its structured analysis.
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
