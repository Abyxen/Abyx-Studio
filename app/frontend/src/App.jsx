import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import Sidebar from "./components/Sidebar";
import CommandPalette from "./components/CommandPalette";
import TopStatusBar from "./components/TopStatusBar";
import Generator from "./components/Generator";
import ModelManager from "./components/ModelManager";
import Settings from "./components/Settings";
import TextChat from "./components/TextChat";
import SpeechTranscriber from "./components/SpeechTranscriber";
import TextToSpeech from "./components/TextToSpeech";
import VideoGenerator from "./components/VideoGenerator";
import InsideBrowser from "./components/InsideBrowser";
import HarnessManager from "./components/HarnessManager";
import { cleanupCandidates, formatBytes, getCleanupCandidates, getDiagnostics, getHardwareSpecs, getHealth, getTelemetry, getBackendOptions, getBackendStatus, listGeneratedOutputs, listLlmConversations, saveLlmConversation, deleteLlmConversation, listSpeechTranscriptions, deleteSpeechTranscription, listTtsOutputs, deleteTtsOutput, getWorkspaces } from "./services/api";
import "./App.css";

// Screens live in the URL hash (#/chat, #/chat/<id>, #/images, ...) so a refresh
// reopens the same screen and the browser's back/forward buttons work.
const ROUTE_TO_TAB = {
  chat: "chat",
  images: "generator",
  video: "video",
  transcribe: "speech",
  voice: "tts",
  models: "models",
  harness: "harness",
  agent: "harness",
  skills: "harness",
  settings: "settings",
  providers: "settings",
  projects: "settings",
  usage: "settings",
};
const TAB_TO_ROUTE = {
  chat: "chat",
  generator: "images",
  video: "video",
  speech: "transcribe",
  tts: "voice",
  models: "models",
  harness: "harness",
  settings: "settings",
};

