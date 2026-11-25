import React, { useState, useEffect } from "react";
import { Sliders, Cpu, Zap, RefreshCw, Check, X, Layers, Shield, Sparkles, Terminal } from "lucide-react";
import { getHarnessRuntimeConfig, updateHarnessRuntimeConfig, getHardwareSpecs } from "../services/api";

export default function HarnessControlsDrawer({ isOpen, onClose, onConfigSaved }) {
  const [config, setConfig] = useState({
    systemPrompt: "You are a helpful local AI assistant.",
    contextSize: 4096,
    temperature: 0.7,
    maxTokens: 4096,
    responseTokenMode: "auto",
    seed: -1,
    performanceProfile: "balanced",
    preferredBackend: "cuda",
    threads: 8,
    gpuLayers: -1,
    batchSize: 512,
    cacheTypeK: "q8_0",
    cacheTypeV: "q8_0",
    ropeScaling: "none",
    ropeFreqScale: 1.0,
    autonomousMaxSteps: 15,
    isLlmRunning: false,
    model: ""
  });

  const [specs, setSpecs] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [restartLlmOnSave, setRestartLlmOnSave] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadConfig();
      loadSpecs();
    }
  }, [isOpen]);

  const loadSpecs = async () => {
    try {
      const res = await getHardwareSpecs();
      if (res && res.ok) {
        setSpecs(res);
      }
    } catch (_) {}
  };

  const loadConfig = async () => {
    setLoading(true);
    try {
      const res = await getHarnessRuntimeConfig();
      if (res && res.ok) {
        setConfig(prev => ({ ...prev, ...res }));
      }
    } catch (err) {
      console.warn("Failed to load harness runtime config:", err);
    } finally {
      setLoading(false);
    }
  };

  const applyProfile = (profile) => {
    let updates = { performanceProfile: profile };
    if (profile === "potato") {
      updates = {
        ...updates,
        contextSize: 2048,
        threads: 4,
        gpuLayers: 0,
        batchSize: 256,
        cacheTypeK: "q4_0",
        cacheTypeV: "q4_0"
      };
    } else if (profile === "balanced") {
      updates = {
        ...updates,
        contextSize: 4096,
        threads: 8,
        gpuLayers: -1,
        batchSize: 512,
        cacheTypeK: "q8_0",
        cacheTypeV: "q8_0"
      };
    } else if (profile === "high") {
      updates = {
        ...updates,
        contextSize: 8192,
        threads: 16,
        gpuLayers: -1,
        batchSize: 1024,
        cacheTypeK: "f16",
        cacheTypeV: "f16"
      };
    }
    setConfig(prev => ({ ...prev, ...updates }));
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveSuccess(false);
    try {
      const res = await updateHarnessRuntimeConfig({
        ...config,
        restartLlm: restartLlmOnSave
      });
      if (res && res.ok) {
        setSaveSuccess(true);
        if (typeof onConfigSaved === "function") {
          onConfigSaved(res.settings || config);
        }
        setTimeout(() => setSaveSuccess(false), 2500);
      }
    } catch (err) {
      console.error("Failed to update harness runtime config:", err);
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="relative w-full max-w-2xl max-h-[90vh] flex flex-col bg-[#12141a] border border-white/10 rounded-xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-[#161922]">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20">
              <Sliders className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white tracking-wide">Model &amp; Harness Controls</h2>
              <p className="text-xs text-neutral-400">
                Configure context window, temperature, RoPE scaling, hardware presets, and agent loop depth
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-white/5 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6 text-sm text-neutral-200">
          {/* Hardware Specs & Recommended Banner */}
          <div className="p-3.5 rounded-lg bg-neutral-900/60 border border-white/10 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                <span className="text-xs font-semibold text-white">
                  {config.performanceProfile === "potato" ? "Economy PC" : config.performanceProfile === "high" ? "High Performance PC" : "Balanced PC"}
                </span>
              </div>
              <span className="text-[11px] font-mono text-neutral-400">
                {config.model ? config.model : "Active Model: None"}
              </span>
            </div>
            <p className="text-[11px] text-neutral-300 leading-relaxed">
              {specs?.cpu || "AMD Ryzen 9 8940HX with Radeon Graphics"} · {specs?.cores || 16} cores · {specs?.ramGb ? `${specs.ramGb} GB RAM` : "31 GB RAM"} · {specs?.gpu || "NVIDIA GeForce RTX 5060 Laptop GPU"} ({specs?.vramGb ? `${specs.vramGb} GB VRAM` : "8 GB VRAM"})
            </p>
            <div className="flex flex-wrap gap-1.5 pt-1">
              <span className="px-2 py-0.5 text-[10px] rounded bg-white/5 border border-white/10 text-neutral-400">Recommended</span>
              <span className="px-2 py-0.5 text-[10px] rounded bg-white/5 border border-white/10 text-neutral-300 font-mono">Context 4096</span>
              <span className="px-2 py-0.5 text-[10px] rounded bg-white/5 border border-white/10 text-neutral-300 font-mono">Threads 8</span>
              <span className="px-2 py-0.5 text-[10px] rounded bg-white/5 border border-white/10 text-neutral-300 font-mono">KV q8_0</span>
              <span className="px-2 py-0.5 text-[10px] rounded bg-white/5 border border-white/10 text-neutral-300 font-mono">Batch 512</span>
              <span className="px-2 py-0.5 text-[10px] rounded bg-white/5 border border-white/10 text-neutral-300 font-mono">Profile balanced</span>
            </div>
          </div>

          {/* Model and context Section */}
          <div className="space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-400">Model and context</h3>

            {/* System Prompt */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-neutral-200">System prompt</label>
              <p className="text-[11px] text-neutral-400">Sets the assistant's personality and instructions</p>
              <textarea
                rows={3}
                value={config.systemPrompt || ""}
                onChange={(e) => setConfig({ ...config, systemPrompt: e.target.value })}
                className="w-full bg-[#181b22] border border-white/10 rounded-lg p-2.5 text-xs text-neutral-200 focus:outline-none focus:border-blue-500 font-sans resize-y"
                placeholder="You are a helpful local AI assistant."
              />
            </div>

            {/* Context Size */}
            <div className="space-y-2 pt-2 border-t border-white/5">
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-xs font-medium text-neutral-200">Context size</label>
                  <p className="text-[11px] text-neutral-400">
                    Model memory limit. 0 uses model default (recommended, up to 256k / 262,144 for Abyx)
                  </p>
                </div>
                <span className="text-xs font-mono font-semibold text-blue-400 px-2 py-0.5 rounded bg-blue-500/10 border border-blue-500/20">
                  {config.contextSize === 0 ? "0 (Auto)" : `${config.contextSize} tokens`}
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="65536"
                step="1024"
                value={config.contextSize}
                onChange={(e) => setConfig({ ...config, contextSize: parseInt(e.target.value, 10) })}
                className="w-full accent-blue-500 cursor-pointer h-1.5 bg-neutral-700 rounded-lg"
              />
              <div className="flex flex-wrap gap-1.5 pt-1">
                {[0, 2048, 4096, 8192, 16384, 32768, 65536].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setConfig({ ...config, contextSize: preset })}
                    className={`px-2.5 py-1 text-[11px] rounded font-mono transition-colors border ${
                      config.contextSize === preset
                        ? "bg-blue-600 text-white border-blue-500"
                        : "bg-white/[0.04] text-neutral-300 border-white/5 hover:bg-white/[0.08]"
                    }`}
                  >
                    {preset === 0 ? "0 (Auto)" : preset >= 1024 ? `${preset / 1024}k` : preset}
                  </button>
                ))}
              </div>
            </div>

            {/* RoPE Scaling */}
            <div className="space-y-2 pt-2 border-t border-white/5">
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-xs font-medium text-neutral-200">RoPE Context Scaling</label>
                  <p className="text-[11px] text-neutral-400">Scales context window for models like Qwen 2.5 and Llama 3 (e.g. 32k on 8GB VRAM)</p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: "none", label: "None" },
                  { id: "yarn", label: "YaRN (Recommended)" },
                  { id: "linear", label: "Linear" }
                ].map((mode) => (
                  <button
                    key={mode.id}
                    type="button"
                    onClick={() => setConfig({ ...config, ropeScaling: mode.id })}
                    className={`px-3 py-2 text-xs rounded-lg font-medium transition-colors border text-left ${
                      config.ropeScaling === mode.id
                        ? "bg-blue-600/20 text-blue-300 border-blue-500/50"
                        : "bg-white/[0.03] text-neutral-400 border-white/5 hover:bg-white/[0.06]"
                    }`}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>

              {config.ropeScaling !== "none" && (
                <div className="space-y-1.5 pt-2">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] text-neutral-300">Scale factor multiplier (0.25 = 4x context, 0.5 = 2x context)</label>
                    <span className="text-[11px] font-mono text-blue-400 font-semibold">{config.ropeFreqScale}x</span>
                  </div>
                  <input
                    type="range"
                    min="0.1"
                    max="1.0"
                    step="0.05"
                    value={config.ropeFreqScale || 1.0}
                    onChange={(e) => setConfig({ ...config, ropeFreqScale: parseFloat(e.target.value) })}
                    className="w-full accent-blue-500 cursor-pointer h-1.5 bg-neutral-700 rounded-lg"
                  />
                </div>
              )}
            </div>
          </div>

          {/* Generation Section */}
          <div className="space-y-4 pt-4 border-t border-white/10">
            <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-400">Generation</h3>

            {/* Temperature */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-xs font-medium text-neutral-200">Temperature</label>
                  <p className="text-[11px] text-neutral-400">Lower is focused, higher is more creative. Recommended 0.7</p>
                </div>
                <span className="text-xs font-mono font-semibold text-blue-400 px-2 py-0.5 rounded bg-blue-500/10 border border-blue-500/20">
                  {config.temperature}
                </span>
              </div>
              <input
                type="range"
                min="0.0"
                max="2.0"
                step="0.05"
                value={config.temperature}
                onChange={(e) => setConfig({ ...config, temperature: parseFloat(e.target.value) })}
                className="w-full accent-blue-500 cursor-pointer h-1.5 bg-neutral-700 rounded-lg"
              />
            </div>

            {/* Max Response Tokens */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-xs font-medium text-neutral-200">Max response tokens</label>
                  <p className="text-[11px] text-neutral-400">Auto adjusts length to the context window (recommended)</p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex rounded bg-white/[0.04] p-0.5 border border-white/5">
                    {["auto", "manual"].map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setConfig({ ...config, responseTokenMode: mode })}
                        className={`px-2.5 py-1 text-[11px] rounded capitalize transition-colors ${
                          config.responseTokenMode === mode
                            ? "bg-blue-600 text-white font-medium"
                            : "text-neutral-400 hover:text-white"
                        }`}
                      >
                        {mode}
                      </button>
                    ))}
                  </div>
                  {config.responseTokenMode === "manual" && (
                    <span className="text-xs font-mono font-semibold text-blue-400 px-2 py-0.5 rounded bg-blue-500/10 border border-blue-500/20">
                      {config.maxTokens}
                    </span>
                  )}
                </div>
              </div>
              {config.responseTokenMode === "manual" && (
                <input
                  type="range"
                  min="256"
                  max="16384"
                  step="256"
                  value={config.maxTokens || 4096}
                  onChange={(e) => setConfig({ ...config, maxTokens: parseInt(e.target.value, 10) })}
                  className="w-full accent-blue-500 cursor-pointer h-1.5 bg-neutral-700 rounded-lg"
                />
              )}
            </div>

            {/* Seed */}
            <div className="flex items-center justify-between pt-1">
              <div>
                <label className="text-xs font-medium text-neutral-200">Seed</label>
                <p className="text-[11px] text-neutral-400">-1 is random. A fixed number repeats the same reply</p>
              </div>
              <input
                type="number"
                value={config.seed ?? -1}
                onChange={(e) => setConfig({ ...config, seed: parseInt(e.target.value, 10) || -1 })}
                className="w-24 bg-[#181b22] border border-white/10 rounded-lg px-2.5 py-1 text-xs text-right font-mono text-neutral-200 focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          {/* Performance Section */}
          <div className="space-y-4 pt-4 border-t border-white/10">
            <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-400">Performance</h3>

            {/* Profile Presets */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-neutral-200">Profile</label>
                <span className="text-[11px] text-neutral-400">Presets fill in the hardware settings below</span>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {["potato", "balanced", "high", "custom"].map((profile) => (
                  <button
                    key={profile}
                    type="button"
                    onClick={() => applyProfile(profile)}
                    className={`px-3 py-1.5 text-xs capitalize rounded-lg font-medium transition-colors border text-center ${
                      config.performanceProfile === profile
                        ? "bg-blue-600/20 text-blue-300 border-blue-500/50"
                        : "bg-white/[0.03] text-neutral-400 border-white/5 hover:bg-white/[0.06]"
                    }`}
                  >
                    {profile}
                  </button>
                ))}
              </div>
            </div>

            {/* Text Backend */}
            <div className="space-y-1.5 pt-2 border-t border-white/5">
              <label className="text-xs font-medium text-neutral-200">Text backend</label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: "cuda", label: "CUDA" },
                  { id: "vulkan", label: "VULKAN" },
                  { id: "cpu", label: "CPU only" }
                ].map((backend) => (
                  <button
                    key={backend.id}
                    type="button"
                    onClick={() => setConfig({ ...config, preferredBackend: backend.id, performanceProfile: "custom" })}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors border text-center ${
                      config.preferredBackend === backend.id
                        ? "bg-blue-600/20 text-blue-300 border-blue-500/50"
                        : "bg-white/[0.03] text-neutral-400 border-white/5 hover:bg-white/[0.06]"
                    }`}
                  >
                    {backend.label}
                  </button>
                ))}
              </div>
            </div>

            {/* CPU Threads */}
            <div className="space-y-2 pt-2 border-t border-white/5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-neutral-200">CPU threads</label>
                <span className="text-xs font-mono font-semibold text-blue-400 px-2 py-0.5 rounded bg-blue-500/10 border border-blue-500/20">
                  {config.threads}
                </span>
              </div>
              <input
                type="range"
                min="1"
                max="32"
                step="1"
                value={config.threads || 8}
                onChange={(e) => setConfig({ ...config, threads: parseInt(e.target.value, 10), performanceProfile: "custom" })}
                className="w-full accent-blue-500 cursor-pointer h-1.5 bg-neutral-700 rounded-lg"
              />
            </div>

            {/* GPU Layers */}
            <div className="space-y-2 pt-2 border-t border-white/5">
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-xs font-medium text-neutral-200">GPU layers</label>
                  <p className="text-[11px] text-neutral-400">-1 or 99 puts all layers on the GPU</p>
                </div>
                <span className="text-xs font-mono font-semibold text-blue-400 px-2 py-0.5 rounded bg-blue-500/10 border border-blue-500/20">
                  {config.gpuLayers === -1 || config.gpuLayers >= 99 ? "All" : config.gpuLayers}
                </span>
              </div>
              <input
                type="range"
                min="-1"
                max="100"
                step="1"
                value={config.gpuLayers ?? -1}
                onChange={(e) => setConfig({ ...config, gpuLayers: parseInt(e.target.value, 10), performanceProfile: "custom" })}
                className="w-full accent-blue-500 cursor-pointer h-1.5 bg-neutral-700 rounded-lg"
              />
            </div>

            {/* Batch Size */}
            <div className="space-y-2 pt-2 border-t border-white/5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-neutral-200">Batch size</label>
                <span className="text-xs font-mono font-semibold text-blue-400 px-2 py-0.5 rounded bg-blue-500/10 border border-blue-500/20">
                  {config.batchSize || 512}
                </span>
              </div>
              <input
                type="range"
                min="128"
                max="2048"
                step="128"
                value={config.batchSize || 512}
                onChange={(e) => setConfig({ ...config, batchSize: parseInt(e.target.value, 10), performanceProfile: "custom" })}
                className="w-full accent-blue-500 cursor-pointer h-1.5 bg-neutral-700 rounded-lg"
              />
            </div>

            {/* KV Cache Precision */}
            <div className="space-y-2 pt-2 border-t border-white/5">
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-xs font-medium text-neutral-200">KV cache</label>
                  <p className="text-[11px] text-neutral-400">Lower precision uses less memory</p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: "q4_0", label: "Q4_0" },
                  { id: "q8_0", label: "Q8_0" },
                  { id: "f16", label: "F16" }
                ].map((kv) => (
                  <button
                    key={kv.id}
                    type="button"
                    onClick={() => setConfig({ ...config, cacheTypeK: kv.id, cacheTypeV: kv.id, performanceProfile: "custom" })}
                    className={`px-3 py-1.5 text-xs font-mono font-medium rounded-lg transition-colors border text-center ${
                      config.cacheTypeK === kv.id
                        ? "bg-blue-600/20 text-blue-300 border-blue-500/50"
                        : "bg-white/[0.03] text-neutral-400 border-white/5 hover:bg-white/[0.06]"
                    }`}
                  >
                    {kv.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Autonomous Execution Section */}
          <div className="space-y-4 pt-4 border-t border-white/10">
            <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-400">Autonomous Agent Loop</h3>

            {/* Autonomous Loop Depth / Max Steps */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-xs font-medium text-neutral-200">Autonomous Loop Depth</label>
                  <p className="text-[11px] text-neutral-400">Maximum autonomous steps and self-correction iterations per run</p>
                </div>
                <span className="text-xs font-mono font-semibold text-blue-400 px-2 py-0.5 rounded bg-blue-500/10 border border-blue-500/20">
                  {config.autonomousMaxSteps || 15} steps
                </span>
              </div>
              <input
                type="range"
                min="1"
                max="50"
                step="1"
                value={config.autonomousMaxSteps || 15}
                onChange={(e) => setConfig({ ...config, autonomousMaxSteps: parseInt(e.target.value, 10) })}
                className="w-full accent-blue-500 cursor-pointer h-1.5 bg-neutral-700 rounded-lg"
              />
            </div>
          </div>

          {/* Restart LLM Option Checkbox */}
          <div className="pt-2">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={restartLlmOnSave}
                onChange={(e) => setRestartLlmOnSave(e.target.checked)}
                className="rounded border-white/20 bg-neutral-800 text-blue-500 focus:ring-0"
              />
              <span className="text-xs text-neutral-300">
                Reload model backend now with these new parameters
              </span>
            </label>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-white/10 bg-[#161922]">
          <div className="flex items-center gap-2">
            {saveSuccess && (
              <span className="flex items-center gap-1.5 text-xs text-emerald-400 font-medium">
                <Check className="w-4 h-4" /> Parameters saved successfully
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-neutral-400 hover:text-white rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 px-5 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-lg shadow-lg shadow-blue-500/20 transition-all disabled:opacity-50"
            >
              {saving ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" /> Applying...
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" /> Save &amp; Apply
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
