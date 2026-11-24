import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  LoaderCircle, Trash2, Square, X, ChevronDown, ChevronRight, Globe2, Globe, Plus, PenLine,
  Lightbulb, Zap, FileText, ArrowUp, Brain, Mic, AudioLines, Image as ImageIcon,
  PanelLeft, Volume2, RotateCcw, ThumbsUp, ThumbsDown, Copy, Check, Pin,
  Download, Sparkles, RefreshCw, FolderKanban, FileCode, Eye, ExternalLink,
  Folder, Code2, Terminal, CheckCircle, Circle, Play, Pause, Settings, GitBranch, Layers, Clock
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
} from "../services/api";
import katex from "katex";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "katex/dist/katex.min.css";

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

function inferFilenameFromPrompt(prompt, defaultExt = "html") {
  if (!prompt || typeof prompt !== "string") return `site.${defaultExt}`;

  // 1. Explicit filename with extension mentioned by user: e.g. "about.html", "contact_us.html", "calc.py"
  const explicitMatch = prompt.match(/\b([a-zA-Z0-9_-]+\.(?:html?|css|js|py|json|svg))\b/i);
  if (explicitMatch && explicitMatch[1]) {
    return explicitMatch[1].toLowerCase();
  }

  // 2. Specific named page request: e.g. "named weather_app", "called bar"
  const namedMatch = prompt.match(/(?:named|called|filename)\s*[:=]?\s*["']?([a-zA-Z0-9_-]+)["']?/i);
  if (namedMatch && namedMatch[1] && !/^(an?|the|this|my|a|it|file|named|called)$/i.test(namedMatch[1])) {
    const rawName = namedMatch[1].toLowerCase();
    return rawName.includes(".") ? rawName : `${rawName}.${defaultExt}`;
  }

  // 3. Self/Profile detection
  if (/\b(yourself|about you|about yourself|who are you|your bio|profile)\b/i.test(prompt)) {
    return `abyx_profile.${defaultExt}`;
  }

  // 4. Clean prompt words
  let clean = prompt
    .replace(/<[^>]+>/g, "")
    .replace(/\b(can you|please|could you|i want you to|i want|help me|make|create|build|generate|code|develop|design|write|an?|the|website|webpage|web page|site|app|application|page|in|using|with|html5?|css|javascript|js|named|called|filename|file)\b/gi, " ")
    .replace(/[^a-zA-Z0-9\s_-]/g, " ")
    .trim();

  // Filter stopwords
  const stopwords = new Set([
    "for", "about", "of", "to", "and", "on", "at", "by", "from", "my", "me", "your",
    "this", "that", "it", "is", "a", "an", "the", "some", "any", "all", "new", "one",
    "like", "just", "well", "rn", "now"
  ]);

  const words = clean.split(/\s+/)
    .map(w => w.toLowerCase())
    .filter(w => w.length > 1 && !stopwords.has(w));

  if (words.length > 0) {
    const slug = words.slice(0, 3).join("_");
    if (slug.length >= 2) {
      return `${slug}.${defaultExt}`;
    }
  }

  return `site.${defaultExt}`;
}

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
  generationStats = null
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

  // Dynamic pill status matching modern AI harnesses
  let icon = <Brain size={13} style={{ color: "#a5b4fc" }} />;
  let label = isComplete ? `Thought process${formattedTime}` : `Thinking...${formattedTime}`;

  if (filename) {
    icon = isComplete 
      ? <CheckCircle size={13} style={{ color: "#10b981" }} />
      : <Code2 size={13} style={{ color: "#38bdf8" }} />;
    label = isComplete 
      ? `Worked on ${filename}${formattedTime}`
      : `Working on ${filename}...`;
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
        ? "Rendered visual assets on RTX 5060 GPU and saved to abyx/assets/"
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
        {!isComplete && <LoaderCircle size={11} className="progress-spinner" style={{ color: "var(--accent-orange, #ff4b1f)", marginLeft: "2px" }} />}
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
                    <LoaderCircle size={14} className="progress-spinner" style={{ color: "#38bdf8" }} />
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

  useEffect(() => {
    if (setIsLlmLoaded) {
      setIsLlmLoaded(status.ready ? (status.settings?.model || true) : false);
    }
  }, [status.ready, status.settings?.model, setIsLlmLoaded]);

  const [showModelMenu, setShowModelMenu] = useState(false);
  const [activeSubmenu, setActiveSubmenu] = useState(null);
  const modelMenuRef = useRef(null);

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

  // Pi-inspired sliding window context compaction to prevent OOM and reduce latency on long sessions
  const compactConversationMessages = (msgs, maxEstimatedTokens = 12000) => {
    if (!Array.isArray(msgs) || msgs.length <= 8) return msgs;
    let totalTokens = 0;
    for (const m of msgs) {
      const text = typeof m.content === "string" ? m.content : JSON.stringify(m.content || "");
      totalTokens += estimateTokens(text);
    }
    if (totalTokens <= maxEstimatedTokens) return msgs;

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
    const safetyBuffer = thinkingEnabled ? 768 : 512;
    const preferredMinimum = thinkingEnabled ? 1024 : 512;
    const available = contextLimit - promptTokens - safetyBuffer;
    if (available <= 0) return 64;
    return clamp(available, Math.min(preferredMinimum, available), Math.min(16384, Math.max(4096, available)));
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

  const handleFileChange = (e) => {
    const files = Array.from(e.target.files);
    if (!files || files.length === 0) return;

    files.forEach((file) => {
      if (isImage(file)) {
        if (!supportsVision) {
          showAlert({
            title: "Vision Model Required",
            message: "To attach images, please select and load a multimodal/vision model with an mmproj file.",
            danger: true,
          });
          return;
        }
        optimizeImageForVision(file)
          .then((image) => {
            setAttachments((prev) => [
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
                originalWidth: image.originalWidth,
                originalHeight: image.originalHeight,
              },
            ]);
          })
          .catch((err) => {
            showAlert({ title: "Image Error", message: err.message || String(err), danger: true });
          });
      } else if (isTextFile(file)) {
        const reader = new FileReader();
        reader.onload = (event) => {
          setAttachments((prev) => [
            ...prev,
            {
              id: Math.random().toString(36).substring(7),
              file,
              type: "document",
              name: file.name,
              content: event.target.result,
            },
          ]);
        };
        reader.readAsText(file);
      } else if (/\.pdf$/i.test(file.name) || file.type === "application/pdf") {
        extractPdfText(file)
          .then((text) => {
            if (!text.trim()) {
              throw new Error(`"${file.name}" has no extractable text (it may be a scanned image). Export the pages as images and attach those to a vision model instead.`);
            }
            setAttachments((prev) => [
              ...prev,
              {
                id: Math.random().toString(36).substring(7),
                file,
                type: "document",
                name: file.name,
                content: text,
              },
            ]);
          })
          .catch((err) => {
            showAlert({ title: "PDF Error", message: err.message || String(err), danger: true });
          });
      } else {
        showAlert({
          title: "Unsupported File",
          message: `File "${file.name}" is not supported. Please select an image (JPEG, PNG, WEBP), a PDF, or a text/code file.`,
          danger: true,
        });
      }
    });

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

    let convId = activeConversationId;
    let isNew = false;
    if (!convId) {
      convId = "chat_" + Date.now();
      setActiveConversationId(convId);
      isNew = true;
    }

    // Delimited context blocks for document attachments
    let documentContext = "";
    attachments.filter(att => att.type === "document").forEach((att) => {
      documentContext += `\n[Attached File: ${att.name}]\n${att.content}\n`;
    });

    const imageAttachments = attachments.filter(att => att.type === "image");
    const conversationHasImage = messages.some(messageContainsImage);
    const requestHasImage = imageAttachments.length > 0 || conversationHasImage;
    const visionInstruction = requestHasImage
      ? "For images in this conversation: answer in natural language, describe the actual image content, and read visible text carefully when relevant. If the user asks a follow-up like \"what is this\" or \"explain\", treat it as referring to the most recent image unless they say otherwise. Do not output raw JSON, arrays, bounding boxes, OCR layout objects, UI class names, or detection labels unless the user explicitly asks for that format."
      : "";
    const requestText = imageAttachments.length > 0
      ? (text && text !== "?" ? text : "Describe what is visible in the image.")
      : text;
    const displayText = text || (imageAttachments.length > 0 ? "Describe what is visible in the image." : "");
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
      const manualMaxTokens = textSettings?.maxTokens || 8192;
      const effectiveMaxTokens = textSettings?.responseTokenMode === "manual"
        ? (thinkingEnabled ? Math.max(manualMaxTokens, 2048) : manualMaxTokens)
        : getAutoMaxResponseTokens(promptTokenEstimate, thinkingEnabled);

      let routedInfo = null;
      const response = await streamChatWithLlm(requestMessages, {
        model: selectedModel || "auto",
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
    if (text) {
      navigator.clipboard.writeText(text);
      setCopiedMessageIdx(index);
      setTimeout(() => setCopiedMessageIdx(null), 2000);
    }
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
        model: selectedModel || "auto",
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

  const contextMax = status.settings?.contextSize || textSettings?.contextSize || 262144;
  const contextUsed = tokenUsage.total_tokens || 0;
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
              {att.type === "image" ? (
                <img src={att.dataUrl} alt="" className="chat-attachment-thumb" />
              ) : (
                <FileText size={16} aria-hidden="true" style={{ flexShrink: 0 }} />
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
        <textarea
          ref={textareaRef}
          className="chat-composer-textarea"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              sendMessage();
            }
          }}
          placeholder={composerPlaceholder}
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
              <Plus size={20} />
            </button>
            <button
              type="button"
              className={`chat-composer-chip ${useWebSearch ? "active" : ""}`}
              onClick={() => setUseWebSearch((value) => !value)}
              disabled={!isChatAvailable || isBusy}
              aria-pressed={useWebSearch}
              title={useWebSearch ? "Disable web search" : "Enable web search"}
            >
              <Globe2 size={15} />
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
                <Brain size={15} />
                <span>Think</span>
              </button>
            )}
          </div>

          <div className="chat-composer-toolbar-right">
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
                {(status.ready || isExplicitLocal || isCloudSelected) && (
                  <span className="chat-model-dot" style={{ background: dotColor }} aria-hidden="true" />
                )}
                <span className="chat-model-trigger-label">{modelLabel}</span>
                <ChevronDown size={15} aria-hidden="true" />
              </button>

              {showModelMenu && (
                <div
                  className="chat-model-menu-container up"
                  onMouseLeave={() => setActiveSubmenu(null)}
                  style={{
                    position: "absolute",
                    bottom: "calc(100% + 8px)",
                    top: "auto",
                    right: 0,
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
                            Strictly local • RTX 5060 GPU ({models.length} model{models.length === 1 ? "" : "s"})
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
                            right: "calc(100% + 8px)",
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

                    {/* 2. CLOUD (AUTO + MORE MODELS) */}
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
                              background: isCloudSelected ? "rgba(56, 189, 248, 0.12)" : (activeSubmenu === "cloud" ? "rgba(255,255,255,0.06)" : "transparent"),
                              border: isCloudSelected ? "1px solid rgba(56, 189, 248, 0.28)" : "1px solid transparent",
                              cursor: "pointer",
                              width: "100%",
                              textAlign: "left"
                            }}
                          >
                            <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: "#38bdf8", flexShrink: 0 }} />
                                <span style={{ fontSize: "13.5px", fontWeight: 600, color: "#ededed" }}>
                                  Cloud
                                </span>
                                <span style={{
                                  fontSize: "10px",
                                  fontWeight: 600,
                                  background: "rgba(56, 189, 248, 0.15)",
                                  color: "#38bdf8",
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
                                right: "calc(100% + 8px)",
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
                                  background: selectedModel === "pollinations/openai" ? "rgba(56, 189, 248, 0.12)" : "transparent",
                                  border: selectedModel === "pollinations/openai" ? "1px solid rgba(56, 189, 248, 0.25)" : "1px solid transparent",
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
                                <span style={{ fontSize: "10px", color: "#38bdf8", background: "rgba(56, 189, 248, 0.12)", padding: "1px 6px", borderRadius: "6px" }}>
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
                                          background: isChosen ? "rgba(56, 189, 248, 0.12)" : "transparent",
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

            {/* Voice Dictation (Mic) Button */}
            <button
              type="button"
              className={`chat-composer-mic-btn ${isListening ? "listening" : ""}`}
              onClick={toggleListening}
              disabled={!isChatAvailable || isBusy}
              aria-label={isListening ? "Stop listening" : "Voice dictation (Mic)"}
              title={isListening ? "Listening... Click to stop speaking" : "Speak to type (Microphone)"}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: "36px",
                height: "36px",
                borderRadius: "50%",
                border: isListening ? "1px solid #ef4444" : "1px solid rgba(255, 255, 255, 0.12)",
                background: isListening ? "rgba(239, 68, 68, 0.22)" : "rgba(255, 255, 255, 0.05)",
                color: isListening ? "#ef4444" : "#ededed",
                cursor: (!isChatAvailable || isBusy) ? "not-allowed" : "pointer",
                transition: "all 0.2s ease",
                marginRight: "6px"
              }}
            >
              <Mic size={17} style={{ animation: isListening ? "pulse 1s infinite" : "none" }} />
            </button>

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
                <ArrowUp size={18} strokeWidth={2.25} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="text-chat-layout">
      <section className="text-chat-main" aria-label="Chat">
        {loadingModel ? (
          <div className="chat-home">
            <div className="chat-loading">
              <LoaderCircle className="progress-spinner" size={28} aria-hidden="true" />
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
                          <>
                            {message.generationStats.truncated && (
                              <div className="chat-generation-warning">
                                Response reached the token limit. Ask "continue" or switch Max Response Tokens to Manual for a larger cap.
                              </div>
                            )}
                            <div className="chat-generation-stats" style={{ border: "none", background: "transparent", padding: 0 }}>
                              {!isComplete && isBusy ? (
                                <div style={{ display: "inline-flex", alignItems: "center", gap: "8px", border: "none", background: "transparent", color: "rgba(255, 255, 255, 0.7)", fontSize: "13px" }}>
                                  <LoaderCircle size={14} className="progress-spinner" style={{ color: "rgba(255, 255, 255, 0.6)" }} />
                                  <span>{actionText}</span>
                                </div>
                              ) : (
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
                          </>
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
                                <span>{copiedMessageIdx === index ? "Copied" : "Copy"}</span>
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
                                <span>{copiedMessageIdx === index ? "Copied" : "Copy"}</span>
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
              </div>
              <div ref={bottomRef} />
            </div>

            <div className="chat-composer-dock">{composer}</div>
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

function MathFormula({ tex, display = false }) {
  const html = katex.renderToString(tex, { displayMode: display, throwOnError: false, output: "html" });
  return display
    ? <div className="chat-math-block" dangerouslySetInnerHTML={{ __html: html }} />
    : <span dangerouslySetInnerHTML={{ __html: html }} />;
}

// Inline math: \( ... \) or $...$ (no space just inside the dollars and no digit right
// after the closing one, so prices like "$5 and $10" stay plain text).
const INLINE_MATH = String.raw`\\\(.+?\\\)|\$(?:[^\s$]|[^\s$][^$\n]*?[^\s$])\$(?!\d)`;

function parseInlineMarkdown(text) {
  const regex = new RegExp(`(${INLINE_MATH}|\\*\\*.*?\\*\\*|\`.*?\`|\\*.*?\\*|\\[.*?\\]\\(.*?\\))`, "g");
  const parts = text.split(regex);

  return parts.map((part, idx) => {
    if (part.length > 4 && part.startsWith("\\(") && part.endsWith("\\)")) {
      return <MathFormula key={idx} tex={part.slice(2, -2)} />;
    }
    if (part.length > 2 && part.startsWith("$") && part.endsWith("$")) {
      return <MathFormula key={idx} tex={part.slice(1, -1)} />;
    }
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={idx}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={idx} className="markdown-inline-code">{part.slice(1, -1)}</code>;
    }
    if (part.startsWith("*") && part.endsWith("*")) {
      return <em key={idx}>{part.slice(1, -1)}</em>;
    }
    if (part.startsWith("[") && part.includes("](") && part.endsWith(")")) {
      const match = part.match(/\[(.*?)\]\((.*?)\)/);
      if (match) {
        const linkUrl = match[2] || "";
        const isPreviewAction = linkUrl.startsWith("action:preview") || linkUrl.startsWith("local://") || linkUrl.includes("openInsideBrowser");
        if (isPreviewAction) {
          const fileMatch = linkUrl.match(/(?:file=|local:\/\/)([^'")\s&]+)/);
          const targetFile = fileMatch ? fileMatch[1] : "index.html";
          return (
            <button
              key={idx}
              type="button"
              className="chat-action-link"
              onClick={() => {
                if (window.openInsideBrowser) window.openInsideBrowser(`local://${targetFile}`);
              }}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "5px",
                color: "#45D483",
                background: "rgba(69, 212, 131, 0.12)",
                border: "1px solid rgba(69, 212, 131, 0.3)",
                borderRadius: "5px",
                padding: "2px 8px",
                fontSize: "12px",
                fontWeight: "600",
                cursor: "pointer",
                margin: "0 3px",
                textDecoration: "none"
              }}
              title={`Preview ${targetFile} in built-in browser`}
            >
              <Globe size={12} style={{ flexShrink: 0 }} />
              <span>{match[1]}</span>
            </button>
          );
        }
        return (
          <a key={idx} href={match[2]} target="_blank" rel="noopener noreferrer" className="markdown-link">
            {match[1]}
          </a>
        );
      }
    }
    return part;
  });
}

/**
 * Interactive Code Block with Copy, Download on bottom, and Preview at the last
 */
export function CodeBlockRenderer({ code, lang, onOpenBrowser, isComplete = true, userPrompt = "" }) {
  const [copied, setCopied] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const [showCode, setShowCode] = useState(false);

  const cleanCode = (code || "").trim();
  const lowerLang = (lang || "").toLowerCase().trim();

  // 1. Detect filename from header comments if present
  let detectedFilename = "";
  const firstLine = cleanCode.split("\n")[0] || "";
  const filenameMatch = firstLine.match(/(?:\/\/|#|<!--|\/\*)\s*(?:filename|file|name|path):\s*([a-zA-Z0-9_./-]+)/i);
  if (filenameMatch && filenameMatch[1]) {
    detectedFilename = filenameMatch[1].trim().replace(/^[/\\]+/, "");
    // If the model defaulted to generic "index.html" but the user requested a specific topic,
    // override with the inferred topic name so previous files are preserved.
    if (detectedFilename.toLowerCase() === "index.html" && userPrompt && !userPrompt.toLowerCase().includes("index.html")) {
      const inferred = inferFilenameFromPrompt(userPrompt, "html");
      if (inferred && inferred !== "site.html") {
        detectedFilename = inferred;
      }
    }
  }

  // 2. Fallback filename & MIME type mapping
  let defaultExt = "txt";
  let mimeType = "text/plain";
  const isHtml = lowerLang === "html" || lowerLang === "htm" || cleanCode.includes("<!DOCTYPE") || cleanCode.includes("<html") || cleanCode.includes("</html>");
  const isSvg = lowerLang === "svg" || (cleanCode.startsWith("<svg") && cleanCode.includes("</svg>"));
  const isMarkdown = lowerLang === "md" || lowerLang === "markdown";

  let badgeText = "CODE";
  if (isHtml) {
    defaultExt = "html";
    mimeType = "text/html;charset=utf-8";
    badgeText = "HTML";
  } else if (isSvg) {
    defaultExt = "svg";
    mimeType = "image/svg+xml";
    badgeText = "SVG";
  } else if (["js", "javascript", "node", "mjs", "cjs"].includes(lowerLang)) {
    defaultExt = "js";
    mimeType = "text/javascript";
    badgeText = "JS";
  } else if (["ts", "typescript"].includes(lowerLang)) {
    defaultExt = "ts";
    mimeType = "text/typescript";
    badgeText = "TS";
  } else if (lowerLang === "jsx") {
    defaultExt = "jsx";
    mimeType = "text/javascript";
    badgeText = "JSX";
  } else if (lowerLang === "tsx") {
    defaultExt = "tsx";
    mimeType = "text/typescript";
    badgeText = "TSX";
  } else if (["py", "python"].includes(lowerLang)) {
    defaultExt = "py";
    mimeType = "text/x-python";
    badgeText = "PY";
  } else if (lowerLang === "css") {
    defaultExt = "css";
    mimeType = "text/css";
    badgeText = "CSS";
  } else if (lowerLang === "json") {
    defaultExt = "json";
    mimeType = "application/json";
    badgeText = "JSON";
  } else if (["sh", "bash", "shell", "zsh"].includes(lowerLang)) {
    defaultExt = "sh";
    mimeType = "text/x-sh";
    badgeText = "SH";
  } else if (["bat", "cmd", "powershell", "ps1"].includes(lowerLang)) {
    defaultExt = lowerLang === "ps1" ? "ps1" : "bat";
    mimeType = "text/plain";
    badgeText = "BAT";
  } else if (["sql", "sqlite"].includes(lowerLang)) {
    defaultExt = "sql";
    mimeType = "text/plain";
    badgeText = "SQL";
  } else if (isMarkdown) {
    defaultExt = "md";
    mimeType = "text/markdown";
    badgeText = "MD";
  } else if (lowerLang) {
    defaultExt = lowerLang.slice(0, 8);
    badgeText = defaultExt.toUpperCase().slice(0, 4);
  }

  const fallbackHtmlName = userPrompt ? inferFilenameFromPrompt(userPrompt, "html") : "index.html";
  const filename = detectedFilename || (isHtml ? fallbackHtmlName : isSvg ? "graphic.svg" : (badgeText === "PY" ? "main.py" : (badgeText === "JS" ? "script.js" : `file.${defaultExt}`)));
  const lineCount = cleanCode.split("\n").length;
  const byteLen = new Blob([cleanCode]).size;
  const sizeStr = byteLen < 1024 ? `${byteLen} B` : `${(byteLen / 1024).toFixed(1)} KB`;
  const relativeDisplayPath = `abyx/${filename}`;

  // Media files (PNG, JPG, WAV, etc.) or raw <img> tags must NEVER be rendered as code cards
  const mediaExtRegex = /\.(?:png|jpe?g|webp|gif|ico|bmp|tiff|wav|mp3|ogg|flac|m4a)$/i;
  const isImageOrMedia = mediaExtRegex.test(filename) ||
    mediaExtRegex.test(lowerLang) ||
    mediaExtRegex.test(detectedFilename) ||
    mediaExtRegex.test(firstLine) ||
    ["png", "jpg", "jpeg", "webp", "gif", "ico", "bmp", "tiff", "wav", "mp3", "ogg", "flac", "audio", "image"].includes(lowerLang) ||
    cleanCode.includes("<img") ||
    cleanCode.includes("[IMAGE:") ||
    cleanCode.includes("[AUDIO:") ||
    cleanCode.includes("data-generate=") ||
    cleanCode.includes("data-prompt=");

  // Auto-save to workspace whenever code block is generated and complete
  useEffect(() => {
    if (isComplete && !isImageOrMedia && cleanCode && cleanCode.length > 5 && filename) {
      saveWorkspaceFile(filename, cleanCode).catch(() => {});
    }
  }, [isComplete, isImageOrMedia, filename, cleanCode]);

  const handleCopy = useCallback(() => {
    try {
      navigator.clipboard.writeText(cleanCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (_) {}
  }, [cleanCode]);

  const handleDownload = useCallback(() => {
    try {
      const blob = new Blob([cleanCode], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setDownloaded(true);
      setTimeout(() => setDownloaded(false), 2000);
    } catch (err) {
      console.error("Download failed", err);
    }
  }, [cleanCode, mimeType, filename]);

  const handleReveal = useCallback(async () => {
    setRevealing(true);
    try {
      await saveWorkspaceFile(filename, cleanCode).catch(() => {});
      const res = await revealWorkspaceFile(filename, cleanCode);
      if (res && res.ok) {
        setRevealed(true);
        setTimeout(() => setRevealed(false), 2500);
      }
    } catch (err) {
      console.error("Reveal failed:", err);
    } finally {
      setRevealing(false);
    }
  }, [filename, cleanCode]);

  const handlePreview = useCallback(async () => {
    try {
      if (isHtml || isSvg) {
        if (isHtml) {
          try {
            saveWorkspaceFile(filename, cleanCode).catch(() => {});
          } catch (_) {}
        }
        const localTarget = `local://${filename}`;
        if (window.openInsideBrowser) {
          window.openInsideBrowser(localTarget);
        } else if (onOpenBrowser) {
          onOpenBrowser(localTarget);
        } else {
          const blob = new Blob([cleanCode], { type: isSvg ? "image/svg+xml" : "text/html;charset=utf-8" });
          window.open(URL.createObjectURL(blob), "_blank");
        }
      }
    } catch (err) {
      console.error("Preview failed", err);
    }
  }, [cleanCode, isHtml, isSvg, onOpenBrowser, filename]);

  // Strictly reveal file cards only at the end when generation is complete and not media
  if (!isComplete || isImageOrMedia) {
    return null;
  }

  return (
    <div className="abyx-file-card-wrapper" style={{
      margin: "10px 0",
      borderRadius: "12px",
      border: "1px solid rgba(255, 255, 255, 0.08)",
      background: "#101014",
      overflow: "hidden",
      boxShadow: "0 2px 10px rgba(0, 0, 0, 0.2)",
      width: "100%",
      maxWidth: "760px"
    }}>
      {/* Sleek Minimalist File Card Header */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "10px 14px",
        gap: "12px",
        flexWrap: "wrap"
      }}>
        {/* Left: Badge & File Info */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0, flex: "1 1 240px" }}>
          {/* Badge */}
          <div style={{
            width: "36px",
            height: "36px",
            borderRadius: "8px",
            background: "rgba(165, 180, 252, 0.08)",
            border: "1px solid rgba(165, 180, 252, 0.18)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: "10.5px",
            fontWeight: "700",
            color: "#a5b4fc",
            letterSpacing: "0.5px",
            flexShrink: 0
          }}>
            {badgeText}
          </div>

          {/* Metadata Column */}
          <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: "2px" }}>
            <div style={{
              fontSize: "13px",
              fontWeight: "600",
              color: "#f3f4f6",
              letterSpacing: "-0.01em",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap"
            }}>
              {filename}
            </div>
            <div style={{
              fontSize: "11px",
              color: "rgba(255, 255, 255, 0.45)",
              fontFamily: "'JetBrains Mono', monospace",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              display: "flex",
              alignItems: "center",
              gap: "6px"
            }}>
              <span>{badgeText}</span>
              <span style={{ opacity: 0.35 }}>•</span>
              <span>{sizeStr}</span>
              <span style={{ opacity: 0.35 }}>•</span>
              <span style={{ opacity: 0.85 }}>{relativeDisplayPath}</span>
            </div>
          </div>
        </div>

        {/* Right: Actions (Download, Reveal, Code) */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
          {/* Download */}
          <button
            type="button"
            onClick={handleDownload}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              height: "30px",
              padding: "0 12px",
              borderRadius: "7px",
              background: downloaded ? "rgba(74, 222, 128, 0.12)" : "rgba(255, 255, 255, 0.08)",
              color: downloaded ? "#4ade80" : "#f3f4f6",
              fontSize: "12px",
              fontWeight: "500",
              border: downloaded ? "1px solid rgba(74, 222, 128, 0.28)" : "1px solid rgba(255, 255, 255, 0.12)",
              cursor: "pointer",
              transition: "all 0.15s ease"
            }}
            title={`Download ${filename}`}
            onMouseEnter={(e) => {
              if (!downloaded) {
                e.currentTarget.style.background = "rgba(255, 255, 255, 0.13)";
                e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.2)";
              }
            }}
            onMouseLeave={(e) => {
              if (!downloaded) {
                e.currentTarget.style.background = "rgba(255, 255, 255, 0.08)";
                e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.12)";
              }
            }}
          >
            {downloaded ? <Check size={13} strokeWidth={2.4} /> : <Download size={13} strokeWidth={2} />}
            <span>{downloaded ? "Saved" : "Download"}</span>
          </button>

          {/* Reveal */}
          <button
            type="button"
            onClick={handleReveal}
            disabled={revealing}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              height: "30px",
              padding: "0 12px",
              borderRadius: "7px",
              background: revealed ? "rgba(74, 222, 128, 0.12)" : "rgba(255, 255, 255, 0.03)",
              color: revealed ? "#4ade80" : "rgba(255, 255, 255, 0.75)",
              fontSize: "12px",
              fontWeight: "500",
              border: revealed ? "1px solid rgba(74, 222, 128, 0.28)" : "1px solid rgba(255, 255, 255, 0.08)",
              cursor: revealing ? "wait" : "pointer",
              transition: "all 0.15s ease"
            }}
            title={`Reveal ${filename} in File Explorer`}
            onMouseEnter={(e) => {
              if (!revealed) {
                e.currentTarget.style.background = "rgba(255, 255, 255, 0.08)";
                e.currentTarget.style.color = "#f3f4f6";
                e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.16)";
              }
            }}
            onMouseLeave={(e) => {
              if (!revealed) {
                e.currentTarget.style.background = "rgba(255, 255, 255, 0.03)";
                e.currentTarget.style.color = "rgba(255, 255, 255, 0.75)";
                e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.08)";
              }
            }}
          >
            {revealed ? <Check size={13} color="#4ade80" /> : <Folder size={13} />}
            <span>{revealed ? "Revealed" : revealing ? "Opening..." : "Reveal"}</span>
          </button>

          {/* Code */}
          <button
            type="button"
            onClick={() => setShowCode(!showCode)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              height: "30px",
              padding: "0 12px",
              borderRadius: "7px",
              background: showCode ? "rgba(165, 180, 252, 0.12)" : "rgba(255, 255, 255, 0.03)",
              color: showCode ? "#a5b4fc" : "rgba(255, 255, 255, 0.75)",
              fontSize: "12px",
              fontWeight: "500",
              border: showCode ? "1px solid rgba(165, 180, 252, 0.3)" : "1px solid rgba(255, 255, 255, 0.08)",
              cursor: "pointer",
              transition: "all 0.15s ease"
            }}
            title={showCode ? "Hide source code" : "View source code"}
            onMouseEnter={(e) => {
              if (!showCode) {
                e.currentTarget.style.background = "rgba(255, 255, 255, 0.08)";
                e.currentTarget.style.color = "#f3f4f6";
              }
            }}
            onMouseLeave={(e) => {
              if (!showCode) {
                e.currentTarget.style.background = "rgba(255, 255, 255, 0.03)";
                e.currentTarget.style.color = "rgba(255, 255, 255, 0.75)";
              }
            }}
          >
            <Code2 size={13} />
            <span>Code</span>
          </button>
        </div>
      </div>

      {/* Expanded Code Viewer (When Code is toggled open) */}
      {showCode && (
        <div style={{
          borderTop: "1px solid rgba(255, 255, 255, 0.08)",
          background: "#0a0a0d",
          padding: "12px 16px"
        }}>
          {/* Code Toolbar */}
          <div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "10px",
            gap: "8px",
            flexWrap: "wrap"
          }}>
            <div style={{
              fontSize: "11px",
              fontFamily: "'JetBrains Mono', monospace",
              color: "rgba(255, 255, 255, 0.45)",
              display: "flex",
              alignItems: "center",
              gap: "6px"
            }}>
              <FileCode size={13} color="#94a3b8" />
              <span style={{ color: "#94a3b8", textTransform: "uppercase", fontWeight: "600" }}>{lang || defaultExt}</span>
              <span>•</span>
              <span>{lineCount} lines</span>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              {/* Copy Button */}
              <button
                type="button"
                onClick={handleCopy}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                  padding: "4px 10px",
                  borderRadius: "6px",
                  fontSize: "11.5px",
                  background: "rgba(255, 255, 255, 0.06)",
                  color: copied ? "#4ade80" : "#d1d5db",
                  border: "1px solid rgba(255, 255, 255, 0.1)",
                  cursor: "pointer"
                }}
                title="Copy code to clipboard"
              >
                {copied ? <Check size={12} /> : <Copy size={12} />}
                <span>{copied ? "Copied" : "Copy"}</span>
              </button>

              {/* Download with Specific Extension */}
              <button
                type="button"
                onClick={handleDownload}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                  padding: "4px 10px",
                  borderRadius: "6px",
                  fontSize: "11.5px",
                  background: "rgba(56, 189, 248, 0.12)",
                  color: "#38bdf8",
                  border: "1px solid rgba(56, 189, 248, 0.25)",
                  cursor: "pointer"
                }}
                title={`Download .${defaultExt}`}
              >
                <Download size={12} />
                <span>.{defaultExt}</span>
              </button>

              {/* Preview Button for HTML / SVG */}
              {(isHtml || isSvg) && (
                <button
                  type="button"
                  onClick={handlePreview}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "4px",
                    padding: "4px 10px",
                    borderRadius: "6px",
                    fontSize: "11.5px",
                    background: "rgba(74, 222, 128, 0.12)",
                    color: "#4ade80",
                    border: "1px solid rgba(74, 222, 128, 0.25)",
                    cursor: "pointer"
                  }}
                  title="Preview in Built-in Browser"
                >
                  <Globe size={12} />
                  <span>Preview</span>
                </button>
              )}
            </div>
          </div>

          {/* Code Text Content */}
          <pre style={{
            margin: 0,
            padding: "12px",
            borderRadius: "8px",
            background: "#050507",
            border: "1px solid rgba(255, 255, 255, 0.05)",
            color: "#e2e8f0",
            fontFamily: "'JetBrains Mono', Consolas, Monaco, monospace",
            fontSize: "12px",
            lineHeight: "1.6",
            overflowX: "auto",
            maxHeight: "440px"
          }}>
            <code>{cleanCode}</code>
          </pre>
        </div>
      )}
    </div>
  );
}

