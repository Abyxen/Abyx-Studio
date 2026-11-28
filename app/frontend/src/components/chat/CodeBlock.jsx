import React, { memo, useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { Check, Copy, Download, Globe, ListOrdered, WrapText, ChevronDown, Folder, AlertCircle } from "lucide-react";
import { saveWorkspaceFile, revealWorkspaceFile } from "../../services/api";
import { useClipboard } from "./useClipboard";
import { resolveLanguage, sniffLanguage, languageFromHljsId } from "./languages";
import { inferFilenameFromPrompt, formatBytesShort, triggerDownload } from "./filenames";

const COLLAPSE_LINES = 28;

let highlighterPromise = null;
let highlighterModule = null;
function loadHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = import("./highlighter.js").then((mod) => {
      highlighterModule = mod;
      return mod;
    });
  }
  return highlighterPromise;
}

function useHighlighter() {
  const [mod, setMod] = useState(highlighterModule);
  useEffect(() => {
    if (mod) return undefined;
    let alive = true;
    loadHighlighter().then((loaded) => { if (alive) setMod(loaded); }).catch(() => {});
    return () => { alive = false; };
  }, [mod]);
  return mod;
}

function detectFilename(code, lang, userPrompt) {
  const firstLine = code.split("\n")[0] || "";
  const match = firstLine.match(/(?:\/\/|#|<!--|\/\*)\s*(?:filename|file|name|path):\s*([a-zA-Z0-9_./-]+)/i);
  if (!match) return "";
  let name = match[1].trim().replace(/^[/\\]+/, "");
  // A generic "index.html" from the model would overwrite earlier pages; prefer the topic name
  if (name.toLowerCase() === "index.html" && userPrompt && !userPrompt.toLowerCase().includes("index.html")) {
    const inferred = inferFilenameFromPrompt(userPrompt, "html");
    if (inferred && inferred !== "site.html") name = inferred;
  }
  return name;
}

function defaultFilename(language, userPrompt) {
  if (!language) return "snippet.txt";
  if (language.ext === "html") return userPrompt ? inferFilenameFromPrompt(userPrompt, "html") : "index.html";
  if (language.ext === "svg") return "graphic.svg";
  if (language.ext === "py") return "main.py";
  if (language.ext === "js") return "script.js";
  return `snippet.${language.ext}`;
}

function IconButton({ label, onClick, active = false, children, disabled = false, tone }) {
  return (
    <button
      type="button"
      className={`abyx-code-btn${active ? " is-active" : ""}${tone ? ` is-${tone}` : ""}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={typeof active === "boolean" && active ? true : undefined}
      data-tooltip={label}
    >
      {children}
    </button>
  );
}

function CodeBlock({ code, lang, isStreaming = false, isComplete = true, onOpenBrowser, userPrompt = "" }) {
  const source = useMemo(() => String(code || "").replace(/\n$/, ""), [code]);
  const deferredSource = useDeferredValue(source);
  const highlighter = useHighlighter();

  const [showLines, setShowLines] = useState(false);
  const [wrap, setWrap] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [revealState, setRevealState] = useState("idle");
  const [copyState, copy] = useClipboard();

  const declared = resolveLanguage(lang);
  const sniffed = declared ? null : sniffLanguage(source);

  const highlighted = useMemo(() => {
    if (!highlighter || !deferredSource) return null;
    const target = declared?.id || sniffed?.id || "";
    try {
      // Auto-detection on a half-streamed block is noisy; wait for completion before guessing
      if (!target && isStreaming) return null;
      return highlighter.highlight(deferredSource, target);
    } catch (_) {
      return null;
    }
  }, [highlighter, deferredSource, declared?.id, sniffed?.id, isStreaming]);

  const language = declared || sniffed || (highlighted?.language ? languageFromHljsId(highlighted.language) : null);
  const label = language?.label || (lang ? lang.toUpperCase() : "Code");
  const isHtml = language?.ext === "html";
  const isSvg = language?.ext === "svg";

  const filename = detectFilename(source, lang, userPrompt) || defaultFilename(language, userPrompt);
  const lineCount = source ? source.split("\n").length : 0;
  const byteSize = useMemo(() => new Blob([source]).size, [source]);
  const collapsible = !isStreaming && lineCount > COLLAPSE_LINES;
  const collapsed = collapsible && !expanded;

  // Completed code is mirrored into the agent workspace, as the workspace tools expect
  useEffect(() => {
    if (isComplete && !isStreaming && source.length > 5 && filename) {
      saveWorkspaceFile(filename, source, "", null, userPrompt).catch(() => {});
    }
  }, [isComplete, isStreaming, filename, source, userPrompt]);

  const handleDownload = useCallback(() => {
    const blob = new Blob([source], { type: language?.mime || "text/plain" });
    const url = URL.createObjectURL(blob);
    triggerDownload(url, filename);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [source, language, filename]);

  const handleReveal = useCallback(async () => {
    setRevealState("busy");
    try {
      await saveWorkspaceFile(filename, source).catch(() => {});
      const res = await revealWorkspaceFile(filename, source);
      setRevealState(res && res.ok ? "done" : "error");
    } catch (_) {
      setRevealState("error");
    }
    setTimeout(() => setRevealState("idle"), 2200);
  }, [filename, source]);

  const handlePreview = useCallback(() => {
    if (isHtml) saveWorkspaceFile(filename, source).catch(() => {});
    const target = `local://${filename}`;
    if (window.openInsideBrowser) {
      window.openInsideBrowser(target);
    } else if (onOpenBrowser) {
      onOpenBrowser(target);
    } else {
      const blob = new Blob([source], { type: isSvg ? "image/svg+xml" : "text/html;charset=utf-8" });
      window.open(URL.createObjectURL(blob), "_blank", "noopener");
    }
  }, [isHtml, isSvg, filename, source, onOpenBrowser]);

  const lines = useMemo(() => {
    if (!showLines) return null;
    return Array.from({ length: lineCount }, (_, i) => i + 1);
  }, [showLines, lineCount]);

  return (
    <figure className={`abyx-code${isStreaming ? " is-streaming" : ""}`} aria-label={`${label} code`}>
      <figcaption className="abyx-code-head">
        <div className="abyx-code-meta">
          <span className="abyx-code-lang">{label}</span>
          {filename && !filename.startsWith("snippet.") && (
            <span className="abyx-code-file" title={filename}>{filename}</span>
          )}
          <span className="abyx-code-stats">
            {isStreaming ? (
              <span className="abyx-code-live"><span className="abyx-live-dot" aria-hidden="true" />Writing · {lineCount} lines</span>
            ) : (
              `${lineCount} ${lineCount === 1 ? "line" : "lines"} · ${formatBytesShort(byteSize)}`
            )}
          </span>
        </div>
        <div className="abyx-code-actions">
          <IconButton label={showLines ? "Hide line numbers" : "Show line numbers"} onClick={() => setShowLines((v) => !v)} active={showLines}>
            <ListOrdered size={14} />
          </IconButton>
          <IconButton label={wrap ? "Disable line wrap" : "Wrap long lines"} onClick={() => setWrap((v) => !v)} active={wrap}>
            <WrapText size={14} />
          </IconButton>
          {!isStreaming && (
            <IconButton label={`Download ${filename}`} onClick={handleDownload}>
              <Download size={14} />
            </IconButton>
          )}
          {!isStreaming && (
            <IconButton
              label={revealState === "error" ? "Could not reveal file" : "Reveal in workspace"}
              onClick={handleReveal}
              disabled={revealState === "busy"}
              tone={revealState === "done" ? "success" : revealState === "error" ? "error" : undefined}
            >
              {revealState === "done" ? <Check size={14} /> : revealState === "error" ? <AlertCircle size={14} /> : <Folder size={14} />}
            </IconButton>
          )}
          {!isStreaming && (isHtml || isSvg) && (
            <button type="button" className="abyx-code-pill" onClick={handlePreview}>
              <Globe size={13} aria-hidden="true" />
              <span>Preview</span>
            </button>
          )}
          <button
            type="button"
            className={`abyx-code-pill${copyState === "copied" ? " is-success" : ""}${copyState === "error" ? " is-error" : ""}`}
            onClick={() => copy(source)}
            aria-live="polite"
          >
            {copyState === "copied" ? <Check size={13} aria-hidden="true" /> : copyState === "error" ? <AlertCircle size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
            <span>{copyState === "copied" ? "Copied" : copyState === "error" ? "Failed" : "Copy"}</span>
          </button>
        </div>
      </figcaption>

      <div className={`abyx-code-body${collapsed ? " is-collapsed" : ""}`}>
        {lines && (
          <div className="abyx-code-gutter" aria-hidden="true">
            {lines.map((n) => <span key={n}>{n}</span>)}
          </div>
        )}
        <pre className={`abyx-code-pre${wrap ? " is-wrapped" : ""}`} tabIndex={0}>
          {highlighted && highlighted.html && deferredSource === source ? (
            <code className="hljs" dangerouslySetInnerHTML={{ __html: highlighted.html }} />
          ) : (
            <code className="hljs">{source}</code>
          )}
          {isStreaming && <span className="abyx-stream-caret" aria-hidden="true" />}
        </pre>
      </div>

      {collapsible && (
        <button type="button" className="abyx-code-expand" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
          <ChevronDown size={14} aria-hidden="true" style={{ transform: expanded ? "rotate(180deg)" : "none" }} />
          <span>{expanded ? "Collapse" : `Show all ${lineCount} lines`}</span>
        </button>
      )}
    </figure>
  );
}

export default memo(CodeBlock);
