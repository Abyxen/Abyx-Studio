import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from "react";
import {
  ArrowUp,
  Square,
  ChevronDown,
  Dices,
  SlidersHorizontal,
  Plus,
  Download,
  Trash2,
  Copy,
  Check,
  Sparkles,
  Film,
  LayoutGrid,
  X,
  Loader2,
  Video as VideoIcon
} from "lucide-react";
import {
  listVideoModels,
  listVideoOutputs,
  deleteVideoOutput,
  generateVideo
} from "../services/api";

const ASPECT_RATIOS = [
  { label: "16:9 Landscape", ratio: "16:9", width: 1280, height: 720 },
  { label: "9:16 Vertical / Reels", ratio: "9:16", width: 720, height: 1280 },
  { label: "1:1 Square", ratio: "1:1", width: 576, height: 576 },
  { label: "4:3 Classic", ratio: "4:3", width: 768, height: 576 },
  { label: "3:2 Widescreen", ratio: "3:2", width: 768, height: 512 },
];

export default function VideoGenerator({
  homeSignal,
  showAlert,
  showConfirm,
  specs,
  activeProject,
  onNavigateToModels
}) {
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [selectedModel, setSelectedModel] = useState("wan-2.1-t2v");
  const [selectedRatio, setSelectedRatio] = useState(ASPECT_RATIOS[0]);
  const [duration, setDuration] = useState(4);
  const [fps, setFps] = useState(24);
  const [steps, setSteps] = useState(25);
  const [seed, setSeed] = useState(-1);

  const [models, setModels] = useState({ local: [], cloud: [] });
  const [outputs, setOutputs] = useState([]);
  const [stageVideo, setStageVideo] = useState(null);

  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [openMenu, setOpenMenu] = useState(null); // "ratio" | "duration" | "seed" | "more" | "model"
  const [copiedPrompt, setCopiedPrompt] = useState(false);

  const textareaRef = useRef(null);
  const composerRef = useRef(null);

  // Return to start screen when clicking Video in sidebar
  useEffect(() => {
    if (homeSignal) setStageVideo(null);
  }, [homeSignal]);

  // Auto-grow textarea
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const lineHeight = parseFloat(getComputedStyle(textarea).lineHeight) || 24;
    const maxHeight = Math.round(lineHeight * 5 + 8);
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [prompt]);

  // Click outside to close menus
  useEffect(() => {
    if (!openMenu) return undefined;
    function handleClickOutside(event) {
      if (composerRef.current && !composerRef.current.contains(event.target)) {
        setOpenMenu(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [openMenu]);

  // Fetch models & video history (does not force open the first video)
  const refreshData = useCallback(async () => {
    try {
      const [modelData, outputData] = await Promise.all([
        listVideoModels().catch(() => ({ local: [], cloud: [] })),
        listVideoOutputs().catch(() => [])
      ]);
      setModels(modelData || { local: [], cloud: [] });
      setOutputs(outputData || []);

      // Auto-select downloaded local model if current selection is generic
      if (modelData?.local && modelData.local.length > 0) {
        setSelectedModel((curr) => {
          if (curr === "wan-2.1-t2v" || curr === "wan-2.1-1.3b-local") {
            const wan = modelData.local.find((m) => /wan/i.test(m.filename || m.name || ""));
            return wan ? wan.filename : (modelData.local[0]?.filename || curr);
          }
          return curr;
        });
      }
    } catch (err) {
      console.warn("Failed to load video studio data:", err);
    }
  }, []);

  useEffect(() => {
    refreshData();
  }, [refreshData]);

  // When opening model menu, refresh video models immediately
  useEffect(() => {
    if (openMenu === "model") {
      refreshData();
    }
  }, [openMenu, refreshData]);

  const toggleMenu = (menuName) => {
    setOpenMenu((current) => (current === menuName ? null : menuName));
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      showAlert?.({ title: "Prompt Required", message: "Please describe what you want to animate." });
      return;
    }

    setOpenMenu(null);
    setIsGenerating(true);
    setGenerationProgress(5);
    const progressInterval = setInterval(() => {
      setGenerationProgress((p) => (p < 95 ? p + 1 : p));
    }, 900);

    try {
      const res = await generateVideo({
        prompt: prompt.trim(),
        negativePrompt: negativePrompt.trim(),
        model: selectedModel,
        resolution: `${selectedRatio.width}x${selectedRatio.height}`,
        duration: Number(duration),
        fps: Number(fps),
        steps: Number(steps),
        seed: seed === -1 ? Math.floor(Math.random() * 2147483647) : Number(seed),
      });

      clearInterval(progressInterval);
      setGenerationProgress(100);

      if (res && res.output) {
        setStageVideo(res.output);
        setOutputs((prev) => [res.output, ...prev.filter((o) => o.id !== res.output.id)]);
      }
    } catch (err) {
      clearInterval(progressInterval);
      showAlert?.({ title: "Video Generation", message: err.message || "Failed to generate video.", danger: true });
    } finally {
      setIsGenerating(false);
      setGenerationProgress(0);
    }
  };

  const handleDelete = async (video) => {
    if (!video) return;
    const confirmed = await showConfirm?.({
      title: "Delete Video",
      message: "Are you sure you want to delete this video?",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!confirmed) return;

    try {
      await deleteVideoOutput(video.videoFile || video.id);
      setOutputs((prev) => prev.filter((o) => o.id !== video.id));
      if (stageVideo?.id === video.id) {
        setStageVideo(outputs.find((o) => o.id !== video.id) || null);
      }
    } catch (err) {
      showAlert?.({ title: "Error", message: err.message || "Failed to delete video.", danger: true });
    }
  };

  const handleCopyPrompt = () => {
    if (!stageVideo?.prompt) return;
    navigator.clipboard.writeText(stageVideo.prompt);
    setCopiedPrompt(true);
    setTimeout(() => setCopiedPrompt(false), 2000);
  };

  const allAvailableModels = [
    ...(models.cloud || []),
    ...(models.local || [])
  ];

  const currentModelObj = allAvailableModels.find((m) => m.id === selectedModel || m.filename === selectedModel);
  const modelDisplayName = currentModelObj?.name || "Select model";

  const stageEmpty = !stageVideo && !isGenerating;

  // The Sleek Composer (matching Images / Text)
  const composer = (
    <div
      className="chat-composer images-composer"
      ref={composerRef}
      style={{ width: "100%", maxWidth: "800px", margin: "0 auto", textAlign: "left" }}
    >
      <div className="chat-composer-inner">
        <textarea
          ref={textareaRef}
          className="chat-composer-textarea images-prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              handleGenerate();
            }
          }}
          placeholder="Describe a video, then select a model to load"
          aria-label="Video prompt"
          rows={2}
          disabled={isGenerating}
        />

        <div className="chat-composer-toolbar">
          <div className="chat-composer-toolbar-left">
            {/* Plus / More Models button */}
            <button
              type="button"
              className="chat-composer-icon-btn"
              onClick={onNavigateToModels}
              title="Browse and download video models from Hugging Face"
              disabled={isGenerating}
            >
              <Plus size={20} aria-hidden="true" />
            </button>

            {/* Resolution / Aspect Ratio Chip */}
            <div className="images-menu-anchor">
              <button
                type="button"
                className="chat-composer-chip"
                onClick={() => toggleMenu("ratio")}
                disabled={isGenerating}
                aria-haspopup="menu"
                aria-expanded={openMenu === "ratio"}
              >
                <span>{selectedRatio.ratio} · {selectedRatio.width}×{selectedRatio.height}</span>
                <ChevronDown size={14} aria-hidden="true" />
              </button>
              {openMenu === "ratio" && (
                <div className="chat-model-menu images-menu-left images-size-menu" role="menu">
                  <div className="chat-model-menu-label">Aspect Ratios</div>
                  {ASPECT_RATIOS.map((item) => {
                    const isSelected = selectedRatio.ratio === item.ratio;
                    return (
                      <button
                        type="button"
                        role="menuitemradio"
                        aria-checked={isSelected}
                        key={item.ratio}
                        className={`chat-model-menu-item ${isSelected ? "selected" : ""}`}
                        onClick={() => {
                          setSelectedRatio(item);
                          setOpenMenu(null);
                        }}
                      >
                        <span className="chat-model-menu-name">{item.ratio}</span>
                        <span className="images-menu-meta">{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Duration & FPS Chip */}
            <div className="images-menu-anchor">
              <button
                type="button"
                className="chat-composer-chip"
                onClick={() => toggleMenu("duration")}
                disabled={isGenerating}
                aria-haspopup="dialog"
                aria-expanded={openMenu === "duration"}
              >
                <span>{duration}s · {fps}fps</span>
                <ChevronDown size={14} aria-hidden="true" />
              </button>
              {openMenu === "duration" && (
                <div className="popover images-popover" role="dialog" style={{ minWidth: "220px" }}>
                  <div className="field">
                    <label className="field-label">Duration</label>
                    <div className="segmented">
                      {[3, 4, 5, 8].map((sec) => (
                        <button
                          key={sec}
                          type="button"
                          className={`segmented-item ${duration === sec ? "active" : ""}`}
                          onClick={() => setDuration(sec)}
                        >
                          {sec}s
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="field" style={{ marginTop: "12px" }}>
                    <label className="field-label">Frame Rate (FPS)</label>
                    <div className="segmented">
                      {[16, 24, 30].map((f) => (
                        <button
                          key={f}
                          type="button"
                          className={`segmented-item ${fps === f ? "active" : ""}`}
                          onClick={() => setFps(f)}
                        >
                          {f} fps
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Seed Chip */}
            <div className="images-menu-anchor">
              <button
                type="button"
                className="chat-composer-chip"
                onClick={() => toggleMenu("seed")}
                disabled={isGenerating}
                aria-haspopup="dialog"
                aria-expanded={openMenu === "seed"}
              >
                <Dices size={15} aria-hidden="true" />
                <span>{seed === -1 ? "Random seed" : `Seed ${seed}`}</span>
              </button>
              {openMenu === "seed" && (
                <div className="popover images-popover" role="dialog">
                  <div className="field">
                    <span className="field-label">Seed</span>
                    <div className="segmented">
                      <button
                        type="button"
                        className={`segmented-item ${seed === -1 ? "active" : ""}`}
                        onClick={() => setSeed(-1)}
                      >
                        Random
                      </button>
                      <button
                        type="button"
                        className={`segmented-item ${seed !== -1 ? "active" : ""}`}
                        onClick={() => {
                          if (seed === -1) setSeed(Math.floor(Math.random() * 2147483647));
                        }}
                      >
                        Fixed
                      </button>
                    </div>
                  </div>
                  {seed !== -1 && (
                    <div className="field" style={{ marginTop: "10px" }}>
                      <label className="field-label" htmlFor="video-seed">Seed number</label>
                      <input
                        id="video-seed"
                        type="number"
                        className="images-input"
                        value={seed}
                        onChange={(e) => setSeed(parseInt(e.target.value) || -1)}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* More Settings Chip */}
            <div className="images-menu-anchor">
              <button
                type="button"
                className={`chat-composer-chip ${negativePrompt?.trim() ? "images-chip-set" : ""}`}
                onClick={() => toggleMenu("more")}
                aria-haspopup="dialog"
                aria-expanded={openMenu === "more"}
              >
                <SlidersHorizontal size={15} aria-hidden="true" />
                <span>More</span>
              </button>
              {openMenu === "more" && (
                <div className="popover images-popover images-popover-wide" role="dialog">
                  <div className="field">
                    <label className="field-label" htmlFor="video-neg">Negative prompt</label>
                    <textarea
                      id="video-neg"
                      className="images-textarea"
                      placeholder="blurry, distorted, low quality, jitter, watermark..."
                      value={negativePrompt}
                      onChange={(e) => setNegativePrompt(e.target.value)}
                      rows={2}
                    />
                  </div>
                  <div className="field" style={{ marginTop: "12px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <label className="field-label">Steps ({steps})</label>
                    </div>
                    <input
                      type="range"
                      min="15"
                      max="50"
                      value={steps}
                      onChange={(e) => setSteps(Number(e.target.value))}
                      style={{ width: "100%", accentColor: "var(--md-sys-color-primary)" }}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="chat-composer-toolbar-right">
            {/* Model Picker */}
            <div className="chat-model-picker">
              <button
                type="button"
                className={`chat-model-trigger ${openMenu === "model" ? "active" : ""}`}
                onClick={() => toggleMenu("model")}
                disabled={isGenerating}
                aria-haspopup="menu"
                aria-expanded={openMenu === "model"}
                title={modelDisplayName}
              >
                <span className="chat-model-dot" aria-hidden="true" style={{ background: "#45D483" }} />
                <span className="chat-model-trigger-label" aria-live="polite">{modelDisplayName}</span>
                <ChevronDown size={15} aria-hidden="true" />
              </button>
              {openMenu === "model" && (
                <div className="chat-model-menu" role="menu" style={{ minWidth: "280px" }}>
                  <div className="chat-model-menu-label">Local Video Models (RTX 5060)</div>
                  {models.local && models.local.length > 0 ? (
                    models.local.map((m) => {
                      const isSelected = selectedModel === m.filename || selectedModel === m.id;
                      return (
                        <button
                          key={m.filename || m.id}
                          type="button"
                          className={`chat-model-menu-item ${isSelected ? "selected" : ""}`}
                          onClick={() => {
                            setSelectedModel(m.filename || m.id);
                            setOpenMenu(null);
                          }}
                        >
                          <span className="chat-model-menu-name">{m.name}</span>
                          <span className="images-menu-meta">{m.size || m.format}</span>
                        </button>
                      );
                    })
                  ) : (
                    <div className="chat-model-menu-item images-menu-static">
                      <span className="chat-model-menu-name">No local video models found</span>
                    </div>
                  )}

                  <div className="chat-model-menu-divider" />
                  <div className="chat-model-menu-label">Cloud Video Models (Instant)</div>
                  <button
                    type="button"
                    className={`chat-model-menu-item ${selectedModel === "wan-2.1-t2v" ? "selected" : ""}`}
                    onClick={() => { setSelectedModel("wan-2.1-t2v"); setOpenMenu(null); }}
                  >
                    <span className="chat-model-menu-name">Wan 2.1 T2V</span>
                    <span className="images-menu-meta">Cloud API · 720p</span>
                  </button>
                  <button
                    type="button"
                    className={`chat-model-menu-item ${selectedModel === "luma-dream-machine" ? "selected" : ""}`}
                    onClick={() => { setSelectedModel("luma-dream-machine"); setOpenMenu(null); }}
                  >
                    <span className="chat-model-menu-name">Luma Dream Machine</span>
                    <span className="images-menu-meta">1080p Cinematic</span>
                  </button>
                  <button
                    type="button"
                    className={`chat-model-menu-item ${selectedModel === "kling-1.5" ? "selected" : ""}`}
                    onClick={() => { setSelectedModel("kling-1.5"); setOpenMenu(null); }}
                  >
                    <span className="chat-model-menu-name">Kling 1.5 HD</span>
                    <span className="images-menu-meta">Realistic Motion</span>
                  </button>
                  <button
                    type="button"
                    className={`chat-model-menu-item ${selectedModel === "cogvideox-5b" ? "selected" : ""}`}
                    onClick={() => { setSelectedModel("cogvideox-5b"); setOpenMenu(null); }}
                  >
                    <span className="chat-model-menu-name">CogVideoX-5B</span>
                    <span className="images-menu-meta">High Fidelity</span>
                  </button>

                  <div className="chat-model-menu-divider" />
                  <button
                    type="button"
                    className="chat-model-menu-item"
                    onClick={() => {
                      setOpenMenu(null);
                      onNavigateToModels?.();
                    }}
                  >
                    <span className="chat-model-menu-name">Manage models…</span>
                  </button>
                </div>
              )}
            </div>

            {/* Circular Send / Generate Button */}
            <button
              type="button"
              className="chat-composer-send-btn"
              onClick={handleGenerate}
              disabled={isGenerating || !prompt.trim()}
              aria-label="Generate video"
              title="Generate video"
            >
              {isGenerating ? (
                <Loader2 size={16} className="images-picker-spin" aria-hidden="true" />
              ) : (
                <ArrowUp size={18} aria-hidden="true" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className={`page images-page ${outputs.length > 0 ? "has-history" : ""}`}>
      <div className="images-main">
        {stageVideo && !isGenerating && (
          <button type="button" className="btn images-back" onClick={() => setStageVideo(null)}>
            <LayoutGrid size={15} aria-hidden="true" />
            <span>All videos</span>
          </button>
        )}

        <div className="page-scroll images-stage-scroll">
          <div className={`page-column images-stage-column ${stageEmpty ? "is-empty" : ""}`}>
            {stageEmpty ? (
              <>
                <div className="images-hero">
                  <h1 className="images-hero-title">What should we imagine in motion?</h1>
                  <div style={{ width: "100%", maxWidth: "800px", margin: "0 auto" }}>
                    {composer}
                  </div>
                </div>

                {/* Video Gallery when on home screen */}
                {outputs.length > 0 && (
                  <div style={{ width: "100%", maxWidth: "800px", margin: "24px auto 0" }}>
                    <div className="images-grid-bar" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                      <span className="images-grid-count" style={{ fontSize: "0.85rem", color: "var(--md-sys-color-outline)" }}>
                        {outputs.length} video{outputs.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "14px" }}>
                      {outputs.map((item) => (
                        <div
                          key={item.id}
                          onClick={() => setStageVideo(item)}
                          style={{
                            position: "relative",
                            borderRadius: "14px",
                            overflow: "hidden",
                            border: "1px solid var(--border-color)",
                            background: "var(--sidebar-hover, var(--md-sys-color-surface-variant))",
                            aspectRatio: "16/9",
                            cursor: "pointer",
                            boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
                            transition: "transform 0.15s ease, border-color 0.15s ease",
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.transform = "translateY(-2px)";
                            e.currentTarget.style.borderColor = "var(--md-sys-color-on-surface)";
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.transform = "translateY(0)";
                            e.currentTarget.style.borderColor = "var(--border-color)";
                          }}
                        >
                          <video src={item.url} muted preload="metadata" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                          <div style={{ position: "absolute", bottom: "6px", right: "6px", background: "rgba(0,0,0,0.75)", color: "#fff", fontSize: "10px", padding: "2px 6px", borderRadius: "4px", fontWeight: "600" }}>
                            {item.duration || 4}s
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : isGenerating ? (
              <div className="images-progress-tile" style={{ padding: "40px", textAlign: "center" }}>
                <Loader2 size={36} className="images-picker-spin" style={{ color: "var(--md-sys-color-primary)", margin: "0 auto 16px" }} />
                <h3 style={{ margin: "0 0 8px 0", fontSize: "1.1rem" }}>Generating video in motion...</h3>
                <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--md-sys-color-outline)" }}>
                  Synthesizing motion frames with Wan 2.1 on RTX 5060 ({generationProgress}%)
                </p>
              </div>
            ) : (
              <figure className="images-stage">
                <div
                  className="images-stage-frame"
                  style={{
                    maxWidth: "800px",
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "#000",
                    borderRadius: "16px",
                    overflow: "hidden",
                    border: "1px solid var(--border-color-muted, var(--border-color))",
                  }}
                >
                  <video
                    key={stageVideo?.url}
                    src={stageVideo?.url}
                    controls
                    autoPlay
                    loop
                    muted
                    playsInline
                    preload="auto"
                    style={{ maxWidth: "100%", maxHeight: "calc(100vh - 400px)", width: "auto", height: "auto", display: "block" }}
                  />
                </div>
                <figcaption className="images-stage-caption" style={{ maxWidth: "800px", textAlign: "center", marginTop: "12px" }}>
                  {stageVideo?.prompt && <p className="images-stage-prompt">{stageVideo.prompt}</p>}
                  <p className="images-stage-meta">
                    {stageVideo?.model} · {stageVideo?.resolution || "1280x720"} · {stageVideo?.duration || 4}s @ {stageVideo?.fps || 24}fps
                  </p>
                </figcaption>
                <div className="images-stage-actions" style={{ marginTop: "12px", display: "flex", gap: "8px", justifyContent: "center" }}>
                  {stageVideo?.url && (
                    <a
                      href={stageVideo.url}
                      download={stageVideo.videoFile || "video.mp4"}
                      className="btn pri"
                      style={{ textDecoration: "none" }}
                    >
                      <Download size={15} aria-hidden="true" />
                      <span>Download</span>
                    </a>
                  )}
                  <button type="button" className="btn" onClick={handleCopyPrompt}>
                    {copiedPrompt ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
                    <span>{copiedPrompt ? "Copied" : "Copy Prompt"}</span>
                  </button>
                  <button type="button" className="btn btn-danger" onClick={() => handleDelete(stageVideo)}>
                    <Trash2 size={15} aria-hidden="true" />
                    <span>Delete</span>
                  </button>
                </div>
              </figure>
            )}
          </div>
        </div>

        {!stageEmpty && (
          <div className="page-dock">
            <div style={{ maxWidth: "800px", width: "100%", margin: "0 auto" }}>
              {composer}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