/**
 * Sleek Image Card Renderer (Matching Reference Layout)
 */
export function ImageBlockRenderer({ src, alt, filename }) {
  const [downloaded, setDownloaded] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const [showFull, setShowFull] = useState(false);

  const cleanFilename = filename || (src ? String(src).split("/").pop().split("\\").pop().split("?")[0] : "image.png");
  const displaySrc = (src && (src.startsWith("http") || src.startsWith("/") || src.startsWith("data:")))
    ? src 
    : `/api/output-file?filename=${encodeURIComponent(cleanFilename)}`;

  const handleDownload = () => {
    try {
      const a = document.createElement("a");
      a.href = displaySrc;
      a.download = cleanFilename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setDownloaded(true);
      setTimeout(() => setDownloaded(false), 2000);
    } catch (_) {}
  };

  const handleReveal = async () => {
    setRevealing(true);
    try {
      const res = await revealWorkspaceFile(`assets/${cleanFilename}`);
      if (res && res.ok) {
        setRevealed(true);
        setTimeout(() => setRevealed(false), 2500);
      }
    } catch (_) {}
    finally {
      setRevealing(false);
    }
  };

  return (
    <div className="abyx-file-card-wrapper" style={{
      margin: "8px 0",
      borderRadius: "14px",
      border: "1px solid rgba(255, 255, 255, 0.08)",
      background: "#111215",
      overflow: "hidden",
      boxShadow: "0 2px 10px rgba(0, 0, 0, 0.25)",
      width: "100%",
      maxWidth: "760px"
    }}>
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "10px 16px",
        gap: "12px",
        flexWrap: "wrap"
      }}>
        {/* Left: Thumbnail Preview & Metadata */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0, flex: "1 1 240px" }}>
          {/* Badge: Sleek Image Icon */}
          <div 
            onClick={() => setShowFull(!showFull)}
            style={{
              width: "38px",
              height: "38px",
              borderRadius: "10px",
              background: "rgba(56, 189, 248, 0.08)",
              border: "1px solid rgba(56, 189, 248, 0.2)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              flexShrink: 0,
              transition: "all 0.15s ease"
            }}
            title="Click to toggle image preview"
          >
            <ImageIcon size={18} style={{ color: "#38bdf8" }} />
          </div>

          <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: "2px" }}>
            <div style={{
              fontSize: "13px",
              fontWeight: "600",
              color: "#f3f4f6",
              letterSpacing: "-0.01em",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap"
            }}>
              {cleanFilename}
            </div>
            <div style={{
              fontSize: "11px",
              color: "rgba(255, 255, 255, 0.45)",
              fontFamily: "'JetBrains Mono', monospace",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              display: "flex",
              alignItems: "center",
              gap: "6px"
            }}>
              <span>PNG</span>
              <span style={{ opacity: 0.35 }}>•</span>
              <span style={{ opacity: 0.85 }}>abyx/assets/{cleanFilename}</span>
            </div>
          </div>
        </div>

        {/* Right: Actions */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
          <button
            type="button"
            onClick={handleDownload}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              height: "32px",
              padding: "0 16px",
              borderRadius: "9999px",
              background: downloaded ? "#4ade80" : "#ffffff",
              color: downloaded ? "#052e16" : "#0f172a",
              fontSize: "12px",
              fontWeight: "600",
              border: "none",
              cursor: "pointer",
              transition: "all 0.15s ease",
              boxShadow: "0 1px 3px rgba(0, 0, 0, 0.2)"
            }}
            title="Download Image"
            onMouseEnter={(e) => {
              if (!downloaded) e.currentTarget.style.background = "#e2e8f0";
            }}
            onMouseLeave={(e) => {
              if (!downloaded) e.currentTarget.style.background = "#ffffff";
            }}
          >
            {downloaded ? <Check size={13} strokeWidth={2.6} /> : <Download size={13} strokeWidth={2.4} />}
            <span>{downloaded ? "Saved" : "Download"}</span>
          </button>

          <button
            type="button"
            onClick={handleReveal}
            disabled={revealing}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              height: "32px",
              padding: "0 14px",
              borderRadius: "9999px",
              background: revealed ? "rgba(74, 222, 128, 0.12)" : "rgba(255, 255, 255, 0.06)",
              color: revealed ? "#4ade80" : "#f1f5f9",
              fontSize: "12px",
              fontWeight: "500",
              border: revealed ? "1px solid rgba(74, 222, 128, 0.28)" : "1px solid rgba(255, 255, 255, 0.12)",
              cursor: revealing ? "wait" : "pointer",
              transition: "all 0.15s ease"
            }}
            title="Reveal in Windows Explorer"
            onMouseEnter={(e) => {
              if (!revealed) {
                e.currentTarget.style.background = "rgba(255, 255, 255, 0.12)";
                e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.2)";
              }
            }}
            onMouseLeave={(e) => {
              if (!revealed) {
                e.currentTarget.style.background = "rgba(255, 255, 255, 0.06)";
                e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.12)";
              }
            }}
          >
            {revealed ? <Check size={13} color="#4ade80" /> : <Folder size={13} />}
            <span>{revealed ? "Revealed" : revealing ? "Opening..." : "Reveal"}</span>
          </button>

          <button
            type="button"
            onClick={() => setShowFull(!showFull)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: "32px",
              height: "32px",
              borderRadius: "9999px",
              background: showFull ? "rgba(56, 189, 248, 0.15)" : "rgba(255, 255, 255, 0.06)",
              color: showFull ? "#38bdf8" : "#f1f5f9",
              border: showFull ? "1px solid rgba(56, 189, 248, 0.3)" : "1px solid rgba(255, 255, 255, 0.12)",
              cursor: "pointer",
              transition: "all 0.15s ease"
            }}
            title={showFull ? "Collapse preview" : "View preview"}
            onMouseEnter={(e) => {
              if (!showFull) {
                e.currentTarget.style.background = "rgba(255, 255, 255, 0.12)";
                e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.2)";
              }
            }}
            onMouseLeave={(e) => {
              if (!showFull) {
                e.currentTarget.style.background = "rgba(255, 255, 255, 0.06)";
                e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.12)";
              }
            }}
          >
            <Eye size={14} strokeWidth={2} />
          </button>
        </div>
      </div>

      {showFull && (
        <div style={{
          padding: "12px",
          borderTop: "1px solid rgba(255, 255, 255, 0.06)",
          background: "#08080a",
          display: "flex",
          justifyContent: "center"
        }}>
          <img 
            src={displaySrc} 
            alt={alt || "Generated Output"} 
            style={{
              maxWidth: "100%",
              maxHeight: "480px",
              borderRadius: "8px",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              objectFit: "contain"
            }} 
          />
        </div>
      )}
    </div>
  );
}

