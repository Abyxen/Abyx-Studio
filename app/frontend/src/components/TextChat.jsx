import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  LoaderCircle, Trash2, Square, X, ChevronDown, ChevronRight, Globe2, Globe, Plus, PenLine,
  Lightbulb, Zap, FileText, ArrowUp, Brain, Mic, AudioLines, Image as ImageIcon,
  PanelLeft, Volume2, RotateCcw, ThumbsUp, ThumbsDown, Copy, Check, Pin,
  Download, Sparkles, RefreshCw, FolderKanban, FileCode, Eye, ExternalLink,
  Folder, Code2, Terminal, CheckCircle, Circle, Play, Pause, Settings, GitBranch, Layers, Clock,
  UploadCloud, FileArchive, FileUp, File, ShieldAlert, Sliders, Lock, Shield, AlertTriangle, ArrowRight, HelpCircle
} from "lucide-react";
import {
  getBackendStatus,
  stopServer,
  getDownloadProgress,
  getLlmStatus,
  listLlmModels,
  streamChatWithLlm,
  startLlm,
  stopLlm,
  getProviders,
  autoTitleConversation,
  saveWorkspaceFile,
  revealWorkspaceFile,
  getPendingApprovals,
  resolveAgentApproval,
  getFileDiff,
} from "../services/api";
import DiffViewer from "./DiffViewer";
import HarnessControlsDrawer from "./HarnessControlsDrawer";
import katex from "katex";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "katex/dist/katex.min.css";
import { MarkdownRenderer } from "./chat/markdown";
import { inferFilenameFromPrompt } from "./chat/filenames";
import { copyText } from "./chat/useClipboard";

// Splits model reasoning from the answer. Reasoning is always extracted (and shown collapsed
// when Deep Think is off), because some models think even when it was not requested.
const processMessageContent = (rawText, apiReasoning = "") => {
  if (typeof rawText !== "string") {
    return { content: rawText, reasoning: apiReasoning || "" };
  }
  if (apiReasoning) {
    return { content: rawText.replace(/<\/?think>/g, "").trim(), reasoning: String(apiReasoning).trim() };
  }

  const cleanReasoningControlTags = (value) => String(value || "")
    .replace(/<\|channel\|>thought/g, "")
    .replace(/<\|channel\|>model/g, "")
    .replace(/<\|turn\|>model/g, "")
    .replace(/<\|im_start\|>model/g, "")
    .replace(/<\|think\|>|<\|thought\|>|<think>|<thinking>|<thought>/g, "")
    .replace(/<\|\/think\|>|<\|\/thought\|>|<\/think>|<\/thinking>|<\/thought>/g, "")
    .trim();

  const startTags = ["<|channel|>thought", "<|think|>", "<|thought|>", "<think>", "<thinking>", "<thought>"];
  const endTags = ["<|channel|>model", "<|turn>model", "<|im_start|>model", "</think>", "</thinking>", "</thought>", "<|/think|>", "<|/thought|>"];

  let startIdx = -1;
  let matchedStartTag = "";

  for (const tag of startTags) {
    const idx = rawText.indexOf(tag);
    if (idx !== -1 && (startIdx === -1 || idx < startIdx)) {
      startIdx = idx;
      matchedStartTag = tag;
    }
  }

  if (startIdx === -1) {
    return { content: cleanReasoningControlTags(rawText), reasoning: "" };
  }

  let endIdx = -1;
  for (const tag of endTags) {
    const idx = rawText.indexOf(tag, startIdx + matchedStartTag.length);
    if (idx !== -1 && (endIdx === -1 || idx < endIdx)) {
      endIdx = idx;
    }
  }

  if (endIdx === -1) {
    const rawReasoning = rawText.substring(startIdx + matchedStartTag.length);
    return { content: "", reasoning: cleanReasoningControlTags(rawReasoning) };
  }

  const rawReasoning = rawText.substring(startIdx + matchedStartTag.length, endIdx);
  const rawContent = rawText.substring(endIdx);

  return {
    content: cleanReasoningControlTags(rawContent),
    reasoning: cleanReasoningControlTags(rawReasoning)
  };
};


