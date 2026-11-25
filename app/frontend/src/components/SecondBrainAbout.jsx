import React, { useState, useEffect } from "react";
import {
  Brain,
  Layers,
  ExternalLink,
  RefreshCw,
  CheckCircle2,
  FolderOpen,
  Wrench,
  Server,
  Plus,
  Trash2,
  ToggleLeft,
  ToggleRight,
  ShieldCheck,
  Cpu,
  Flame,
  Info
} from "lucide-react";
import {
  getObsidianStatus,
  syncObsidian,
  openObsidian,
  getMcpServers,
  addMcpServer,
  toggleMcpServer,
  deleteMcpServer
} from "../services/api";

export default function SecondBrainAbout() {
  const [obsidianStatus, setObsidianStatus] = useState(null);
  const [mcpConfig, setMcpConfig] = useState(null);
  const [mcpTools, setMcpTools] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);

  // Add MCP server modal
  const [addMcpOpen, setAddMcpOpen] = useState(false);
  const [serverName, setServerName] = useState("");
  const [serverDesc, setServerDesc] = useState("");
  const [serverCommand, setServerCommand] = useState("npx");
  const [serverArgs, setServerArgs] = useState("");

  useEffect(() => {
    loadAll();
  }, []);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [obsRes, mcpRes] = await Promise.all([
        getObsidianStatus().catch(() => null),
        getMcpServers().catch(() => null)
      ]);
      if (obsRes) setObsidianStatus(obsRes);
      if (mcpRes?.ok) {
        setMcpConfig(mcpRes.servers || {});
        setMcpTools(mcpRes.tools || []);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSyncObsidian = async () => {
    setSyncing(true);
    setError(null);
    try {
      const res = await syncObsidian();
      if (res?.ok || res?.success) {
        setSuccessMessage("Obsidian vault memories and conversations synced successfully!");
        setObsidianStatus(prev => ({ ...prev, ...res }));
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSyncing(false);
    }
  };

  const handleOpenObsidian = async () => {
    setOpening(true);
    try {
      await openObsidian();
      setSuccessMessage("Obsidian launch signal sent!");
    } catch (err) {
      setError(err.message);
    } finally {
      setOpening(false);
    }
  };

  const handleToggleMcpServer = async (name, currentEnabled) => {
    try {
      await toggleMcpServer(name, !currentEnabled);
      loadAll();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDeleteMcpServer = async (name) => {
    if (!window.confirm(`Delete MCP server "${name}"?`)) return;
    try {
      await deleteMcpServer(name);
      loadAll();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleAddMcpServer = async (e) => {
    e.preventDefault();
    if (!serverName.trim()) return;
    try {
      const res = await addMcpServer({
        name: serverName.trim(),
        description: serverDesc.trim(),
        command: serverCommand.trim() || "npx",
        args: serverArgs.trim() ? serverArgs.trim().split(" ") : []
      });
      if (res?.ok) {
        setAddMcpOpen(false);
        setServerName("");
        setServerDesc("");
        setServerArgs("");
        setSuccessMessage(`MCP server "${serverName}" registered!`);
        loadAll();
      }
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
            <Brain className="abyx-header-icon" size={26} />
            <div>
              <h1 className="abyx-page-title">Second Brain, MCP & About ABYX</h1>
              <p className="abyx-page-subtitle">
                Obsidian vault synchronization, Model Context Protocol (MCP) tool integration, and ABYX independent architecture.
              </p>
            </div>
          </div>
          <div className="abyx-header-actions">
            <button
              type="button"
              className="abyx-btn abyx-btn-secondary"
              onClick={loadAll}
              title="Refresh status"
            >
              <RefreshCw size={15} />
              <span>Refresh</span>
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

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, alignItems: "start" }}>
        {/* Left Column: Obsidian Second Brain & MCP */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Obsidian Second Brain Card */}
          <div className="abyx-card" style={{ padding: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Brain size={22} style={{ color: "var(--accent-color, #ff6a3d)" }} />
                <h3 style={{ margin: 0, fontSize: "1.05rem" }}>Obsidian Second Brain</h3>
              </div>
              <span
                style={{
                  fontSize: "0.74rem",
                  padding: "3px 8px",
                  borderRadius: 10,
                  backgroundColor: obsidianStatus?.vaultExists ? "rgba(34, 197, 94, 0.2)" : "rgba(245, 158, 11, 0.2)",
                  color: obsidianStatus?.vaultExists ? "#22c55e" : "#f59e0b",
                  fontWeight: 600
                }}
              >
                {obsidianStatus?.vaultExists ? "VAULT CONNECTED" : "VAULT READY"}
              </span>
            </div>

            <p style={{ fontSize: "0.85rem", color: "var(--md-sys-color-outline)", margin: "0 0 16px", lineHeight: 1.5 }}>
              Automatically mirrors conversations, living memories, and knowledge sources into your Obsidian markdown vault for lifelong second-brain recall.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 18, fontSize: "0.85rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px", backgroundColor: "var(--md-sys-color-surface-variant, #222)", borderRadius: 6 }}>
                <span style={{ color: "var(--md-sys-color-outline)" }}>Vault Name</span>
                <span style={{ fontWeight: 600 }}>{obsidianStatus?.vaultName || "Abyx_Brain"}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px", backgroundColor: "var(--md-sys-color-surface-variant, #222)", borderRadius: 6 }}>
                <span style={{ color: "var(--md-sys-color-outline)" }}>Vault Path</span>
                <span style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{obsidianStatus?.vaultPath || "--"}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px", backgroundColor: "var(--md-sys-color-surface-variant, #222)", borderRadius: 6 }}>
                <span style={{ color: "var(--md-sys-color-outline)" }}>Indexed Markdown Notes</span>
                <span style={{ fontWeight: 600 }}>{obsidianStatus?.noteCount || 0} notes</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px", backgroundColor: "var(--md-sys-color-surface-variant, #222)", borderRadius: 6 }}>
                <span style={{ color: "var(--md-sys-color-outline)" }}>Obsidian App Installed</span>
                <span style={{ fontWeight: 600, color: obsidianStatus?.obsidianInstalled ? "#22c55e" : "var(--md-sys-color-outline)" }}>
                  {obsidianStatus?.obsidianInstalled ? "Detected" : "Not Found"}
                </span>
              </div>
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <button
                type="button"
                className="abyx-btn abyx-btn-primary"
                onClick={handleSyncObsidian}
                disabled={syncing}
                style={{ flex: 1 }}
              >
                <RefreshCw size={14} className={syncing ? "spin" : ""} />
                <span>{syncing ? "Syncing..." : "Sync Markdown Vault"}</span>
              </button>
              {obsidianStatus?.obsidianInstalled && (
                <button
                  type="button"
                  className="abyx-btn abyx-btn-secondary"
                  onClick={handleOpenObsidian}
                  disabled={opening}
                >
                  <ExternalLink size={14} />
                  <span>Open in Obsidian</span>
                </button>
              )}
            </div>
          </div>

          {/* MCP Tools & Server Registry Card */}
          <div className="abyx-card" style={{ padding: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Wrench size={20} style={{ color: "var(--accent-color, #ff6a3d)" }} />
                <h3 style={{ margin: 0, fontSize: "1.05rem" }}>Model Context Protocol (MCP)</h3>
              </div>
              <button
                type="button"
                className="abyx-btn abyx-btn-secondary"
                style={{ padding: "4px 8px", fontSize: "0.78rem" }}
                onClick={() => setAddMcpOpen(true)}
              >
                <Plus size={12} />
                <span>Add Server</span>
              </button>
            </div>

            <p style={{ fontSize: "0.85rem", color: "var(--md-sys-color-outline)", margin: "0 0 14px", lineHeight: 1.5 }}>
              Standard Model Context Protocol client registry. Extends ABYX LLMs with local tools, system inspection, and calculation engines.
            </p>

            {/* Server List */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
              {mcpConfig && Object.entries(mcpConfig).map(([name, srv]) => (
                <div
                  key={name}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "8px 12px",
                    borderRadius: 6,
                    backgroundColor: "var(--md-sys-color-surface-variant, #222)",
                    border: "1px solid var(--border-color, #333)"
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: "0.88rem" }}>{name}</div>
                    <div style={{ fontSize: "0.76rem", color: "var(--md-sys-color-outline)" }}>
                      {srv.description || "MCP tool server"}
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <button
                      type="button"
                      onClick={() => handleToggleMcpServer(name, srv.enabled)}
                      style={{ background: "none", border: "none", color: srv.enabled ? "#22c55e" : "#ef4444", cursor: "pointer" }}
                      title={srv.enabled ? "Disable server" : "Enable server"}
                    >
                      {srv.enabled ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}
                    </button>
                    {name !== "local_tools" && (
                      <button
                        type="button"
                        onClick={() => handleDeleteMcpServer(name)}
                        style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", opacity: 0.7 }}
                        title="Delete server"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Active Registered Tools */}
            <div style={{ borderTop: "1px solid var(--border-color, #333)", paddingTop: 12 }}>
              <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--md-sys-color-outline)", textTransform: "uppercase" }}>
                Registered MCP Tools ({mcpTools.length})
              </span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                {mcpTools.map((t, idx) => (
                  <span
                    key={idx}
                    style={{
                      fontSize: "0.76rem",
                      fontFamily: "monospace",
                      backgroundColor: "rgba(255, 106, 61, 0.12)",
                      color: "var(--accent-color, #ff6a3d)",
                      padding: "3px 8px",
                      borderRadius: 4,
                      border: "1px solid rgba(255, 106, 61, 0.25)"
                    }}
                  >
                    {t.function?.name || `tool_${idx}`}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Architectural Showcase & System Philosophy */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div className="abyx-card" style={{ padding: 24 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
              <img
                src="/logo.png"
                alt="ABYX Logo"
                style={{ width: 56, height: 56, borderRadius: 12, objectFit: "contain" }}
                onError={(e) => { e.currentTarget.style.display = "none"; }}
              />
              <div>
                <h2 style={{ fontSize: "1.3rem", margin: 0, fontWeight: 700 }}>ABYX</h2>
                <div style={{ fontSize: "0.85rem", color: "var(--accent-color, #ff6a3d)", fontWeight: 500 }}>
                  Independent Intelligence Platform
                </div>
              </div>
            </div>

            <p style={{ fontSize: "0.9rem", lineHeight: 1.6, color: "var(--md-sys-color-on-surface)", margin: "0 0 16px" }}>
              ABYX unites offline local multimodal execution with flexible cloud intelligence. Built with privacy-first principles: no telemetry, no tracking, and encrypted credential storage backed by the Windows Data Protection API (DPAPI).
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
              <div style={{ padding: 12, borderRadius: 8, backgroundColor: "var(--md-sys-color-surface-variant, #222)", border: "1px solid var(--border-color, #333)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#22c55e", fontWeight: 600, fontSize: "0.85rem", marginBottom: 4 }}>
                  <ShieldCheck size={16} />
                  <span>Hardware Isolation</span>
                </div>
                <div style={{ fontSize: "0.78rem", color: "var(--md-sys-color-outline)" }}>
                  Models run directly on local GPU/VRAM or via secure direct APIs.
                </div>
              </div>

              <div style={{ padding: 12, borderRadius: 8, backgroundColor: "var(--md-sys-color-surface-variant, #222)", border: "1px solid var(--border-color, #333)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--accent-color, #ff6a3d)", fontWeight: 600, fontSize: "0.85rem", marginBottom: 4 }}>
                  <Cpu size={16} />
                  <span>Bounded Workspaces</span>
                </div>
                <div style={{ fontSize: "0.78rem", color: "var(--md-sys-color-outline)" }}>
              Path checks restrict agent file operations to the active project; they are not an operating-system sandbox.
                </div>
              </div>

              <div style={{ padding: 12, borderRadius: 8, backgroundColor: "var(--md-sys-color-surface-variant, #222)", border: "1px solid var(--border-color, #333)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#38bdf8", fontWeight: 600, fontSize: "0.85rem", marginBottom: 4 }}>
                  <Brain size={16} />
                  <span>Living Memory</span>
                </div>
                <div style={{ fontSize: "0.78rem", color: "var(--md-sys-color-outline)" }}>
                  Semantic profile and session recall persistent across model switches.
                </div>
              </div>

              <div style={{ padding: 12, borderRadius: 8, backgroundColor: "var(--md-sys-color-surface-variant, #222)", border: "1px solid var(--border-color, #333)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#a855f7", fontWeight: 600, fontSize: "0.85rem", marginBottom: 4 }}>
                  <Flame size={16} />
                  <span>Auto Model Routing</span>
                </div>
                <div style={{ fontSize: "0.78rem", color: "var(--md-sys-color-outline)" }}>
                  Intelligently selects the optimal model per reasoning, vision, or coding task.
                </div>
              </div>
            </div>

            <div style={{ borderTop: "1px solid var(--border-color, #333)", paddingTop: 14, fontSize: "0.82rem", color: "var(--md-sys-color-outline)", display: "flex", justifyContent: "space-between" }}>
              <span>Engine: Local AI Studio Unified Microkernel</span>
              <span>Version: 2.1-unified</span>
            </div>
          </div>
        </div>
      </div>

      {/* Modal: Add MCP Server */}
      {addMcpOpen && (
        <div className="abyx-modal-backdrop" onClick={() => setAddMcpOpen(false)}>
          <div className="abyx-modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
            <h3 style={{ margin: "0 0 16px" }}>Add Custom MCP Server</h3>
            <form onSubmit={handleAddMcpServer} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label style={{ fontSize: "0.85rem", fontWeight: 600, display: "block", marginBottom: 6 }}>Server Identifier</label>
                <input
                  type="text"
                  placeholder="e.g. filesystem-server"
                  value={serverName}
                  onChange={(e) => setServerName(e.target.value)}
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--border-color, #444)", backgroundColor: "var(--md-sys-color-background)", color: "inherit" }}
                  required
                />
              </div>

              <div>
                <label style={{ fontSize: "0.85rem", fontWeight: 600, display: "block", marginBottom: 6 }}>Description</label>
                <input
                  type="text"
                  placeholder="Brief description"
                  value={serverDesc}
                  onChange={(e) => setServerDesc(e.target.value)}
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--border-color, #444)", backgroundColor: "var(--md-sys-color-background)", color: "inherit" }}
                />
              </div>

              <div>
                <label style={{ fontSize: "0.85rem", fontWeight: 600, display: "block", marginBottom: 6 }}>Executable / Command</label>
                <input
                  type="text"
                  placeholder="npx or node"
                  value={serverCommand}
                  onChange={(e) => setServerCommand(e.target.value)}
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--border-color, #444)", backgroundColor: "var(--md-sys-color-background)", color: "inherit" }}
                />
              </div>

              <div>
                <label style={{ fontSize: "0.85rem", fontWeight: 600, display: "block", marginBottom: 6 }}>Arguments (space separated)</label>
                <input
                  type="text"
                  placeholder="-y @modelcontextprotocol/server-filesystem C:\Path"
                  value={serverArgs}
                  onChange={(e) => setServerArgs(e.target.value)}
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--border-color, #444)", backgroundColor: "var(--md-sys-color-background)", color: "inherit" }}
                />
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 10 }}>
                <button type="button" className="abyx-btn abyx-btn-secondary" onClick={() => setAddMcpOpen(false)}>Cancel</button>
                <button type="submit" className="abyx-btn abyx-btn-primary" disabled={!serverName.trim()}>Register Server</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
