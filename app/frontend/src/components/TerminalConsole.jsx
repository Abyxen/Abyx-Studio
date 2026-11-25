import React, { useState, useRef, useEffect } from "react";
import { Terminal, Play, RotateCcw, Copy, Check, AlertCircle, CheckCircle2, ChevronDown, ChevronUp } from "lucide-react";
import { executeTerminalCommand } from "../services/api";

export default function TerminalConsole({
  defaultCwd = ".",
  onCommandComplete = null,
  compact = false
}) {
  const [command, setCommand] = useState("");
  const [history, setHistory] = useState([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [historyLog, setHistoryLog] = useState([]);
  const [running, setRunning] = useState(false);
  const [copied, setCopied] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const outputEndRef = useRef(null);

  const quickPresets = [
    "git status",
    "git log -n 5 --oneline",
    "dir",
    "node -v",
    "python --version"
  ];

  useEffect(() => {
    outputEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [historyLog]);

  const handleRun = async (cmdToRun = null) => {
    const cmd = (cmdToRun || command).trim();
    if (!cmd || running) return;

    setRunning(true);
    setHistory((prev) => [cmd, ...prev.filter((c) => c !== cmd)]);
    setHistoryIdx(-1);

    const logEntry = {
      id: Date.now(),
      command: cmd,
      startTime: new Date().toLocaleTimeString(),
      status: "running",
      stdout: "",
      stderr: "",
      exitCode: null,
      durationMs: 0
    };

    setHistoryLog((prev) => [...prev, logEntry]);
    setCommand("");

    try {
      const res = await executeTerminalCommand(cmd, defaultCwd, 20000);
      setHistoryLog((prev) =>
        prev.map((entry) =>
          entry.id === logEntry.id
            ? {
                ...entry,
                status: res.ok ? "completed" : "failed",
                stdout: res.stdout || "",
                stderr: res.stderr || "",
                exitCode: res.exitCode != null ? res.exitCode : res.ok ? 0 : 1,
                durationMs: res.durationMs || 0,
                error: res.error || null
              }
            : entry
        )
      );
      onCommandComplete?.(res);
    } catch (err) {
      setHistoryLog((prev) =>
        prev.map((entry) =>
          entry.id === logEntry.id
            ? {
                ...entry,
                status: "failed",
                stderr: err.message,
                exitCode: 1,
                error: err.message
              }
            : entry
        )
      );
    } finally {
      setRunning(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleRun();
    } else if (e.key === "ArrowUp") {
      if (history.length > 0 && historyIdx < history.length - 1) {
        const nextIdx = historyIdx + 1;
        setHistoryIdx(nextIdx);
        setCommand(history[nextIdx]);
      }
    } else if (e.key === "ArrowDown") {
      if (historyIdx > 0) {
        const nextIdx = historyIdx - 1;
        setHistoryIdx(nextIdx);
        setCommand(history[nextIdx]);
      } else if (historyIdx === 0) {
        setHistoryIdx(-1);
        setCommand("");
      }
    }
  };

  const handleCopyAll = () => {
    const text = historyLog
      .map(
        (l) =>
          `$ ${l.command}\n${l.stdout ? l.stdout + "\n" : ""}${l.stderr ? "[ERROR] " + l.stderr + "\n" : ""}`
      )
      .join("\n");
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div
      className="abyx-terminal-console"
      style={{
        borderRadius: "8px",
        border: "1px solid var(--border-color, rgba(255, 255, 255, 0.1))",
        background: "#08090d",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        fontSize: "12px",
        fontFamily: "'JetBrains Mono', monospace",
        margin: "8px 0"
      }}
    >
      {/* Console Header Bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 12px",
          background: "rgba(255, 255, 255, 0.03)",
          borderBottom: "1px solid rgba(255, 255, 255, 0.08)"
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <Terminal size={14} color="#38bdf8" />
          <span style={{ fontWeight: 600, color: "#f1f5f9" }}>Harness Terminal Runner</span>
          <span style={{ fontSize: "10px", color: "#64748b" }}>({defaultCwd})</span>
          {running && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                padding: "1px 6px",
                borderRadius: "4px",
                background: "rgba(245, 158, 11, 0.15)",
                color: "#f59e0b",
                fontSize: "10px",
                fontWeight: 600
              }}
            >
              Running...
            </span>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <button
            type="button"
            onClick={handleCopyAll}
            className="abyx-btn"
            style={{ padding: "3px 6px", fontSize: "11px", display: "inline-flex", alignItems: "center", gap: "4px" }}
            title="Copy entire console log"
          >
            {copied ? <Check size={11} color="#45D483" /> : <Copy size={11} />}
            <span>{copied ? "Copied" : "Copy"}</span>
          </button>
          <button
            type="button"
            onClick={() => setHistoryLog([])}
            className="abyx-btn"
            style={{ padding: "3px 6px", fontSize: "11px" }}
            title="Clear console"
          >
            <RotateCcw size={11} />
          </button>
          <button
            type="button"
            onClick={() => setCollapsed(!collapsed)}
            className="abyx-btn"
            style={{ padding: "3px 6px", fontSize: "11px" }}
            title={collapsed ? "Expand console" : "Collapse console"}
          >
            {collapsed ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
          </button>
        </div>
      </div>

      {!collapsed && (
        <>
          {/* Quick preset chips */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "6px 12px",
              background: "rgba(0, 0, 0, 0.2)",
              borderBottom: "1px solid rgba(255, 255, 255, 0.05)",
              overflowX: "auto"
            }}
          >
            <span style={{ fontSize: "10px", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.5px" }}>Presets:</span>
            {quickPresets.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => handleRun(preset)}
                disabled={running}
                style={{
                  padding: "2px 8px",
                  borderRadius: "4px",
                  border: "1px solid rgba(255, 255, 255, 0.08)",
                  background: "rgba(255, 255, 255, 0.03)",
                  color: "#94a3b8",
                  fontSize: "11px",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  whiteSpace: "nowrap"
                }}
              >
                {preset}
              </button>
            ))}
          </div>

          {/* Console Log Area */}
          <div
            style={{
              minHeight: compact ? "100px" : "180px",
              maxHeight: compact ? "220px" : "320px",
              overflowY: "auto",
              padding: "10px 14px",
              display: "flex",
              flexDirection: "column",
              gap: "10px",
              background: "rgba(0, 0, 0, 0.45)"
            }}
          >
            {historyLog.length === 0 ? (
              <div style={{ color: "#475569", fontStyle: "italic", padding: "12px 0" }}>
                Type a command below or click a preset to execute in the workspace sandbox.
              </div>
            ) : (
              historyLog.map((item) => (
                <div key={item.id} style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "#38bdf8" }}>
                      <span style={{ color: "#64748b" }}>$</span>
                      <strong style={{ color: "#e2e8f0" }}>{item.command}</strong>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "10px", color: "#64748b" }}>
                      {item.durationMs > 0 && <span>{item.durationMs}ms</span>}
                      {item.status === "completed" && <CheckCircle2 size={12} color="#45D483" />}
                      {item.status === "failed" && <AlertCircle size={12} color="#ef4444" />}
                      {item.exitCode !== null && <span>exit: {item.exitCode}</span>}
                    </div>
                  </div>

                  {item.stdout && (
                    <pre
                      style={{
                        margin: 0,
                        color: "#cbd5e1",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-all",
                        lineHeight: 1.45,
                        fontSize: "11.5px"
                      }}
                    >
                      {item.stdout}
                    </pre>
                  )}

                  {item.stderr && (
                    <pre
                      style={{
                        margin: 0,
                        color: "#f87171",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-all",
                        lineHeight: 1.45,
                        fontSize: "11.5px"
                      }}
                    >
                      {item.stderr}
                    </pre>
                  )}
                </div>
              ))
            )}
            <div ref={outputEndRef} />
          </div>

          {/* Command Input Prompt */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "8px 12px",
              background: "rgba(255, 255, 255, 0.02)",
              borderTop: "1px solid rgba(255, 255, 255, 0.08)"
            }}
          >
            <span style={{ color: "#38bdf8", fontWeight: 700 }}>$</span>
            <input
              type="text"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={running}
              placeholder="Enter terminal command (e.g. git status, npm run build)..."
              style={{
                flex: 1,
                background: "transparent",
                border: "none",
                outline: "none",
                color: "#f8fafc",
                fontSize: "12px",
                fontFamily: "inherit"
              }}
            />
            <button
              type="button"
              onClick={() => handleRun()}
              disabled={running || !command.trim()}
              className="abyx-btn primary"
              style={{ padding: "4px 10px", fontSize: "11px", display: "inline-flex", alignItems: "center", gap: "4px" }}
            >
              <Play size={11} /> Run
            </button>
          </div>
        </>
      )}
    </div>
  );
}