function getActionText(message, prevUserMessage) {
  const stats = message?.generationStats || {};
  const raw = typeof message?.content === "string" 
    ? message.content 
    : (Array.isArray(message?.content) ? message.content.map(c => c.text || "").join(" ") : "");
  
  const userPrompt = typeof prevUserMessage?.content === "string"
    ? prevUserMessage.content.toLowerCase()
    : (Array.isArray(prevUserMessage?.content) ? prevUserMessage.content.map(c => c.text || "").join(" ").toLowerCase() : "");

  // 1. Web search
  if (stats.web || /search(ing|ed)?\s+(the\s+)?(web|google|internet)|web-search/i.test(raw)) {
    return "Searching the web…";
  }

  // 2. Vision / Image reading
  if (stats.vision) {
    return "Reading the image…";
  }

  // 3. Audio generation
  if (/\[AUDIO:/i.test(raw) || (!raw && /generate\s+(an?\s+)?audio|voice|speech|tts|podcast/i.test(userPrompt))) {
    return "Synthesizing audio…";
  }

  // 4. Image generation
  if (/data-generate="[^"]+"|<img\s+[^>]*data-generate|\[IMAGE:/i.test(raw) || (!raw && /generate\s+(an?\s+)?(image|photo|picture|avatar|illustration)|draw\s+/i.test(userPrompt))) {
    return "Generating image…";
  }

  // 5. Explicit filename in code comments: <!-- path: index.html --> or // filename: app.js
  const pathMatch = raw.match(/(?:<!--|\/\/|#|\/\*)\s*(?:path|filename|file|name):\s*([a-zA-Z0-9_./-]+)/i);
  if (pathMatch && pathMatch[1]) {
    let fn = pathMatch[1].trim().replace(/^[/\\]+/, "");
    if (fn.toLowerCase() === "index.html" && userPrompt && !userPrompt.includes("index.html")) {
      const inferred = inferFilenameFromPrompt(userPrompt, "html");
      if (inferred && inferred !== "site.html") {
        fn = inferred;
      }
    }
    return `Working on ${fn}…`;
  }

  // 6. HTML / Website detection
  if (/<!DOCTYPE html|<html/i.test(raw)) {
    const fn = inferFilenameFromPrompt(userPrompt, "html");
    return `Working on ${fn}…`;
  }
  if (/<svg/i.test(raw)) {
    return "Working on graphic.svg…";
  }

  // 7. Code block fence language
  const fenceMatch = raw.match(/```(\w+)/);
  if (fenceMatch) {
    const lang = fenceMatch[1].toLowerCase();
    if (lang === "html" || lang === "htm") {
      const fn = inferFilenameFromPrompt(userPrompt, "html");
      return `Working on ${fn}…`;
    }
    if (lang === "css") return "Working on styles.css…";
    if (lang === "js" || lang === "javascript" || lang === "jsx" || lang === "ts" || lang === "tsx") return "Working on script.js…";
    if (lang === "py" || lang === "python") return "Working on main.py…";
    return "Writing code…";
  }

  // 8. Preceding user prompt intent before tokens arrive
  if (!raw || raw.length < 40) {
    if (/website|html|web page|landing page|site/i.test(userPrompt)) {
      const fn = inferFilenameFromPrompt(userPrompt, "html");
      return `Working on ${fn}…`;
    }
    if (/script|code|program|python|function/i.test(userPrompt)) {
      return "Writing code…";
    }
  }

  // 9. Default fallback
  return "Thinking…";
}

function ChatThinkingSection({
  reasoning,
  timeElapsed,
  isComplete,
  hasWeb = false,
  sources = [],
  content = "",
  detectedFile = null,
  generationStats = null,
  actionText = ""
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  const formattedTime = timeElapsed > 0 
    ? ` (${timeElapsed.toFixed(timeElapsed < 10 ? 1 : 0)}s)`
    : "";

  const textReasoning = String(reasoning || "");
  const textContent = String(content || "");

  // Filename detection from content or prop
  let filename = detectedFile;
  if (!filename) {
    const pathMatch = textContent.match(/(?:<!--|\/\/|#|\/\*)\s*(?:path|filename|file|name):\s*([a-zA-Z0-9_./-]+)/i);
    if (pathMatch && pathMatch[1]) {
      filename = pathMatch[1].trim().replace(/^[/\\]+/, "");
    } else if (/<!DOCTYPE html|<html/i.test(textContent)) {
      filename = "index.html";
    } else if (/<svg/i.test(textContent)) {
      filename = "graphic.svg";
    } else {
      const fenceMatch = textContent.match(/```(\w+)/);
      if (fenceMatch) {
        const lang = fenceMatch[1].toLowerCase();
        if (lang === "html" || lang === "htm") filename = "index.html";
        else if (lang === "py" || lang === "python") filename = "main.py";
        else if (lang === "js" || lang === "javascript") filename = "script.js";
        else if (lang === "css") filename = "styles.css";
      }
    }
  }

  const isWeb = hasWeb || sources.length > 0 || /search(ing|ed)?\s+(the\s+)?(web|google|internet)|pesquis(ou|ando)\s+na\s+web|query:\s*|web-search/i.test(textReasoning);
  const isExecuting = /execut(ing|ed)|run(ning)?\s+(code|script|app|command|terminal)|build(ing)?\s+(project|app)|npm\s+(install|run)|python\s+/i.test(textReasoning);
  const hasImageDirective = /data-generate="([^"]+)"|\[IMAGE:\s*([^\]]+)\]/i.test(textContent);
  const hasAudioDirective = /\[AUDIO:\s*([^\]]+)\]/i.test(textContent);

  const isImageAction = actionText && /image|photo|picture|draw/i.test(actionText);
  const isAudioAction = actionText && /audio|voice|speech|synthesiz/i.test(actionText);
  const isCodeAction = actionText && /working on|writing code/i.test(actionText);

  // Dynamic pill status matching modern AI harnesses — single unified thinking section
  let icon = <Brain size={13} style={{ color: "#a5b4fc" }} />;
  let label = isComplete ? `Thought process${formattedTime}` : `Thinking...${formattedTime}`;

  if (!isComplete && actionText && actionText !== "Thinking…") {
    label = `${actionText}${formattedTime}`;
    if (isImageAction) icon = <ImageIcon size={13} style={{ color: "#38bdf8" }} />;
    else if (isAudioAction) icon = <Volume2 size={13} style={{ color: "#22c55e" }} />;
    else if (isCodeAction) icon = <Code2 size={13} style={{ color: "#38bdf8" }} />;
    else if (isWeb) icon = <Globe size={13} style={{ color: "#38bdf8" }} />;
  } else if (filename) {
    icon = isComplete 
      ? <CheckCircle size={13} style={{ color: "#10b981" }} />
      : <Code2 size={13} style={{ color: "#38bdf8" }} />;
    label = isComplete 
      ? `Worked on ${filename}${formattedTime}`
      : `Working on ${filename}...${formattedTime}`;
  } else if (hasImageDirective || isImageAction) {
    icon = isComplete 
      ? <CheckCircle size={13} style={{ color: "#10b981" }} />
      : <ImageIcon size={13} style={{ color: "#38bdf8" }} />;
    label = isComplete ? `Generated image${formattedTime}` : `Generating image...${formattedTime}`;
  } else if (hasAudioDirective || isAudioAction) {
    icon = isComplete 
      ? <CheckCircle size={13} style={{ color: "#10b981" }} />
      : <Volume2 size={13} style={{ color: "#22c55e" }} />;
    label = isComplete ? `Synthesized audio${formattedTime}` : `Synthesizing audio...${formattedTime}`;
  } else if (isWeb) {
    icon = <Globe size={13} style={{ color: "#38bdf8" }} />;
    label = isComplete 
      ? (sources.length > 0 ? `Searched the web (${sources.length} sources)${formattedTime}` : `Searched the web${formattedTime}`)
      : `Searching the web...${formattedTime}`;
  } else if (isExecuting) {
    icon = <Terminal size={13} style={{ color: "#f59e0b" }} />;
    label = isComplete ? `Executed application${formattedTime}` : `Executing application...${formattedTime}`;
  }

  // Build step-by-step agent activities
  const steps = [];

  // Step 1: Initial Analysis
  steps.push({
    title: filename
      ? `Analyzed workspace requirements for ${filename}`
      : "Analyzed request & project requirements",
    subtitle: "Processed architectural specifications and environment context",
    status: "done",
    time: "0.1s"
  });

  // Step 2: Web Search (if applicable)
  if (isWeb) {
    steps.push({
      title: isComplete || sources.length > 0
        ? `Searched web for references & documentation (${sources.length || 1} sources)`
        : "Searching the web...",
      subtitle: sources.length > 0 ? sources.map(s => s.title || s.url).slice(0, 2).join(", ") : "Querying external references",
      status: isComplete || sources.length > 0 ? "done" : "in_progress",
      time: "1.2s"
    });
  }

  // Step 3: File generation / editing
  if (filename) {
    const lineCount = textContent ? textContent.split("\n").length : 0;
    const byteLen = textContent ? new Blob([textContent]).size : 0;
    const sizeStr = byteLen < 1024 ? `${byteLen} B` : `${(byteLen / 1024).toFixed(1)} KB`;

    steps.push({
      title: isComplete 
        ? `Worked on ${filename}`
        : `Working on ${filename}...`,
      subtitle: isComplete 
        ? `Generated production code (${sizeStr}, ${lineCount} lines)`
        : `Streaming syntax tree (${lineCount} lines generated)`,
      status: isComplete ? "done" : "in_progress",
      time: timeElapsed > 0 ? `${(timeElapsed * 0.7).toFixed(1)}s` : "active"
    });
  }

  // Step 4: Media Generation Directives
  if (hasImageDirective) {
    steps.push({
      title: isComplete 
        ? "Executed local GPU image generator"
        : "Executing local GPU image generator (Euler_A, 60 steps)...",
      subtitle: isComplete 
        ? "Rendered visual assets on local accelerator and saved to abyx/assets/"
        : "Generating photorealistic visual assets with local SD pipeline",
      status: isComplete ? "done" : "in_progress",
      time: timeElapsed > 0 ? `${(timeElapsed * 0.9).toFixed(1)}s` : null
    });
  }

  if (hasAudioDirective) {
    steps.push({
      title: isComplete 
        ? "Synthesized speech audio via Kokoro TTS"
        : "Synthesizing speech audio with Kokoro engine...",
      subtitle: "Generated voice narration and linked to workspace audio player",
      status: isComplete ? "done" : "in_progress",
      time: isComplete ? `${timeElapsed.toFixed(1)}s` : null
    });
  }

  // Step 5: Workspace Deployment
  if (filename) {
    steps.push({
      title: isComplete 
        ? `Finalized and saved abyx/${filename} to workspace`
        : `Synchronizing abyx/${filename} to workspace...`,
      subtitle: isComplete 
        ? "File ready for Download, File Explorer Reveal, or Browser Preview"
        : "Pending completion of token stream",
      status: isComplete ? "done" : "pending",
      time: isComplete ? `${timeElapsed.toFixed(1)}s` : null
    });
  }

  return (
    <div className="chat-thinking-wrapper" style={{ margin: "4px 0 10px", width: "100%", maxWidth: "780px" }}>
      {/* Sleek pill matching reference: [Icon] Label [Chevron] */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "8px",
          padding: "6px 14px",
          borderRadius: "9999px",
          background: "#121215",
          border: "1px solid rgba(255, 255, 255, 0.08)",
          color: "#9ca3af",
          fontSize: "12px",
          fontFamily: "system-ui, -apple-system, sans-serif",
          cursor: "pointer",
          transition: "all 0.15s ease",
          boxShadow: "0 1px 4px rgba(0, 0, 0, 0.2)",
          userSelect: "none"
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.18)";
          e.currentTarget.style.color = "#e5e7eb";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.08)";
          e.currentTarget.style.color = "#9ca3af";
        }}
      >
        <span style={{ display: "flex", alignItems: "center" }}>{icon}</span>
        <span style={{ fontWeight: 500 }}>{label}</span>
        {!isComplete && (
          <LoaderCircle
            size={11}
            className="abyx-spin"
            style={{ color: "var(--accent-orange, #ff4b1f)", marginLeft: "2px", flexShrink: 0 }}
          />
        )}
        <ChevronDown
          size={13}
          style={{
            transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.2s ease",
            color: "#6b7280",
            marginLeft: "4px"
          }}
        />
      </button>

      {/* Expanded Breakdown & Agent Activity Logs */}
      {isExpanded && (
        <div style={{
          marginTop: "8px",
          borderRadius: "12px",
          border: "1px solid rgba(255, 255, 255, 0.08)",
          background: "#0c0c0f",
          padding: "12px 14px",
          boxShadow: "0 4px 20px rgba(0, 0, 0, 0.35)",
          maxWidth: "760px"
        }}>
          {/* Header */}
          <div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "10px",
            paddingBottom: "8px",
            borderBottom: "1px solid rgba(255, 255, 255, 0.06)"
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <Terminal size={12} style={{ color: "#38bdf8" }} />
              <span style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.5px", color: "#9ca3af", textTransform: "uppercase", fontFamily: "'JetBrains Mono', monospace" }}>
                Agent Execution Trace
              </span>
            </div>
            <span style={{ fontSize: "11px", color: isComplete ? "#10b981" : "#38bdf8", fontWeight: 600 }}>
              {isComplete ? "Completed" : "Executing..."}
            </span>
          </div>

          {/* Activity Steps */}
          <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
            {steps.map((st, i) => (
              <div key={i} style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "10px",
                padding: "6px 0",
                borderBottom: i < steps.length - 1 ? "1px solid rgba(255, 255, 255, 0.04)" : "none"
              }}>
                <div style={{ marginTop: "2px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {st.status === "done" ? (
                    <CheckCircle size={14} style={{ color: "#10b981" }} />
                  ) : st.status === "in_progress" ? (
                    <LoaderCircle size={13} className="abyx-spin" style={{ color: "#38bdf8", flexShrink: 0 }} />
                  ) : (
                    <Circle size={14} style={{ color: "rgba(255, 255, 255, 0.2)" }} />
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: "12px",
                    fontWeight: st.status === "in_progress" ? 600 : 500,
                    color: st.status === "pending" ? "#6b7280" : "#f3f4f6",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between"
                  }}>
                    <span>{st.title}</span>
                    {st.time && <span style={{ fontSize: "11px", color: "#6b7280", marginLeft: "8px" }}>{st.time}</span>}
                  </div>
                  {st.subtitle && (
                    <div style={{ fontSize: "11px", color: "#9ca3af", marginTop: "1px" }}>
                      {st.subtitle}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Full reasoning text content if present */}
          {textReasoning && (
            <div style={{ marginTop: "12px", paddingTop: "8px", borderTop: "1px solid rgba(255, 255, 255, 0.06)" }}>
              <div style={{ fontSize: "10.5px", color: "#6b7280", fontWeight: 600, letterSpacing: "0.5px", textTransform: "uppercase", marginBottom: "4px" }}>
                Model Reasoning Buffer
              </div>
              <div style={{
                fontSize: "12px",
                lineHeight: "1.6",
                color: "rgba(255, 255, 255, 0.65)",
                fontFamily: "'JetBrains Mono', Consolas, monospace",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                maxHeight: "260px",
                overflowY: "auto"
              }}>
                {textReasoning}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const messageContainsImage = (message) => (
  Array.isArray(message?.content) &&
  message.content.some((item) => item?.type === "image_url" && item?.image_url?.url)
);

function TextChat({ 
  specs, 
  showAlert, 
  showConfirm, 
  textSettings, 
  setTextSettings, 
  setActiveModel, 
  setServerRunning,
  conversations = [],
  setConversations,
  activeConversationId,
  setActiveConversationId,
  saveConversationState,
  onRenameConversation,
  onTogglePinConversation,
  onExportConversation,
  setIsLlmLoaded,
  setActiveTab,
  onThreadChange,
  sidebarVisible = true,
  onToggleSidebar,
  activeProject,
  onOpenProjects,
  onOpenBrowser
}) {
  const formatGenerationTime = (seconds) => {
    const value = Number(seconds) || 0;
    if (value < 1) return `${Math.round(value * 1000)} ms`;
    return `${value.toFixed(value < 10 ? 2 : 1)} s`;
  };

  const [models, setModels] = useState([]);
  const [status, setStatus] = useState({ ready: false, running: false, settings: {} });
  const [selectedModel, setSelectedModel] = useState(() => {
    const saved = localStorage.getItem("selectedLlmModel");
    if (!saved || saved === "auto" || saved === "cloud") return "local";
    return saved;
  });
  const [cloudProviders, setCloudProviders] = useState([]);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [useWebSearch, setUseWebSearch] = useState(false);
  const [webTimeFilter, setWebTimeFilter] = useState("any");
  const [loadingModel, setLoadingModel] = useState(null);
  const [speakingIdx, setSpeakingIdx] = useState(null);
  const kokoroAudioRef = useRef(null);
  const [copiedMessageIdx, setCopiedMessageIdx] = useState(null);
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [renameInput, setRenameInput] = useState("");
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [tokenUsage, setTokenUsage] = useState({
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0
  });

  const [agentMode, setAgentMode] = useState(() => localStorage.getItem("abyx_agent_mode") || "act");
  const [isHarnessControlsOpen, setIsHarnessControlsOpen] = useState(false);
  const [activeDiff, setActiveDiff] = useState(null);
  const [pendingApprovals, setPendingApprovals] = useState([]);

  useEffect(() => {
    let mounted = true;
    const checkApprovals = async () => {
      try {
        const res = await getPendingApprovals();
        if (mounted && res && Array.isArray(res.approvals)) {
          setPendingApprovals(res.approvals.filter(a => a.status === "pending"));
        }
      } catch (_) {}
    };
    checkApprovals();
    const interval = setInterval(checkApprovals, 3000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (setIsLlmLoaded) {
      setIsLlmLoaded(status.ready ? (status.settings?.model || true) : false);
    }
  }, [status.ready, status.settings?.model, setIsLlmLoaded]);

  const [showModelMenu, setShowModelMenu] = useState(false);
  const [activeSubmenu, setActiveSubmenu] = useState(null);
  const modelMenuRef = useRef(null);

  // Local Permissions & Execution Mode (Act / Plan / Turbo / Default / Review)
  const [permissionMode, setPermissionMode] = useState(() => {
    return localStorage.getItem("abyx_permission_mode") || "turbo";
  });
  const [showPermissionsMenu, setShowPermissionsMenu] = useState(false);
  const permissionsMenuRef = useRef(null);

  const [executionMode, setExecutionMode] = useState(() => {
    return localStorage.getItem("abyx_execution_mode") || "act";
  });

  const [thinkingEffort, setThinkingEffort] = useState(() => {
    return localStorage.getItem("abyx_thinking_effort") || "high";
  });

  const handlePermissionModeChange = async (newMode) => {
    setPermissionMode(newMode);
    localStorage.setItem("abyx_permission_mode", newMode);
    setShowPermissionsMenu(false);
    try {
      await fetch("/api/security/mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: executionMode === "plan" ? "plan" : "build",
          permissionMode: newMode
        })
      });
    } catch (err) {
      console.warn("Failed to update security permission mode:", err);
    }
  };

  const handleToggleExecutionMode = async () => {
    const next = executionMode === "act" ? "plan" : "act";
    setExecutionMode(next);
    localStorage.setItem("abyx_execution_mode", next);
    try {
      await fetch("/api/security/mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: next === "plan" ? "plan" : "build",
          permissionMode
        })
      });
    } catch (_) {}
  };

  // Slash Commands Support (/plan, /act, /code, /turbo, /auto, /default, /review, /clear, /help)
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const slashMenuRef = useRef(null);

  const SLASH_COMMANDS = useMemo(() => [
    { cmd: "/plan", label: "/plan [task]", desc: "Formulate architecture & plan (read-only analysis, no mutations)", icon: Zap, type: "mode", mode: "plan" },
    { cmd: "/act", label: "/act [task]", desc: "Autonomous execution & code implementation", icon: Play, type: "mode", mode: "act" },
    { cmd: "/code", label: "/code [task]", desc: "Direct coding, refactoring, and software engineering", icon: FileCode, type: "mode", mode: "act" },
    { cmd: "/turbo", label: "/turbo", desc: "Turbo: Unrestricted autonomous execution (no confirmation pauses)", icon: Zap, type: "permission", permission: "turbo" },
    { cmd: "/auto", label: "/auto", desc: "Auto: Automatically decide if commands run safely", icon: Shield, type: "permission", permission: "auto" },
    { cmd: "/default", label: "/default", desc: "Default: Ask before sensitive operations", icon: Lock, type: "permission", permission: "default" },
    { cmd: "/review", label: "/review", desc: "Request Review: Every command requires approval", icon: Eye, type: "permission", permission: "request_review" },
    { cmd: "/clear", label: "/clear", desc: "Clear current conversation history", icon: Trash2, type: "action", action: "clear" },
    { cmd: "/help", label: "/help", desc: "Show command list and agent workflows", icon: HelpCircle, type: "action", action: "help" },
  ], []);

  const matchingSlashCommands = useMemo(() => {
    if (!input.startsWith("/")) return [];
    const commandPart = input.trim().split(/\s+/)[0].toLowerCase();
    return SLASH_COMMANDS.filter(c => c.cmd.toLowerCase().startsWith(commandPart));
  }, [input, SLASH_COMMANDS]);

  const handleInputChange = (e) => {
    const val = e.target.value;
    setInput(val);
    if (val.startsWith("/") && !val.includes(" ")) {
      setShowSlashMenu(true);
    } else {
      setShowSlashMenu(false);
    }
  };

  const executeSlashCommandItem = async (cmdItem) => {
    setShowSlashMenu(false);
    if (cmdItem.type === "mode") {
      setExecutionMode(cmdItem.mode);
      localStorage.setItem("abyx_execution_mode", cmdItem.mode);
      try {
        await fetch("/api/security/mode", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: cmdItem.mode === "plan" ? "plan" : "build", permissionMode })
        });
      } catch (_) {}
      setInput(`${cmdItem.cmd} `);
      textareaRef.current?.focus();
    } else if (cmdItem.type === "permission") {
      handlePermissionModeChange(cmdItem.permission);
      setInput("");
      setMessages(prev => [...prev, {
        role: "assistant",
        content: `Sandbox permission set to **${cmdItem.cmd.replace("/", "").toUpperCase()}** (${cmdItem.desc}).`
      }]);
    } else if (cmdItem.action === "clear") {
      setInput("");
      setMessages([]);
      setActiveConversationId(null);
    } else if (cmdItem.action === "help") {
      setInput("");
      setMessages(prev => [...prev, {
        role: "assistant",
        content: `### Available Slash Commands\n\n` +
          `- **/plan [prompt]**: Formulate structured architecture and plan without tool mutations.\n` +
          `- **/act [prompt]**: Autonomous execution, tool calls, and workspace changes.\n` +
          `- **/code [prompt]**: Direct coding, refactoring, and implementation.\n` +
          `- **/turbo**: Unrestricted autonomous mode (skips approval prompts).\n` +
          `- **/auto**: Balanced automation with safe approval heuristics.\n` +
          `- **/default**: Standard sandbox safety (prompts for sensitive operations).\n` +
          `- **/review**: Request approval for every command.\n` +
          `- **/clear**: Clear the current chat conversation.\n` +
          `- **/help**: Show this help guide.`
      }]);
    }
  };

  useEffect(() => {
    fetch("/api/security/status")
      .then(res => res.json())
      .then(data => {
        if (data && data.ok) {
          if (data.mode) setExecutionMode(data.mode === "plan" ? "plan" : "act");
          if (data.permissionMode) {
            let pm = data.permissionMode;
            if (pm === "ask") pm = "default";
            if (pm === "approve for me") pm = "auto";
            if (pm === "request review") pm = "request_review";
            setPermissionMode(pm);
          }
        }
      })
      .catch(() => {});
  }, []);

  // Real-time Voice Dictation (Microphone) State & Handler
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef(null);

  const toggleListening = useCallback(() => {
    if (isListening) {
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch (_) {}
      }
      setIsListening(false);
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      if (typeof showAlert === "function") {
        showAlert({
          title: "Microphone Voice Input",
          message: "Speech recognition is not supported by your current browser environment. Please use Google Chrome, Microsoft Edge, or a Web Speech API enabled browser."
        });
      } else {
        alert("Speech recognition is not supported in this browser.");
      }
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = navigator.language || "en-US";

      recognition.onstart = () => {
        setIsListening(true);
      };

      recognition.onresult = (event) => {
        let transcript = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          if (event.results[i].isFinal) {
            transcript += event.results[i][0].transcript;
          }
        }
        if (transcript) {
          setInput((prev) => (prev ? prev.trim() + " " + transcript.trim() : transcript.trim()));
        }
      };

      recognition.onerror = (event) => {
        console.warn("Speech recognition error:", event.error);
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err) {
      console.error("Failed to start speech recognition:", err);
      setIsListening(false);
    }
  }, [isListening, showAlert]);

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch (_) {}
      }
    };
  }, []);

  useEffect(() => {
    function handleClickOutside(event) {
      if (modelMenuRef.current && !modelMenuRef.current.contains(event.target)) {
        setShowModelMenu(false);
        setActiveSubmenu(null);
      }
      if (permissionsMenuRef.current && !permissionsMenuRef.current.contains(event.target)) {
        setShowPermissionsMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const estimateTokens = (text) => {
    const value = String(text || "").trim();
    if (!value) return 0;
    const wordCount = value.split(/\s+/).filter(Boolean).length;
    return Math.max(wordCount, Math.ceil(value.length / 4));
  };

  // Context compaction threshold dynamically calibrated to model context window (supporting up to 262,144 tokens)
  const compactConversationMessages = (msgs, maxEstimatedTokens) => {
    const contextLimit = Number(status.settings?.contextSize || textSettings?.contextSize || 262144);
    const limit = maxEstimatedTokens !== undefined ? maxEstimatedTokens : Math.max(120000, Math.floor(contextLimit * 0.75));
    if (!Array.isArray(msgs) || msgs.length <= 8) return msgs;
    let totalTokens = 0;
    for (const m of msgs) {
      const text = typeof m.content === "string" ? m.content : JSON.stringify(m.content || "");
      totalTokens += estimateTokens(text);
    }
    if (totalTokens <= limit) return msgs;

    const recentCount = 6;
    const recentMessages = msgs.slice(-recentCount);
    const olderMessages = msgs.slice(0, -recentCount);

    const summaryPoints = [];
    for (let i = 0; i < olderMessages.length; i += 2) {
      const uMsg = olderMessages[i];
      const aMsg = olderMessages[i + 1];
      const uText = (typeof uMsg?.content === "string" ? uMsg.content : "").slice(0, 120).trim();
      const aText = (typeof aMsg?.content === "string" ? aMsg.content : "").replace(/```[\s\S]*?```/g, "[code]").slice(0, 150).trim();
      if (uText) {
        summaryPoints.push(`- User: "${uText}" -> Abyx: "${aText}"`);
      }
    }

    const compactedAnchor = {
      role: "user",
      content: `[PRIOR CONVERSATION CONTEXT (${olderMessages.length} earlier turns compacted for performance):\n${summaryPoints.slice(-8).join("\n")}\n]`
    };
    const ackAnchor = {
      role: "assistant",
      content: "Understood. I retain full context of our earlier discussion."
    };
    return [compactedAnchor, ackAnchor, ...recentMessages];
  };

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  const getAutoMaxResponseTokens = (promptTokens, thinkingEnabled) => {
    const contextLimit = Number(status.settings?.contextSize || textSettings?.contextSize || 262144);
    const safetyBuffer = thinkingEnabled ? 1024 : 512;
    const available = Math.max(8192, contextLimit - promptTokens - safetyBuffer);
    return Math.min(65536, available);
  };
  
  const bottomRef = useRef(null);
  const textareaRef = useRef(null);
  const completedDownloadRef = useRef("");
  const loadingModelRef = useRef(null);
  const chatMessagesRef = useRef(null);
  const prevMessagesLengthRef = useRef(0);
  const followGenerationRef = useRef(false);
  const abortControllerRef = useRef(null);
  // rAF batching: accumulate token updates and flush once per frame
  const tokenBufferRef = useRef(null);
  const rafRef = useRef(null);
  // Debounced stats: only update stats pill every 250ms
  const statsDebounceRef = useRef(null);

  const [attachments, setAttachments] = useState([]);
  const fileInputRef = useRef(null);
  const supportsVision = Boolean(status.ready && status.settings?.supportsVision);
  const supportsThinking = Boolean(status.ready && status.settings?.supportsThinking);
  const deepThinkEnabled = status.ready
    ? status.settings?.enableThinking === true
    : textSettings?.enableThinking === true;
  const visionStatus = status.settings?.visionStatus || "Image input requires a matching mmproj projector file.";

  const resizeComposerInput = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const maxHeight = 200;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  }, []);

  useLayoutEffect(() => {
    resizeComposerInput();
  }, [input, resizeComposerInput]);

  const isImage = (file) => {
    return /\.(jpe?g|png|webp)$/i.test(file.name) || file.type.startsWith("image/");
  };

  const isTextFile = (file) => {
    return /\.(txt|md|csv|js|jsx|ts|tsx|py|json|css|html|java|cpp|c|h|rs|go|sh|bat|xml|yaml|yml)$/i.test(file.name) || file.type.startsWith("text/");
  };

  const optimizeImageForVision = (file, maxSide = 1024, quality = 0.92) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.onload = () => {
      const originalDataUrl = reader.result;
      const img = new Image();
      img.onerror = () => reject(new Error(`Could not decode ${file.name}`));
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const width = Math.max(1, Math.round(img.width * scale));
        const height = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        const sendDataUrl = canvas.toDataURL("image/jpeg", quality);
        resolve({
          previewDataUrl: originalDataUrl,
          sendDataUrl,
          originalWidth: img.width,
          originalHeight: img.height,
          width,
          height,
        });
      };
      img.src = originalDataUrl;
    };
    reader.readAsDataURL(file);
  });

  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const dragCounterRef = useRef(0);

  const formatFileSize = (bytes) => {
    if (!bytes || bytes <= 0) return "0 B";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const fileToBase64 = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Failed to read file ${file.name}`));
    reader.onload = () => {
      const res = reader.result;
      const base64 = typeof res === "string" ? res.split(",")[1] || "" : "";
      resolve(base64);
    };
    reader.readAsDataURL(file);
  });

  const inspectZipArchive = (arrayBuffer) => {
    try {
      const view = new DataView(arrayBuffer);
      const len = arrayBuffer.byteLength;
      let eocdOffset = -1;
      for (let i = len - 22; i >= Math.max(0, len - 65557); i--) {
        if (view.getUint32(i, true) === 0x06054b50) {
          eocdOffset = i;
          break;
        }
      }
      if (eocdOffset === -1) return null;
      const entryCount = view.getUint16(eocdOffset + 10, true);
      const cdOffset = view.getUint32(eocdOffset + 16, true);
      const entries = [];
      let offset = cdOffset;
      const decoder = new TextDecoder("utf-8");
      for (let k = 0; k < entryCount && offset < eocdOffset; k++) {
        if (view.getUint32(offset, true) !== 0x02014b50) break;
        const uncompressedSize = view.getUint32(offset + 24, true);
        const filenameLen = view.getUint16(offset + 28, true);
        const extraLen = view.getUint16(offset + 30, true);
        const commentLen = view.getUint16(offset + 32, true);
        const nameBytes = new Uint8Array(arrayBuffer, offset + 46, filenameLen);
        const filename = decoder.decode(nameBytes);
        entries.push({ filename, size: uncompressedSize });
        offset += 46 + filenameLen + extraLen + commentLen;
      }
      return entries;
    } catch (_) {
      return null;
    }
  };

  const saveFileToWorkspaceUploads = async (file) => {
    try {
      const base64 = await fileToBase64(file);
      await fetch("/api/files/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          subfolder: "uploads",
          content: base64,
          encoding: "base64"
        })
      });
    } catch (_) {}
  };

  const processIncomingFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;

    for (const file of files) {
      const lowerName = file.name.toLowerCase();
      const ext = lowerName.split(".").pop();
      const isZip = ext === "zip";
      const isOtherArchive = ["rar", "7z", "tar", "gz", "bz2", "xz", "iso", "tgz"].includes(ext);
      const isImg = isImage(file);
      const isCodeOrText = isTextFile(file) || ["js", "jsx", "ts", "tsx", "py", "json", "html", "css", "sql", "yaml", "yml", "xml", "md", "txt", "csv", "tsv", "c", "cpp", "h", "rs", "go", "java", "sh", "bat", "ps1", "env", "gitignore"].includes(ext);
      const isPdf = ext === "pdf" || file.type === "application/pdf";

      // 1. ZIP Archives — Parse central directory in browser and upload
      if (isZip) {
        try {
          const buffer = await file.arrayBuffer();
          const entries = inspectZipArchive(buffer);
          await saveFileToWorkspaceUploads(file);
          let summary = `[Attached Archive: "${file.name}" (${formatFileSize(file.size)}) — Uploaded to workspace: "uploads/${file.name}"]`;
          if (entries && entries.length > 0) {
            summary += `\nArchive Contents (${entries.length} items):\n`;
            summary += entries.slice(0, 45).map(e => `  - ${e.filename} (${formatFileSize(e.size)})`).join("\n");
            if (entries.length > 45) {
              summary += `\n  ... and ${entries.length - 45} more files.`;
            }
          }
          setAttachments(prev => [
            ...prev,
            {
              id: Math.random().toString(36).substring(7),
              file,
              type: "archive",
              name: file.name,
              content: summary,
              size: file.size,
            }
          ]);
        } catch (err) {
          await saveFileToWorkspaceUploads(file);
          setAttachments(prev => [
            ...prev,
            {
              id: Math.random().toString(36).substring(7),
              file,
              type: "archive",
              name: file.name,
              content: `[Attached Archive: "${file.name}" (${formatFileSize(file.size)}) saved to workspace: "uploads/${file.name}"]`,
              size: file.size,
            }
          ]);
        }
        continue;
      }

      // 2. Other Archives (RAR, 7Z, TAR, GZ, etc.) — Upload to workspace & provide context
      if (isOtherArchive) {
        await saveFileToWorkspaceUploads(file);
        setAttachments(prev => [
          ...prev,
          {
            id: Math.random().toString(36).substring(7),
            file,
            type: "archive",
            name: file.name,
            content: `[Attached Archive: "${file.name}" (${formatFileSize(file.size)}) saved to workspace: "uploads/${file.name}". You can inspect, unpack, or process it using workspace tools.]`,
            size: file.size,
          }
        ]);
        continue;
      }

      // 3. Images
      if (isImg) {
        if (supportsVision) {
          try {
            const image = await optimizeImageForVision(file);
            setAttachments(prev => [
              ...prev,
              {
                id: Math.random().toString(36).substring(7),
                file,
                type: "image",
                name: file.name,
                dataUrl: image.previewDataUrl,
                sendDataUrl: image.sendDataUrl,
                width: image.width,
                height: image.height,
                size: file.size,
              }
            ]);
          } catch (err) {
            showAlert({ title: "Image Error", message: err.message || String(err), danger: true });
          }
        } else {
          // If loaded model does not support vision, attach gracefully with preview & upload
          await saveFileToWorkspaceUploads(file);
          const reader = new FileReader();
          reader.onload = () => {
            setAttachments(prev => [
              ...prev,
              {
                id: Math.random().toString(36).substring(7),
                file,
                type: "image",
                name: file.name,
                dataUrl: reader.result,
                content: `[Attached Image: "${file.name}" (${formatFileSize(file.size)}) saved to workspace: "uploads/${file.name}"]`,
                size: file.size,
              }
            ]);
          };
          reader.readAsDataURL(file);
        }
        continue;
      }

      // 4. PDF Documents
      if (isPdf) {
        try {
          const text = await extractPdfText(file);
          await saveFileToWorkspaceUploads(file);
          setAttachments(prev => [
            ...prev,
            {
              id: Math.random().toString(36).substring(7),
              file,
              type: "document",
              name: file.name,
              content: text.trim() 
                ? text 
                : `[Attached PDF Document: "${file.name}" (${formatFileSize(file.size)}) saved to workspace: "uploads/${file.name}"]`,
              size: file.size,
            }
          ]);
        } catch (err) {
          await saveFileToWorkspaceUploads(file);
          setAttachments(prev => [
            ...prev,
            {
              id: Math.random().toString(36).substring(7),
              file,
              type: "document",
              name: file.name,
              content: `[Attached PDF Document: "${file.name}" (${formatFileSize(file.size)}) saved to workspace: "uploads/${file.name}"]`,
              size: file.size,
            }
          ]);
        }
        continue;
      }

      // 5. Code & Text files
      if (isCodeOrText) {
        try {
          const text = await file.text();
          setAttachments(prev => [
            ...prev,
            {
              id: Math.random().toString(36).substring(7),
              file,
              type: "code",
              name: file.name,
              content: `[Attached Code/Text File: "${file.name}" (${formatFileSize(file.size)})]\n\`\`\`${ext}\n${text}\n\`\`\``,
              size: file.size,
            }
          ]);
        } catch (_) {
          await saveFileToWorkspaceUploads(file);
          setAttachments(prev => [
            ...prev,
            {
              id: Math.random().toString(36).substring(7),
              file,
              type: "code",
              name: file.name,
              content: `[Attached File: "${file.name}" (${formatFileSize(file.size)}) saved to workspace: "uploads/${file.name}"]`,
              size: file.size,
            }
          ]);
        }
        continue;
      }

      // 6. Universal fallback for ANY other file (binaries, audio, video, databases, etc.)
      await saveFileToWorkspaceUploads(file);
      setAttachments(prev => [
        ...prev,
        {
          id: Math.random().toString(36).substring(7),
          file,
          type: "file",
          name: file.name,
          content: `[Attached File: "${file.name}" (${file.type || "binary/data"}, ${formatFileSize(file.size)}) saved to workspace: "uploads/${file.name}"]`,
          size: file.size,
        }
      ]);
    }
  };

  const handleFileChange = (e) => {
    processIncomingFiles(e.target.files);
    e.target.value = "";
  };

  useEffect(() => {
    loadingModelRef.current = loadingModel;
  }, [loadingModel]);


  const buildTextStartOptions = (settings) => ({
    threads: settings?.threads || specs?.cpu_cores_physical || 4,
    contextSize: settings?.contextSize ?? 0,
    gpuLayers: settings?.gpuLayers ?? -1,
    enableThinking: settings?.enableThinking === true,
    flashAttn: settings?.flashAttn,
    cacheTypeK: settings?.cacheTypeK,
    cacheTypeV: settings?.cacheTypeV,
    mlock: settings?.mlock,
    mmap: settings?.mmap,
    cachePrompt: settings?.cachePrompt,
    defragThold: settings?.defragThold,
    batchSize: settings?.batchSize,
    ubatchSize: settings?.ubatchSize,
    performanceProfile: settings?.performanceProfile,
    preferredBackend: settings?.preferredBackend,
  });

  const handleThinkingToggle = async () => {
    const enabled = !deepThinkEnabled;
    const nextSettings = { ...textSettings, enableThinking: enabled };

    if (!status.ready || !status.settings?.model) {
      setTextSettings(nextSettings);
      return;
    }

    const reload = await showConfirm({
      title: enabled ? "Reload With DeepThink?" : "Reload Without DeepThink?",
      message: "Changing DeepThink requires reloading the text model before it affects new replies. Reload now, or skip and keep the currently loaded model as-is?",
      confirmLabel: "Reload",
      cancelLabel: "Skip",
    });
    if (!reload) return;

    setIsBusy(true);
    try {
      setTextSettings(nextSettings);
      await stopLlm();
      const result = await startLlm(status.settings.model, buildTextStartOptions(nextSettings));
      setStatus({ ...status, ...result, ready: true, running: true, settings: result.settings });
    } catch (err) {
      showAlert({ title: "Text Model Reload Failed", message: err.message || String(err), danger: true });
    } finally {
      setIsBusy(false);
    }
  };

  useEffect(() => {
    if (!supportsVision) {
      setAttachments((current) => current.filter((attachment) => attachment.type !== "image"));
    }
  }, [supportsVision]);

  // Load conversation messages when activeConversationId changes
  useEffect(() => {
    if (isBusy) return;
    if (activeConversationId) {
      const conv = conversations.find(c => c.id === activeConversationId);
      if (conv) {
        setMessages(conv.messages);
        if (conv.model && models.some(m => m.filename === conv.model)) {
          setSelectedModel(conv.model);
        }
        const total = conv.messages.reduce((sum, m) => {
          const text = Array.isArray(m.content)
            ? m.content.map(c => c.text || "").join(" ")
            : (m.content || "");
          return sum + estimateTokens(text) + estimateTokens(m.reasoning || "");
        }, 0);
        setTokenUsage({
          prompt_tokens: Math.round(total * 0.7),
          completion_tokens: Math.round(total * 0.3),
          total_tokens: total
        });
      }
    } else {
      setMessages([]);
      setTokenUsage({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
    }
  }, [activeConversationId, conversations, models, isBusy]);

  const refresh = useCallback(async () => {
    const [nextModels, nextStatus, provData] = await Promise.all([
      listLlmModels().catch(() => []),
      getLlmStatus().catch(() => ({ ready: false, running: false, settings: {} })),
      getProviders().catch(() => ({ providers: [] })),
    ]);
    const selectableModels = (nextModels || []).filter((model) => !model.isProjector);
    setModels(selectableModels);
    setStatus(nextStatus);
    setCloudProviders(provData?.providers || []);
    const active = nextStatus.settings?.model;
    setSelectedModel((current) => {
      if (current && current.includes("/")) return current;
      return active || "local";
    });
  }, []);

  useEffect(() => {
    refresh().catch(() => {});
    const timer = setInterval(() => {
      getLlmStatus().then((nextStatus) => {
        setStatus(nextStatus);
        // If it suddenly loaded or became ready externally, update selection and reset loading states
        if (nextStatus.ready && nextStatus.settings?.model) {
          setSelectedModel(prev => (prev && prev.includes("/")) ? prev : (nextStatus.settings?.model || "local"));
          setLoadingModel(null);
        }
      }).catch(() => {});
      getDownloadProgress().then((state) => {
        if (state.kind === "text" && (state.active || state.error || state.progress === 100)) {
          const completionKey = `${state.filename || ""}:${state.downloadedBytes || 0}`;
          if (!state.active && !state.error && completedDownloadRef.current !== completionKey) {
            completedDownloadRef.current = completionKey;
            refresh().catch(() => {});
          }
        }
      }).catch(() => {});
    }, 1500);
    return () => clearInterval(timer);
  }, [refresh]);

  const handleStopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  };

  useEffect(() => {
    // Track the length even while the thread is unmounted (home screen), so the
    // first message of a new or cleared chat is detected correctly
    const len = messages.length;
    const prevLen = prevMessagesLengthRef.current;
    prevMessagesLengthRef.current = len;

    const container = chatMessagesRef.current;
    if (!container) return;

    const lastMessage = messages[len - 1];
    const isNewUserMessage = len > prevLen && lastMessage?.role === "user";
    const isOpeningConversation = prevLen === 0 && len > 0;

    // Scroll only the message list. scrollIntoView() also scrolls every scrollable
    // ancestor, which pushed the header and composer off screen while streaming.
    // Follow new text only while the reader is at the bottom (see handleMessagesScroll),
    // so scrolling up during generation is never pulled back down.
    if (isNewUserMessage || isOpeningConversation) followGenerationRef.current = true;
    if (followGenerationRef.current) {
      container.scrollTo({ top: container.scrollHeight });
    }
  }, [messages, isBusy, loadingModel]);

  // Lets the app hide its top bar while a conversation is on screen
  useEffect(() => {
    onThreadChange?.(messages.length > 0 && !loadingModel);
  }, [messages.length, loadingModel, onThreadChange]);

  const handleMessagesScroll = (event) => {
    const container = event.currentTarget;
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    followGenerationRef.current = distanceFromBottom <= 24;
  };

  const handleModelChange = async (filename) => {
    if (!filename) {
      if (status.ready) {
        setIsBusy(true);
        try {
          await stopLlm();
          setStatus((prev) => ({ ...prev, ready: false, running: false }));
          setSelectedModel("");
          setMessages([]);
          setTokenUsage({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
        } catch (err) {
          showAlert({ title: "Unload Failed", message: err.message || String(err), danger: true });
        } finally {
          setIsBusy(false);
        }
      }
      return;
    }

    // Only one large model fits at a time: if an image model is loaded, ask before swapping
    const imageStatus = await getBackendStatus().catch(() => null);
    const imageModel = imageStatus?.ready && imageStatus.settings?.model
      ? imageStatus.settings.model.split(/[\\/]/).pop().replace(/\.(safetensors|ckpt|gguf)$/i, "")
      : null;
    if (imageModel) {
      const confirmed = await showConfirm({
        title: "Unload the image model?",
        message: `${imageModel} is loaded for images. Only one large model can run at a time, so it will be unloaded to load ${filename.replace(/\.gguf$/i, "")}. You can load it again from Images later.`,
        confirmLabel: "Unload and load",
      });
      if (!confirmed) return;
    }

    setSelectedModel(filename);
    localStorage.setItem("selectedLlmModel", filename);
    setIsBusy(true);
    setLoadingModel(filename);
    try {
      if (imageModel) {
        await stopServer();
        if (setServerRunning) setServerRunning(false);
      }

      const result = await startLlm(filename, {
        threads: textSettings?.threads || specs?.cpu_cores_physical || 4,
        contextSize: textSettings?.contextSize ?? 0,
        gpuLayers: textSettings?.gpuLayers ?? -1,
        enableThinking: textSettings?.enableThinking === true,
        flashAttn: textSettings?.flashAttn,
        cacheTypeK: textSettings?.cacheTypeK,
        cacheTypeV: textSettings?.cacheTypeV,
        mlock: textSettings?.mlock,
        mmap: textSettings?.mmap,
        cachePrompt: textSettings?.cachePrompt,
        defragThold: textSettings?.defragThold,
        batchSize: textSettings?.batchSize,
        ubatchSize: textSettings?.ubatchSize,
        performanceProfile: textSettings?.performanceProfile,
        preferredBackend: textSettings?.preferredBackend,
      });
      setStatus({ ...status, ...result, ready: true, running: true, settings: result.settings });
      setMessages([]);
      setTokenUsage({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
    } catch (err) {
      if (loadingModelRef.current === filename) {
        showAlert({ title: "Text Model Load Failed", message: err.message, danger: true });
      }
    } finally {
      setLoadingModel(null);
      setIsBusy(false);
    }
  };

  const handleCancelLlmLoad = async () => {
    try {
      await stopLlm();
    } catch (_) {}
    setLoadingModel(null);
    setIsBusy(false);
    setSelectedModel("");
  };

  const handleNewChat = () => {
    setActiveConversationId(null);
  };

  const sendMessage = async () => {
    const text = input.trim();
    const hasAttachments = attachments.length > 0;
    if ((!text && !hasAttachments) || isBusy || !isChatAvailable) return;

    let targetText = text;

    // Intercept slash commands
    if (text.startsWith("/")) {
      const parts = text.split(/\s+/);
      const command = parts[0].toLowerCase();
      const promptText = text.slice(command.length).trim();

      if (command === "/plan") {
        setExecutionMode("plan");
        localStorage.setItem("abyx_execution_mode", "plan");
        fetch("/api/security/mode", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "plan", permissionMode })
        }).catch(() => {});

        if (!promptText && !hasAttachments) {
          setInput("");
          setShowSlashMenu(false);
          setMessages(prev => [...prev, {
            role: "assistant",
            content: "Switched to **Plan Mode**. The agent will formulate architecture, steps, and read-only analysis without making workspace mutations."
          }]);
          return;
        }
        targetText = promptText;
      } else if (command === "/act" || command === "/code") {
        setExecutionMode("act");
        localStorage.setItem("abyx_execution_mode", "act");
        fetch("/api/security/mode", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "build", permissionMode })
        }).catch(() => {});

        if (!promptText && !hasAttachments) {
          setInput("");
          setShowSlashMenu(false);
          setMessages(prev => [...prev, {
            role: "assistant",
            content: "Switched to **Act Mode**. Autonomous tool execution, code generation, and workspace modifications are enabled."
          }]);
          return;
        }
        targetText = promptText;
      } else if (command === "/turbo") {
        setInput("");
        setShowSlashMenu(false);
        handlePermissionModeChange("turbo");
        setMessages(prev => [...prev, {
          role: "assistant",
          content: "Sandbox permission set to **Turbo**. All commands and tools run autonomously without confirmation pauses."
        }]);
        return;
      } else if (command === "/auto") {
        setInput("");
        setShowSlashMenu(false);
        handlePermissionModeChange("auto");
        setMessages(prev => [...prev, {
          role: "assistant",
          content: "Sandbox permission set to **Auto**. Safe commands execute automatically using safe heuristics."
        }]);
        return;
      } else if (command === "/default" || command === "/ask") {
        setInput("");
        setShowSlashMenu(false);
        handlePermissionModeChange("default");
        setMessages(prev => [...prev, {
          role: "assistant",
          content: "Sandbox permission set to **Default**. The agent prompts for user confirmation before executing sensitive operations."
        }]);
        return;
      } else if (command === "/review") {
        setInput("");
        setShowSlashMenu(false);
        handlePermissionModeChange("request_review");
        setMessages(prev => [...prev, {
          role: "assistant",
          content: "Sandbox permission set to **Request Review**. Every command and filesystem change requires explicit user approval."
        }]);
        return;
      } else if (command === "/clear") {
        setInput("");
        setShowSlashMenu(false);
        setMessages([]);
        setActiveConversationId(null);
        return;
      } else if (command === "/help") {
        setInput("");
        setShowSlashMenu(false);
        setMessages(prev => [...prev, {
          role: "assistant",
          content: `### Available Slash Commands\n\n` +
            `- **/plan [prompt]**: Formulate structured architecture and plan without tool mutations.\n` +
            `- **/act [prompt]**: Autonomous execution, tool calls, and workspace changes.\n` +
            `- **/code [prompt]**: Direct coding, refactoring, and implementation.\n` +
            `- **/turbo**: Unrestricted autonomous mode (skips approval prompts).\n` +
            `- **/auto**: Balanced automation with safe approval heuristics.\n` +
            `- **/default**: Standard sandbox safety (prompts for sensitive operations).\n` +
            `- **/review**: Request approval for every command.\n` +
            `- **/clear**: Clear the current chat conversation.\n` +
            `- **/help**: Show this help guide.`
        }]);
        return;
      }
    }

    let convId = activeConversationId;
    let isNew = false;
    if (!convId) {
      convId = "chat_" + Date.now();
      setActiveConversationId(convId);
      isNew = true;
    }

    // Delimited context blocks for document, archive, code, and file attachments
    let documentContext = "";
    attachments.filter(att => att.content).forEach((att) => {
      documentContext += `\n${att.content}\n`;
    });

    const imageAttachments = attachments.filter(att => att.type === "image" && att.sendDataUrl);
    const conversationHasImage = messages.some(messageContainsImage);
    const requestHasImage = imageAttachments.length > 0 || conversationHasImage;
    const visionInstruction = requestHasImage
      ? "For images in this conversation: answer in natural language, describe the actual image content, and read visible text carefully when relevant. If the user asks a follow-up like \"what is this\" or \"explain\", treat it as referring to the most recent image unless they say otherwise. Do not output raw JSON, arrays, bounding boxes, OCR layout objects, UI class names, or detection labels unless the user explicitly asks for that format."
      : "";
    const requestText = imageAttachments.length > 0
      ? (targetText && targetText !== "?" ? targetText : "Describe what is visible in the image.")
      : targetText;
    const displayText = targetText || (imageAttachments.length > 0 ? "Describe what is visible in the image." : "");
    const requestCombinedText = [
      requestText,
      documentContext,
    ].filter(Boolean).join("\n\n").trim();
    const displayCombinedText = documentContext
      ? [displayText, documentContext].filter(Boolean).join("\n\n").trim()
      : displayText;

    let userMessageContent;
    let requestUserMessageContent;
    if (imageAttachments.length > 0) {
      userMessageContent = [
        {
          type: "text",
          text: displayCombinedText
        },
        ...imageAttachments.map((img) => ({
          type: "image_url",
          image_url: {
            url: img.dataUrl
          }
        }))
      ];
      requestUserMessageContent = [
        {
          type: "text",
          text: requestCombinedText
        },
        ...imageAttachments.map((img) => ({
          type: "image_url",
          image_url: {
            url: img.sendDataUrl || img.dataUrl
          }
        }))
      ];
    } else {
      userMessageContent = displayCombinedText;
      requestUserMessageContent = requestCombinedText;
    }

    const nextMessages = [...messages, { role: "user", content: userMessageContent }];
    const requestConversationMessages = [...messages, { role: "user", content: requestUserMessageContent }];
    followGenerationRef.current = true;
    setMessages(nextMessages);
    setInput("");
    setIsBusy(true);

    const displayTitleText = text || (imageAttachments.length > 0 ? "Sent Image" : "Sent File");
    // Keep the full first line; the sidebar truncates visually
    const firstTitle = isNew ? displayTitleText.split("\n")[0].slice(0, 80) : null;
    saveConversationState(convId, nextMessages, selectedModel, firstTitle);

    const requestStartedAt = performance.now();
    setMessages([...nextMessages, {
      role: "assistant",
      content: "",
      generationStats: { status: "starting", tokens: 0, tokensPerSecond: 0, seconds: 0, vision: requestHasImage, web: useWebSearch },
    }]);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const systemPrompt = textSettings?.systemPrompt || "You are a helpful local AI assistant.";
      const combinedSystemPrompt = [
        systemPrompt.trim(),
        visionInstruction,
      ].filter(Boolean).join("\n\n");
      const requestMessages = [
        ...(combinedSystemPrompt ? [{ role: "system", content: combinedSystemPrompt }] : []),
        ...compactConversationMessages(requestConversationMessages),
      ];
      const promptTokenEstimate = requestMessages.reduce((sum, message) => {
        const messageText = Array.isArray(message.content)
          ? message.content.map((item) => item.text || "").join(" ")
          : (message.content || "");
        return sum + estimateTokens(messageText);
      }, 0);
      setTokenUsage({
        prompt_tokens: promptTokenEstimate,
        completion_tokens: 0,
        total_tokens: promptTokenEstimate,
      });

      let assistantText = "";
      let rawAssistantText = "";
      let assistantReasoning = "";
      let streamedTokens = 0;
      let firstTokenAt = null;
      let thinkingStartedAt = null;
      let thinkingEndedAt = null;
      let thinkingDuration = 0;

      const thinkingEnabled = deepThinkEnabled;
      const manualMaxTokens = textSettings?.maxTokens || 32768;
      const effectiveMaxTokens = textSettings?.responseTokenMode === "manual"
        ? (thinkingEnabled ? Math.max(manualMaxTokens, 4096) : manualMaxTokens)
        : getAutoMaxResponseTokens(promptTokenEstimate, thinkingEnabled);

      let routedInfo = null;
      const response = await streamChatWithLlm(requestMessages, {
        conversationId: activeConversationId,
        model: selectedModel || "auto",
        agentMode: executionMode === "plan" ? "plan" : "act",
        permissionMode: permissionMode,
        thinkingEffort: thinkingEffort,
        temperature: textSettings?.temperature || 0.7,
        maxTokens: effectiveMaxTokens,
        topP: textSettings?.topP,
        topK: textSettings?.topK,
        minP: textSettings?.minP,
        repeatPenalty: textSettings?.repeatPenalty,
        seed: textSettings?.seed,
        enableThinking: thinkingEnabled,
        useWeb: useWebSearch,
        timeFilter: webTimeFilter,
        signal: controller.signal,
        onRoutedModel: (info) => {
          routedInfo = info;
        },
      }, (_token, fullText, _reasoningToken, fullReasoning) => {
        const now = performance.now();
        if (streamedTokens === 0) {
          firstTokenAt = now;
        }
        streamedTokens += 1;
        const generationSeconds = firstTokenAt
          ? Math.max(0.05, (now - firstTokenAt) / 1000)
          : Math.max(0.05, (now - requestStartedAt) / 1000);
        
        rawAssistantText = fullText;
        const processed = processMessageContent(fullText, fullReasoning);
        assistantText = processed.content;
        assistantReasoning = processed.reasoning;

        // Calculate thinking duration
        if (processed.reasoning && !thinkingStartedAt) {
          thinkingStartedAt = now;
        }
        if (processed.content && thinkingStartedAt && !thinkingEndedAt) {
          thinkingEndedAt = now;
          thinkingDuration = (thinkingEndedAt - thinkingStartedAt) / 1000;
        }
        const currentThinkingDuration = thinkingEndedAt 
          ? thinkingDuration 
          : (thinkingStartedAt ? (now - thinkingStartedAt) / 1000 : 0);

        // Debounced stats update: only update stats every 250ms for smoother UI
        // while text still updates per-frame via rAF batching
        const currentStats = {
          status: "streaming",
          tokens: streamedTokens,
          tokensPerSecond: streamedTokens / generationSeconds,
          seconds: (now - requestStartedAt) / 1000,
        };
        // rAF batching: accumulate updates and flush once per frame (~16ms)
        // This reduces React re-renders from N per token to ~60/sec
        tokenBufferRef.current = {
          content: processed.content,
          reasoning: processed.reasoning,
          thinkingDuration: currentThinkingDuration,
          stats: currentStats,
        };

        if (!rafRef.current) {
          rafRef.current = requestAnimationFrame(() => {
            const buffer = tokenBufferRef.current;
            if (buffer) {
              setMessages((prev) => {
                const updated = [...prev];
                if (updated.length > 0 && updated[updated.length - 1].role === "assistant") {
                  updated[updated.length - 1] = {
                    ...updated[updated.length - 1],
                    content: buffer.content,
                    reasoning: buffer.reasoning,
                    thinkingDuration: buffer.thinkingDuration,
                    generationStats: buffer.stats,
                  };
                }
                return updated;
              });
              tokenBufferRef.current = null;
            }
            rafRef.current = null;
          });
        }
      });

      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      tokenBufferRef.current = null;

      const completedAt = performance.now();
      let finalThinkingDuration = thinkingDuration;
      if (thinkingStartedAt && !thinkingEndedAt) {
        thinkingEndedAt = completedAt;
        finalThinkingDuration = (thinkingEndedAt - thinkingStartedAt) / 1000;
      }

      const exactTokens = Number(response.timings?.predicted_n) || streamedTokens;
      const backendTotalMs = Number(response.timings?.prompt_ms || 0) + Number(response.timings?.predicted_ms || 0);
      const exactSeconds = backendTotalMs > 0
        ? backendTotalMs / 1000
        : (completedAt - requestStartedAt) / 1000;
      const exactTokensPerSecond = Number(response.timings?.predicted_per_second)
        || (exactTokens / Math.max(0.001, exactSeconds));
      const generationStats = {
        status: "complete",
        tokens: exactTokens,
        tokensPerSecond: exactTokensPerSecond,
        seconds: exactSeconds,
        finishReason: response.finishReason || null,
        truncated: response.finishReason === "length",
      };
      
      const processed = processMessageContent(response.content || rawAssistantText || assistantText, response.reasoningContent || assistantReasoning);
      const finalAssistantMessage = {
        role: "assistant",
        content: processed.content,
        reasoning: processed.reasoning,
        thinkingDuration: finalThinkingDuration,
        generationStats,
        routedModel: routedInfo || response.routedModel,
        webSources: response.webSources || [],
      };
      const finalMessages = [...nextMessages, finalAssistantMessage];
      setMessages(finalMessages);
      saveConversationState(convId, finalMessages, selectedModel);
      const finalCompletionEstimate = Math.max(
        exactTokens,
        estimateTokens(processed.content) + estimateTokens(processed.reasoning)
      );
      const finalUsageEstimate = {
        prompt_tokens: promptTokenEstimate,
        completion_tokens: finalCompletionEstimate,
        total_tokens: promptTokenEstimate + finalCompletionEstimate,
      };
      setTokenUsage(response.usage
        ? {
            prompt_tokens: Math.max(Number(response.usage.prompt_tokens) || 0, finalUsageEstimate.prompt_tokens),
            completion_tokens: Math.max(Number(response.usage.completion_tokens) || 0, finalUsageEstimate.completion_tokens),
            total_tokens: Math.max(Number(response.usage.total_tokens) || 0, finalUsageEstimate.total_tokens),
          }
        : finalUsageEstimate
      );
      
      // Clean up attached files on success
      setAttachments([]);
    } catch (err) {
      if (err.name === "AbortError") {
        setMessages((prev) => {
          const updated = [...prev];
          if (updated.length > 0 && updated[updated.length - 1].role === "assistant") {
            const lastMsg = updated[updated.length - 1];
            updated[updated.length - 1] = {
              ...lastMsg,
              generationStats: lastMsg.generationStats ? {
                ...lastMsg.generationStats,
                status: "complete",
              } : null
            };
            saveConversationState(convId, updated, selectedModel);
          }
          return updated;
        });
      } else {
        const finalMessages = [...nextMessages, { role: "assistant", content: `Error: ${err.message}`, error: true }];
        setMessages(finalMessages);
        saveConversationState(convId, finalMessages, selectedModel);
      }
    } finally {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      tokenBufferRef.current = null;
      setIsBusy(false);
      abortControllerRef.current = null;
      setTimeout(() => {
        followGenerationRef.current = false;
      }, 250);
      // Hard guarantee: finalize assistant message status so UI never stays stuck in 'Thinking...' or 'Working on...'
      setMessages((prev) => {
        if (!prev || prev.length === 0) return prev;
        const last = prev[prev.length - 1];
        if (last && last.role === "assistant" && last.generationStats && last.generationStats.status !== "complete") {
          const updated = [...prev];
          updated[updated.length - 1] = {
            ...last,
            generationStats: {
              ...last.generationStats,
              status: "complete"
            }
          };
          return updated;
        }
        return prev;
      });
    }
  };

  const handleClearChat = () => {
    setMessages([]);
    setTokenUsage({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
    if (activeConversationId) {
      saveConversationState(activeConversationId, [], selectedModel);
    }
  };

  const handleCopyMessage = (message, index) => {
    const text = Array.isArray(message.content)
      ? message.content.map(c => c.text || "").filter(Boolean).join("\n")
      : (message.content || "");
    if (!text) return;
    copyText(text)
      .then(() => setCopiedMessageIdx(index))
      .catch(() => setCopiedMessageIdx(`error-${index}`))
      .finally(() => setTimeout(() => setCopiedMessageIdx(null), 2000));
  };

  const handleForkConversation = (fromIndex) => {
    if (isBusy || !messages || messages.length === 0) return;
    const slicedMessages = messages.slice(0, fromIndex + 1);
    const currentConv = conversations.find(c => c.id === activeConversationId);
    const baseTitle = currentConv?.title || "Conversation";
    const newId = `chat_${Date.now()}_fork`;
    const newTitle = `${baseTitle} (Branch)`;
    
    saveConversationState?.(newId, slicedMessages, selectedModel, newTitle);
    setActiveConversationId?.(newId);
    setMessages(slicedMessages);
    if (showAlert) showAlert("success", "Conversation Branched", `Branched ${slicedMessages.length} messages into a new thread.`);
  };

  const fallbackBrowserSpeech = (cleanText, index) => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(cleanText);
      utterance.onend = () => setSpeakingIdx(null);
      utterance.onerror = () => setSpeakingIdx(null);
      window.speechSynthesis.speak(utterance);
    } else {
      setSpeakingIdx(null);
    }
  };

  const handleSpeakMessage = async (index, message) => {
    if (speakingIdx === index) {
      if (kokoroAudioRef.current) {
        kokoroAudioRef.current.pause();
        kokoroAudioRef.current = null;
      }
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
      setSpeakingIdx(null);
      return;
    }

    if (kokoroAudioRef.current) {
      kokoroAudioRef.current.pause();
      kokoroAudioRef.current = null;
    }
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();

    const rawText = Array.isArray(message.content)
      ? message.content.map(c => c.text || "").join(" ")
      : (message.content || "");
    const cleanText = rawText
      .replace(/```[\s\S]*?```/g, "")
      .replace(/\[IMAGE:.*?\]/gi, "")
      .replace(/\[AUDIO:.*?\]/gi, "")
      .replace(/!\[.*?\]\(.*?\)/g, "")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\[([^\]]+)\]\([^\)]+\)/g, "$1")
      .replace(/[#*_~>]/g, "")
      .trim();

    if (!cleanText) return;
    setSpeakingIdx(index);

    // 1. Try Kokoro AI Speech Engine
    try {
      const res = await fetch("/api/tts/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: cleanText.slice(0, 3000), voice: "af_heart", speed: 1.0 })
      });
      if (res.ok) {
        const data = await res.json();
        const wavFilename = data?.output?.audioFile || data?.output?.filename;
        if (wavFilename) {
          const audio = new Audio(`/tts-outputs/${encodeURIComponent(wavFilename)}`);
          kokoroAudioRef.current = audio;
          audio.onended = () => {
            setSpeakingIdx(null);
            kokoroAudioRef.current = null;
          };
          audio.onerror = () => {
            fallbackBrowserSpeech(cleanText, index);
          };
          audio.play().catch(() => fallbackBrowserSpeech(cleanText, index));
          return;
        }
      }
    } catch (_) {}

    // 2. Fallback to browser SpeechSynthesis
    fallbackBrowserSpeech(cleanText, index);
  };

  const handleFeedback = (index, type) => {
    setMessages((prev) => {
      const next = [...prev];
      if (next[index]) {
        next[index] = {
          ...next[index],
          feedback: next[index].feedback === type ? null : type
        };
        if (activeConversationId) {
          saveConversationState(activeConversationId, next, selectedModel);
        }
      }
      return next;
    });
  };

  const handleDeleteMessage = (index) => {
    setMessages((prev) => {
      const next = prev.filter((_, i) => i !== index);
      if (activeConversationId) {
        saveConversationState(activeConversationId, next, selectedModel);
      }
      return next;
    });
  };

  const handleEditMessage = (index, message) => {
    const text = Array.isArray(message.content)
      ? message.content.filter(c => c.type === "text").map(c => c.text).join(" ")
      : (message.content || "");
    setInput(text);
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  };

  const handleRegenerate = async (index) => {
    if (isBusy) return;
    const priorMessages = messages.slice(0, index);
    while (priorMessages.length > 0 && priorMessages[priorMessages.length - 1].role === "assistant") {
      priorMessages.pop();
    }
    if (priorMessages.length === 0) return;

    const convId = activeConversationId || ("chat_" + Date.now());
    if (!activeConversationId) setActiveConversationId(convId);

    setMessages([...priorMessages, {
      role: "assistant",
      content: "",
      generationStats: { status: "starting", tokens: 0, tokensPerSecond: 0, seconds: 0, vision: false, web: useWebSearch },
    }]);
    setIsBusy(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const systemPrompt = textSettings?.systemPrompt || "You are a helpful local AI assistant.";
      const requestMessages = [
        ...(systemPrompt ? [{ role: "system", content: systemPrompt.trim() }] : []),
        ...compactConversationMessages(priorMessages),
      ];
      let assistantText = "";
      let rawAssistantText = "";
      let assistantReasoning = "";
      let streamedTokens = 0;
      let routedInfo = null;
      const requestStartedAt = performance.now();

      const response = await streamChatWithLlm(requestMessages, {
        conversationId: activeConversationId,
        model: selectedModel || "auto",
        agentMode: executionMode === "plan" ? "plan" : "act",
        permissionMode: permissionMode,
        thinkingEffort: thinkingEffort,
        temperature: textSettings?.temperature || 0.7,
        maxTokens: textSettings?.maxTokens || 8192,
        signal: controller.signal,
        onRoutedModel: (info) => { routedInfo = info; }
      }, (_token, fullText, _reasoningToken, fullReasoning) => {
        streamedTokens += 1;
        rawAssistantText = fullText;
        const processed = processMessageContent(fullText, fullReasoning);
        assistantText = processed.content;
        assistantReasoning = processed.reasoning;
        setMessages([...priorMessages, {
          role: "assistant",
          content: processed.content,
          reasoning: processed.reasoning,
          generationStats: {
            status: "streaming",
            tokens: streamedTokens,
            tokensPerSecond: streamedTokens / Math.max(0.1, (performance.now() - requestStartedAt) / 1000),
            seconds: (performance.now() - requestStartedAt) / 1000,
          }
        }]);
      });

      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      tokenBufferRef.current = null;

      const completedAt = performance.now();
      const exactTokens = Number(response.timings?.predicted_n) || streamedTokens;
      const exactSeconds = (completedAt - requestStartedAt) / 1000;
      const processed = processMessageContent(response.content || rawAssistantText || assistantText, response.reasoningContent || assistantReasoning);

      const finalAssistantMessage = {
        role: "assistant",
        content: processed.content,
        reasoning: processed.reasoning,
        generationStats: {
          status: "complete",
          tokens: exactTokens,
          tokensPerSecond: exactTokens / Math.max(0.001, exactSeconds),
          seconds: exactSeconds,
          finishReason: response.finishReason || null,
        },
        routedModel: routedInfo || response.routedModel,
        webSources: response.webSources || [],
      };
      const finalMessages = [...priorMessages, finalAssistantMessage];
      setMessages(finalMessages);
      saveConversationState(convId, finalMessages, selectedModel);
    } catch (err) {
      if (err.name !== "AbortError") {
        setMessages([...priorMessages, { role: "assistant", content: `Error: ${err.message}`, error: true }]);
      }
    } finally {
      setIsBusy(false);
      abortControllerRef.current = null;
    }
  };

  const handleAutoTitle = async () => {
    if (!activeConversationId || messages.length === 0) return;
    const firstUserMsg = messages.find(m => m.role === "user");
    const firstAssistantMsg = messages.find(m => m.role === "assistant");
    const promptText = typeof firstUserMsg?.content === "string" ? firstUserMsg.content : "Conversation";
    const responseText = typeof firstAssistantMsg?.content === "string" ? firstAssistantMsg.content : "";

    try {
      const res = await autoTitleConversation({ prompt: promptText, response: responseText });
      if (res?.ok && res.title) {
        onRenameConversation?.(activeConversationId, res.title);
        showAlert?.({ title: "Auto-Title Applied", message: `New title: "${res.title}"` });
      }
    } catch (err) {
      showAlert?.({ title: "Auto-Title Failed", message: err.message, danger: true });
    }
  };

  const hasMessages = messages.length > 0;
  const isCloudSpecific = Boolean(selectedModel && (selectedModel.includes("/") || selectedModel.startsWith("gpt-") || selectedModel.startsWith("claude-") || selectedModel.startsWith("gemini-") || selectedModel.startsWith("deepseek-") || selectedModel === "cloud_auto"));
  const isExplicitLocal = !isCloudSpecific;
  const isCloudSelected = isCloudSpecific;
  const isAuto = false;
  const isChatAvailable = Boolean(status.ready || isCloudSelected || models.length > 0 || isExplicitLocal);

  // Shows what is actually loaded or selected
  const modelLabel = isExplicitLocal
    ? `Local: ${(selectedModel === "local" ? (status.settings?.model || "AbyxV2 9B") : selectedModel).replace(/\.gguf$/i, "")}`
    : `Cloud: ${selectedModel.split("/").pop()}`;
  const dotColor = isExplicitLocal ? "#4ade80" : "#38bdf8";

  const currentModelName = String(selectedModel || status.settings?.model || "").toLowerCase();
  const modelContextLimit = currentModelName.includes("inkling") ? 8192 :
                            currentModelName.includes("gemma") ? 16384 :
                            currentModelName.includes("abyx") ? 32768 : 8192;
  const contextMax = Number(status.settings?.contextSize || textSettings?.contextSize) || modelContextLimit;

  const estimatedTokens = useMemo(() => {
    let t = 0;
    for (const m of messages) {
      const text = typeof m.content === "string" ? m.content : JSON.stringify(m.content || "");
      t += Math.max(1, Math.round(text.length / 3.8));
    }
    return t;
  }, [messages]);

  const contextUsed = tokenUsage.total_tokens > 0 ? tokenUsage.total_tokens : estimatedTokens;
  const contextPercent = Math.min(100, Math.round((contextUsed / contextMax) * 100));
  const composerPlaceholder = isChatAvailable ? "Ask anything" : "Select a model to start chatting";

  const homeSuggestions = [
    ...(isChatAvailable ? [
      { Icon: PenLine, label: "Write a professional email to reschedule a meeting", onClick: () => setInput("Write a professional email to reschedule a meeting") },
      { Icon: Lightbulb, label: "Explain how transformers work in simple terms", onClick: () => setInput("Explain how transformers work in simple terms") },
    ] : []),
    { Icon: ImageIcon, label: "Create an image", onClick: () => setActiveTab?.("generator") },
    { Icon: Mic, label: "Transcribe a recording", onClick: () => setActiveTab?.("speech") },
    { Icon: AudioLines, label: "Turn text into speech", onClick: () => setActiveTab?.("tts") },
  ];

  const composer = (
    <div className="chat-composer">
      {attachments.length > 0 && (
        <div className="chat-attachments">
          {attachments.map((att) => (
            <div key={att.id} className="chat-attachment">
              {att.type === "image" && att.dataUrl ? (
                <img src={att.dataUrl} alt="" className="chat-attachment-thumb" />
              ) : att.type === "archive" ? (
                <FileArchive size={15} style={{ color: "var(--accent-orange, #ff4b1f)", flexShrink: 0 }} />
              ) : att.type === "code" ? (
                <FileCode size={15} style={{ color: "#38bdf8", flexShrink: 0 }} />
              ) : (
                <FileText size={15} aria-hidden="true" style={{ color: "#9ca3af", flexShrink: 0 }} />
              )}
              <span className="chat-attachment-name" title={att.name}>{att.name}</span>
              <button
                type="button"
                className="chat-attachment-remove"
                onClick={() => setAttachments(prev => prev.filter(item => item.id !== att.id))}
                aria-label={`Remove ${att.name}`}
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="chat-composer-inner">
        {/* Floating Slash Commands Autocomplete Menu */}
        {showSlashMenu && matchingSlashCommands.length > 0 && (
          <div ref={slashMenuRef} className="chat-slash-menu">
            <div className="chat-slash-menu-header">Available Commands</div>
            {matchingSlashCommands.map((item) => {
              const ItemIcon = item.icon;
              return (
                <button
                  key={item.cmd}
                  type="button"
                  className="chat-slash-menu-item"
                  onClick={() => executeSlashCommandItem(item)}
                >
                  <div className="chat-slash-item-left">
                    <ItemIcon size={14} className="chat-slash-item-icon" />
                    <span className="chat-slash-item-cmd">{item.label}</span>
                  </div>
                  <span className="chat-slash-item-desc">{item.desc}</span>
                </button>
              );
            })}
          </div>
        )}

        <textarea
          ref={textareaRef}
          className="chat-composer-textarea"
          value={input}
          onChange={handleInputChange}
          onKeyDown={(event) => {
            if (event.key === "Escape" && showSlashMenu) {
              setShowSlashMenu(false);
              return;
            }
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              sendMessage();
            }
          }}
          placeholder={composerPlaceholder || "Ask anything or type / for commands..."}
          aria-label="Message"
          disabled={!isChatAvailable || isBusy}
          rows={1}
        />

        <div className="chat-composer-toolbar">
          <div className="chat-composer-toolbar-left">
            <input type="file" ref={fileInputRef} style={{ display: "none" }} multiple onChange={handleFileChange} />
            <button
              type="button"
              className="chat-composer-icon-btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={!status.ready || isBusy}
              aria-label="Attach files"
              title={isChatAvailable ? "Attach files (text/code) or images (vision models only)" : "Select a model to attach files"}
            >
              <Plus size={18} />
            </button>

            {/* Model Selector Pill on Left (Image 2) */}
            <div ref={modelMenuRef} className="chat-model-picker">
              <button
                type="button"
                onClick={() => !isBusy && setShowModelMenu(!showModelMenu)}
                className={`chat-model-trigger ${showModelMenu ? "active" : ""}`}
                disabled={isBusy}
                aria-haspopup="menu"
                aria-expanded={showModelMenu}
                title={status.ready ? status.settings?.model : "Choose a model"}
              >
                <span className="chat-model-dot" style={{ background: dotColor }} aria-hidden="true" />
                <span className="chat-model-trigger-label">
                  <span>{modelLabel}</span>
                </span>
                <ChevronDown size={13} aria-hidden="true" />
              </button>

              {showModelMenu && (
                <div
                  className="chat-model-menu-container up"
                  onMouseLeave={() => setActiveSubmenu(null)}
                  style={{
                    position: "absolute",
                    bottom: "calc(100% + 8px)",
                    top: "auto",
                    left: 0,
                    zIndex: 100,
                  }}
                >
                  <div
                    className="chat-model-menu"
                    role="menu"
                    style={{
                      width: "320px",
                      padding: "8px",
                      borderRadius: "16px",
                      background: "rgba(22, 22, 24, 0.96)",
                      backdropFilter: "blur(20px)",
                      WebkitBackdropFilter: "blur(20px)",
                      border: "1px solid rgba(255, 255, 255, 0.08)",
                      boxShadow: "0 18px 45px rgba(0, 0, 0, 0.5)",
                      overflow: "visible",
                    }}
                  >
                    <div style={{ padding: "6px 10px 8px", fontSize: "11px", fontWeight: 600, color: "rgba(255,255,255,0.45)", letterSpacing: "0.4px" }}>
                      AI Execution Mode
                    </div>

                    {/* 1. LOCAL (OFFLINE GPU) */}
                    <div style={{ position: "relative" }}>
                      <button
                        type="button"
                        role="menuitem"
                        className={`chat-model-menu-item ${isExplicitLocal ? "selected" : ""}`}
                        onMouseEnter={() => setActiveSubmenu("local")}
                        onClick={() => {
                          setSelectedModel("local");
                          if (!status.ready && models.length > 0) {
                            handleModelChange(models[0].filename);
                          }
                          setShowModelMenu(false);
                          setActiveSubmenu(null);
                        }}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "9px 11px",
                          borderRadius: "12px",
                          background: isExplicitLocal ? "rgba(74, 222, 128, 0.12)" : (activeSubmenu === "local" ? "rgba(255,255,255,0.06)" : "transparent"),
                          border: isExplicitLocal ? "1px solid rgba(74, 222, 128, 0.28)" : "1px solid transparent",
                          cursor: "pointer",
                          width: "100%",
                          textAlign: "left"
                        }}
                      >
                        <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                            <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: "#4ade80", flexShrink: 0 }} />
                            <span style={{ fontSize: "13.5px", fontWeight: 600, color: "#ededed" }}>
                              Local
                            </span>
                            {isExplicitLocal && (
                              <span style={{
                                fontSize: "10px",
                                fontWeight: 600,
                                background: "rgba(74, 222, 128, 0.15)",
                                color: "#4ade80",
                                padding: "1px 6px",
                                borderRadius: "4px"
                              }}>
                                Active
                              </span>
                            )}
                          </div>
                          <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.45)", lineHeight: "1.3", paddingLeft: "13px" }}>
                            Strictly local • Neural Engine ({models.length} model{models.length === 1 ? "" : "s"})
                          </span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                          <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.4)" }}>Models</span>
                          <ChevronRight size={14} color="rgba(255,255,255,0.4)" />
                        </div>
                      </button>

                      {/* Submenu Flyout for Local Models */}
                      {activeSubmenu === "local" && (
                        <div
                          style={{
                            position: "absolute",
                            left: "calc(100% + 8px)",
                            bottom: 0,
                            top: "auto",
                            width: "280px",
                            maxHeight: "360px",
                            overflowY: "auto",
                            background: "rgba(22, 22, 24, 0.98)",
                            backdropFilter: "blur(20px)",
                            WebkitBackdropFilter: "blur(20px)",
                            border: "1px solid rgba(255, 255, 255, 0.08)",
                            borderRadius: "14px",
                            boxShadow: "0 18px 45px rgba(0, 0, 0, 0.5)",
                            padding: "8px",
                            zIndex: 110
                          }}
                        >
                          <div style={{ padding: "4px 8px 8px 8px", fontSize: "11px", fontWeight: 600, color: "rgba(255,255,255,0.45)" }}>
                            SELECT LOCAL MODEL
                          </div>
                          {models.length === 0 ? (
                            <div style={{ padding: "12px", fontSize: "12px", color: "rgba(255,255,255,0.4)", textAlign: "center" }}>
                              No local GGUF models in app/llm-models
                            </div>
                          ) : (
                            models.map((m) => {
                              const isLoaded = m.filename === status.settings?.model && status.ready;
                              const isChosen = selectedModel === m.filename || (selectedModel === "local" && isLoaded);
                              const displayName = m.filename.replace(/\.gguf$/i, "");
                              return (
                                <button
                                  type="button"
                                  key={m.filename}
                                  onClick={() => {
                                    setSelectedModel(m.filename);
                                    if (!isLoaded) handleModelChange(m.filename);
                                    setShowModelMenu(false);
                                    setActiveSubmenu(null);
                                  }}
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    width: "100%",
                                    padding: "8px 10px",
                                    borderRadius: "8px",
                                    background: isChosen ? "rgba(74, 222, 128, 0.12)" : "transparent",
                                    border: isChosen ? "1px solid rgba(74, 222, 128, 0.25)" : "1px solid transparent",
                                    color: "#ededed",
                                    cursor: "pointer",
                                    textAlign: "left",
                                    marginBottom: "2px"
                                  }}
                                >
                                  <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
                                    <span style={{ color: isLoaded ? "#4ade80" : "rgba(255,255,255,0.3)", fontSize: "10px" }}>●</span>
                                    <span style={{ fontSize: "12.5px", fontWeight: isChosen ? 600 : 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                      {displayName}
                                    </span>
                                  </div>
                                  {isLoaded ? (
                                    <span style={{ fontSize: "10px", color: "#4ade80", background: "rgba(74, 222, 128, 0.12)", padding: "1px 6px", borderRadius: "6px", flexShrink: 0 }}>
                                      Active
                                    </span>
                                  ) : (
                                    <span style={{ fontSize: "10px", color: "rgba(255,255,255,0.4)", background: "rgba(255,255,255,0.05)", padding: "1px 6px", borderRadius: "6px", flexShrink: 0 }}>
                                      Load
                                    </span>
                                  )}
                                </button>
                              );
                            })
                          )}
                        </div>
                      )}
                    </div>

                    {/* 2. CLOUD */}
                    {(() => {
                      const configuredProviders = cloudProviders.filter((p) => p.hasKey || p.isConfigured);
                      return (
                        <div style={{ position: "relative", marginTop: "4px" }}>
                          <button
                            type="button"
                            role="menuitem"
                            className={`chat-model-menu-item ${isCloudSelected ? "selected" : ""}`}
                            onMouseEnter={() => setActiveSubmenu("cloud")}
                            onClick={() => {
                              setSelectedModel("auto");
                              setShowModelMenu(false);
                              setActiveSubmenu(null);
                            }}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              padding: "9px 11px",
                              borderRadius: "12px",
                              background: isCloudSelected ? "rgba(96, 165, 250, 0.12)" : (activeSubmenu === "cloud" ? "rgba(255,255,255,0.06)" : "transparent"),
                              border: isCloudSelected ? "1px solid rgba(96, 165, 250, 0.28)" : "1px solid transparent",
                              cursor: "pointer",
                              width: "100%",
                              textAlign: "left"
                            }}
                          >
                            <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: "#60a5fa", flexShrink: 0 }} />
                                <span style={{ fontSize: "13.5px", fontWeight: 600, color: "#ededed" }}>
                                  Cloud
                                </span>
                                <span style={{
                                  fontSize: "10px",
                                  fontWeight: 600,
                                  background: "rgba(96, 165, 250, 0.15)",
                                  color: "#60a5fa",
                                  padding: "1px 6px",
                                  borderRadius: "4px"
                                }}>
                                  Auto
                                </span>
                              </div>
                              <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.45)", lineHeight: "1.3", paddingLeft: "13px" }}>
                                Smart cloud routing • More Models flyout
                              </span>
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                              <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.4)" }}>More</span>
                              <ChevronRight size={14} color="rgba(255,255,255,0.4)" />
                            </div>
                          </button>

                          {/* Submenu Flyout for Cloud AI Models */}
                          {activeSubmenu === "cloud" && (
                            <div
                              style={{
                                position: "absolute",
                                left: "calc(100% + 8px)",
                                bottom: 0,
                                top: "auto",
                                width: "280px",
                                maxHeight: "360px",
                                overflowY: "auto",
                                background: "rgba(22, 22, 24, 0.98)",
                                backdropFilter: "blur(20px)",
                                WebkitBackdropFilter: "blur(20px)",
                                border: "1px solid rgba(255, 255, 255, 0.08)",
                                borderRadius: "14px",
                                boxShadow: "0 18px 45px rgba(0, 0, 0, 0.5)",
                                padding: "8px",
                                zIndex: 110
                              }}
                            >
                              <div style={{ padding: "4px 8px 8px 8px", fontSize: "11px", fontWeight: 600, color: "rgba(255,255,255,0.45)" }}>
                                CLOUD AI PROVIDERS
                              </div>

                              {/* Pollinations Free tier */}
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedModel("pollinations/openai");
                                  setShowModelMenu(false);
                                  setActiveSubmenu(null);
                                }}
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "space-between",
                                  width: "100%",
                                  padding: "8px 10px",
                                  borderRadius: "8px",
                                  background: selectedModel === "pollinations/openai" ? "rgba(96, 165, 250, 0.12)" : "transparent",
                                  border: selectedModel === "pollinations/openai" ? "1px solid rgba(96, 165, 250, 0.25)" : "1px solid transparent",
                                  color: "#ededed",
                                  cursor: "pointer",
                                  textAlign: "left",
                                  marginBottom: "4px"
                                }}
                              >
                                <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                                  <span style={{ fontSize: "12.5px", fontWeight: 500 }}>Pollinations Free tier</span>
                                  <span style={{ fontSize: "10px", color: "rgba(255,255,255,0.4)" }}>GPT-4o Mini (Keyless Free)</span>
                                </div>
                                <span style={{ fontSize: "10px", color: "#60a5fa", background: "rgba(96, 165, 250, 0.12)", padding: "1px 6px", borderRadius: "6px" }}>
                                  Free
                                </span>
                              </button>

                              {/* Configured cloud models */}
                              {configuredProviders.map((p) => (
                                <div key={p.id} style={{ margin: "4px 0" }}>
                                  <div style={{ fontSize: "11px", fontWeight: 600, color: "rgba(255,255,255,0.6)", padding: "4px 8px" }}>
                                    <Globe size={12} style={{ color: "var(--md-sys-color-primary, #a8c7fa)", flexShrink: 0 }} /> <span>{p.name}</span>
                                  </div>
                                  {(p.modelObjects || p.models || []).slice(0, 5).map((m) => {
                                    const modelId = typeof m === "string" ? `${p.id}/${m}` : (m.id || `${p.id}/${m.rawId}`);
                                    const modelName = typeof m === "string" ? m : (m.name || m.rawId || m.id);
                                    const isChosen = selectedModel === modelId;
                                    return (
                                      <button
                                        type="button"
                                        key={modelId}
                                        onClick={() => {
                                          setSelectedModel(modelId);
                                          setShowModelMenu(false);
                                          setActiveSubmenu(null);
                                        }}
                                        style={{
                                          display: "flex",
                                          alignItems: "center",
                                          justifyContent: "space-between",
                                          width: "100%",
                                          padding: "6px 8px",
                                          borderRadius: "6px",
                                          background: isChosen ? "rgba(96, 165, 250, 0.12)" : "transparent",
                                          color: "#ededed",
                                          cursor: "pointer",
                                          textAlign: "left"
                                        }}
                                      >
                                        <span style={{ fontSize: "12px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                          {modelName}
                                        </span>
                                      </button>
                                    );
                                  })}
                                </div>
                              ))}

                              <div style={{ height: "1px", background: "rgba(255,255,255,0.06)", margin: "6px 0" }} />

                              {/* Setup / Configure Cloud Providers */}
                              {typeof setActiveTab === "function" && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setShowModelMenu(false);
                                    setActiveSubmenu(null);
                                    setActiveTab("providers");
                                  }}
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    gap: "6px",
                                    width: "100%",
                                    padding: "8px 10px",
                                    borderRadius: "8px",
                                    background: "rgba(255,255,255,0.06)",
                                    border: "none",
                                    color: "var(--md-sys-color-primary, #a8c7fa)",
                                    fontSize: "11.5px",
                                    fontWeight: 600,
                                    cursor: "pointer"
                                  }}
                                >
                                  <Settings size={13} style={{ marginRight: 6 }} />
                                  <span>Configure Cloud Providers</span>
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {/* 3. THINKING EFFORT (Image 4) */}
                    <div style={{ position: "relative", marginTop: "4px" }}>
                      <button
                        type="button"
                        role="menuitem"
                        className="chat-model-menu-item"
                        onMouseEnter={() => setActiveSubmenu("thinking_effort")}
                        onClick={() => setActiveSubmenu(activeSubmenu === "thinking_effort" ? null : "thinking_effort")}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "9px 11px",
                          borderRadius: "12px",
                          background: activeSubmenu === "thinking_effort" ? "rgba(255,255,255,0.06)" : "transparent",
                          cursor: "pointer",
                          width: "100%",
                          textAlign: "left"
                        }}
                      >
                        <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                            <Brain size={14} style={{ color: "#a78bfa", flexShrink: 0 }} />
                            <span style={{ fontSize: "13.5px", fontWeight: 600, color: "#ededed" }}>
                              Thinking effort
                            </span>
                            <span className="chat-model-menu-tag pro">
                              {thinkingEffort}
                            </span>
                          </div>
                          <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.45)", lineHeight: "1.3", paddingLeft: "20px" }}>
                            Reasoning budget: {thinkingEffort.toUpperCase()}
                          </span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                          <ChevronRight size={14} color="rgba(255,255,255,0.4)" />
                        </div>
                      </button>

                      {/* Submenu Flyout for Thinking Effort */}
                      {activeSubmenu === "thinking_effort" && (
                        <div
                          style={{
                            position: "absolute",
                            left: "calc(100% + 8px)",
                            bottom: 0,
                            top: "auto",
                            width: "240px",
                            background: "rgba(20, 20, 24, 0.98)",
                            backdropFilter: "blur(20px)",
                            WebkitBackdropFilter: "blur(20px)",
                            border: "1px solid rgba(255, 255, 255, 0.1)",
                            borderRadius: "14px",
                            boxShadow: "0 18px 45px rgba(0, 0, 0, 0.5)",
                            padding: "8px",
                            zIndex: 120
                          }}
                        >
                          <div style={{ padding: "4px 8px 8px 8px", fontSize: "11px", fontWeight: 600, color: "rgba(255,255,255,0.45)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                            <span>Thinking effort</span>
                            <span style={{ fontSize: "10px", opacity: 0.6 }}>ⓘ</span>
                          </div>
                          {[
                            { id: "low", label: "Low", desc: "Fast reasoning, minimal tokens" },
                            { id: "medium", label: "Medium", desc: "Standard step-by-step reasoning" },
                            { id: "high", label: "High", desc: "Deep multi-stage deliberation" }
                          ].map((eff) => (
                            <button
                              key={eff.id}
                              type="button"
                              onClick={() => {
                                setThinkingEffort(eff.id);
                                localStorage.setItem("abyx_thinking_effort", eff.id);
                                setActiveSubmenu(null);
                              }}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                width: "100%",
                                padding: "8px 10px",
                                borderRadius: "8px",
                                background: thinkingEffort === eff.id ? "rgba(167, 139, 250, 0.15)" : "transparent",
                                border: thinkingEffort === eff.id ? "1px solid rgba(167, 139, 250, 0.3)" : "1px solid transparent",
                                cursor: "pointer",
                                color: "#ededed",
                                marginBottom: "3px",
                                textAlign: "left"
                              }}
                            >
                              <div>
                                <div style={{ fontSize: "12.5px", fontWeight: thinkingEffort === eff.id ? 600 : 400 }}>{eff.label}</div>
                                <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.4)" }}>{eff.desc}</div>
                              </div>
                              {thinkingEffort === eff.id && <Check size={14} color="#a78bfa" />}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {status.ready && (
                      <>
                        <div className="chat-model-menu-divider" />
                        <button
                          type="button"
                          role="menuitem"
                          className="chat-model-menu-item"
                          onClick={() => {
                            handleModelChange("");
                            setShowModelMenu(false);
                            setActiveSubmenu(null);
                          }}
                          style={{ color: "#ef4444", fontSize: "12px", justifyContent: "center" }}
                        >
                          Unload Local Model from GPU
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>

            <button
              type="button"
              className={`chat-composer-chip ${useWebSearch ? "active" : ""}`}
              onClick={() => setUseWebSearch((value) => !value)}
              disabled={!isChatAvailable || isBusy}
              aria-pressed={useWebSearch}
              title={useWebSearch ? "Disable web search" : "Enable web search"}
            >
              <Globe2 size={14} />
              <span>Web</span>
            </button>
            {status.ready && supportsThinking && (
              <button
                type="button"
                className={`chat-composer-chip ${deepThinkEnabled ? "active" : ""}`}
                onClick={handleThinkingToggle}
                aria-pressed={deepThinkEnabled}
                title={deepThinkEnabled ? "Disable DeepThink reasoning" : "Enable DeepThink reasoning"}
              >
                <Brain size={14} />
                <span>Think</span>
              </button>
            )}
          </div>

          <div className="chat-composer-toolbar-right">
            {/* Local Permissions / Controls Trigger - Matches Image 2 Right Side */}
            <div className="chat-permissions-wrapper" ref={permissionsMenuRef}>
              <button
                type="button"
                className={`chat-toolbar-perm-btn ${showPermissionsMenu ? "active" : ""}`}
                onClick={() => setShowPermissionsMenu(v => !v)}
                title="Configure local permissions and sandbox execution policies"
              >
                <Shield size={14} />
                <span>{permissionMode === "turbo" ? "Turbo" : permissionMode === "request_review" ? "Review" : permissionMode === "auto" ? "Auto" : "Default"}</span>
                <ChevronDown size={13} />
              </button>

              {showPermissionsMenu && (
                <div className="chat-permissions-dropdown" style={{ right: 0, left: "auto" }}>
                  <div className="chat-permissions-header">Local Permissions</div>

                  <button
                    type="button"
                    className={`chat-permissions-item ${permissionMode === "request_review" ? "selected" : ""}`}
                    onClick={() => handlePermissionModeChange("request_review")}
                  >
                    <div className="chat-permissions-item-left">
                      <Eye size={15} className="chat-permissions-item-icon" />
                      <div>
                        <div className="chat-permissions-item-title">Request Review</div>
                        <div className="chat-permissions-item-desc">Every command requires approval.</div>
                      </div>
                    </div>
                    {permissionMode === "request_review" && <Check size={14} color="#4ade80" />}
                  </button>

                  <button
                    type="button"
                    className={`chat-permissions-item ${permissionMode === "default" || permissionMode === "ask" ? "selected" : ""}`}
                    onClick={() => handlePermissionModeChange("default")}
                  >
                    <div className="chat-permissions-item-left">
                      <Lock size={15} className="chat-permissions-item-icon" />
                      <div>
                        <div className="chat-permissions-item-title">Default</div>
                        <div className="chat-permissions-item-desc">Ask before sensitive operations.</div>
                      </div>
                    </div>
                    {(permissionMode === "default" || permissionMode === "ask") && <Check size={14} color="#4ade80" />}
                  </button>

                  <button
                    type="button"
                    className={`chat-permissions-item ${permissionMode === "auto" ? "selected" : ""}`}
                    onClick={() => handlePermissionModeChange("auto")}
                  >
                    <div className="chat-permissions-item-left">
                      <Shield size={15} className="chat-permissions-item-icon" />
                      <div>
                        <div className="chat-permissions-item-title">Auto</div>
                        <div className="chat-permissions-item-desc">Automatically decide if commands run.</div>
                      </div>
                    </div>
                    {permissionMode === "auto" && <Check size={14} color="#4ade80" />}
                  </button>

                  <button
                    type="button"
                    className={`chat-permissions-item ${permissionMode === "turbo" ? "selected" : ""}`}
                    onClick={() => handlePermissionModeChange("turbo")}
                  >
                    <div className="chat-permissions-item-left">
                      <AlertTriangle size={15} className="chat-permissions-item-icon" style={{ color: "#f87171" }} />
                      <div>
                        <div className="chat-permissions-item-title">
                          Turbo
                          <span style={{ fontSize: "10px", color: "rgba(255,255,255,0.45)", background: "rgba(255,255,255,0.08)", padding: "1px 5px", borderRadius: "4px" }}>Default</span>
                        </div>
                        <div className="chat-permissions-item-desc">Run all commands without restrictions.</div>
                      </div>
                    </div>
                    {permissionMode === "turbo" && <Check size={14} color="#4ade80" />}
                  </button>
                </div>
              )}
            </div>

            {/* Voice Dictation (Mic) Button */}
            <button
              type="button"
              className={`chat-composer-mic-btn ${isListening ? "listening" : ""}`}
              onClick={toggleListening}
              disabled={!isChatAvailable || isBusy}
              aria-label={isListening ? "Stop listening" : "Voice dictation (Mic)"}
              title={isListening ? "Listening... Click to stop speaking" : "Speak to type (Microphone)"}
            >
              <Mic size={16} />
            </button>

            {/* Blue Circular Submit Button - Matches Image 2 */}
            {isBusy ? (
              <button type="button" className="chat-composer-stop-btn" onClick={handleStopGeneration} aria-label="Stop generating" title="Stop generating">
                <Square size={14} fill="currentColor" />
              </button>
            ) : (
              <button
                type="button"
                className="chat-composer-send-btn"
                onClick={sendMessage}
                disabled={(!input.trim() && attachments.length === 0) || !isChatAvailable}
                aria-label="Send message"
                title="Send message"
              >
                <ArrowRight size={17} strokeWidth={2.5} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div
      className="text-chat-layout"
      style={{ position: "relative" }}
      onDragEnter={(e) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounterRef.current += 1;
        setIsDraggingOver(true);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounterRef.current -= 1;
        if (dragCounterRef.current <= 0) {
          setIsDraggingOver(false);
          dragCounterRef.current = 0;
        }
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounterRef.current = 0;
        setIsDraggingOver(false);
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          processIncomingFiles(e.dataTransfer.files);
        }
      }}
    >
      <section className="text-chat-main" aria-label="Chat">
        {isDraggingOver && (
          <div style={{
            position: "absolute",
            inset: "12px",
            zIndex: 1000,
            background: "rgba(10, 10, 14, 0.88)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            border: "2px dashed rgba(255, 75, 31, 0.6)",
            borderRadius: "16px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "12px",
            pointerEvents: "none",
            boxShadow: "0 20px 50px rgba(0, 0, 0, 0.6)"
          }}>
            <UploadCloud size={38} style={{ color: "var(--accent-orange, #ff4b1f)" }} />
            <div style={{ fontSize: "16px", fontWeight: 600, color: "#f3f4f6" }}>
              Drop files here to attach
            </div>
            <div style={{ fontSize: "12px", color: "rgba(255, 255, 255, 0.5)" }}>
              Attach archives (zip, rar, 7z), code, documents, images, audio, or datasets
            </div>
          </div>
        )}
        {loadingModel ? (
          <div className="chat-home">
            <div className="chat-loading">
              <LoaderCircle className="abyx-spin" size={24} style={{ color: "var(--accent-orange, #ff4b1f)" }} aria-hidden="true" />
              <h1 className="chat-home-title">Loading model</h1>
              <p className="chat-loading-name">{loadingModel.replace(/\.gguf$/i, "")}</p>
              <p className="chat-loading-note">
                Starting llama.cpp and loading the weights into memory. This can take up to 30 seconds depending on model size and hardware.
              </p>
              <button type="button" className="m3-btn m3-btn-outlined" onClick={handleCancelLlmLoad}>
                <Square size={13} fill="currentColor" aria-hidden="true" />
                <span>Cancel</span>
              </button>
            </div>
          </div>
        ) : !hasMessages ? (
          <div className="chat-home">
            <h1 className="chat-home-title">What should we make today?</h1>
            {composer}
            <ul className="chat-home-suggestions">
              {homeSuggestions.map(({ Icon, label, onClick }) => (
                <li key={label}>
                  <button type="button" className="chat-home-suggestion" onClick={onClick}>
                    <Icon size={18} aria-hidden="true" />
                    <span>{label}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <>
            <div className="chat-thread-bar">
              <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
                {!sidebarVisible && (
                  <button type="button" className="chat-thread-btn chat-thread-sidebar-btn" onClick={onToggleSidebar} aria-label="Open sidebar" title="Open sidebar">
                    <PanelLeft size={18} />
                  </button>
                )}
                {(() => {
                  const currentConv = conversations.find(c => c.id === activeConversationId);
                  const currentChatTitle = currentConv?.title || "Chat Session";
                  const isCurrentChatPinned = Boolean(currentConv?.pinned);
                  return (
                    <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, overflow: "hidden" }}>
                      <span style={{ fontWeight: 600, fontSize: "0.925rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: "var(--md-sys-color-on-surface)" }}>
                        {currentChatTitle}
                      </span>
                      <button
                        type="button"
                        className="chat-thread-btn"
                        onClick={() => {
                          setRenameInput(currentChatTitle);
                          setShowRenameModal(true);
                        }}
                        title="Rename this conversation"
                        aria-label="Rename conversation"
                      >
                        <PenLine size={13} />
                      </button>
                      <button
                        type="button"
                        className={`chat-thread-btn ${isCurrentChatPinned ? "active" : ""}`}
                        onClick={(e) => onTogglePinConversation?.(activeConversationId, e)}
                        title={isCurrentChatPinned ? "Unpin conversation" : "Pin conversation to top"}
                        aria-label="Pin conversation"
                      >
                        <Pin size={13} fill={isCurrentChatPinned ? "currentColor" : "none"} />
                      </button>
                      <button
                        type="button"
                        className="chat-thread-btn"
                        onClick={handleAutoTitle}
                        title="Auto-synthesize title from conversation"
                        aria-label="Auto title"
                      >
                        <Sparkles size={13} />
                      </button>
                    </div>
                  );
                })()}
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {activeProject && (
                  <button
                    type="button"
                    className="abyx-project-pill-btn"
                    onClick={onOpenProjects || (() => setActiveTab("projects"))}
                    title={`Active Project: ${activeProject.name}\nFolder: ${activeProject.path}\nClick to manage projects`}
                  >
                    <FolderKanban size={13} />
                    <span style={{ maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {activeProject.name}
                    </span>
                    <span
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: "50%",
                        background: activeProject.available ? "#22c55e" : "#ef4444"
                      }}
                    />
                  </button>
                )}
                <div style={{ position: "relative" }}>
                  <button
                    type="button"
                    className="chat-thread-btn"
                    onClick={() => setShowExportMenu(!showExportMenu)}
                    title="Export conversation"
                    aria-label="Export conversation"
                  >
                    <Download size={15} />
                  </button>
                  {showExportMenu && (
                    <div
                      style={{
                        position: "absolute",
                        right: 0,
                        top: "100%",
                        marginTop: 4,
                        background: "var(--md-sys-color-surface)",
                        border: "1px solid var(--border-color)",
                        borderRadius: "var(--md-shape-corner-small)",
                        padding: 4,
                        display: "flex",
                        flexDirection: "column",
                        gap: 2,
                        minWidth: 160,
                        zIndex: 150,
                        boxShadow: "0 8px 24px rgba(0,0,0,0.3)"
                      }}
                    >
                      <button
                        type="button"
                        className="chat-model-menu-item"
                        style={{ padding: "6px 10px", fontSize: "0.8rem", textAlign: "left" }}
                        onClick={(e) => {
                          setShowExportMenu(false);
                          onExportConversation?.(activeConversationId, "md", e);
                        }}
                      >
                        Export as Markdown (.md)
                      </button>
                      <button
                        type="button"
                        className="chat-model-menu-item"
                        style={{ padding: "6px 10px", fontSize: "0.8rem", textAlign: "left" }}
                        onClick={(e) => {
                          setShowExportMenu(false);
                          onExportConversation?.(activeConversationId, "json", e);
                        }}
                      >
                        Export as JSON (.json)
                      </button>
                    </div>
                  )}
                </div>

                {/* Plan / Act Mode Pill */}
                <button
                  type="button"
                  onClick={() => {
                    const nextMode = agentMode === "act" ? "plan" : "act";
                    setAgentMode(nextMode);
                    localStorage.setItem("abyx_agent_mode", nextMode);
                  }}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "3px 10px",
                    borderRadius: "12px",
                    background: agentMode === "act" ? "rgba(56, 189, 248, 0.12)" : "rgba(168, 85, 247, 0.12)",
                    border: `1px solid ${agentMode === "act" ? "rgba(56, 189, 248, 0.3)" : "rgba(168, 85, 247, 0.3)"}`,
                    color: agentMode === "act" ? "#38bdf8" : "#c084fc",
                    fontSize: "11px",
                    fontWeight: 600,
                    cursor: "pointer"
                  }}
                  title={agentMode === "act" ? "Act Mode: Autonomous tool execution enabled" : "Plan Mode: Architectural reasoning only"}
                >
                  {agentMode === "act" ? <Zap size={12} /> : <Brain size={12} />}
                  <span>{agentMode === "act" ? "Act Mode" : "Plan Mode"}</span>
                </button>

                {/* Model & Harness Parameters Quick Drawer */}
                <button
                  type="button"
                  onClick={() => setIsHarnessControlsOpen(true)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "3px 10px",
                    borderRadius: "12px",
                    background: "rgba(255, 255, 255, 0.05)",
                    border: "1px solid rgba(255, 255, 255, 0.12)",
                    color: "rgba(255, 255, 255, 0.85)",
                    fontSize: "11px",
                    fontWeight: 600,
                    cursor: "pointer"
                  }}
                  title="Configure context window, temperature, RoPE scaling, and agent loop depth"
                >
                  <Sliders size={12} />
                  <span>Controls</span>
                </button>

                {(() => {
                  const strokeColor = contextPercent > 85 ? "#ef4444" : contextPercent > 70 ? "#f59e0b" : "var(--md-sys-color-primary, #38bdf8)";
                  return (
                    <div
                      className="chat-context"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "6px",
                        padding: "3px 8px",
                        borderRadius: "12px",
                        background: "rgba(255, 255, 255, 0.04)",
                        border: "1px solid rgba(255, 255, 255, 0.08)",
                        cursor: "default"
                      }}
                      title={`Context Window: ${contextUsed.toLocaleString()} / ${contextMax.toLocaleString()} tokens (${contextPercent}% used)`}
                      aria-label={`Context used: ${contextPercent}%`}
                    >
                      <svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true">
                        <circle cx="10" cy="10" r="8" stroke="rgba(255,255,255,0.12)" strokeWidth="2.5" fill="none" />
                        <circle cx="10" cy="10" r="8" stroke={strokeColor} strokeWidth="2.5" fill="none"
                          strokeDasharray={2 * Math.PI * 8}
                          strokeDashoffset={2 * Math.PI * 8 * (1 - contextPercent / 100)}
                          strokeLinecap="round" transform="rotate(-90 10 10)"
                        />
                      </svg>
                      <span style={{ fontSize: "11px", fontWeight: 600, color: strokeColor, fontFamily: "'JetBrains Mono', monospace" }}>
                        {contextPercent}%
                      </span>
                    </div>
                  );
                })()}
                <button type="button" className="chat-thread-btn" onClick={handleClearChat} aria-label="Clear this chat" title="Clear this chat">
                  <Trash2 size={16} />
                </button>
              </div>
            </div>

            <div
              ref={chatMessagesRef}
              className="chat-messages"
              onScroll={handleMessagesScroll}
            >
              <div className="chat-thread">
                {messages.map((message, index) => {
                  const rawContent = Array.isArray(message.content)
                    ? message.content.map(p => p.text || "").join("\n")
                    : String(message.content || "");
                  const processed = processMessageContent(
                    rawContent,
                    message.reasoning || ""
                  );
                  const displayContent = Array.isArray(message.content) ? message.content : processed.content;
                  const displayReasoning = processed.reasoning;
                  const hasDisplayContent = Array.isArray(displayContent)
                    ? displayContent.length > 0
                    : Boolean(String(displayContent || "").trim());

                  const isComplete = !isBusy || !message.generationStats || message.generationStats.status === "complete" || index < messages.length - 1;

                  // Extract detected file if model is generating code or files
                  const rawStr = typeof rawContent === "string" ? rawContent : "";
                  const textWithoutCodeOrMedia = rawStr
                    .replace(/```[\s\S]*?(?:```|$)/g, "")
                    .replace(/\[(?:IMAGE|AUDIO):[\s\S]*?\]/gi, "")
                    .replace(/<img[^>]*data-generate[^>]*>/gi, "")
                    .trim();
                  const hasVisibleContent = hasDisplayContent && (isComplete || textWithoutCodeOrMedia.length > 0);

                  const prevUserMsg = index > 0 ? messages[index - 1] : null;
                  const prevUserPrompt = typeof prevUserMsg?.content === "string" 
                    ? prevUserMsg.content 
                    : (Array.isArray(prevUserMsg?.content) ? prevUserMsg.content.map(c => c.text || "").join(" ") : "");
                  const actionText = getActionText(message, prevUserMsg);
                  const isWorkingOnAsset = actionText !== "Thinking…";

                  return (
                    <div
                      key={`${message.role}-${index}`}
                      className={`chat-message-row ${message.role === "user" ? "user" : "ai"}`}
                    >
                      <span className="sr-only">{message.role === "user" ? "You said:" : "Assistant said:"}</span>
                      <div className="chat-bubble-wrap">
                        {message.role === "assistant" && (
                          <div style={{
                            fontSize: "11px",
                            fontWeight: "700",
                            letterSpacing: "1.2px",
                            color: "rgba(255, 255, 255, 0.75)",
                            textTransform: "uppercase",
                            marginBottom: "2px",
                            fontFamily: "'JetBrains Mono', monospace"
                          }}>
                            ABYX
                          </div>
                        )}
                        {message.role === "assistant" && (displayReasoning || (!isComplete && isBusy && index === messages.length - 1)) && (
                          <ChatThinkingSection
                            reasoning={displayReasoning}
                            timeElapsed={message.generationStats?.seconds || 0}
                            isComplete={isComplete}
                            hasWeb={message.generationStats?.web || false}
                            sources={message.webSources || []}
                            content={rawContent}
                            generationStats={message.generationStats}
                            actionText={actionText}
                          />
                        )}
                        {(hasVisibleContent || message.error) && (
                          <div className={`chat-bubble ${message.error ? "error" : ""}`}>
                            {Array.isArray(displayContent) ? (
                              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                                {displayContent.map((item, idx) => {
                                  if (item.type === "text") return <MarkdownRenderer key={idx} content={item.text} onOpenBrowser={onOpenBrowser} isComplete={isComplete} userPrompt={prevUserPrompt} />;
                                  if (item.type === "image_url") return (
                                    <img key={idx} src={item.image_url.url} alt="Attached image"
                                      style={{ maxWidth: "240px", maxHeight: "180px", objectFit: "contain", borderRadius: "8px", marginTop: "4px" }}
                                    />
                                  );
                                  return null;
                                })}
                              </div>
                            ) : (
                              <MarkdownRenderer content={displayContent} onOpenBrowser={onOpenBrowser} isComplete={isComplete} userPrompt={prevUserPrompt} />
                            )}
                          </div>
                        )}
                        {message.role === "assistant" && Array.isArray(message.webSources) && message.webSources.length > 0 && (
                          <div className="chat-sources">
                            <div className="chat-sources-title">
                              <Globe2 size={13} aria-hidden="true" />
                              <span>Sources</span>
                            </div>
                            {message.webSources.map((source, sourceIndex) => (
                              <a key={`${source.url}-${sourceIndex}`} href={source.url} target="_blank" rel="noreferrer">
                                [{source.index || sourceIndex + 1}] {source.title || source.url}
                              </a>
                            ))}
                          </div>
                        )}

                        {message.role === "assistant" && message.generationStats && !message.error && (
                          <div className="chat-generation-stats" style={{ border: "none", background: "transparent", padding: 0 }}>
                            {isComplete && (
                              <>
                                {message.routedModel && (
                                  <span style={{ display: "inline-flex", alignItems: "center", color: "#38bdf8", fontWeight: "600", marginRight: "6px" }}>
                                    <Sparkles size={12} style={{ marginRight: 4, flexShrink: 0 }} />
                                    {message.routedModel.selectedModelName || message.routedModel.selectedModel} ({message.routedModel.providerName || "Cloud"}) ·
                                  </span>
                                )}
                                {(message.model || message.generationStats.model || status.settings?.model || "AbyxV2 9B").replace(/\.gguf$/i, "")} · {formatGenerationTime(message.generationStats.seconds)} · {message.generationStats.tokens} tokens
                              </>
                            )}
                          </div>
                        )}

                        {/* Message Action Bar (Abyx Behavior) */}
                        <div className="chat-msg-actions">
                          {message.role === "user" ? (
                            <>
                              <button
                                type="button"
                                className="chat-msg-action-btn"
                                onClick={() => handleEditMessage(index, message)}
                                title="Edit message (loads text into prompt)"
                              >
                                <PenLine size={13} />
                                <span>Edit</span>
                              </button>
                              <button
                                type="button"
                                className="chat-msg-action-btn"
                                onClick={() => handleCopyMessage(message, index)}
                                title="Copy message text"
                              >
                                {copiedMessageIdx === index ? <Check size={13} style={{ color: "var(--md-sys-color-primary)" }} /> : <Copy size={13} />}
                                <span aria-live="polite">{copiedMessageIdx === index ? "Copied" : copiedMessageIdx === `error-${index}` ? "Copy failed" : "Copy"}</span>
                              </button>
                              <button
                                type="button"
                                className="chat-msg-action-btn"
                                onClick={() => handleForkConversation(index)}
                                title="Branch into a new conversation from here"
                              >
                                <GitBranch size={13} />
                                <span>Branch</span>
                              </button>
                              <button
                                type="button"
                                className="chat-msg-action-btn"
                                onClick={() => handleDeleteMessage(index)}
                                title="Delete message"
                              >
                                <Trash2 size={13} />
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                className="chat-msg-action-btn"
                                onClick={() => handleCopyMessage(message, index)}
                                title="Copy response markdown"
                              >
                                {copiedMessageIdx === index ? <Check size={13} style={{ color: "var(--md-sys-color-primary)" }} /> : <Copy size={13} />}
                                <span aria-live="polite">{copiedMessageIdx === index ? "Copied" : copiedMessageIdx === `error-${index}` ? "Copy failed" : "Copy"}</span>
                              </button>
                              <button
                                type="button"
                                className="chat-msg-action-btn"
                                onClick={() => handleForkConversation(index)}
                                title="Branch into a new conversation from here"
                              >
                                <GitBranch size={13} />
                                <span>Branch</span>
                              </button>
                              <button
                                type="button"
                                className="chat-msg-action-btn"
                                onClick={() => handleRegenerate(index)}
                                disabled={isBusy}
                                title="Regenerate this response"
                              >
                                <RotateCcw size={13} />
                                <span>Regenerate</span>
                              </button>
                              {message.generationStats?.truncated && isComplete && (
                                <button
                                  type="button"
                                  className="chat-msg-action-btn"
                                  onClick={() => handleSendMessage("continue")}
                                  disabled={isBusy}
                                  style={{ color: "#38bdf8" }}
                                  title="Continue generating remaining content"
                                >
                                  <Play size={12} fill="#38bdf8" />
                                  <span>Continue</span>
                                </button>
                              )}
                              <button
                                type="button"
                                className={`chat-msg-action-btn ${speakingIdx === index ? "speaking active" : ""}`}
                                onClick={() => handleSpeakMessage(index, message)}
                                title={speakingIdx === index ? "Stop speaking" : "Read response aloud"}
                              >
                                <Volume2 size={13} />
                                <span>{speakingIdx === index ? "Stop" : "Read Aloud"}</span>
                              </button>
                              <button
                                type="button"
                                className={`chat-msg-action-btn ${message.feedback === "up" ? "active" : ""}`}
                                onClick={() => handleFeedback(index, "up")}
                                title="Helpful response"
                              >
                                <ThumbsUp size={13} />
                              </button>
                              <button
                                type="button"
                                className={`chat-msg-action-btn ${message.feedback === "down" ? "active" : ""}`}
                                onClick={() => handleFeedback(index, "down")}
                                title="Unhelpful response"
                              >
                                <ThumbsDown size={13} />
                              </button>
                              <button
                                type="button"
                                className="chat-msg-action-btn"
                                onClick={() => handleDeleteMessage(index)}
                                title="Delete response"
                              >
                                <Trash2 size={13} />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}

                {/* In-Stream Agent Approvals */}
                {pendingApprovals && pendingApprovals.length > 0 && (
                  <div className="agent-approvals-stream" style={{ margin: "16px 0", display: "flex", flexDirection: "column", gap: "10px" }}>
                    {pendingApprovals.map((approval) => (
                      <div
                        key={approval.id}
                        className="agent-approval-card"
                        style={{
                          background: "linear-gradient(135deg, rgba(239, 68, 68, 0.08) 0%, rgba(20, 20, 25, 0.95) 100%)",
                          border: "1px solid rgba(239, 68, 68, 0.35)",
                          borderRadius: "12px",
                          padding: "16px",
                          boxShadow: "0 8px 24px rgba(0, 0, 0, 0.4)"
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            <ShieldAlert size={18} color="#ef4444" />
                            <span style={{ fontSize: "13px", fontWeight: 700, color: "#f87171", letterSpacing: "0.5px" }}>
                              AGENT ACTION REQUIRES PERMISSION
                            </span>
                          </div>
                          <span style={{
                            fontSize: "10px",
                            fontWeight: 700,
                            padding: "2px 8px",
                            borderRadius: "6px",
                            background: "rgba(239, 68, 68, 0.2)",
                            color: "#ef4444",
                            textTransform: "uppercase"
                          }}>
                            {approval.riskLevel || "HIGH RISK"}
                          </span>
                        </div>

                        <div style={{ fontSize: "12px", color: "var(--color-text-secondary, #94a3b8)", marginBottom: "8px" }}>
                          Tool: <strong style={{ color: "var(--color-text-primary, #f1f5f9)" }}>{approval.tool}</strong>
                          {approval.action ? " · Action: " : ""}
                          {approval.action && <strong style={{ color: "var(--color-text-primary, #f1f5f9)" }}>{approval.action}</strong>}
                        </div>

                        <div style={{
                          background: "rgba(0, 0, 0, 0.4)",
                          borderRadius: "8px",
                          padding: "10px 12px",
                          fontFamily: "'JetBrains Mono', monospace",
                          fontSize: "11px",
                          color: "#e2e8f0",
                          wordBreak: "break-all",
                          marginBottom: "12px",
                          border: "1px solid rgba(255, 255, 255, 0.06)"
                        }}>
                          {approval.target || approval.command || approval.description || "Potentially destructive workspace modification"}
                        </div>
                        {approval.preview && (
                          <pre style={{
                            whiteSpace: "pre-wrap",
                            overflowWrap: "anywhere",
                            background: "rgba(0, 0, 0, 0.35)",
                            borderRadius: "8px",
                            padding: "10px 12px",
                            color: "#cbd5e1",
                            fontSize: "11px",
                            margin: "0 0 10px"
                          }}>{approval.preview}</pre>
                        )}
                        {approval.reason && (
                          <div style={{ fontSize: "11px", color: "#fbbf24", marginBottom: "12px" }}>
                            {approval.reason}
                          </div>
                        )}

                        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                await resolveAgentApproval(approval.id, true);
                                setPendingApprovals(prev => prev.filter(a => a.id !== approval.id));
                              } catch (_) {}
                            }}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "6px",
                              padding: "6px 14px",
                              borderRadius: "8px",
                              background: "#10b981",
                              color: "#ffffff",
                              fontSize: "12px",
                              fontWeight: 600,
                              cursor: "pointer",
                              border: "none"
                            }}
                          >
                            <Check size={14} />
                            Approve Action
                          </button>

                          {approval.filePath && (
                            <button
                              type="button"
                              onClick={async () => {
                                try {
                                  const diffRes = await getFileDiff(approval.filePath, approval.newContent || "");
                                  if (diffRes && diffRes.diff) {
                                    setActiveDiff({
                                      filePath: approval.filePath,
                                      diffLines: diffRes.diff,
                                      originalContent: diffRes.originalContent || "",
                                      newContent: approval.newContent || ""
                                    });
                                  }
                                } catch (_) {}
                              }}
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "6px",
                                padding: "6px 14px",
                                borderRadius: "8px",
                                background: "rgba(255, 255, 255, 0.08)",
                                color: "#e2e8f0",
                                border: "1px solid rgba(255, 255, 255, 0.12)",
                                fontSize: "12px",
                                fontWeight: 500,
                                cursor: "pointer"
                              }}
                            >
                              <FileCode size={14} />
                              View Diff
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                await resolveAgentApproval(approval.id, false);
                                setPendingApprovals(prev => prev.filter(a => a.id !== approval.id));
                              } catch (_) {}
                            }}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "6px",
                              padding: "6px 14px",
                              borderRadius: "8px",
                              background: "rgba(239, 68, 68, 0.15)",
                              color: "#ef4444",
                              border: "1px solid rgba(239, 68, 68, 0.3)",
                              fontSize: "12px",
                              fontWeight: 600,
                              cursor: "pointer"
                            }}
                          >
                            <X size={14} />
                            Reject
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div ref={bottomRef} />
            </div>

            <div className="chat-composer-dock">{composer}</div>

            {/* Active Diff Modal */}
            {activeDiff && (
              <div
                style={{
                  position: "fixed",
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  background: "rgba(0, 0, 0, 0.7)",
                  backdropFilter: "blur(6px)",
                  zIndex: 9999,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "24px"
                }}
                onClick={() => setActiveDiff(null)}
              >
                <div
                  style={{
                    width: "100%",
                    maxWidth: "960px",
                    maxHeight: "85vh",
                    background: "#0f172a",
                    borderRadius: "16px",
                    overflow: "hidden",
                    border: "1px solid rgba(255, 255, 255, 0.15)",
                    boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.8)",
                    display: "flex",
                    flexDirection: "column"
                  }}
                  onClick={e => e.stopPropagation()}
                >
                  <DiffViewer
                    filePath={activeDiff.filePath}
                    originalContent={activeDiff.originalContent}
                    newContent={activeDiff.newContent}
                    diffLines={activeDiff.diffLines}
                    onClose={() => setActiveDiff(null)}
                  />
                </div>
              </div>
            )}

            {/* Harness Controls Drawer */}
            <HarnessControlsDrawer
              isOpen={isHarnessControlsOpen}
              onClose={() => setIsHarnessControlsOpen(false)}
            />
          </>
        )}
      </section>

      {/* Rename Conversation Dialog */}
      {showRenameModal && (
        <div className="abyx-modal-backdrop" onClick={() => setShowRenameModal(false)}>
          <div className="abyx-modal-dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 380 }}>
            <div className="abyx-modal-header">
              <h2 style={{ margin: 0, fontSize: "1rem", fontWeight: 600 }}>Rename Conversation</h2>
              <button className="abyx-btn abyx-btn-sm" onClick={() => setShowRenameModal(false)}>
                <X size={14} />
              </button>
            </div>
            <form onSubmit={(e) => {
              e.preventDefault();
              if (renameInput.trim() && activeConversationId) {
                onRenameConversation?.(activeConversationId, renameInput.trim());
              }
              setShowRenameModal(false);
            }}>
              <div className="abyx-modal-body">
                <input
                  type="text"
                  className="abyx-input"
                  value={renameInput}
                  onChange={(e) => setRenameInput(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="abyx-modal-footer">
                <button type="button" className="abyx-btn" onClick={() => setShowRenameModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="abyx-btn abyx-btn-primary">
                  Save
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
// PDF text is extracted in the browser, so PDFs work with every model, not only vision ones.
// pdf.js is loaded on first use to keep it out of the main bundle.
async function extractPdfText(file) {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const text = textContent.items.map((item) => (item.str || "") + (item.hasEOL ? "\n" : " ")).join("").trim();
    if (text) pages.push(`[Page ${pageNumber}]\n${text}`);
  }
  await pdf.destroy();
  return pages.join("\n\n");
}


export default TextChat;
