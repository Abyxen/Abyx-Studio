import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Globe, Key, Check, AlertCircle, RefreshCw, Eye, EyeOff,
  ExternalLink, ShieldCheck, Zap, Sparkles, Trash2, ChevronDown,
  ChevronUp, Copy, Sliders, Server, CheckCircle2, X, MessageSquare, BookOpen
} from "lucide-react";
import {
  getProviders,
  saveProvidersConfig,
  testProviderConnection,
  getFreeApisCatalog
} from "../services/api";
import "../styles/abyx.css";

export default function CloudProviders({ showAlert, showConfirm, setActiveTab, onSelectModel }) {
  const [providers, setProviders] = useState([]);
  const [activeModel, setActiveModel] = useState("auto");
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [keyInputs, setKeyInputs] = useState({});
  const [showKeys, setShowKeys] = useState({});
  const [testing, setTesting] = useState({});
  const [testResults, setTestResults] = useState({});
  const [customEndpoints, setCustomEndpoints] = useState({});
  const [defaultModels, setDefaultModels] = useState({});
  const [expandedModels, setExpandedModels] = useState({});
  const [saving, setSaving] = useState({});
  const [copiedSnippet, setCopiedSnippet] = useState(null);

  // Free APIs Catalog Modal State
  const [showCatalogModal, setShowCatalogModal] = useState(false);
  const [catalogData, setCatalogData] = useState(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogSearch, setCatalogSearch] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getProviders();
      const list = data.providers || [];
      setProviders(list);
      setActiveModel(data.activeModel || "auto");

      // Extract custom endpoints and default models
      const endpoints = {};
      const defModels = {};
      list.forEach((p) => {
        if (p.baseUrl) endpoints[p.id] = p.baseUrl;
        if (p.defaultModel) defModels[p.id] = p.defaultModel;
      });
      if (data.custom) {
        endpoints["custom"] = data.custom.baseUrl || "";
        defModels["custom"] = data.custom.model || "";
      }
      setCustomEndpoints(endpoints);
      setDefaultModels(defModels);
    } catch (err) {
      console.error("Failed to load providers:", err);
      showAlert?.({ title: "Error", message: "Failed to load cloud providers: " + err.message, danger: true });
    } finally {
      setLoading(false);
    }
  }, [showAlert]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const loadCatalog = async () => {
    setShowCatalogModal(true);
    if (!catalogData) {
      setCatalogLoading(true);
      try {
        const cat = await getFreeApisCatalog();
        setCatalogData(cat);
      } catch (err) {
        showAlert?.({ title: "Catalog Error", message: "Failed to load free APIs catalog: " + err.message, danger: true });
      } finally {
        setCatalogLoading(false);
      }
    }
  };

  const handleKeyChange = (providerId, val) => {
    setKeyInputs((prev) => ({ ...prev, [providerId]: val }));
  };

  const toggleShowKey = (providerId) => {
    setShowKeys((prev) => ({ ...prev, [providerId]: !prev[providerId] }));
  };

  const toggleExpandModels = (providerId) => {
    setExpandedModels((prev) => ({ ...prev, [providerId]: !prev[providerId] }));
  };

  const handleEndpointChange = (providerId, val) => {
    setCustomEndpoints((prev) => ({ ...prev, [providerId]: val }));
  };

  const handleDefaultModelChange = (providerId, val) => {
    setDefaultModels((prev) => ({ ...prev, [providerId]: val }));
  };

  const handleSave = async (providerId) => {
    setSaving((prev) => ({ ...prev, [providerId]: true }));
    try {
      const payload = {
        keys: {},
        custom: {},
        endpoints: {},
        defaultModels: {},
      };

      if (providerId === "custom") {
        payload.custom = {
          baseUrl: customEndpoints["custom"] || "",
          model: defaultModels["custom"] || "",
        };
        if (keyInputs["custom"] !== undefined) {
          payload.custom_key = keyInputs["custom"];
        }
      } else {
        if (keyInputs[providerId] !== undefined) {
          payload.keys[providerId] = keyInputs[providerId];
        }
        if (customEndpoints[providerId] !== undefined) {
          payload.endpoints[providerId] = customEndpoints[providerId];
        }
        if (defaultModels[providerId] !== undefined) {
          payload.defaultModels[providerId] = defaultModels[providerId];
        }
      }

      const res = await saveProvidersConfig(payload);
      if (res.ok || res.success) {
        showAlert?.({
          title: "Provider Saved",
          message: `Settings for ${providerId} updated and securely stored in DPAPI vault.`
        });
        setKeyInputs((prev) => {
          const next = { ...prev };
          delete next[providerId];
          return next;
        });
        await loadData();
      }
    } catch (err) {
      showAlert?.({ title: "Save Failed", message: err.message, danger: true });
    } finally {
      setSaving((prev) => ({ ...prev, [providerId]: false }));
    }
  };

  const handleRemoveKey = async (provider) => {
    const pId = provider.id;
    const confirmed = await showConfirm?.({
      title: "Remove Saved Key",
      message: `Are you sure you want to remove your saved API credentials for ${provider.name}? This will delete the key from your encrypted DPAPI vault.`,
      confirmLabel: "Remove Key",
      danger: true,
    });
    if (!confirmed) return;

    setSaving((prev) => ({ ...prev, [pId]: true }));
    try {
      const payload = {
        keys: { [pId]: "" },
      };
      if (pId === "custom") {
        payload.custom_key = "";
      }
      const res = await saveProvidersConfig(payload);
      if (res.ok || res.success) {
        showAlert?.({
          title: "Key Removed",
          message: `API key for ${provider.name} was successfully removed from DPAPI vault.`
        });
        setKeyInputs((prev) => {
          const next = { ...prev };
          delete next[pId];
          return next;
        });
        setTestResults((prev) => {
          const next = { ...prev };
          delete next[pId];
          return next;
        });
        await loadData();
      }
    } catch (err) {
      showAlert?.({ title: "Action Failed", message: err.message, danger: true });
    } finally {
      setSaving((prev) => ({ ...prev, [pId]: false }));
    }
  };

  const handleTest = async (provider) => {
    const pId = provider.id;
    setTesting((prev) => ({ ...prev, [pId]: true }));
    setTestResults((prev) => ({ ...prev, [pId]: null }));
    try {
      const inputKey = keyInputs[pId] || "";
      const customUrl = customEndpoints[pId] || "";
      const customModel = defaultModels[pId] || "";
      const result = await testProviderConnection(pId, inputKey, customUrl, customModel);
      setTestResults((prev) => ({ ...prev, [pId]: result }));
    } catch (err) {
      setTestResults((prev) => ({
        ...prev,
        [pId]: { ok: false, error: err.message || "Connection failed" },
      }));
    } finally {
      setTesting((prev) => ({ ...prev, [pId]: false }));
    }
  };

  const handleUseInChat = (provider, modelId) => {
    const targetModel = modelId || defaultModels[provider.id] || (provider.models?.[0]) || `${provider.id}/default`;
    onSelectModel?.(targetModel);
    setActiveTab?.("chat");
    showAlert?.({
      title: "Model Selected",
      message: `Switched chat model to ${targetModel}. Returning to Text Chat.`
    });
  };

  const handleCopySnippet = (snippetText, id) => {
    navigator.clipboard.writeText(snippetText);
    setCopiedSnippet(id);
    setTimeout(() => setCopiedSnippet(null), 2000);
  };

  // Provider categorization
  const isLocalRuntime = (id) => ["ollama", "lmstudio", "custom"].includes(id.toLowerCase());
  const isKeyless = () => false;

  const categories = useMemo(() => {
    const configuredCount = providers.filter((p) => p.isConfigured || p.hasKey).length;
    const localCount = providers.filter((p) => isLocalRuntime(p.id)).length;
    const cloudCount = providers.filter((p) => !isLocalRuntime(p.id)).length;

    return [
      { id: "all", label: `All Providers (${providers.length})` },
      { id: "configured", label: `Configured & Ready (${configuredCount})` },
      { id: "cloud", label: `Cloud AI Providers (${cloudCount})` },
      { id: "local", label: `Local Runtimes (${localCount})` },
    ];
  }, [providers]);

  const filteredProviders = useMemo(() => {
    return providers.filter((p) => {
      // Category filter
      if (selectedCategory === "configured" && !p.isConfigured && !p.hasKey) return false;
      if (selectedCategory === "local" && !isLocalRuntime(p.id)) return false;
      if (selectedCategory === "cloud" && isLocalRuntime(p.id)) return false;

      // Text search
      if (!search.trim()) return true;
      const term = search.toLowerCase();
      return (
        p.name.toLowerCase().includes(term) ||
        p.id.toLowerCase().includes(term) ||
        (p.description || "").toLowerCase().includes(term) ||
        (p.models || []).some((m) => String(m).toLowerCase().includes(term))
      );
    });
  }, [providers, selectedCategory, search]);

  return (
    <div className="abyx-page-container">
      {/* Page Header */}
      <div className="abyx-page-header">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1 className="abyx-page-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Globe size={24} /> Cloud AI Providers & Connections
            </h1>
            <p className="abyx-page-subtitle">
              Connect external and local intelligence providers: OpenAI, Anthropic Claude, Gemini, Groq, DeepSeek, Cerebras, OpenRouter, Mistral, Ollama, LM Studio, and zero-config Pollinations. Credentials are encrypted via Windows DPAPI and never written to disk in plain text.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="abyx-btn" onClick={loadCatalog} title="View Free APIs catalog, documentation, and copyable integration snippets">
              <BookOpen size={14} /> Free APIs Catalog &amp; Snippets
            </button>
            <button className="abyx-btn" onClick={loadData} disabled={loading} title="Refresh provider status and credentials">
              <RefreshCw size={14} className={loading ? "status-pill-spin" : ""} /> Refresh
            </button>
          </div>
        </div>
      </div>

      {/* Filter and Security Banner */}
      <div className="abyx-section-card" style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
          <div style={{ flex: 1, minWidth: 260 }}>
            <input
              type="text"
              className="abyx-input"
              placeholder="Search providers by name, models, features, or ID..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div style={{ fontSize: "0.85rem", color: "var(--md-sys-color-outline)", display: "flex", alignItems: "center", gap: 6 }}>
            <ShieldCheck size={16} color="var(--md-sys-color-success)" />
            <span>Vault Status: Protected by Windows DPAPI / AES-256</span>
          </div>
        </div>

        {/* Category Tabs */}
        <div className="abyx-filter-tabs">
          {categories.map((cat) => (
            <button
              key={cat.id}
              type="button"
              className={`abyx-filter-tab ${selectedCategory === cat.id ? "active" : ""}`}
              onClick={() => setSelectedCategory(cat.id)}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {/* Providers Grid */}
      <div className="abyx-providers-grid">
        {filteredProviders.map((provider) => {
          const isConfigured = provider.isConfigured || provider.keyless || provider.hasKey;
          const currentInput = keyInputs[provider.id] !== undefined ? keyInputs[provider.id] : "";
          const isVisible = showKeys[provider.id];
          const testRes = testResults[provider.id];
          const isTesting = testing[provider.id];
          const isSaving = saving[provider.id];
          const isCustomOrLocal = isLocalRuntime(provider.id);
          const modelsList = provider.modelObjects || provider.models || [];
          const isExpanded = expandedModels[provider.id];
          const currentDefaultModel = defaultModels[provider.id] || provider.defaultModel || (modelsList[0]?.id || modelsList[0] || "");

          return (
            <div key={provider.id} className={`abyx-provider-card ${isConfigured ? "configured" : ""}`}>
              {/* Card Header */}
              <div className="abyx-provider-top">
                <div className="abyx-provider-identity">
                  <div className="abyx-provider-name">
                    <Globe size={16} style={{ color: "var(--md-sys-color-primary, #a8c7fa)", flexShrink: 0 }} />
                    <span>{provider.name}</span>
                  </div>
                  <span className="abyx-provider-desc">{provider.description || provider.tagline}</span>
                </div>
                <span className={`abyx-provider-badge ${provider.keyless || provider.tierType === "free" ? "free" : ""}`}>
                  {provider.badge || (provider.keyless ? "KEYLESS FREE" : isCustomOrLocal ? "LOCAL RUNTIME" : "CLOUD API")}
                </span>
              </div>

              {/* Endpoint Base URL input for Local / Custom Runtimes */}
              {isCustomOrLocal && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <label style={{ fontSize: "0.75rem", color: "var(--md-sys-color-outline)", fontWeight: 500 }}>
                    Endpoint Base URL:
                  </label>
                  <input
                    type="text"
                    className="abyx-input"
                    placeholder={
                      provider.id === "ollama" ? "http://127.0.0.1:11434" :
                      provider.id === "lmstudio" ? "http://127.0.0.1:1234/v1" :
                      "http://127.0.0.1:8000/v1"
                    }
                    value={customEndpoints[provider.id] || ""}
                    onChange={(e) => handleEndpointChange(provider.id, e.target.value)}
                  />
                </div>
              )}

              {/* API Key Input for Non-Keyless Providers */}
              {!provider.keyless && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <label style={{ fontSize: "0.75rem", color: "var(--md-sys-color-outline)", fontWeight: 500 }}>
                      {provider.id === "custom" || isCustomOrLocal ? "API Key (Optional for local):" : "API Key:"}
                    </label>
                    {provider.maskedKey && (
                      <span style={{ fontSize: "0.75rem", color: "var(--md-sys-color-success)", display: "flex", alignItems: "center", gap: 4 }}>
                        <CheckCircle2 size={12} /> Key configured in DPAPI
                      </span>
                    )}
                  </div>
                  <div className="abyx-key-input-group">
                    <input
                      type={isVisible ? "text" : "password"}
                      className="abyx-input"
                      placeholder={provider.maskedKey ? `Saved: ${provider.maskedKey}` : `Enter ${provider.name} API Key...`}
                      value={currentInput}
                      onChange={(e) => handleKeyChange(provider.id, e.target.value)}
                    />
                    <button
                      type="button"
                      className="abyx-btn abyx-btn-sm"
                      onClick={() => toggleShowKey(provider.id)}
                      title={isVisible ? "Hide Key" : "Show Key"}
                    >
                      {isVisible ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                    {(currentInput || customEndpoints[provider.id] !== undefined || defaultModels[provider.id] !== undefined) && (
                      <button
                        type="button"
                        className="abyx-btn abyx-btn-sm abyx-btn-primary"
                        onClick={() => handleSave(provider.id)}
                        disabled={isSaving}
                        title="Save settings into DPAPI vault"
                      >
                        <Check size={14} /> Save
                      </button>
                    )}
                    {provider.hasKey && (
                      <button
                        type="button"
                        className="abyx-btn abyx-btn-sm"
                        style={{ color: "var(--md-sys-color-error)", borderColor: "rgba(239, 68, 68, 0.3)" }}
                        onClick={() => handleRemoveKey(provider)}
                        disabled={isSaving}
                        title="Delete key from secure vault"
                      >
                        <Trash2 size={13} /> Clear
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Keyless Notice */}
              {provider.keyless && (
                <div style={{ fontSize: "0.8rem", color: "var(--md-sys-color-success)", display: "flex", alignItems: "center", gap: 6, padding: "4px 0" }}>
                  <Zap size={14} /> Keyless Provider — Ready to use immediately with zero setup!
                </div>
              )}

              {/* Default Model Selector & Model List Accordion */}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <label style={{ fontSize: "0.75rem", color: "var(--md-sys-color-outline)", fontWeight: 500 }}>
                    Default Model:
                  </label>
                  {modelsList.length > 0 && (
                    <button
                      type="button"
                      className="abyx-link-btn"
                      onClick={() => toggleExpandModels(provider.id)}
                      style={{ fontSize: "0.75rem", display: "flex", alignItems: "center", gap: 4 }}
                    >
                      <span>{modelsList.length} models</span>
                      {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                    </button>
                  )}
                </div>

                {modelsList.length > 0 ? (
                  <select
                    className="abyx-input"
                    value={currentDefaultModel}
                    onChange={(e) => {
                      handleDefaultModelChange(provider.id, e.target.value);
                      handleSave(provider.id);
                    }}
                    style={{ fontSize: "0.8rem" }}
                  >
                    {modelsList.map((m) => {
                      const mId = typeof m === "object" ? (m.rawId || m.id) : m;
                      const mName = typeof m === "object" ? (m.name || m.id) : m;
                      return (
                        <option key={mId} value={mId}>
                          {mName}
                        </option>
                      );
                    })}
                  </select>
                ) : (
                  <input
                    type="text"
                    className="abyx-input"
                    placeholder="Enter model identifier (e.g. gpt-4o, llama3)"
                    value={defaultModels[provider.id] || ""}
                    onChange={(e) => handleDefaultModelChange(provider.id, e.target.value)}
                  />
                )}

                {/* Expanded Models Pill View */}
                {isExpanded && modelsList.length > 0 && (
                  <div className="abyx-model-pill-list">
                    {modelsList.map((m) => {
                      const mId = typeof m === "object" ? (m.rawId || m.id) : m;
                      const mName = typeof m === "object" ? (m.name || m.id) : m;
                      const isSelected = currentDefaultModel === mId;
                      return (
                        <div
                          key={mId}
                          className={`abyx-model-pill ${isSelected ? "selected" : ""}`}
                          onClick={() => {
                            handleDefaultModelChange(provider.id, mId);
                            handleSave(provider.id);
                          }}
                          title={`Click to set ${mName} as default model for ${provider.name}`}
                        >
                          <span>{mName}</span>
                          {isSelected && <Check size={11} />}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Action Buttons: Test Connection, Use in Chat, Get Key */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    type="button"
                    className="abyx-btn abyx-btn-sm"
                    onClick={() => handleTest(provider)}
                    disabled={isTesting}
                    title="Send an authentication ping to verify credentials and measure latency"
                  >
                    {isTesting ? <RefreshCw size={13} className="status-pill-spin" /> : <Zap size={13} />}
                    <span>{isTesting ? "Testing..." : "Test Connection"}</span>
                  </button>

                  {isConfigured && (
                    <button
                      type="button"
                      className="abyx-btn abyx-btn-sm"
                      onClick={() => handleUseInChat(provider, currentDefaultModel)}
                      title="Activate this provider & model in Text Chat"
                    >
                      <MessageSquare size={13} />
                      <span>Use in Chat</span>
                    </button>
                  )}
                </div>

                {provider.keyUrl && (
                  <a
                    href={provider.keyUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="abyx-btn abyx-btn-sm"
                    style={{ textDecoration: "none" }}
                    title={`Open ${provider.name} developer console to retrieve free or commercial API key`}
                  >
                    <span>Get Key</span> <ExternalLink size={12} />
                  </a>
                )}
              </div>

              {/* Test Connection Result Box */}
              {testRes && (
                <div
                  style={{
                    padding: "10px 12px",
                    borderRadius: "6px",
                    fontSize: "0.775rem",
                    backgroundColor: testRes.ok ? "rgba(36, 138, 61, 0.12)" : "rgba(215, 0, 21, 0.12)",
                    color: testRes.ok ? "var(--md-sys-color-success)" : "var(--md-sys-color-error)",
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600 }}>
                    {testRes.ok ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
                    <span>{testRes.ok ? `Connected successfully (${testRes.latency_ms || testRes.latency || "OK"})` : "Connection failed"}</span>
                  </div>
                  {testRes.error && <div style={{ wordBreak: "break-word" }}>{testRes.error}</div>}
                  {testRes.model && (
                    <div style={{ opacity: 0.9 }}>Model verified: <strong>{testRes.model}</strong></div>
                  )}
                  {testRes.sampleReply && (
                    <div style={{ fontStyle: "italic", opacity: 0.9 }}>"{testRes.sampleReply}"</div>
                  )}
                </div>
              )}

              {/* Status Footer */}
              <div className="abyx-provider-status">
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span className={`abyx-status-indicator ${isConfigured ? "live" : ""}`} />
                  <span>{isConfigured ? "Active & Configured" : "Not Configured"}</span>
                </div>
                {provider.models && provider.models.length > 0 && (
                  <span style={{ color: "var(--md-sys-color-outline)", fontSize: "0.75rem" }}>
                    {provider.models.length} {provider.models.length === 1 ? "model" : "models"} available
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Free APIs Catalog & Code Snippets Modal */}
      {showCatalogModal && (
        <div className="abyx-modal-backdrop" onClick={() => setShowCatalogModal(false)}>
          <div className="abyx-modal-dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 780, maxHeight: "85vh" }}>
            <div className="abyx-modal-header">
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <BookOpen size={20} />
                <h2 style={{ margin: 0, fontSize: "1.2rem", fontWeight: 600 }}>Free LLM APIs Catalog &amp; Code Snippets</h2>
              </div>
              <button className="abyx-btn abyx-btn-sm" onClick={() => setShowCatalogModal(false)}>
                <X size={16} />
              </button>
            </div>

            <div className="abyx-modal-body" style={{ overflowY: "auto", padding: "16px 20px" }}>
              <p style={{ fontSize: "0.85rem", color: "var(--md-sys-color-outline)", marginTop: 0 }}>
                Explore free-tier model providers, keyless endpoints, generous rate limits, and ready-to-run API integration snippets.
              </p>

              <div style={{ marginBottom: 16 }}>
                <input
                  type="text"
                  className="abyx-input"
                  placeholder="Filter free providers and models..."
                  value={catalogSearch}
                  onChange={(e) => setCatalogSearch(e.target.value)}
                />
              </div>

              {catalogLoading ? (
                <div style={{ padding: 30, textAlign: "center", color: "var(--md-sys-color-outline)" }}>
                  <RefreshCw size={24} className="status-pill-spin" />
                  <p>Loading Free APIs catalog...</p>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  {(catalogData?.providers || [])
                    .filter((p) => {
                      if (!catalogSearch.trim()) return true;
                      const s = catalogSearch.toLowerCase();
                      return p.name.toLowerCase().includes(s) || (p.description || "").toLowerCase().includes(s);
                    })
                    .map((item) => {
                      const curlSnippet = `curl -X POST "${item.baseUrl || 'https://api.example.com/v1'}/chat/completions" \\\n  -H "Content-Type: application/json" \\\n  -H "Authorization: Bearer YOUR_API_KEY" \\\n  -d '{\n    "model": "${item.models?.[0]?.id || 'default'}",\n    "messages": [{"role": "user", "content": "Hello!"}]\n  }'`;

                      return (
                        <div key={item.id} className="abyx-section-card" style={{ padding: 14, margin: 0 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                            <div>
                              <strong style={{ fontSize: "1rem" }}>{item.name}</strong>
                              <span style={{ marginLeft: 8, fontSize: "0.75rem", padding: "2px 6px", borderRadius: 4, background: "rgba(36, 138, 61, 0.12)", color: "var(--md-sys-color-success)", fontWeight: 600 }}>
                                {item.freeTier || "Free Tier"}
                              </span>
                            </div>
                            {item.keyUrl && (
                              <a href={item.keyUrl} target="_blank" rel="noreferrer" className="abyx-link-btn" style={{ fontSize: "0.8rem", display: "flex", alignItems: "center", gap: 4 }}>
                                <span>Get API Key</span> <ExternalLink size={12} />
                              </a>
                            )}
                          </div>
                          <p style={{ fontSize: "0.825rem", color: "var(--md-sys-color-outline)", margin: "4px 0 8px" }}>
                            {item.description}
                          </p>
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8, fontSize: "0.75rem" }}>
                            <span style={{ color: "var(--md-sys-color-on-surface)" }}>
                              <strong>Base URL:</strong> <code>{item.baseUrl || "(Keyless default)"}</code>
                            </span>
                            {item.models && (
                              <span style={{ color: "var(--md-sys-color-on-surface)" }}>
                                <strong>Models:</strong> {item.models.map((m) => m.name || m.id).join(", ")}
                              </span>
                            )}
                          </div>

                          {/* Code Snippet Box */}
                          <div style={{ position: "relative", background: "var(--md-sys-color-background)", borderRadius: 6, padding: "8px 12px", border: "1px solid var(--border-color)" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                              <span style={{ fontSize: "0.7rem", color: "var(--md-sys-color-outline)", fontWeight: 600 }}>CURL INTEGRATION</span>
                              <button
                                type="button"
                                className="abyx-btn abyx-btn-sm"
                                onClick={() => handleCopySnippet(curlSnippet, item.id)}
                                style={{ padding: "2px 8px", fontSize: "0.7rem" }}
                              >
                                {copiedSnippet === item.id ? <Check size={12} /> : <Copy size={12} />}
                                <span>{copiedSnippet === item.id ? "Copied" : "Copy"}</span>
                              </button>
                            </div>
                            <pre style={{ margin: 0, fontSize: "0.75rem", fontFamily: "monospace", overflowX: "auto" }}>
                              {curlSnippet}
                            </pre>
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>

            <div className="abyx-modal-footer">
              <button className="abyx-btn abyx-btn-primary" onClick={() => setShowCatalogModal(false)}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