/**
 * Sleek Audio Player Card Renderer (Kokoro AI Speech)
 */
export function AudioBlockRenderer({ src, filename, duration, text }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const [progress, setProgress] = useState(0);
  const audioRef = useRef(null);

  const cleanFilename = filename || (src ? String(src).split("/").pop().split("\\").pop().split("?")[0] : "speech.wav");
  const displaySrc = src || `/tts-outputs/${encodeURIComponent(cleanFilename)}`;

  const togglePlay = () => {
    if (!audioRef.current) {
      audioRef.current = new Audio(displaySrc);
      audioRef.current.ontimeupdate = () => {
        if (audioRef.current && audioRef.current.duration) {
          setProgress(audioRef.current.currentTime / audioRef.current.duration);
        }
      };
      audioRef.current.onended = () => {
        setIsPlaying(false);
        setProgress(0);
      };
      audioRef.current.onerror = async () => {
        if (text && text.trim().length > 0) {
          try {
            const genRes = await fetch("/api/chat/quick-audio", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ text, filename: cleanFilename })
            });
            const genData = await genRes.json();
            if (genData?.ok && genData?.audio?.url) {
              audioRef.current.src = genData.audio.url;
              audioRef.current.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
              return;
            }
          } catch (_) {}
        }
        if (!audioRef.current.src.includes("/api/output-file")) {
          audioRef.current.src = `/api/output-file?filename=${encodeURIComponent(cleanFilename)}`;
          audioRef.current.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
        } else {
          setIsPlaying(false);
        }
      };
    }
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play().then(() => setIsPlaying(true)).catch(() => {
        if (audioRef.current) {
          audioRef.current.src = `/api/output-file?filename=${encodeURIComponent(cleanFilename)}`;
          audioRef.current.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
        }
      });
    }
  };

  const handleDownload = () => {
    try {
      const a = document.createElement("a");
      a.href = `/api/output-file?filename=${encodeURIComponent(cleanFilename)}`;
      a.download = cleanFilename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setDownloaded(true);
      setTimeout(() => setDownloaded(false), 2000);
    } catch (_) {}
  };

  const handleReveal = async () => {
    setRevealing(true);
    try {
      let res = await revealWorkspaceFile(`audio/${cleanFilename}`);
      if (!res || !res.ok) {
        res = await revealWorkspaceFile(cleanFilename);
      }
      if ((!res || !res.ok) && text) {
        try {
          const genRes = await fetch("/api/chat/quick-audio", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text, filename: cleanFilename })
          });
          const genData = await genRes.json();
          if (genData?.ok) {
            res = await revealWorkspaceFile(`audio/${cleanFilename}`);
          }
        } catch (_) {}
      }
      if (res && (res.ok || res.revealed)) {
        setRevealed(true);
        setTimeout(() => setRevealed(false), 2500);
      }
    } catch (_) {}
    finally {
      setRevealing(false);
    }
  };

  return (
    <div className="abyx-file-card-wrapper" style={{
      margin: "8px 0",
      borderRadius: "14px",
      border: "1px solid rgba(255, 255, 255, 0.08)",
      background: "#111215",
      overflow: "hidden",
      boxShadow: "0 2px 10px rgba(0, 0, 0, 0.25)",
      width: "100%",
      maxWidth: "760px"
    }}>
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "10px 16px",
        gap: "12px",
        flexWrap: "wrap"
      }}>
        {/* Left: Play/Pause & Info */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0, flex: "1 1 240px" }}>
          <button
            type="button"
            onClick={togglePlay}
            style={{
              width: "38px",
              height: "38px",
              borderRadius: "50%",
              background: isPlaying ? "rgba(34, 197, 94, 0.22)" : "rgba(34, 197, 94, 0.1)",
              color: "#22c55e",
              border: isPlaying ? "1px solid rgba(34, 197, 94, 0.45)" : "1px solid rgba(34, 197, 94, 0.22)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              flexShrink: 0,
              transition: "all 0.15s ease"
            }}
            title={isPlaying ? "Pause" : "Play Kokoro Audio"}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = isPlaying ? "rgba(34, 197, 94, 0.3)" : "rgba(34, 197, 94, 0.18)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = isPlaying ? "rgba(34, 197, 94, 0.22)" : "rgba(34, 197, 94, 0.1)";
            }}
          >
            {isPlaying ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" style={{ marginLeft: "2px" }} />}
          </button>

          <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: "2px", flex: 1 }}>
            <div style={{
              fontSize: "13px",
              fontWeight: "600",
              color: "#f3f4f6",
              letterSpacing: "-0.01em",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap"
            }}>
              {cleanFilename}
            </div>
            <div style={{
              fontSize: "11px",
              color: "rgba(255, 255, 255, 0.45)",
              fontFamily: "'JetBrains Mono', monospace",
              display: "flex",
              alignItems: "center",
              gap: "6px"
            }}>
              <span>WAV</span>
              <span style={{ opacity: 0.35 }}>•</span>
              <span>Kokoro AI</span>
              {duration ? <><span style={{ opacity: 0.35 }}>•</span><span>{duration}</span></> : null}
            </div>
            {/* Live playback bar */}
            {isPlaying && (
              <div style={{
                width: "100%",
                height: "2px",
                background: "rgba(255, 255, 255, 0.08)",
                borderRadius: "2px",
                marginTop: "4px",
                overflow: "hidden"
              }}>
                <div style={{
                  width: `${Math.round(progress * 100)}%`,
                  height: "100%",
                  background: "#22c55e",
                  transition: "width 0.1s linear"
                }} />
              </div>
            )}
          </div>
        </div>

        {/* Right: Actions */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
          <button
            type="button"
            onClick={handleDownload}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              height: "32px",
              padding: "0 16px",
              borderRadius: "9999px",
              background: downloaded ? "#4ade80" : "#ffffff",
              color: downloaded ? "#052e16" : "#0f172a",
              fontSize: "12px",
              fontWeight: "600",
              border: "none",
              cursor: "pointer",
              transition: "all 0.15s ease",
              boxShadow: "0 1px 3px rgba(0, 0, 0, 0.2)"
            }}
            title="Download Audio WAV"
            onMouseEnter={(e) => {
              if (!downloaded) e.currentTarget.style.background = "#e2e8f0";
            }}
            onMouseLeave={(e) => {
              if (!downloaded) e.currentTarget.style.background = "#ffffff";
            }}
          >
            {downloaded ? <Check size={13} strokeWidth={2.6} /> : <Download size={13} strokeWidth={2.4} />}
            <span>{downloaded ? "Saved" : "Download"}</span>
          </button>

          <button
            type="button"
            onClick={handleReveal}
            disabled={revealing}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              height: "32px",
              padding: "0 14px",
              borderRadius: "9999px",
              background: revealed ? "rgba(74, 222, 128, 0.12)" : "rgba(255, 255, 255, 0.06)",
              color: revealed ? "#4ade80" : "#f1f5f9",
              fontSize: "12px",
              fontWeight: "500",
              border: revealed ? "1px solid rgba(74, 222, 128, 0.28)" : "1px solid rgba(255, 255, 255, 0.12)",
              cursor: revealing ? "wait" : "pointer",
              transition: "all 0.15s ease"
            }}
            title="Reveal in Windows Explorer"
            onMouseEnter={(e) => {
              if (!revealed) {
                e.currentTarget.style.background = "rgba(255, 255, 255, 0.12)";
                e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.2)";
              }
            }}
            onMouseLeave={(e) => {
              if (!revealed) {
                e.currentTarget.style.background = "rgba(255, 255, 255, 0.06)";
                e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.12)";
              }
            }}
          >
            {revealed ? <Check size={13} color="#4ade80" /> : <Folder size={13} />}
            <span>{revealed ? "Revealed" : revealing ? "Opening..." : "Reveal"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function ensureFencedCode(content) {
  if (typeof content !== 'string') return '';
  if (content.includes('```')) return content;

  const text = content.trim();

  // Pattern 1: Check for path comment with code anywhere in text
  // e.g. <!-- path: index.html --> or // path: script.py or # path: main.py
  const fileCommentRegex = /(?:^|\n)((?:<!--|\/\/|#|\/\*)\s*(?:path|filename|file|name):\s*([a-zA-Z0-9_./-]+)\s*(?:-->|\*\/)?[\s\S]*)$/i;
  const commentMatch = text.match(fileCommentRegex);
  if (commentMatch && commentMatch[1]) {
    const filename = commentMatch[2];
    const ext = filename.split('.').pop().toLowerCase();

    // Media files (PNG, JPG, WAV, etc.) are NOT source code and must NEVER be wrapped in code blocks!
    const mediaExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp', 'tiff', 'wav', 'mp3', 'ogg', 'flac', 'm4a'];
    if (mediaExts.includes(ext)) {
      return text.replace(/(?:^|\n)(?:<!--|\/\/|#|\/\*)\s*(?:path|filename|file|name):\s*[a-zA-Z0-9_./-]+\.(?:png|jpe?g|gif|webp|ico|bmp|tiff|wav|mp3|ogg|flac|m4a)\s*(?:-->|\*\/)?/gi, "").trim();
    }

    const intro = text.slice(0, text.length - commentMatch[1].length).trim();
    const codePart = commentMatch[1].trim();
    const lang = (ext === 'html' || ext === 'htm') ? 'html' : (ext === 'js' ? 'javascript' : (ext === 'py' ? 'python' : ext));
    const fenced = `\`\`\`${lang}\n${codePart}\n\`\`\``;
    return intro ? `${intro}\n\n${fenced}` : fenced;
  }

  // Pattern 2: Check for raw HTML document anywhere in text (<!DOCTYPE html or <html)
  const htmlStart = text.search(/<!DOCTYPE html|<html/i);
  if (htmlStart !== -1) {
    const intro = text.slice(0, htmlStart).trim();
    const htmlBody = text.slice(htmlStart).trim();
    const fenced = `\`\`\`html\n${htmlBody}\n\`\`\``;
    return intro ? `${intro}\n\n${fenced}` : fenced;
  }

  // Pattern 3: Check for raw SVG
  if (text.startsWith('<svg') && text.includes('</svg>')) {
    return `\`\`\`svg\n${text}\n\`\`\``;
  }

  return content;
}

export function MarkdownRenderer({ content, onOpenBrowser, isComplete = true, userPrompt = "" }) {
  if (typeof content !== 'string') return null;

  const pLower = (userPrompt || "").toLowerCase();
  const isAudioIntent = /\b(?:generate|create|make|produce|synthesize|record|convert|turn)\s+(?:both\s+)?(?:an?\s+)?(?:audio|speech|voice|podcast|voiceover|narration|sound\s+clip|recording|spoken\s+word)\b|\b(?:convert|turn)\s+(?:[\w\s]{1,30})?\s*into\s+(?:an?\s+)?(?:audio|speech|voice|podcast)\b|\b(?:read\s+.*aloud|narrate|speak\s+this|speak\s+out\s+loud|text\s*to\s*speech|tts)\b/i.test(pLower);
  const isImageIntent = /\b(?:generate|create|make|draw|paint|render|illustrate|produce|design)\s+(?:both\s+)?(?:an?\s+)?(?:image|photo|picture|drawing|illustration|artwork|wallpaper|portrait|graphic|banner|logo|avatar|visual)\b|\b(?:draw\s+me|paint\s+me)\b/i.test(pLower);
  const asksBoth = (isAudioIntent && isImageIntent) || /\b(?:image\s+and\s+audio|audio\s+and\s+image|both\s+(?:an?\s+)?image\s+and\s+(?:an?\s+)?audio|picture\s+and\s+voice)\b/i.test(pLower);

  const audioOnly = (isAudioIntent && !isImageIntent) && !asksBoth;
  const imageOnly = (isImageIntent && !isAudioIntent) && !asksBoth;

  const normalizedContent = ensureFencedCode(content);
  const parts = normalizedContent.split(/(```[\s\S]*?```|\[AUDIO:\s*[\s\S]*?\]|\[IMAGE:\s*[\s\S]*?\]|\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\])/gi);
  const isTableSeparator = (line) => /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/.test(line.trim());
  const splitTableRow = (line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());

  return (
    <div className="markdown-body">
      {parts.map((part, index) => {
        if (!part) return null;
        if (part.length > 4 && part.startsWith("$$") && part.endsWith("$$")) {
          return <MathFormula key={index} tex={part.slice(2, -2).trim()} display />;
        }
        if (part.length > 4 && part.startsWith("\\[") && part.endsWith("\\]")) {
          return <MathFormula key={index} tex={part.slice(2, -2).trim()} display />;
        }
        if (part.startsWith("[AUDIO:") && part.endsWith("]")) {
          if (imageOnly) return null;
          const audioMatch = part.match(/\[AUDIO:\s*([\s\S]*?)\]/i);
          if (audioMatch) {
            const tagContent = audioMatch[1];
            const srcM = tagContent.match(/src="([^"]+)"/i);
            const nameM = tagContent.match(/(?:filename|name)="([^"]+)"/i);
            const durM = tagContent.match(/duration="([^"]+)"/i);
            const textM = tagContent.match(/text="([^"]+)"/i);
            const fname = nameM ? nameM[1].split("/").pop().split("\\").pop() : "speech.wav";
            const audioSrc = srcM ? srcM[1] : `/tts-outputs/${encodeURIComponent(fname)}`;
            return (
              <AudioBlockRenderer
                key={index}
                src={audioSrc}
                filename={fname}
                duration={durM ? durM[1] : ""}
                text={textM ? textM[1] : ""}
              />
            );
          }
        }
        if (part.startsWith("[IMAGE:") && part.endsWith("]")) {
          if (audioOnly) return null;
          const imgMatch = part.match(/\[IMAGE:\s*([\s\S]*?)\]/i);
          if (imgMatch) {
            const tagContent = imgMatch[1];
            const pM = tagContent.match(/prompt="([^"]+)"/i);
            const fM = tagContent.match(/(?:filename|name)="([^"]+)"/i);
            const fname = fM ? fM[1].split("/").pop().split("\\").pop() : "image.png";
            return (
              <ImageBlockRenderer
                key={index}
                src={`/api/output-file?filename=${encodeURIComponent(fname)}`}
                alt={pM ? pM[1] : ""}
                filename={fname}
              />
            );
          }
        }
        if (part.startsWith("```")) {
          if (!isComplete) {
            return null;
          }
          let lang = "";
          let code = "";
          if (part.endsWith("```")) {
            const match = part.match(/```(\w*)\n([\s\S]*?)```/);
            lang = match ? match[1] : "";
            code = match ? match[2] : part.slice(3, -3);
          } else {
            const match = part.match(/```(\w*)\n?([\s\S]*)/);
            lang = match ? match[1] : "";
            code = match ? match[2] : part.slice(3);
          }
          const isMediaFence = /\.(?:png|jpe?g|webp|gif|ico|bmp|tiff|wav|mp3|ogg|flac|m4a)$/i.test(lang) ||
            ["png", "jpg", "jpeg", "webp", "gif", "ico", "bmp", "tiff", "wav", "mp3", "ogg", "flac"].includes(lang.toLowerCase().trim()) ||
            code.includes("<img") || code.includes("[IMAGE:") || code.includes("[AUDIO:") || code.includes("data-generate=") || code.includes("data-prompt=");
          if (isMediaFence) {
            return null;
          }
          return (
            <CodeBlockRenderer
              key={index}
              code={code}
              lang={lang}
              onOpenBrowser={onOpenBrowser}
              isComplete={isComplete}
              userPrompt={userPrompt}
            />
          );
        } else {
          const rawLines = part.split(/\r?\n/);
          const blocks = [];
          let currentBlock = null;

          for (let i = 0; i < rawLines.length; i++) {
            const line = rawLines[i];
            const trimmed = line.trim();

            if (trimmed.startsWith("|") && i + 1 < rawLines.length && isTableSeparator(rawLines[i + 1])) {
              if (currentBlock) { blocks.push(currentBlock); currentBlock = null; }
              const header = splitTableRow(line);
              const rows = [];
              i += 2;
              while (i < rawLines.length && rawLines[i].trim().startsWith("|")) {
                rows.push(splitTableRow(rawLines[i]));
                i += 1;
              }
              i -= 1;
              blocks.push({ type: "table", header, rows });
            } else if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
              if (currentBlock) { blocks.push(currentBlock); currentBlock = null; }
              blocks.push({ type: "hr" });
            } else if (/^!\[(.*?)\]\((.*?)\)$/.test(trimmed)) {
              if (currentBlock) { blocks.push(currentBlock); currentBlock = null; }
              if (!audioOnly) {
                const m = trimmed.match(/^!\[(.*?)\]\((.*?)\)$/);
                blocks.push({ type: "image_card", alt: m[1], src: m[2] });
              }
            } else if (/\[AUDIO:\s*[\s\S]*?\]/i.test(trimmed)) {
              if (currentBlock) { blocks.push(currentBlock); currentBlock = null; }
              if (!imageOnly) {
                const audioMatch = trimmed.match(/\[AUDIO:\s*([\s\S]*?)\]/i);
                if (audioMatch) {
                  const tagContent = audioMatch[1];
                  const srcM = tagContent.match(/src="([^"]+)"/i);
                  const nameM = tagContent.match(/(?:filename|name)="([^"]+)"/i);
                  const durM = tagContent.match(/duration="([^"]+)"/i);
                  const textM = tagContent.match(/text="([^"]+)"/i);
                  const fname = nameM ? nameM[1].split("/").pop().split("\\").pop() : "speech.wav";
                  const audioSrc = srcM ? srcM[1] : `/tts-outputs/${encodeURIComponent(fname)}`;
                  if (!blocks.some(b => b.type === "audio_card" && b.filename === fname)) {
                    blocks.push({
                      type: "audio_card",
                      src: audioSrc,
                      filename: fname,
                      duration: durM ? durM[1] : "",
                      text: textM ? textM[1] : ""
                    });
                  }
                  const remainingText = trimmed.replace(/\[AUDIO:\s*[\s\S]*?\]/i, "").trim();
                  if (remainingText) {
                    blocks.push({ type: "p", lines: [remainingText] });
                  }
                }
              }
            } else if (/^\[IMAGE:\s*prompt="([^"]+)".*?\]$/i.test(trimmed)) {
              if (currentBlock) { blocks.push(currentBlock); currentBlock = null; }
              if (!audioOnly) {
                const pM = trimmed.match(/prompt="([^"]+)"/i);
                const fM = trimmed.match(/filename="([^"]+)"/i);
                const fname = fM ? fM[1].split("/").pop().split("\\").pop() : "image.png";
                if (!blocks.some(b => b.type === "image_card" && b.filename === fname)) {
                  blocks.push({ type: "image_card", alt: pM ? pM[1] : "", src: `/api/output-file?filename=${encodeURIComponent(fname)}`, filename: fname });
                }
              }
            } else if (/<img\s+[^>]*src=["'](?:assets\/)?([^"']+)["'][^>]*>/i.test(trimmed)) {
              if (currentBlock) { blocks.push(currentBlock); currentBlock = null; }
              if (!audioOnly) {
                const m = trimmed.match(/<img\s+[^>]*src=["'](?:assets\/)?([^"']+)["'][^>]*>/i);
                const altM = trimmed.match(/alt=["']([^"']+)["']/i);
                const dataGenM = trimmed.match(/data-generate=["']([^"']+)["']/i);
                const fname = m ? m[1].split("/").pop().split("\\").pop() : "image.png";
                if (!blocks.some(b => b.type === "image_card" && b.filename === fname)) {
                  blocks.push({
                    type: "image_card",
                    alt: altM ? altM[1] : (dataGenM ? dataGenM[1] : "Generated image"),
                    src: `/api/output-file?filename=${encodeURIComponent(fname)}`,
                    filename: fname
                  });
                }
              }
            } else if (/^<!--\s*path:\s*[^>]+\s*-->$/i.test(trimmed)) {
              // Ignore path comments in rendered markdown text
              continue;
            } else if (trimmed.startsWith(">")) {
              const quoteLine = trimmed.replace(/^>\s?/, "");
              if (currentBlock && currentBlock.type === "quote") {
                currentBlock.lines.push(quoteLine);
              } else {
                if (currentBlock) { blocks.push(currentBlock); }
                currentBlock = { type: "quote", lines: [quoteLine] };
              }
            } else if (trimmed.startsWith("### ")) {
              if (currentBlock) { blocks.push(currentBlock); currentBlock = null; }
              blocks.push({ type: "h4", content: trimmed.slice(4) });
            } else if (trimmed.startsWith("## ")) {
              if (currentBlock) { blocks.push(currentBlock); currentBlock = null; }
              blocks.push({ type: "h3", content: trimmed.slice(3) });
            } else if (trimmed.startsWith("# ")) {
              if (currentBlock) { blocks.push(currentBlock); currentBlock = null; }
              blocks.push({ type: "h2", content: trimmed.slice(2) });
            } else if (trimmed.startsWith("* ") || trimmed.startsWith("- ")) {
              const itemContent = trimmed.slice(2);
              if (currentBlock && currentBlock.type === "ul") {
                currentBlock.items.push(itemContent);
              } else {
                if (currentBlock) { blocks.push(currentBlock); }
                currentBlock = { type: "ul", items: [itemContent] };
              }
            } else {
              const numMatch = trimmed.match(/^(\d+)\.\s+(.*)/);
              if (numMatch) {
                const itemContent = numMatch[2];
                if (currentBlock && currentBlock.type === "ol") {
                  currentBlock.items.push(itemContent);
                } else {
                  if (currentBlock) { blocks.push(currentBlock); }
                  currentBlock = { type: "ol", items: [itemContent] };
                }
              } else if (trimmed === "") {
                if (currentBlock) { blocks.push(currentBlock); currentBlock = null; }
              } else {
                if (currentBlock && currentBlock.type === "p") {
                  currentBlock.lines.push(line);
                } else {
                  if (currentBlock) { blocks.push(currentBlock); }
                  currentBlock = { type: "p", lines: [line] };
                }
              }
            }
          }
          if (currentBlock) {
            blocks.push(currentBlock);
          }

          return blocks.map((block, blockIdx) => {
            switch (block.type) {
              case "image_card":
                return <ImageBlockRenderer key={blockIdx} src={block.src} alt={block.alt} filename={block.filename} />;
              case "audio_card":
                return <AudioBlockRenderer key={blockIdx} src={block.src} filename={block.filename} duration={block.duration} />;
              case "h4":
                return <h4 key={blockIdx}>{parseInlineMarkdown(block.content)}</h4>;
              case "h3":
                return <h3 key={blockIdx}>{parseInlineMarkdown(block.content)}</h3>;
              case "h2":
                return <h2 key={blockIdx}>{parseInlineMarkdown(block.content)}</h2>;
              case "ul":
                return (
                  <ul key={blockIdx}>
                    {block.items.map((item, itemIdx) => (
                      <li key={itemIdx}>{parseInlineMarkdown(item)}</li>
                    ))}
                  </ul>
                );
              case "ol":
                return (
                  <ol key={blockIdx}>
                    {block.items.map((item, itemIdx) => (
                      <li key={itemIdx}>{parseInlineMarkdown(item)}</li>
                    ))}
                  </ol>
                );
              case "table":
                return (
                  <div key={blockIdx} className="chat-table-wrap">
                    <table className="chat-table">
                      <thead>
                        <tr>{block.header.map((cell, cellIdx) => <th key={cellIdx}>{parseInlineMarkdown(cell)}</th>)}</tr>
                      </thead>
                      <tbody>
                        {block.rows.map((row, rowIdx) => (
                          <tr key={rowIdx}>
                            {block.header.map((_, cellIdx) => <td key={cellIdx}>{parseInlineMarkdown(row[cellIdx] || "")}</td>)}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              case "hr":
                return <hr key={blockIdx} />;
              case "quote":
                return <blockquote key={blockIdx}>{parseInlineMarkdown(block.lines.join(" "))}</blockquote>;
              case "p": {
                // A lone bold line such as "**Analysis:**" acts as a section label, so it gets heading spacing
                const isSectionLabel = block.lines.length === 1 && /^[^\w*]*\*\*[^*]+\*\*:?$/u.test(block.lines[0].trim());
                // Keep the model's single line breaks (addresses, emails, poems)
                return (
                  <p key={blockIdx} className={isSectionLabel ? "md-section-label" : undefined}>
                    {block.lines.map((line, lineIdx) => (
                      <React.Fragment key={lineIdx}>
                        {lineIdx > 0 && <br />}
                        {parseInlineMarkdown(line.trim())}
                      </React.Fragment>
                    ))}
                  </p>
                );
              }
              default:
                return null;
            }
          });
        }
      })}
    </div>
  );
}

export default TextChat;
