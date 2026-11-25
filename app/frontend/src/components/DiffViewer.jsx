import React, { useState, useMemo } from "react";
import { FileCode, Check, Copy, X, Plus, Minus, GitCommit } from "lucide-react";

export default function DiffViewer({
  filePath = "file.js",
  originalContent = "",
  newContent = "",
  diffLines = null,
  onClose = null,
  title = "Code Changes (Diff)"
}) {
  const [copied, setCopied] = useState(false);
  const [viewMode, setViewMode] = useState("unified"); // "unified" | "side"

  // Compute diff lines locally if not precomputed
  const lines = useMemo(() => {
    if (Array.isArray(diffLines) && diffLines.length > 0) return diffLines;

    const oldLines = String(originalContent || "").split("\n");
    const newLines = String(newContent || "").split("\n");
    const computed = [];

    let i = 0;
    let j = 0;
    while (i < oldLines.length || j < newLines.length) {
      if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
        computed.push({ type: "common", text: oldLines[i], oldLine: i + 1, newLine: j + 1 });
        i++;
        j++;
      } else if (j < newLines.length && (i >= oldLines.length || !oldLines.slice(i, i + 6).includes(newLines[j]))) {
        computed.push({ type: "added", text: newLines[j], newLine: j + 1 });
        j++;
      } else if (i < oldLines.length) {
        computed.push({ type: "deleted", text: oldLines[i], oldLine: i + 1 });
        i++;
      }
    }
    return computed;
  }, [originalContent, newContent, diffLines]);

  const stats = useMemo(() => {
    let added = 0;
    let deleted = 0;
    for (const l of lines) {
      if (l.type === "added") added++;
      if (l.type === "deleted") deleted++;
    }
    return { added, deleted };
  }, [lines]);

  const handleCopy = () => {
    const text = lines
      .map((l) => (l.type === "added" ? `+ ${l.text}` : l.type === "deleted" ? `- ${l.text}` : `  ${l.text}`))
      .join("\n");
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div
      className="abyx-diff-viewer"
      style={{
        borderRadius: "8px",
        border: "1px solid var(--border-color, rgba(255, 255, 255, 0.1))",
        background: "var(--card-bg, #0d0f17)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        fontSize: "12px",
        fontFamily: "'JetBrains Mono', monospace",
        margin: "8px 0"
      }}
    >
      {/* Diff Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 14px",
          background: "rgba(255, 255, 255, 0.03)",
          borderBottom: "1px solid var(--border-color, rgba(255, 255, 255, 0.08))"
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <FileCode size={14} color="#38bdf8" />
          <span style={{ fontWeight: 600, color: "var(--md-sys-color-on-surface, #f1f5f9)" }}>
            {filePath}
          </span>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              padding: "2px 6px",
              borderRadius: "4px",
              fontSize: "10px",
              fontWeight: 700,
              background: "rgba(69, 212, 131, 0.15)",
              color: "#45D483"
            }}
          >
            <Plus size={10} /> {stats.added}
          </span>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              padding: "2px 6px",
              borderRadius: "4px",
              fontSize: "10px",
              fontWeight: 700,
              background: "rgba(239, 68, 68, 0.15)",
              color: "#ef4444"
            }}
          >
            <Minus size={10} /> {stats.deleted}
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <button
            type="button"
            onClick={handleCopy}
            className="abyx-btn"
            style={{
              padding: "3px 8px",
              fontSize: "11px",
              display: "inline-flex",
              alignItems: "center",
              gap: "4px"
            }}
            title="Copy diff to clipboard"
          >
            {copied ? <Check size={12} color="#45D483" /> : <Copy size={12} />}
            <span>{copied ? "Copied" : "Copy Diff"}</span>
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="abyx-btn"
              style={{ padding: "3px 6px", fontSize: "11px" }}
              title="Close diff view"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Diff Content Body */}
      <div
        style={{
          maxHeight: "360px",
          overflowY: "auto",
          overflowX: "auto",
          background: "rgba(0, 0, 0, 0.35)",
          padding: "4px 0"
        }}
      >
        {lines.length === 0 ? (
          <div style={{ padding: "16px", color: "var(--md-sys-color-outline, #94a3b8)", textAlign: "center" }}>
            No differences found between versions.
          </div>
        ) : (
          lines.map((line, idx) => {
            const isAdded = line.type === "added";
            const isDeleted = line.type === "deleted";

            const bg = isAdded
              ? "rgba(69, 212, 131, 0.12)"
              : isDeleted
              ? "rgba(239, 68, 68, 0.12)"
              : "transparent";

            const textColor = isAdded
              ? "#86efac"
              : isDeleted
              ? "#fca5a5"
              : "rgba(241, 245, 249, 0.85)";

            const gutterChar = isAdded ? "+" : isDeleted ? "-" : " ";
            const gutterColor = isAdded ? "#45D483" : isDeleted ? "#ef4444" : "#64748b";

            return (
              <div
                key={idx}
                style={{
                  display: "flex",
                  alignItems: "stretch",
                  background: bg,
                  lineHeight: "1.5",
                  padding: "1px 0"
                }}
              >
                {/* Line Numbers */}
                <div
                  style={{
                    width: "36px",
                    textAlign: "right",
                    paddingRight: "6px",
                    color: "rgba(148, 163, 184, 0.4)",
                    userSelect: "none",
                    flexShrink: 0
                  }}
                >
                  {line.oldLine || ""}
                </div>
                <div
                  style={{
                    width: "36px",
                    textAlign: "right",
                    paddingRight: "8px",
                    color: "rgba(148, 163, 184, 0.4)",
                    userSelect: "none",
                    flexShrink: 0
                  }}
                >
                  {line.newLine || ""}
                </div>

                {/* Sign Gutter */}
                <div
                  style={{
                    width: "16px",
                    textAlign: "center",
                    color: gutterColor,
                    fontWeight: 700,
                    userSelect: "none",
                    flexShrink: 0
                  }}
                >
                  {gutterChar}
                </div>

                {/* Code Text */}
                <div
                  style={{
                    flex: 1,
                    color: textColor,
                    whiteSpace: "pre",
                    paddingRight: "14px"
                  }}
                >
                  {line.text || " "}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