function readRoute() {
  const [route, id] = window.location.hash.replace(/^#\/?/, "").split("/");
  let section = null;
  if (route === "providers" || route === "projects" || route === "usage") {
    section = route;
    try {
      localStorage.setItem("settings_active_section", route);
    } catch (_) {}
  }
  const tab = ROUTE_TO_TAB[route] || "chat";
  const conversationId = tab === "chat" && id ? decodeURIComponent(id) : null;
  return { tab, conversationId, section };
}

function routeHash(tab, conversationId) {
  const route = TAB_TO_ROUTE[tab] || "chat";
  return tab === "chat" && conversationId ? `#/${route}/${encodeURIComponent(conversationId)}` : `#/${route}`;
}

function App() {
  const dialogResolverRef = useRef(null);
  const [dialog, setDialog] = useState(null);

  const closeDialog = useCallback((value) => {
    const resolver = dialogResolverRef.current;
    dialogResolverRef.current = null;
    setDialog(null);
    if (resolver) resolver(value);
  }, []);

  const showConfirm = useCallback(({ title = "Confirm Action", message, confirmLabel = "OK", cancelLabel = "Cancel", danger = false }) => {
    return new Promise((resolve) => {
      dialogResolverRef.current = resolve;
      setDialog({ type: "confirm", title, message, confirmLabel, cancelLabel, danger });
    });
  }, []);

  const showAlert = useCallback(({ title = "Notice", message, confirmLabel = "OK", danger = false }) => {
    return new Promise((resolve) => {
      dialogResolverRef.current = resolve;
      setDialog({ type: "alert", title, message, confirmLabel, danger });
    });
  }, []);

  // Theme State
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem("theme");
    if (saved) return saved;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  }, [theme]);

  // Navigation
  const [activeTab, setActiveTab] = useState(() => readRoute().tab);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState(() => readRoute().section || localStorage.getItem("settings_active_section") || "appearance");

  useEffect(() => {
    const onKeyDown = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandPaletteOpen((open) => !open);
      }
      if (event.key === "Escape") setCommandPaletteOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Prompts
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");

  // Model & Server Status
  const [activeModel, setActiveModel] = useState(null);
  const [serverRunning, setServerRunning] = useState(false);
  const [isLlmLoaded, setIsLlmLoaded] = useState(false);
  const [backendOptions, setBackendOptions] = useState({
    options: [{ id: "cpu", label: "CPU", available: true }],
    cudaAvailable: false,
    vulkanAvailable: false,
    defaultBackendType: "cpu",
  });
  const [health, setHealth] = useState(null);
  const [cleanupItems, setCleanupItems] = useState([]);
  const [isReadinessBusy, setIsReadinessBusy] = useState(false);
  const [diagnosticsCopied, setDiagnosticsCopied] = useState(false);
  const [activeProject, setActiveProject] = useState(null);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [browserUrl, setBrowserUrl] = useState("local://index.html");

  const handleOpenBrowser = useCallback((url) => {
    if (url) setBrowserUrl(url);
    setBrowserOpen(true);
  }, []);

  const handleToggleBrowser = useCallback(() => {
    setBrowserOpen((open) => !open);
  }, []);

  useEffect(() => {
    window.openInsideBrowser = handleOpenBrowser;
    return () => {
      delete window.openInsideBrowser;
    };
  }, [handleOpenBrowser]);

  useEffect(() => {
    getWorkspaces().then((data) => {
      if (data?.ok && data.activeProject) {
        setActiveProject(data.activeProject);
      }
    }).catch(() => {});
  }, []);

  // Gallery History
  const [generatedImages, setGeneratedImages] = useState([]);

  // Generation status
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);

  // System Specifications & Telemetry
  const [specs, setSpecs] = useState({
    os_name: "Loading Specs...",
    cpu_name: "Loading Specs...",
    cpu_cores_physical: 4,
    cpu_cores_logical: 8,
    ram_total_gb: 0,
    gpu_name: "Loading Specs...",
  });

  const [telemetry, setTelemetry] = useState({
    cpu_usage: 0,
    ram_used_gb: 0,
    ram_total_gb: 0,
    gpu_name: "Detecting...",
    vram_used_gb: 0,
    vram_total_gb: 0,
  });

  // Default Image Constraints
  const [constraints, setConstraints] = useState({
    width: 1024,
    height: 1024,
    steps: 60,
    npuSteps: 60,
    standardSteps: 60,
    cfgScale: 1.0,     // Recommended default CFG for Flux.1 Schnell
    sampler: "euler_a",
    seed: -1,
    denoisingStrength: 0.7,
    useGpu: true,
    useTaesd: true,
    useFlashAttn: true,
    useTiling: false,
    vaeTiling: true,
    vaeOnCpu: false,
    threads: 4,
    backendType: "auto",
  });

  const [textSettings, setTextSettings] = useState(() => {
    const saved = localStorage.getItem("textSettings");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return {
          ...parsed,
          enableThinking: parsed.enableThinking === true,
          maxTokens: !parsed.maxTokens || parsed.maxTokens < 8192 ? 16384 : parsed.maxTokens,
          responseTokenMode: parsed.responseTokenMode || "auto",
        };
      } catch (_) {}
    }
    return {
      contextSize: 0,
      temperature: 0.7,
      systemPrompt: "You are a helpful local AI assistant.",
      threads: Math.max(4, Math.min(16, (navigator.hardwareConcurrency || 4) - 2)),
      enableThinking: false,
      // New performance settings
      gpuLayers: -1,
      maxTokens: 16384,
      responseTokenMode: "auto",
      topP: 0.95,
      topK: 40,
      minP: 0.05,
      repeatPenalty: 1.1,
      seed: null,
      performanceProfile: "balanced",
      flashAttn: true,
      cacheTypeK: "q8_0",
      cacheTypeV: "q8_0",
      mlock: false,
      mmap: true,
      cachePrompt: true,
      defragThold: 0.1,
      batchSize: 512,
      ubatchSize: 512,
      preferredBackend: "auto",
    };
  });

  useEffect(() => {
    localStorage.setItem("textSettings", JSON.stringify(textSettings));
  }, [textSettings]);

  const [speechSettings, setSpeechSettings] = useState(() => {
    const saved = localStorage.getItem("speechSettings");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return {
          language: parsed.language || "auto",
          threads: Math.max(1, Math.min(32, Number(parsed.threads) || Math.max(1, Math.min(8, navigator.hardwareConcurrency || 4)))),
          backendPreference: ["auto", "vulkan", "metal", "cpu"].includes(parsed.backendPreference) ? parsed.backendPreference : "auto",
          translate: parsed.translate === true,
        };
      } catch (_) {}
    }
    return {
      language: "auto",
      threads: Math.max(1, Math.min(8, navigator.hardwareConcurrency || 4)),
      backendPreference: "auto",
      translate: false,
    };
  });

  useEffect(() => {
    localStorage.setItem("speechSettings", JSON.stringify(speechSettings));
  }, [speechSettings]);

  const [ttsSettings, setTtsSettings] = useState(() => {
    const saved = localStorage.getItem("ttsSettings");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return {
          model: parsed.model || "",
          voice: parsed.voice || "af_heart",
          speed: Math.max(0.5, Math.min(2, Number(parsed.speed) || 1)),
        };
      } catch (_) {}
    }
    return {
      model: "",
      voice: "af_heart",
      speed: 1,
    };
  });

  useEffect(() => {
    localStorage.setItem("ttsSettings", JSON.stringify(ttsSettings));
  }, [ttsSettings]);

  // Lifted Chat History States
  const [conversations, setConversations] = useState([]);
  const [activeConversationId, setActiveConversationId] = useState(() => readRoute().conversationId);

  // Keep the URL in step with the screen; the first sync replaces the entry so the
  // initial load doesn't add an extra back-button step
  useEffect(() => {
    const hash = routeHash(activeTab, activeConversationId);
    if (window.location.hash === hash) return;
    if (!window.location.hash) {
      window.history.replaceState(null, "", hash);
    } else {
      window.location.hash = hash;
    }
  }, [activeTab, activeConversationId]);

  useEffect(() => {
    const handleHashChange = () => {
      const { tab, conversationId, section } = readRoute();
      setActiveTab(tab);
      if (section) setSettingsSection(section);
      if (tab === "chat") setActiveConversationId(conversationId);
    };
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);
  const [sidebarVisible, setSidebarVisible] = useState(() => {
    const saved = localStorage.getItem("sidebarVisible");
    return saved !== "false";
  });

  useEffect(() => {
    localStorage.setItem("sidebarVisible", String(sidebarVisible));
  }, [sidebarVisible]);

  const [fontSize, setFontSize] = useState(() => {
    const saved = localStorage.getItem("fontSize");
    return saved ? Number(saved) : 16;
  });

  useEffect(() => {
    document.documentElement.style.setProperty("--app-font-size", `${fontSize}px`);
    localStorage.setItem("fontSize", String(fontSize));
  }, [fontSize]);
  const [speechTranscriptions, setSpeechTranscriptions] = useState([]);
  const [selectedSpeechTranscript, setSelectedSpeechTranscript] = useState(null);
  const [ttsOutputs, setTtsOutputs] = useState([]);
  const [selectedTtsOutput, setSelectedTtsOutput] = useState(null);

  const sanitizeMessageForStorage = (message) => {
    if (!Array.isArray(message?.content)) return message;
    return {
      ...message,
      content: message.content.map((item) => {
        if (item?.type !== "image_url") return item;
        return {
          type: "text",
          text: "[Attached image omitted from saved chat history]",
        };
      }),
    };
  };

  const sanitizeConversationForStorage = (conversation) => ({
    ...conversation,
    messages: Array.isArray(conversation.messages)
      ? conversation.messages.map(sanitizeMessageForStorage)
      : [],
  });

  const persistConversation = (conversation) => {
    const compactConversation = sanitizeConversationForStorage(conversation);
    try {
      saveLlmConversation(compactConversation).catch((err) => {
        console.warn("Could not save chat history to app folder:", err);
      });
    } catch (err) {
      console.warn("Could not save chat history:", err);
    }
  };

  useEffect(() => {
    let cancelled = false;
    async function loadConversations() {
      let legacyConversations = [];
      const legacySaved = localStorage.getItem("chat_conversations");
      if (legacySaved) {
        try {
          legacyConversations = JSON.parse(legacySaved);
        } catch (_) {
          localStorage.removeItem("chat_conversations");
        }
      }

      try {
        const diskConversations = await listLlmConversations();
        const diskIds = new Set(diskConversations.map((conversation) => conversation.id));
        const missingLegacy = legacyConversations
          .map(sanitizeConversationForStorage)
          .filter((conversation) => conversation.id && !diskIds.has(conversation.id));

        if (missingLegacy.length > 0) {
          await Promise.all(missingLegacy.map((conversation) => saveLlmConversation(conversation)));
        }

        const merged = [...diskConversations, ...missingLegacy]
          .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
        if (!cancelled) setConversations(merged);
        if (legacySaved) localStorage.removeItem("chat_conversations");
      } catch (err) {
        console.warn("Could not load chat history from app folder:", err);
        if (!cancelled && legacyConversations.length > 0) {
          setConversations(legacyConversations.map(sanitizeConversationForStorage));
        }
      }
    }
    loadConversations();
    return () => {
      cancelled = true;
    };
  }, []);

  const saveConversationState = useCallback((id, msgs, modelName, newTitle = null) => {
    setConversations((prev) => {
      const list = [...prev];
      const idx = list.findIndex(c => c.id === id);
      let conversation;
      if (idx !== -1) {
        conversation = {
          ...list[idx],
          messages: msgs,
          timestamp: Date.now(),
          model: modelName,
          ...(newTitle ? { title: newTitle } : {})
        };
        list[idx] = conversation;
      } else {
        conversation = {
          id,
          title: newTitle || "Chat Session",
          model: modelName,
          messages: msgs,
          timestamp: Date.now()
        };
        list.unshift(conversation);
      }
      persistConversation(conversation);
      return list;
    });
  }, []);

  const handleDeleteConversation = useCallback((id, e) => {
    if (e) e.stopPropagation();
    setConversations((prev) => {
      const filtered = prev.filter((c) => c.id !== id);
      return filtered;
    });
    deleteLlmConversation(id).catch((err) => {
      console.warn("Could not delete chat history from app folder:", err);
    });
    if (activeConversationId === id) {
      setActiveConversationId(null);
    }
  }, [activeConversationId]);

  const handleRenameConversation = useCallback((id, newTitle) => {
    if (!newTitle || !newTitle.trim()) return;
    setConversations((prev) => {
      const list = [...prev];
      const idx = list.findIndex(c => c.id === id);
      if (idx !== -1) {
        const updated = { ...list[idx], title: newTitle.trim(), timestamp: Date.now() };
        list[idx] = updated;
        persistConversation(updated);
      }
      return list;
    });
  }, []);

  const handleTogglePinConversation = useCallback((id, e) => {
    if (e) e.stopPropagation();
    setConversations((prev) => {
      const list = [...prev];
      const idx = list.findIndex(c => c.id === id);
      if (idx !== -1) {
        const updated = { ...list[idx], pinned: !list[idx].pinned };
        list[idx] = updated;
        persistConversation(updated);
      }
      return list;
    });
  }, []);

  const handleExportConversation = useCallback((id, format = "md", e) => {
    if (e) e.stopPropagation();
    setConversations((prev) => {
      const conv = prev.find(c => c.id === id);
      if (!conv) return prev;
      const titleClean = (conv.title || "conversation").replace(/[^a-zA-Z0-9_-]/g, "_");

      if (format === "json") {
        const blob = new Blob([JSON.stringify(conv, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${titleClean}.json`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        const mdContent = `# ${conv.title || "Conversation"}\n\n` +
          (conv.messages || []).map(m => `### ${m.role === "user" ? "User" : "Assistant"}\n\n${typeof m.content === "string" ? m.content : JSON.stringify(m.content)}\n`).join("\n---\n\n");
        const blob = new Blob([mdContent], { type: "text/markdown" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${titleClean}.md`;
        a.click();
        URL.revokeObjectURL(url);
      }
      return prev;
    });
  }, []);

  const refreshSpeechTranscriptions = useCallback(async () => {
    try {
      const list = await listSpeechTranscriptions();
      setSpeechTranscriptions(list);
    } catch (err) {
      console.warn("Could not load speech transcriptions:", err);
      setSpeechTranscriptions([]);
    }
  }, []);

  const handleDeleteSpeechTranscription = useCallback(async (item, e) => {
    if (e) e.stopPropagation();
    const itemId = item.filename || item.metadata || item.textFile;
    if (!itemId) return;

    const ok = await showConfirm({
      title: "Delete Transcription",
      message: `Are you sure you want to delete "${item.displayName || item.sourceFilename || "this transcription"}"? This action cannot be undone.`,
      confirmLabel: "Delete",
      danger: true
    });
    if (!ok) return;

    try {
      await deleteSpeechTranscription(itemId);
      
      setSelectedSpeechTranscript((prev) => {
        if (prev) {
          const prevId = prev.filename || prev.metadata || prev.textFile;
          if (prevId === itemId) return null;
        }
        return prev;
      });

      refreshSpeechTranscriptions();
    } catch (err) {
      console.error("Failed to delete speech transcription:", err);
      showAlert({ title: "Delete Failed", message: err.message || String(err), danger: true });
    }
  }, [showConfirm, showAlert, setSelectedSpeechTranscript, refreshSpeechTranscriptions]);

  useEffect(() => {
    refreshSpeechTranscriptions();
  }, [refreshSpeechTranscriptions]);

  const refreshTtsOutputs = useCallback(async () => {
    try {
      const list = await listTtsOutputs();
      setTtsOutputs(list);
    } catch (err) {
      console.warn("Could not load TTS outputs:", err);
      setTtsOutputs([]);
    }
  }, []);

  const handleDeleteTtsOutput = useCallback(async (item, e) => {
    if (e) e.stopPropagation();
    const itemId = item.filename || item.metadata;
    if (!itemId) return;

    const ok = await showConfirm({
      title: "Delete TTS Output",
      message: `Are you sure you want to delete "${item.displayName || item.audioFile || "this audio"}"? This action cannot be undone.`,
      confirmLabel: "Delete",
      danger: true
    });
    if (!ok) return;

    try {
      await deleteTtsOutput(itemId);
      setSelectedTtsOutput((prev) => {
        if (prev) {
          const prevId = prev.filename || prev.metadata;
          if (prevId === itemId) return null;
        }
        return prev;
      });
      refreshTtsOutputs();
    } catch (err) {
      console.error("Failed to delete TTS output:", err);
      showAlert({ title: "Delete Failed", message: err.message || String(err), danger: true });
    }
  }, [showConfirm, showAlert, refreshTtsOutputs]);

  useEffect(() => {
    refreshTtsOutputs();
  }, [refreshTtsOutputs]);

  // Load hardware specifications on mount
  useEffect(() => {
    async function loadSpecs() {
      try {
        const hardware = await getHardwareSpecs();
        const backendInfo = await getBackendOptions();
        setBackendOptions(backendInfo);
        setSpecs(hardware);
        // Default CPU threads count to match physical cores
        setConstraints((prev) => ({
          ...prev,
          threads: hardware.cpu_cores_physical || 4,
          backendType: prev.backendType === "auto" ? backendInfo.defaultBackendType || "cpu" : prev.backendType,
          useGpu: (prev.backendType === "auto" ? backendInfo.defaultBackendType : prev.backendType) !== "cpu",
        }));
        setTextSettings((prev) => ({
          ...prev,
          threads: prev.threads || hardware.cpu_cores_physical || 4
        }));
      } catch (err) {
        console.error("Error fetching hardware specs:", err);
      }
    }
    loadSpecs();
  }, []);

  const refreshReadiness = useCallback(async () => {
    setIsReadinessBusy(true);
    try {
      const [healthInfo, candidates] = await Promise.all([
        getHealth(),
        getCleanupCandidates().catch(() => []),
      ]);
      setHealth(healthInfo);
      setCleanupItems(candidates);
    } finally {
      setIsReadinessBusy(false);
    }
  }, []);

  useEffect(() => {
    refreshReadiness();
  }, [refreshReadiness]);

  const copyDiagnostics = useCallback(async () => {
    try {
      const diagnostics = await getDiagnostics();
      await navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2));
      setDiagnosticsCopied(true);
      setTimeout(() => setDiagnosticsCopied(false), 1800);
    } catch (err) {
      showAlert({ title: "Diagnostics Failed", message: err.message || String(err), danger: true });
    }
  }, [showAlert]);

  const cleanupSafeItems = useCallback(async () => {
    if (cleanupItems.length === 0) return;
    const totalBytes = cleanupItems.reduce((sum, item) => sum + Number(item.sizeBytes || 0), 0);
    const ok = await showConfirm({
      title: "Clean Safe Files?",
      message: `Delete ${cleanupItems.length} temporary/cache item${cleanupItems.length === 1 ? "" : "s"} and free about ${formatBytes(totalBytes)}?\n\nModels and generated outputs are not included.`,
      confirmLabel: "Clean",
      danger: true,
    });
    if (!ok) return;

    setIsReadinessBusy(true);
    try {
      await cleanupCandidates(cleanupItems.map((item) => item.id));
      await refreshReadiness();
    } catch (err) {
      showAlert({ title: "Cleanup Failed", message: err.message || String(err), danger: true });
    } finally {
      setIsReadinessBusy(false);
    }
  }, [cleanupItems, refreshReadiness, showAlert, showConfirm]);

  useEffect(() => {
    async function loadSavedOutputs() {
      const outputs = await listGeneratedOutputs();
      setGeneratedImages(outputs);
    }
    loadSavedOutputs();
  }, []);

  // Save active model configuration to localStorage for persistence across reloads
  useEffect(() => {
    if (activeModel) {
      localStorage.setItem("active-model", activeModel);
    } else {
      localStorage.removeItem("active-model");
    }
  }, [activeModel]);

  // Check if server is already running on mount (handles page refresh and startup lag)
  useEffect(() => {
    let checkInterval = null;

    async function checkServerRunning() {
      const status = await getBackendStatus();
      const isRunning = Boolean(status.ready);
      if (isRunning) {
        if (checkInterval) clearInterval(checkInterval);

        const savedModel = localStorage.getItem("active-model");
        if (savedModel) {
          setActiveModel(savedModel);
          setServerRunning(true);
        } else {
          // Query the active model from status if possible, otherwise use fallback
          try {
            if (status && status.settings && status.settings.model) {
              const modelName = status.settings.model.split(/[\\/]/).pop();
              setActiveModel(modelName);
            }
          } catch (_) {}
          setServerRunning(true);
        }
      } else {
        // If server is not running, check if they had a simulated model active in browser mode
        const isTauriDesktop = typeof window !== "undefined" && window.__TAURI_INTERNALS__ !== undefined;
        if (!isTauriDesktop) {
          const savedModel = localStorage.getItem("active-model");
          if (savedModel) {
            setActiveModel(savedModel);
            setServerRunning(false);
          }
        }
      }
    }

    checkServerRunning();
    // Poll every 2 seconds to auto-detect when the backend becomes ready
    checkInterval = setInterval(checkServerRunning, 2000);

    return () => {
      if (checkInterval) clearInterval(checkInterval);
    };
  }, []);

  // Poll system telemetry usage statistics on interval
  useEffect(() => {
    async function updateTelemetry() {
      try {
        const stats = await getTelemetry();
        setTelemetry((prev) => (
          prev.cpu_usage === stats.cpu_usage &&
          prev.ram_used_gb === stats.ram_used_gb &&
          prev.ram_total_gb === stats.ram_total_gb &&
          prev.gpu_name === stats.gpu_name &&
          prev.vram_used_gb === stats.vram_used_gb &&
          prev.vram_total_gb === stats.vram_total_gb
            ? prev
            : stats
        ));
      } catch (err) {
        // Telemetry errors ignored
      }
    }

    updateTelemetry();
    const interval = setInterval(updateTelemetry, 1500); // Poll every 1.5 seconds

    return () => clearInterval(interval);
  }, []);

  // Sync active model settings default parameters
  useEffect(() => {
    if (activeModel) {
      const name = activeModel.toLowerCase();
      if (name.includes("lcm-dreamshaper-v7-fp16")) {
        setConstraints((prev) => ({
          ...prev,
          steps: 4,
          npuSteps: 4,
          cfgScale: 1.0,
          width: 512,
          height: 512,
          backendType: "openvino-npu",
          useGpu: true,
        }));
      } else if (name.includes("flux") || name.includes("schnell")) {
        setConstraints((prev) => ({
          ...prev,
          steps: 4,
          standardSteps: 4,
          cfgScale: 1.0,
          width: 1024,
          height: 1024,
        }));
      } else if (name.includes("lightning") || name.includes("turbo")) {
        setConstraints((prev) => ({
          ...prev,
          steps: 4,
          standardSteps: 4,
          cfgScale: 1.5,
          width: 1024,
          height: 1024,
        }));
      } else if (name.includes("sd15")) {
        setConstraints((prev) => ({
          ...prev,
          steps: 25,
          standardSteps: 25,
          cfgScale: 7.0,
          width: 512,
          height: 512,
        }));
      } else if (name.includes("sd35")) {
        setConstraints((prev) => ({
          ...prev,
          steps: 20,
          standardSteps: 20,
          cfgScale: 4.5,
          width: 1024,
          height: 1024,
        }));
      } else {
        // Fallback for custom or SD 1.x models (like CyberRealistic or arbitrary safetensors)
        setConstraints((prev) => ({
          ...prev,
          steps: 60,
          standardSteps: 60,
          cfgScale: 7.0,
          width: 512,
          height: 512,
        }));
      }
    }
  }, [activeModel]);

  // Tab contents are kept mounted to preserve loading/generation state when switching tabs

  const handleNewChat = useCallback(() => {
    setActiveConversationId(null);
    setActiveTab("chat");
  }, []);

  const toggleSidebar = useCallback(() => setSidebarVisible((visible) => !visible), []);

  // Picking Images or Video in the sidebar always lands on its start screen, even when it is already open
  const [imagesHomeSignal, setImagesHomeSignal] = useState(0);
  const [videoHomeSignal, setVideoHomeSignal] = useState(0);
  const openTabFromSidebar = useCallback((tab) => {
    if (tab === "generator") setImagesHomeSignal((n) => n + 1);
    if (tab === "video") setVideoHomeSignal((n) => n + 1);
    setActiveTab(tab);
  }, []);

  const handleOpenProjects = useCallback(() => {
    try {
      localStorage.setItem("settings_active_section", "projects");
    } catch (_) {}
    setSettingsSection("projects");
    setActiveTab("settings");
  }, []);

  // The top bar only shows outside a running conversation, so chats get the full height
  const [chatInThread, setChatInThread] = useState(false);
  const showTopBar = !(activeTab === "chat" && chatInThread);

  const sidebarContent = useMemo(() => (
    <Sidebar
      collapsed={!sidebarVisible}
      onToggleSidebar={toggleSidebar}
      activeTab={activeTab}
      setActiveTab={openTabFromSidebar}
      specs={specs}
      telemetry={telemetry}
      onNewChat={handleNewChat}
      conversations={conversations}
      activeConversationId={activeConversationId}
      setActiveConversationId={setActiveConversationId}
      onDeleteConversation={handleDeleteConversation}
      onRenameConversation={handleRenameConversation}
      onTogglePinConversation={handleTogglePinConversation}
      onExportConversation={handleExportConversation}
      speechTranscriptions={speechTranscriptions}
      selectedSpeechTranscript={selectedSpeechTranscript}
      setSelectedSpeechTranscript={setSelectedSpeechTranscript}
      onDeleteSpeechTranscription={handleDeleteSpeechTranscription}
      activeProject={activeProject}
      onOpenCommandPalette={() => setCommandPaletteOpen(true)}
    />
  ), [
    sidebarVisible, toggleSidebar, activeTab, openTabFromSidebar, specs, telemetry,
    handleNewChat, conversations, activeConversationId, handleDeleteConversation,
    handleRenameConversation, handleTogglePinConversation, handleExportConversation,
    speechTranscriptions, selectedSpeechTranscript, handleDeleteSpeechTranscription,
    activeProject
  ]);

  // The status bar unloads models itself; keep the screens' view in step. The picked image
  // model stays selected so the next generate loads it again.
  const handleImageUnloaded = useCallback(() => setServerRunning(false), []);
  const handleTextUnloaded = useCallback(() => setIsLlmLoaded(false), []);

  return (
    <div className="app-container">
      <CommandPalette open={commandPaletteOpen} onClose={() => setCommandPaletteOpen(false)} onNavigate={(item) => {
        if (item.action === "new_chat") { handleNewChat(); return; }
        if (item.action === "toggle_sidebar") { toggleSidebar(); return; }
        if (item.section) { setSettingsSection(item.section); try { localStorage.setItem("settings_active_section", item.section); } catch (_) {} }
        openTabFromSidebar(item.tab);
      }} />
      {/* Sidebar with Navigation Rail & Specs */}
      {sidebarContent}

      {/* Main Panel */}
      <div className="main-content">
        {/* Top telemetry specs chips bar */}
        {showTopBar && (
        <TopStatusBar
          onImageUnloaded={handleImageUnloaded}
          onTextUnloaded={handleTextUnloaded}
          theme={theme}
          setTheme={setTheme}
          sidebarVisible={sidebarVisible}
          onToggleSidebar={toggleSidebar}
        />
        )}

        <div style={{ display: activeTab === "generator" ? "flex" : "none", flex: 1, flexDirection: "column", overflow: "hidden" }}>
          <Generator
            homeSignal={imagesHomeSignal}
            prompt={prompt}
            setPrompt={setPrompt}
            negativePrompt={negativePrompt}
            setNegativePrompt={setNegativePrompt}
            constraints={constraints}
            setConstraints={setConstraints}
            activeModel={activeModel}
            generatedImages={generatedImages}
            setGeneratedImages={setGeneratedImages}
            isGenerating={isGenerating}
            setIsGenerating={setIsGenerating}
            generationProgress={generationProgress}
            setGenerationProgress={setGenerationProgress}
            setActiveTab={setActiveTab}
            setActiveModel={setActiveModel}
            showAlert={showAlert}
            showConfirm={showConfirm}
            specs={specs}
            textSettings={textSettings}
          />
        </div>

        <div style={{ display: activeTab === "video" ? "flex" : "none", flex: 1, flexDirection: "column", overflow: "hidden" }}>
          <VideoGenerator
            homeSignal={videoHomeSignal}
            showAlert={showAlert}
            showConfirm={showConfirm}
            specs={specs}
            activeProject={activeProject}
            onNavigateToModels={() => setActiveTab("models")}
          />
        </div>

        <div style={{ display: activeTab === "models" ? "flex" : "none", flex: 1, flexDirection: "column", overflow: "hidden" }}>
          <ModelManager
            activeModel={activeModel}
            setActiveModel={setActiveModel}
            serverRunning={serverRunning}
            setServerRunning={setServerRunning}
            constraints={constraints}
            setConstraints={setConstraints}
            telemetry={telemetry}
            backendOptions={backendOptions}
            showAlert={showAlert}
            showConfirm={showConfirm}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            specs={specs}
            textSettings={textSettings}
          />
        </div>

        <div style={{ display: activeTab === "chat" ? "flex" : "none", flex: 1, flexDirection: "column", overflow: "hidden" }}>
          <TextChat
            specs={specs}
            showAlert={showAlert}
            showConfirm={showConfirm}
            textSettings={textSettings}
            setTextSettings={setTextSettings}
            setActiveModel={setActiveModel}
            setServerRunning={setServerRunning}
            conversations={conversations}
            setConversations={setConversations}
            activeConversationId={activeConversationId}
            setActiveConversationId={setActiveConversationId}
            saveConversationState={saveConversationState}
            onRenameConversation={handleRenameConversation}
            onTogglePinConversation={handleTogglePinConversation}
            onExportConversation={handleExportConversation}
            setIsLlmLoaded={setIsLlmLoaded}
            setActiveTab={setActiveTab}
            onThreadChange={setChatInThread}
            sidebarVisible={sidebarVisible}
            onToggleSidebar={toggleSidebar}
            activeProject={activeProject}
            onOpenProjects={handleOpenProjects}
            onOpenBrowser={handleOpenBrowser}
          />
        </div>

        <div style={{ display: activeTab === "harness" ? "flex" : "none", flex: 1, flexDirection: "column", overflow: "hidden" }}>
          <HarnessManager
            showAlert={showAlert}
            onOpenBrowser={handleOpenBrowser}
            activeProject={activeProject}
          />
        </div>

        <div style={{ display: activeTab === "speech" ? "flex" : "none", flex: 1, flexDirection: "column", overflow: "hidden" }}>
          <SpeechTranscriber
            showAlert={showAlert}
            showConfirm={showConfirm}
            selectedTranscript={selectedSpeechTranscript}
            onTranscriptionsChanged={refreshSpeechTranscriptions}
            speechSettings={speechSettings}
            setSpeechSettings={setSpeechSettings}
          />
        </div>

        <div style={{ display: activeTab === "tts" ? "flex" : "none", flex: 1, flexDirection: "column", overflow: "hidden" }}>
          <TextToSpeech
            showAlert={showAlert}
            showConfirm={showConfirm}
            selectedOutput={selectedTtsOutput}
            onOutputsChanged={refreshTtsOutputs}
            outputs={ttsOutputs}
            onDeleteOutput={handleDeleteTtsOutput}
            ttsSettings={ttsSettings}
            setTtsSettings={setTtsSettings}
          />
        </div>

        <div style={{ display: activeTab === "settings" ? "flex" : "none", flex: 1, flexDirection: "column", overflow: "hidden" }}>
          <Settings
            initialSection={settingsSection}
            onSectionChange={setSettingsSection}
            onNavigateToChat={(proj) => {
              if (proj) setActiveProject(proj);
              openTabFromSidebar("chat");
            }}
            onActiveWorkspaceChanged={(proj) => {
              setActiveProject(proj);
            }}
            constraints={constraints}
            setConstraints={setConstraints}
            activeModel={activeModel}
            specs={specs}
            backendOptions={backendOptions}
            setBackendOptions={setBackendOptions}
            serverRunning={serverRunning}
            setServerRunning={setServerRunning}
            setActiveModel={setActiveModel}
            showAlert={showAlert}
            showConfirm={showConfirm}
            textSettings={textSettings}
            setTextSettings={setTextSettings}
            speechSettings={speechSettings}
            setSpeechSettings={setSpeechSettings}
            ttsSettings={ttsSettings}
            setTtsSettings={setTtsSettings}
            health={health}
            cleanupItems={cleanupItems}
            isReadinessBusy={isReadinessBusy}
            refreshReadiness={refreshReadiness}
            copyDiagnostics={copyDiagnostics}
            cleanupSafeItems={cleanupSafeItems}
            diagnosticsCopied={diagnosticsCopied}
            theme={theme}
            setTheme={setTheme}
            fontSize={fontSize}
            setFontSize={setFontSize}
          />
        </div>
      </div>

      <InsideBrowser
        isOpen={browserOpen}
        onClose={() => setBrowserOpen(false)}
        initialUrl={browserUrl}
        activeProject={activeProject}
      />

      {dialog && (
        <div className="app-dialog-backdrop" role="presentation">
          <div className="app-dialog" role="dialog" aria-modal="true" aria-labelledby="app-dialog-title">
            <h3 id="app-dialog-title" className="app-dialog-title">{dialog.title}</h3>
            <p className="app-dialog-message">{dialog.message}</p>
            <div className="app-dialog-actions">
              {dialog.type === "confirm" && (
                <button className="m3-btn m3-btn-outlined" onClick={() => closeDialog(false)}>
                  {dialog.cancelLabel}
                </button>
              )}
              <button
                className={`m3-btn ${dialog.danger ? "m3-btn-error" : "m3-btn-filled"}`}
                onClick={() => closeDialog(true)}
              >
                {dialog.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
