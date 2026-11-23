/**
 * AXOM AI Providers Engine
 * Unified client for top free AI distributors:
 * - Groq (LPU Inference - Free Tier)
 * - OpenRouter (Aggregated Free Models: Llama 3.3, Gemini 2.0, DeepSeek R1, Qwen 2.5)
 * - Google Gemini (AI Studio - 1,500 req/day free, 1M context)
 * - Cerebras (Wafer-Scale 2,000+ tok/s - 1M free tokens/day)
 * - DeepSeek (Official DeepSeek-R1 & V3 API)
 * - Custom OpenAI-Compatible Endpoints (Local vLLM, LM Studio, Custom Proxy)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('node:crypto');
const credentialStore = require('../security/credential_store');
const db = require('../db');
const providerRegistry = require('../providers/registry');
const { dataDir } = require('../data_paths');

const freeApisService = require('./free_apis_service');
const KEYS_FILE = path.join(dataDir, 'ai_keys.json');

function buildProviderMetadata() {
  const catalog = freeApisService.getCatalog();
  const map = {};

  for (const p of catalog.providers) {
    map[p.id] = {
      id: p.id,
      name: p.name,
      flag: p.flag || '',
      country: p.country || '',
      tagline: p.description || '',
      badge: p.usage?.quotaLabel || (p.keyless ? 'KEYLESS FREE' : (p.tierType === 'free' ? 'FREE TIER' : 'FREEMIUM')),
      tierType: p.tierType || (p.keyless ? 'free' : 'freemium'),
      author: p.author || 'General',
      keyUrl: p.keyUrl || '',
      baseUrl: p.openaiBaseUrl || p.baseUrl,
      description: p.description || '',
      envKey: p.envVar || '',
      keyless: Boolean(p.keyless),
      noBearer: Boolean(p.noBearer),
      anonymousKey: p.anonymousKey || '',
      keyPrefix: p.keyPrefix || '',
      models: (p.models || []).map(m => ({
        id: `${p.id}/${m.id}`,
        rawId: m.id,
        name: m.name || m.id,
        displayName: `${m.name || m.id} (${p.name})`,
        modality: m.modality,
        contextWindow: m.contextWindow || m.context || '128,000',
        maxTokens: m.maxTokens,
        pricing: m.pricing || null,
        capabilities: m.capabilities || ['Text Generation', 'Function calling'],
        tier: m.tier || p.tierType || 'free',
        author: m.author || p.author || 'General',
        description: m.description || p.description || ''
      }))
    };
  }

  map.custom = {
    id: 'custom',
    name: 'Custom OpenAI-Compatible Endpoint',
    tagline: 'Connect local vLLM, LM Studio, Ollama OpenAI or custom server',
    badge: 'SELF-HOSTED / PROXY',
    tierType: 'free',
    author: 'Self-Hosted',
    keyUrl: '',
    baseUrl: '',
    description: 'Connect any OpenAI-compatible server URL (e.g. http://localhost:1234/v1).',
    envKey: 'CUSTOM_API_KEY',
    models: []
  };

  return map;
}

const PROVIDER_METADATA = buildProviderMetadata();

function loadStoredConfig(profileId = 'prof_default') {
  const defaults = {
    keys: {},
    custom: {
      baseUrl: '',
      model: ''
    },
    activeModel: 'abyx:1.1'
  };

  try {
    if (profileId === 'prof_default' && fs.existsSync(KEYS_FILE)) {
      const data = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));
      defaults.keys = { ...defaults.keys, ...(data.keys || {}) };
      defaults.custom = { ...defaults.custom, ...(data.custom || {}) };
      defaults.activeModel = data.activeModel || defaults.activeModel;
    }
    if (profileId && typeof db.getProfileSetting === 'function') {
      const saved = db.getProfileSetting(profileId, 'provider_config', null);
      if (saved && typeof saved === 'object') {
        return {
          keys: defaults.keys,
          custom: { ...defaults.custom, ...(saved.custom || {}) },
          activeModel: saved.activeModel || defaults.activeModel
        };
      }
    }
    return defaults;
  } catch (err) {
    console.warn('[AI_PROVIDERS] Warning reading profile provider configuration:', err.message);
    return defaults;
  }
}

function saveStoredConfig(config, profileId = 'prof_default') {
  const safeConfig = {
    custom: { baseUrl: String(config?.custom?.baseUrl || ''), model: String(config?.custom?.model || '') },
    activeModel: String(config?.activeModel || 'abyx:1.1')
  };
  try {
    db.setProfileSetting(profileId, 'provider_config', safeConfig);
    return true;
  } catch (err) {
    console.error('[AI_PROVIDERS] Error saving profile provider configuration:', err.message);
    return false;
  }
}

/**
 * Migrate legacy plaintext API keys to OS-backed secret store (Windows DPAPI)
 */
function migratePlaintextKeysToVault() {
  try {
    if (fs.existsSync(KEYS_FILE)) {
      const data = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));
      if (data.keys && Object.keys(data.keys).length > 0) {
        let migratedCount = 0;
        for (const [providerId, rawKey] of Object.entries(data.keys)) {
          if (rawKey && typeof rawKey === 'string' && rawKey.trim()) {
            const meta = credentialStore.storeSecret('prof_default', providerId, rawKey.trim());
            if (meta) {
              try {
                db.saveProviderCredentialMetadata(meta);
              } catch (e) {
                // Ignore if DB not yet initialized
              }
              migratedCount++;
            }
          }
        }
        if (migratedCount > 0) {
          data.keys = {};
          fs.writeFileSync(KEYS_FILE, JSON.stringify(data, null, 2), 'utf8');
          console.log(`[AI_PROVIDERS] Successfully migrated ${migratedCount} plaintext keys to OS-backed credential store (DPAPI).`);
        }
      }
    }
  } catch (err) {
    console.warn('[AI_PROVIDERS] Plaintext key migration notice:', err.message);
  }
}

// Run vault migration check immediately
migratePlaintextKeysToVault();

function maskApiKey(key) {
  if (!key || typeof key !== 'string') return '';
  const trimmed = key.trim();
  if (trimmed.length <= 8) return '••••••••';
  const prefix = trimmed.slice(0, 4);
  const suffix = trimmed.slice(-4);
  return `${prefix}••••${suffix}`;
}

function getEffectiveKey(providerId, profileId = 'prof_default') {
  const pid = profileId || 'prof_default';

  // 1. Try OS-backed vault first (DPAPI encrypted)
  try {
    const vaultSecret = credentialStore.getSecret(pid, providerId);
    if (vaultSecret && vaultSecret.trim()) {
      return vaultSecret.trim();
    }
  } catch (e) {
    // Continue fallback
  }

  // 2. Legacy config fallback
  const cfg = loadStoredConfig(pid);
  if (pid === 'prof_default' && cfg.keys && cfg.keys[providerId] && cfg.keys[providerId].trim()) {
    return cfg.keys[providerId].trim();
  }

  // 3. Environment variable fallback
  const meta = PROVIDER_METADATA[providerId];
  if (meta && meta.envKey && process.env[meta.envKey]) {
    return process.env[meta.envKey].trim();
  }
  return '';
}

function getProviderStatusList(profileId = 'prof_default') {
  const pid = profileId || 'prof_default';
  const cfg = loadStoredConfig(pid);
  const metaMap = buildProviderMetadata();
  const list = [];
  const allModels = [];

  for (const [pId, meta] of Object.entries(metaMap)) {
    const rawKey = getEffectiveKey(pId, pid);
    const hasKey = Boolean(rawKey);
    const masked = maskApiKey(rawKey);

    let isConfigured = hasKey;
    if (pId === 'custom') {
      isConfigured = Boolean(cfg.custom?.baseUrl && cfg.custom?.model);
    }

    const usageStats = freeApisService.getUsageStats(pid);
    const pUsage = usageStats.providers[pId] || {
      requestsToday: 0,
      requestsTotal: 0,
      tokensToday: 0,
      tokensTotal: null,
      percentUsed: null,
      remaining: null,
      quotaLabel: 'Remaining quota unavailable',
      quotaStatus: 'unavailable',
      usageSource: 'locally tracked',
      avgLatencyMs: null
    };

    const provObj = {
      id: pId,
      name: meta.name,
      flag: meta.flag || '🌐',
      country: meta.country || '',
      tierType: meta.tierType || (meta.keyless ? 'free' : 'freemium'),
      author: meta.author || 'General',
      usage: pUsage,
      tagline: meta.tagline,
      badge: meta.badge,
      free_tier: meta.badge || meta.tagline,
      freeTier: meta.badge || meta.tagline,
      keyUrl: meta.keyUrl,
      key_url: meta.keyUrl,
      baseUrl: pId === 'custom' ? (cfg.custom?.baseUrl || '') : (cfg.endpoints?.[pId] || meta.baseUrl),
      base_url: pId === 'custom' ? (cfg.custom?.baseUrl || '') : (cfg.endpoints?.[pId] || meta.baseUrl),
      description: meta.description,
      isConfigured,
      is_configured: isConfigured,
      hasKey,
      has_key: hasKey,
      keyless: meta.keyless,
      maskedKey: masked,
      masked_key: masked,
      customModel: pId === 'custom' ? (cfg.custom?.model || '') : (cfg.defaultModels?.[pId] || undefined),
      custom_model: pId === 'custom' ? (cfg.custom?.model || '') : (cfg.defaultModels?.[pId] || undefined),
      defaultModel: cfg.defaultModels?.[pId] || (meta.models?.[0]?.rawId || meta.models?.[0]?.id || ''),
      modelObjects: meta.models,
      models: meta.models.map(m => m.rawId || m.id)
    };
    list.push(provObj);

    for (const m of meta.models) {
      allModels.push({
        id: m.id,
        rawId: m.rawId || m.id,
        name: m.name || m.id,
        author: m.author || meta.author || 'General',
        providerId: pId,
        providerName: meta.name,
        flag: meta.flag || '🌐',
        tier: m.tier || meta.tierType || 'free',
        pricing: m.pricing || null,
        contextWindow: m.contextWindow || '128,000',
        capabilities: m.capabilities || ['Text Generation', 'Function calling'],
        description: m.description || meta.description || '',
        isConfigured
      });
    }
  }

  return {
    providers: list,
    models: allModels,
    totalModels: allModels.length,
    activeModel: cfg.activeModel || 'abyx:1.1'
  };
}

function saveProvidersConfig(payload = {}, profileId = 'prof_default') {
  const pid = profileId || 'prof_default';
  const cfg = loadStoredConfig(pid);
  if (!cfg.keys) cfg.keys = {};

  const entries = { ...(payload.keys && typeof payload.keys === 'object' ? payload.keys : {}), ...payload };
  delete entries.keys;

  for (const [key, value] of Object.entries(entries)) {
    if (key === 'custom_url' || key === 'custom_model' || key === 'active_model' || key === 'custom' || key === 'endpoints' || key === 'default_models' || key === 'defaultModels') continue;
    if (!Object.prototype.hasOwnProperty.call(PROVIDER_METADATA, key)) continue;
    if (typeof value === 'string' || value === null) {
      const val = value === null ? '' : value.trim();
      if (val && !val.includes('••••')) {
        // Encrypt & store in OS-backed secret store (DPAPI)
        const meta = credentialStore.storeSecret(pid, key, val);
        if (meta) {
          try {
            db.saveProviderCredentialMetadata(meta);
          } catch (e) {
            console.error('[AI_PROVIDERS] DB credential metadata save notice:', e.message);
          }
        }
      } else if (val === '') {
        credentialStore.removeSecret(pid, key);
        try {
          db.removeProviderCredentialMetadata(pid, key);
        } catch (e) {}
        delete cfg.keys[key];
      }
    }
  }

  if (!cfg.custom) cfg.custom = {};
  if (typeof payload.custom_url === 'string') {
    cfg.custom.baseUrl = payload.custom_url.trim();
  }
  if (typeof payload.custom_model === 'string') {
    cfg.custom.model = payload.custom_model.trim();
  }
  if (payload.custom && typeof payload.custom === 'object') {
    if (typeof payload.custom.baseUrl === 'string') cfg.custom.baseUrl = payload.custom.baseUrl.trim();
    if (typeof payload.custom.model === 'string') cfg.custom.model = payload.custom.model.trim();
  }
  if (typeof payload.custom_key === 'string' || typeof payload.custom === 'string') {
    const val = (payload.custom_key || payload.custom || '').trim();
    if (val && !val.includes('••••')) {
      const meta = credentialStore.storeSecret(pid, 'custom', val);
      if (meta) {
        try {
          db.saveProviderCredentialMetadata(meta);
        } catch (e) {}
      }
    } else if (val === '') {
      credentialStore.removeSecret(pid, 'custom');
      try {
        db.removeProviderCredentialMetadata(pid, 'custom');
      } catch (e) {}
      delete cfg.keys.custom;
    }
  }

  if (payload.endpoints && typeof payload.endpoints === 'object') {
    if (!cfg.endpoints) cfg.endpoints = {};
    Object.assign(cfg.endpoints, payload.endpoints);
  }
  if (payload.default_models && typeof payload.default_models === 'object') {
    if (!cfg.defaultModels) cfg.defaultModels = {};
    Object.assign(cfg.defaultModels, payload.default_models);
  }
  if (payload.defaultModels && typeof payload.defaultModels === 'object') {
    if (!cfg.defaultModels) cfg.defaultModels = {};
    Object.assign(cfg.defaultModels, payload.defaultModels);
  }
  if (payload.providerId && payload.defaultModel) {
    if (!cfg.defaultModels) cfg.defaultModels = {};
    cfg.defaultModels[payload.providerId] = payload.defaultModel;
  }

  if (payload.active_model && typeof payload.active_model === 'string') {
    cfg.activeModel = payload.active_model.trim();
  }

  // Ensure no raw keys leak in json file
  cfg.keys = {};
  saveStoredConfig(cfg, pid);

  return {
    saved: true,
    status: getProviderStatusList(pid)
  };
}

const MODEL_CACHE_TTL = 10 * 60 * 1000; // 10 minutes cache
const providerModelCache = new Map();
function modelCacheFor(profileId = 'prof_default') {
  const pid = profileId || 'prof_default';
  if (!providerModelCache.has(pid)) providerModelCache.set(pid, {});
  return providerModelCache.get(pid);
}

/**
 * Dynamically fetch live models from a connected provider API
 */
async function fetchProviderLiveModels(providerId, profileId = 'prof_default') {
  const meta = PROVIDER_METADATA[providerId];
  if (!meta) return [];

  const key = getEffectiveKey(providerId, profileId);
  if (!key && providerId !== 'custom') {
    return [];
  }

  const caches = modelCacheFor(profileId);
  const cache = caches[providerId];
  if (cache && cache.models.length && (Date.now() - cache.timestamp < MODEL_CACHE_TTL)) {
    return cache.models;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    if (providerId === 'openrouter') {
      const res = await fetch('https://openrouter.ai/api/v1/models', {
        headers: {
          'Authorization': `Bearer ${key}`,
          'HTTP-Referer': 'http://localhost:8000',
          'X-Title': 'AXOM'
        },
        signal: controller.signal
      });
      clearTimeout(timeout);
      if (res.ok) {
        const json = await res.json();
        const rawList = Array.isArray(json.data) ? json.data : [];
        const mapped = rawList.map(m => {
          const isFree = m.id.endsWith(':free');
          return {
            id: `openrouter/${m.id}`,
            rawId: m.id,
            name: `${m.name || m.id}${isFree ? ' (Free)' : ''}`,
            provider: 'openrouter',
            providerName: 'OpenRouter',
            context: m.context_length ? `${Math.round(m.context_length / 1024)}k ctx` : undefined,
            isFree,
            freeTierNote: isFree ? 'Completely Free ($0.00)' : undefined,
            badge: isFree ? 'FREE' : undefined,
            isLocal: false,
            isConfigured: true
          };
        });

        // Sort: free models first, then alphabetical by name
        mapped.sort((a, b) => {
          if (a.isFree && !b.isFree) return -1;
          if (!a.isFree && b.isFree) return 1;
          return a.name.localeCompare(b.name);
        });

        caches.openrouter = { timestamp: Date.now(), models: mapped };
        return mapped;
      }
    } else if (providerId === 'groq') {
      const res = await fetch('https://api.groq.com/openai/v1/models', {
        headers: { 'Authorization': `Bearer ${key}` },
        signal: controller.signal
      });
      clearTimeout(timeout);
      if (res.ok) {
        const json = await res.json();
        const rawList = Array.isArray(json.data) ? json.data : [];
        const mapped = rawList
          .filter(m => !m.id.includes('whisper'))
          .map(m => ({
            id: `groq/${m.id}`,
            rawId: m.id,
            name: `${m.id} (Groq LPU)`,
            provider: 'groq',
            providerName: 'Groq',
            badge: 'LPU FAST',
            isLocal: false,
            isConfigured: true
          }));
        caches.groq = { timestamp: Date.now(), models: mapped };
        return mapped;
      }
    } else if (providerId === 'gemini') {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`, {
        signal: controller.signal
      });
      clearTimeout(timeout);
      if (res.ok) {
        const json = await res.json();
        const rawList = Array.isArray(json.models) ? json.models : [];
        const mapped = rawList
          .filter(m => m.supportedGenerationMethods && m.supportedGenerationMethods.includes('generateContent'))
          .map(m => {
            const cleanId = m.name.replace(/^models\//, '');
            return {
              id: `gemini/${cleanId}`,
              rawId: cleanId,
              name: `${m.displayName || cleanId} (Google Gemini)`,
              provider: 'gemini',
              providerName: 'Google Gemini (AI Studio)',
              context: m.inputTokenLimit ? `${Math.round(m.inputTokenLimit / 1024)}k ctx` : '1M ctx',
              badge: '1M CTX',
              isLocal: false,
              isConfigured: true
            };
          });
        caches.gemini = { timestamp: Date.now(), models: mapped };
        return mapped;
      }
    } else if (providerId === 'cerebras') {
      const res = await fetch('https://api.cerebras.ai/v1/models', {
        headers: { 'Authorization': `Bearer ${key}` },
        signal: controller.signal
      });
      clearTimeout(timeout);
      if (res.ok) {
        const json = await res.json();
        const rawList = Array.isArray(json.data) ? json.data : [];
        const mapped = rawList.map(m => ({
          id: `cerebras/${m.id}`,
          rawId: m.id,
          name: `${m.id} (Cerebras Wafer-Scale)`,
          provider: 'cerebras',
          providerName: 'Cerebras',
          badge: '2000 TOK/S',
          isLocal: false,
          isConfigured: true
        }));
        caches.cerebras = { timestamp: Date.now(), models: mapped };
        return mapped;
      }
    } else if (providerId === 'deepseek') {
      const res = await fetch('https://api.deepseek.com/v1/models', {
        headers: { 'Authorization': `Bearer ${key}` },
        signal: controller.signal
      });
      clearTimeout(timeout);
      if (res.ok) {
        const json = await res.json();
        const rawList = Array.isArray(json.data) ? json.data : [];
        const mapped = rawList.map(m => ({
          id: `deepseek/${m.id}`,
          rawId: m.id,
          name: `${m.id === 'deepseek-reasoner' ? 'DeepSeek R1 Reasoner' : 'DeepSeek V3 Chat'}`,
          provider: 'deepseek',
          providerName: 'DeepSeek',
          badge: m.id === 'deepseek-reasoner' ? 'REASONER' : 'CHAT',
          isLocal: false,
          isConfigured: true
        }));
        caches.deepseek = { timestamp: Date.now(), models: mapped };
        return mapped;
      }
    }
  } catch (e) {
    console.warn(`[AI_PROVIDERS] Live model fetch for ${providerId} notice:`, e.message);
  }

  return [];
}

/**
 * Discover locally installed Ollama models
 */
async function fetchLocalOllamaModels() {
  const caches = modelCacheFor();
  const cache = caches.local;
  if (cache && cache.models.length && (Date.now() - cache.timestamp < MODEL_CACHE_TTL)) {
    return cache.models;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch('http://localhost:11434/api/tags', { signal: controller.signal });
    clearTimeout(timeout);

    if (res.ok) {
      const json = await res.json();
      const list = Array.isArray(json.models) ? json.models : [];
      const result = [];
      const seen = new Set();

      for (const m of list) {
        if (!seen.has(m.name) && !m.name.toLowerCase().includes('embedding')) {
          seen.add(m.name);
          result.push({
            id: m.name,
            name: `${m.name} (Local Ollama)`,
            provider: 'ollama',
            providerName: 'Ollama',
            badge: 'LOCAL',
            isLocal: true,
            isConfigured: true
          });
        }
      }
      caches.local = { timestamp: Date.now(), models: result };
      return result;
    }
  } catch (e) {}

  return [];
}

/**
 * Check if input is a simple greeting or casual chitchat
 */
function isBasicPrompt(text) {
  if (!text || typeof text !== 'string') return true;
  const t = text.trim().toLowerCase();
  if (t.length <= 60) {
    if (/^(hi|hello|hey|yo|sup|hiya|howdy|good\s+(morning|afternoon|evening|day)|how\s+are\s+you(\s+doing)?|what'?s\s+up|who\s+are\s+you|what\s+is\s+your\s+name|ola|olá|oi|tudo\s+bem|como\s+vai|thanks|thank\s+you)\b[\s!.?]*$/i.test(t)) {
      return true;
    }
  }
  return false;
}

/**
 * Detect whether a user prompt actually requires complex reasoning / deep thinking.
 * Simple greetings, casual chit-chat, and straightforward queries must NOT trigger reasoning loops.
 */
function isComplexTask(prompt = '', context = {}) {
  if (!prompt || typeof prompt !== 'string') return false;
  const t = prompt.trim().toLowerCase();

  // 1. Basic casual greetings or brief chitchat are NEVER complex
  if (isBasicPrompt(t)) return false;

  // 2. Explicit request for reasoning or step-by-step thinking
  if (/\b(think|reasoning|step[- ]by[- ]step|think through|explain why|detailed analysis|how does|why does|solve|prove|derive|compare|benchmark|audit)\b/i.test(t)) {
    return true;
  }

  // 3. Explicit agent, research, web search, subagent, or RAG tasks
  if (context.agent_mode || context.research_mode || context.web_search || context.subagent || context.isRag) {
    return true;
  }

  // 4. Programming, coding, architecture, debugging
  if (/\b(code|function|class|method|debug|refactor|script|html|css|javascript|typescript|python|sql|api|regex|json|algorithm|git|terminal|powershell|bash|npm|test|compile|docker)\b/i.test(t)) {
    return true;
  }

  // 5. High-complexity mathematics or logic
  if (/\b(calculate|math|integral|equation|formula|matrix|latex|theorem|probability|derivative)\b/i.test(t)) {
    return true;
  }

  // 6. File generation, artifacts, or creative projects
  if (/\b(create|generate|write|build|make)\s+(file|folder|script|app|page|document|pdf|zip|table|program|component)\b/i.test(t)) {
    return true;
  }

  // 7. Length threshold: long queries (>200 chars) usually have multiple constraints
  if (t.length > 200) {
    return true;
  }

  return false;
}

/**
 * Asynchronously fetch combined model list - exactly two user choices: auto and axom:1.1
 */
async function getCombinedModelListAsync({ force = false, profileId = 'prof_default' } = {}) {
  // Pre-warm provider model cache in background for auto-routing
  if (force || !modelCacheFor(profileId).openrouter?.models?.length) {
    fetchProviderLiveModels('openrouter', profileId).catch(() => {});
  }
  if (force || !modelCacheFor(profileId).gemini?.models?.length) {
    fetchProviderLiveModels('gemini', profileId).catch(() => {});
  }

  const baseList = [
    {
      id: 'auto',
      name: 'Auto (Best Model)',
      provider: 'auto',
      providerName: 'Auto-Router',
      isAuto: true,
      badge: 'BEST MODEL',
      capabilities: { tools: true, vision: true, reasoning: true, contextWindow: 128000, streaming: true },
      description: 'Automatically analyzes your prompt. If simple (like "hi"), replies instantly without thinking or web search. If complex or real-time, autonomously routes to Abyx, OpenRouter, or Gemini.'
    }
  ];

  try {
    const registryModels = await providerRegistry.listAllModels({ profileId });
    const seenIds = new Set(baseList.map(m => m.id));
    for (const rm of registryModels) {
      if (rm.provider) {
        const cache = modelCacheFor(profileId);
        cache[rm.provider] = cache[rm.provider] || { timestamp: Date.now(), models: [] };
        if (!cache[rm.provider].models.some(item => item.id === rm.id)) cache[rm.provider].models.push({ ...rm, isConfigured: true });
      }
      if (rm.provider === 'ollama') {
        const local = modelCacheFor(profileId);
        local.local = local.local || { timestamp: Date.now(), models: [] };
        if (!local.local.models.some(item => item.id === rm.id)) local.local.models.push({ ...rm, isLocal: true, isConfigured: true });
      }
      if (!seenIds.has(rm.id)) {
        seenIds.add(rm.id);
        baseList.push(rm);
      }
    }
  } catch (e) {}

  return baseList;
}

function getCombinedModelList() {
  return [
    {
      id: 'auto',
      name: 'Auto (Best Model)',
      provider: 'auto',
      providerName: 'Auto-Router',
      isAuto: true,
      badge: 'BEST MODEL',
      description: 'Automatically analyzes your prompt. If simple (like "hi"), replies instantly without thinking or web search. If complex or real-time, autonomously routes to Axom, OpenRouter Free, or Google Gemini.'
    }
  ];
}

/**
 * Intelligent reasoning-based model router.
 * Evaluates prompt reasoning depth, coding logic, and analytical complexity.
 * Strictly uses user-configured cloud providers (with valid keys) or the local RTX 5060 engine.
 */
function selectBestModelForTask(prompt = '', options = {}) {
  const { isRag = false, hasWebSearch = false, hasAttachments = false, profileId = 'prof_default', isOllamaLive = false, isLocalReady = true } = options;
  const status = getProviderStatusList(profileId);
  const models = modelCacheFor(profileId);
  const lower = String(prompt || '').toLowerCase();

  const getProvModels = (pId) => {
    if (models[pId]?.models?.length) return models[pId].models;
    const found = status.providers.find(p => p.id === pId);
    if (found?.models?.length) {
      return found.models.map(m => typeof m === 'string' ? { id: `${pId}/${m}`, rawId: m, name: m } : m);
    }
    const meta = PROVIDER_METADATA[pId];
    if (meta?.models?.length) return meta.models;
    return [];
  };

  // Only providers where hasKey or custom is genuinely configured by the user
  const isProvOk = (pId) => {
    const found = status.providers.find(p => p.id === pId);
    if (!found || !found.isConfigured || !found.hasKey) {
      if (pId === 'custom' && found?.isConfigured) return true;
      return false;
    }
    const mList = getProvModels(pId);
    return Boolean(mList && mList.length > 0);
  };

  const getModel = (pId, matcher) => {
    const list = getProvModels(pId);
    if (!list.length) return null;
    if (typeof matcher === 'function') {
      const match = list.find(matcher);
      if (match) return match;
    }
    return list[0];
  };

  const pick = (pId, reason, category, matcher) => {
    const m = getModel(pId, matcher);
    if (!m) return null;
    const meta = PROVIDER_METADATA[pId];
    const provName = meta?.name || pId.toUpperCase();
    const rawId = m.rawId || m.id;
    const modelId = (rawId.includes('/') || rawId.startsWith(pId + '/')) ? rawId : `${pId}/${rawId}`;
    return {
      providerId: pId,
      providerName: provName,
      selectedModel: modelId,
      model: modelId,
      selectedModelName: m.name || m.displayName || rawId,
      category,
      reason
    };
  };

  // --- REASONING DEPTH EVALUATION ---
  const mathPatterns = [
    /\b(prove|proof|theorem|derive|derivation|calculate|equation|integral|derivative|matrix|vector|probability|calculus|algebra|eigen|formula)\b/,
    /\b(step-by-step|step by step|logical analysis|philosophy|counterexample|falsifiable|deduction|syllogism|contradiction)\b/,
    /\b(scientific|peer review|hypothesis|physics|chemistry|thermodynamics|quantum)\b/
  ];
  const codePatterns = [
    /\b(function|def|class|const|let|var|return|async|await|import|export)\b/,
    /\b(python|javascript|typescript|c\+\+|java|rust|golang|sql|html|css|json|react|vue|node)\b/,
    /\b(bug|error|exception|debug|syntax|refactor|regex|algorithm|api|endpoint|architecture|schema|database)\b/,
    /```/
  ];
  const deepThinkingPatterns = [
    /\b(analyze|analysis|compare|contrast|trade-off|tradeoff|evaluate|critique|comprehensive|deep dive|explain why)\b/,
    /\b(plan|strategy|roadmap|architecture|design system|optimizations?|root cause)\b/
  ];

  let reasoningScore = 0;
  if (mathPatterns.some(p => p.test(lower))) reasoningScore += 45;
  if (codePatterns.some(p => p.test(lower))) reasoningScore += 40;
  if (deepThinkingPatterns.some(p => p.test(lower))) reasoningScore += 25;
  if (lower.length > 500) reasoningScore += 15;
  if (isRag || hasAttachments) reasoningScore += 20;

  const isBasic = isBasicPrompt(prompt) && reasoningScore < 10 && lower.length < 80;

  // 1. High/Frontier Reasoning Required (Score >= 45)
  if (reasoningScore >= 45) {
    const frontierChoice =
      (isProvOk('deepseek') && pick('deepseek', 'Full chain-of-thought mathematical & logical reasoning (R1)', 'reasoning', m => /reasoner|r1/i.test(m.id || '')))
      || (isProvOk('openai') && pick('openai', 'Frontier reasoning engine (o1/o3-mini)', 'reasoning', m => /^o[13]|reason/i.test(m.id || '')))
      || (isProvOk('anthropic') && pick('anthropic', 'Hybrid deep reasoning (Claude 3.7 / Sonnet)', 'reasoning', m => /3-7|sonnet/i.test(m.id || '')))
      || (isProvOk('groq') && pick('groq', 'Sub-second reasoning (DeepSeek-R1 Distill)', 'reasoning', m => /r1|reasoning/i.test(m.id || '')))
      || (isProvOk('gemini') && pick('gemini', 'Deep analytical reasoning (Thinking/Pro)', 'reasoning', m => /thinking|pro/i.test(m.id || '')))
      || (isProvOk('openrouter') && pick('openrouter', 'Frontier chain-of-thought reasoning', 'reasoning', m => /r1|reasoning|o1|o3/i.test(m.id || '')))
      || (isProvOk('anthropic') && pick('anthropic', 'Frontier code intelligence & architecture (Claude Sonnet)', 'code', m => /sonnet/i.test(m.id || '')))
      || (isProvOk('openai') && pick('openai', 'Frontier code logic (GPT-4o)', 'code', m => /4o/i.test(m.id || '')))
      || (isProvOk('mistral') && pick('mistral', 'Specialized code synthesis (Codestral)', 'code', m => /codestral/i.test(m.id || '')));

    if (frontierChoice) return frontierChoice;

    return {
      providerId: 'local',
      providerName: 'Local AI Engine',
      selectedModel: 'local',
      model: 'local',
      selectedModelName: 'Local RTX 5060 (Reasoning Mode)',
      category: 'reasoning',
      reason: `High reasoning task (Score: ${reasoningScore}/100) - executed on local RTX 5060 with step-by-step reasoning`
    };
  }

  // 2. Fast / Low Reasoning Queries (Casual greeting, quick basic chitchat)
  if (isBasic) {
    if (isLocalReady) {
      return {
        providerId: 'local',
        providerName: 'Local AI Engine',
        selectedModel: 'local',
        model: 'local',
        selectedModelName: 'Local RTX 5060 (Fast Reflex)',
        category: 'instant',
        isBasic: true,
        reason: 'Instant sub-second response on local RTX 5060 GPU'
      };
    }
    const fastCloud =
      (isProvOk('groq') && pick('groq', 'Sub-second LPU fast response', 'instant'))
      || (isProvOk('cerebras') && pick('cerebras', 'Wafer-scale 2,000+ tok/s fast response', 'instant'))
      || (isProvOk('gemini') && pick('gemini', 'High-speed Gemini Flash response', 'instant', m => /flash/i.test(m.id || '')))
      || (isProvOk('openai') && pick('openai', 'Instant lightweight response (GPT-4o Mini)', 'instant', m => /mini/i.test(m.id || '')))
      || (isProvOk('anthropic') && pick('anthropic', 'Fast Claude Haiku response', 'instant', m => /haiku/i.test(m.id || '')));
    if (fastCloud) return fastCloud;
  }

  // 3. Medium Reasoning & General Tasks
  const anyConfiguredCloud =
    (isProvOk('anthropic') && pick('anthropic', 'Versatile frontier intelligence (Claude Sonnet)', 'general', m => /sonnet/i.test(m.id || '')))
    || (isProvOk('openai') && pick('openai', 'Multimodal intelligence (GPT-4o)', 'general', m => /4o/i.test(m.id || '')))
    || (isProvOk('gemini') && pick('gemini', 'High-speed multimodal intelligence (Gemini Flash)', 'general', m => /flash/i.test(m.id || '')))
    || (isProvOk('deepseek') && pick('deepseek', 'Balanced instruction model (DeepSeek-V3)', 'general', m => /chat|v3/i.test(m.id || '')))
    || (isProvOk('groq') && pick('groq', 'Fast versatile LPU inference', 'general'))
    || (isProvOk('openrouter') && pick('openrouter', 'Configured cloud intelligence', 'general'))
    || (isProvOk('mistral') && pick('mistral', 'Mistral instruction intelligence', 'general'))
    || (isProvOk('cerebras') && pick('cerebras', 'Wafer-scale inference', 'general'))
    || (isProvOk('cohere') && pick('cohere', 'Command R instruction following', 'general'))
    || (isProvOk('custom') && pick('custom', 'Custom OpenAI-compatible endpoint', 'general'));

  if (anyConfiguredCloud) return anyConfiguredCloud;

  // 4. Default: Local Model on RTX 5060 (100% private, zero cost, GPU-accelerated)
  return {
    providerId: 'local',
    providerName: 'Local AI Engine',
    selectedModel: 'local',
    model: 'local',
    selectedModelName: 'Local RTX 5060 Model',
    category: 'general',
    reason: 'Executed securely on local RTX 5060 GPU'
  };
}

function isCloudModel(modelId) {
  if (!modelId || typeof modelId !== 'string') return false;
  const m = modelId.trim().toLowerCase();
  if (m === 'auto' || m === 'abyx' || m === 'axom' || m.startsWith('abyx:') || m.startsWith('axom:') || m.startsWith('local:') || m.startsWith('ollama:')) {
    return false;
  }
  if (m.includes('/') && !m.includes('127.0.0.1')) {
    return true;
  }
  if (m.startsWith('gpt-') || m.startsWith('o1') || m.startsWith('o3') || m.startsWith('claude-') || m.startsWith('gemini-') || m.startsWith('gemma-') || m.startsWith('deepseek-') || m.startsWith('codestral') || m.startsWith('mistral-') || m.startsWith('command-') || m.startsWith('llama-') || m.startsWith('qwen-') || m === 'openai' || m === 'pollinations' || m === 'pai') {
    return true;
  }
  try {
    const catalog = freeApisService.getCatalog();
    for (const p of catalog.providers) {
      if (p.id === 'local' || p.id === 'ollama' || p.id === 'lmstudio') continue;
      if (m === p.id) return true;
      for (const model of (p.models || [])) {
        const raw = (model.rawId || model.id || model.name || '').toLowerCase();
        if (raw === m) return true;
      }
    }
  } catch (e) {}
  return false;
}


/**
 * Resolves a resilient cascading failover chain for free tiers
 */
function getFailoverCandidates(failedModelId, profileId = 'prof_default') {
  const candidates = [];
  const resolved = resolveProvider(failedModelId);
  const failedProvId = resolved?.providerId;
  const cfg = loadStoredConfig(profileId);

  // 1. Configured cloud providers with active keys (Groq -> Gemini -> OpenRouter -> Cohere -> Aion -> NVIDIA)
  const priorityOrder = ['groq', 'gemini', 'openrouter', 'cohere', 'aion', 'nvidia', 'zai', 'siliconflow'];
  for (const pId of priorityOrder) {
    if (pId === failedProvId) continue;
    const key = getEffectiveKey(pId, profileId);
    if (key && PROVIDER_METADATA[pId]?.models?.length) {
      const topModel = PROVIDER_METADATA[pId].models[0];
      candidates.push({
        providerId: pId,
        modelId: topModel.id,
        name: PROVIDER_METADATA[pId].name,
        type: 'configured_cloud'
      });
    }
  }

  // 2. Guaranteed keyless permanent free gateways
  if (failedProvId !== 'kilo') {
    candidates.push({
      providerId: 'kilo',
      modelId: 'kilo/nvidia/nemotron-3.5-lightning:free',
      name: 'Kilo Code (Keyless)',
      type: 'keyless'
    });
  }
  if (failedProvId !== 'llm7') {
    candidates.push({
      providerId: 'llm7',
      modelId: 'llm7/gpt-oss:20b',
      name: 'LLM7.io (Keyless)',
      type: 'keyless'
    });
  }
  if (failedProvId !== 'ovhcloud') {
    candidates.push({
      providerId: 'ovhcloud',
      modelId: 'ovhcloud/Meta-Llama-3.1-70B-Instruct',
      name: 'OVHcloud AI (Keyless EU)',
      type: 'keyless'
    });
  }

  return candidates;
}

function resolveProvider(modelId) {
  if (!modelId || typeof modelId !== 'string') return null;
  const cleanId = modelId.trim();
  const lower = cleanId.toLowerCase();

  // Pollinations and PAI aliases
  if (lower === 'pollinations' || lower === 'pai' || lower === 'openai') {
    return {
      providerId: 'pollinations',
      rawModel: 'openai',
      meta: PROVIDER_METADATA['pollinations']
    };
  }
  if (lower.startsWith('pai/')) {
    return {
      providerId: 'pollinations',
      rawModel: cleanId.replace(/^pai\//i, ''),
      meta: PROVIDER_METADATA['pollinations']
    };
  }
  if (lower.startsWith('pollinations/')) {
    return {
      providerId: 'pollinations',
      rawModel: cleanId.replace(/^pollinations\//i, ''),
      meta: PROVIDER_METADATA['pollinations']
    };
  }

  // OpenRouter base alias
  if (lower === 'openrouter' || lower === 'openrouter/') {
    return {
      providerId: 'openrouter',
      rawModel: 'cohere/north-mini-code:free',
      meta: PROVIDER_METADATA['openrouter']
    };
  }
  if (lower.startsWith('openrouter/')) {
    return {
      providerId: 'openrouter',
      rawModel: cleanId.replace(/^openrouter\//i, ''),
      meta: PROVIDER_METADATA['openrouter']
    };
  }
  if (lower.endsWith(':free')) {
    return {
      providerId: 'openrouter',
      rawModel: cleanId,
      meta: PROVIDER_METADATA['openrouter']
    };
  }

  // Check known openrouter catalog check
  const openRouterModels = PROVIDER_METADATA['openrouter']?.models || [];
  if (openRouterModels.some(m => m.rawId === cleanId || m.id === cleanId)) {
    return {
      providerId: 'openrouter',
      rawModel: cleanId,
      meta: PROVIDER_METADATA['openrouter']
    };
  }

  // Standard prefix check (e.g. "openai/gpt-4o", "groq/llama-3.3-70b-versatile", etc.)
  if (cleanId.includes('/')) {
    const parts = cleanId.split('/');
    const prefix = parts[0].toLowerCase();
    const meta = PROVIDER_METADATA[prefix];
    if (meta) {
      const rawModel = parts.slice(1).join('/');
      return {
        providerId: prefix,
        rawModel: rawModel || cleanId,
        meta
      };
    }
    // Fallback for any other prefix with slash: OpenRouter
    if (PROVIDER_METADATA['openrouter']) {
      return {
        providerId: 'openrouter',
        rawModel: cleanId,
        meta: PROVIDER_METADATA['openrouter']
      };
    }
  }

  // Bare models without slash:
  // OpenAI
  if (lower.startsWith('gpt-') || lower.startsWith('o1') || lower.startsWith('o3')) {
    return {
      providerId: 'openai',
      rawModel: cleanId,
      meta: PROVIDER_METADATA['openai']
    };
  }

  // Anthropic Claude
  if (lower.startsWith('claude-')) {
    return {
      providerId: 'anthropic',
      rawModel: cleanId,
      meta: PROVIDER_METADATA['anthropic']
    };
  }

  // Google Gemini
  if (lower.startsWith('gemini-') || lower.startsWith('gemma-')) {
    return {
      providerId: 'gemini',
      rawModel: cleanId,
      meta: PROVIDER_METADATA['gemini']
    };
  }

  // DeepSeek
  if (lower.startsWith('deepseek-') || lower.startsWith('deepseek/')) {
    return {
      providerId: 'deepseek',
      rawModel: cleanId.replace(/^deepseek\//i, ''),
      meta: PROVIDER_METADATA['deepseek']
    };
  }

  // Mistral
  if (lower.startsWith('mistral-') || lower.startsWith('codestral') || lower.startsWith('ministral-') || lower.startsWith('pixtral-')) {
    return {
      providerId: 'mistral',
      rawModel: cleanId,
      meta: PROVIDER_METADATA['mistral']
    };
  }

  // Cohere
  if (lower.startsWith('command-') || lower.startsWith('c4ai-')) {
    return {
      providerId: 'cohere',
      rawModel: cleanId,
      meta: PROVIDER_METADATA['cohere']
    };
  }

  // Search across catalog models
  try {
    const catalog = freeApisService.getCatalog();
    for (const p of catalog.providers) {
      if (p.id === 'local' || p.id === 'ollama' || p.id === 'lmstudio') continue;
      for (const m of (p.models || [])) {
        const raw = (m.rawId || m.id || m.name || '').toLowerCase();
        if (raw === lower) {
          return {
            providerId: p.id,
            rawModel: m.rawId || m.id || cleanId,
            meta: PROVIDER_METADATA[p.id]
          };
        }
      }
    }
  } catch (e) {}

  return null;
}

/**
 * Test connectivity and auth for any provider
 */
async function testProviderConnection(providerId, apiKey, customBaseUrl = '', customModel = '', profileId = 'prof_default') {
  const adapter = providerRegistry.getAdapter(providerId);
  if (adapter) {
    const key = apiKey || credentialStore.getSecret(profileId, providerId);
    const res = await adapter.testConnection({ apiKey: key, baseUrl: customBaseUrl, model: customModel });
    return {
      ok: res.ok,
      success: res.ok,
      latency_ms: res.latencyMs || 0,
      latency: `${res.latencyMs || 0}ms`,
      model: res.model || customModel,
      error: res.error,
      statusCode: res.statusCode
    };
  }

  const res = await freeApisService.testEndpoint(providerId, customModel, apiKey, profileId);
  return {
    ok: res.ok,
    success: res.ok,
    latency_ms: res.latency_ms,
    latency: `${res.latency_ms}ms`,
    status: res.status,
    model: res.model,
    sampleReply: res.reply,
    error: res.error
  };
}

/**
 * Universal OpenAI-compatible streaming chat completion for cloud distributors
 */
function estimateUsageTokens(messages = [], output = '') {
  const inputText = messages.map(message => typeof message.content === 'string' ? message.content : JSON.stringify(message.content || '')).join('\n');
  return { inputTokens: Math.ceil(inputText.length / 4), outputTokens: Math.ceil(String(output || '').length / 4) };
}

function buildUsageMetadata({ providerId, model, messages, output, usage, durationMs, status = 'success' }) {
  const estimated = estimateUsageTokens(messages, output);
  const hasActualInput = usage?.inputTokens != null && usage.inputTokens !== '' && Number.isFinite(Number(usage.inputTokens));
  const hasActualOutput = usage?.outputTokens != null && usage.outputTokens !== '' && Number.isFinite(Number(usage.outputTokens));
  const tokenSource = hasActualInput && hasActualOutput ? 'actual' : (status === 'success' ? 'estimated' : 'unavailable');
  const inputTokens = hasActualInput ? Number(usage.inputTokens) : (tokenSource === 'estimated' ? estimated.inputTokens : null);
  const outputTokens = hasActualOutput ? Number(usage.outputTokens) : (tokenSource === 'estimated' ? estimated.outputTokens : null);
  return {
    providerId,
    model,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens == null || outputTokens == null ? null : inputTokens + outputTokens,
    tokenSource,
    durationMs: Number.isFinite(Number(durationMs)) ? Math.max(0, Math.round(Number(durationMs))) : null
  };
}

function writeUsageMetadata(res, metadata) {
  if (res && typeof res.write === 'function' && !res.writableEnded) {
    res.write(`data: ${JSON.stringify({ type: 'usage', ...metadata })}\n\n`);
  }
}

function saveUsageEvent({ requestId, profileId, sessionId, agentId, requestType, providerId, model, messages, output, usage, durationMs, status = 'success', errorCode, rateLimitEvent = false }) {
  const metadata = buildUsageMetadata({ providerId, model, messages, output, usage, durationMs, status });
  db.recordAiUsageEvent({
    requestId, profileId, sessionId, agentId, requestType, providerId, model,
    inputTokens: metadata.inputTokens,
    outputTokens: metadata.outputTokens,
    cachedInputTokens: usage?.cachedInputTokens, reasoningTokens: usage?.reasoningTokens,
    tokenSource: metadata.tokenSource, durationMs: metadata.durationMs, status, errorCode, rateLimitEvent
  });
  return metadata;
}

function persistQuotaSnapshots(providerId, profileId, snapshots = []) {
  for (const item of snapshots || []) db.saveProviderQuotaSnapshot(profileId, { ...item, providerId, source: 'provider_header' });
}

function readOpenAiQuotaHeaders(headers) {
  const snapshots = [];
  for (const [quotaKind, suffix] of [['requests', 'requests'], ['tokens', 'tokens']]) {
    const limit = headers.get(`x-ratelimit-limit-${suffix}`);
    const remaining = headers.get(`x-ratelimit-remaining-${suffix}`);
    if (limit == null && remaining == null) continue;
    const resetRaw = headers.get(`x-ratelimit-reset-${suffix}`);
    let resetAt = null;
    if (resetRaw) {
      const absolute = Date.parse(resetRaw);
      if (Number.isFinite(absolute)) resetAt = new Date(absolute).toISOString();
      else {
        const match = resetRaw.match(/^(\d+(?:\.\d+)?)(ms|s|m|h)$/i);
        if (match) {
          const factor = { ms: 1, s: 1000, m: 60000, h: 3600000 }[match[2].toLowerCase()];
          resetAt = new Date(Date.now() + Number(match[1]) * factor).toISOString();
        }
      }
    }
    snapshots.push({ quotaKind, limitValue: limit == null ? null : Number(limit), remainingValue: remaining == null ? null : Number(remaining), resetAt });
  }
  return snapshots;
}

async function streamProviderChat({ model, modelId, messages, temperature, max_tokens, params = {}, res, signal, isBasic = false, onChunk, onThink, onFinish, enableFailover = true, attempt = 0, candidates = null, profileId = 'prof_default', sessionId = null, agentId = null, requestType = 'chat', requestId = null, requestStartedAt = null }) {
  const chosenModel = model || modelId;
  const currentRequestId = requestId || crypto.randomUUID();
  const startedAt = requestStartedAt || Date.now();

  // Direct check for modern modular adapters
  const pIdCandidate = chosenModel.includes('/') ? chosenModel.split('/')[0].toLowerCase() : null;
  const directAdapter = providerRegistry.getAdapter(pIdCandidate) ||
    (chosenModel.startsWith('gpt-') || chosenModel.startsWith('o1') || chosenModel.startsWith('o3') ? providerRegistry.getAdapter('openai') : null) ||
    (chosenModel.startsWith('claude-') ? providerRegistry.getAdapter('anthropic') : null) ||
    (chosenModel.startsWith('gemini-') ? providerRegistry.getAdapter('gemini') : null);

  if (directAdapter) {
    try {
      const streamRes = await directAdapter.streamChat({
        model: chosenModel.includes('/') ? chosenModel.split('/').slice(1).join('/') : chosenModel,
        messages,
        temperature,
        maxTokens: max_tokens || 4096,
        signal,
        onChunk: (chunk) => {
          if (res && typeof res.write === 'function' && !res.writableEnded) {
            res.write(`data: ${JSON.stringify({ text: chunk, content: chunk })}\n\n`);
          }
          if (onChunk) onChunk(chunk);
        },
        onReasoning: (reasoning) => {
          if (res && typeof res.write === 'function' && !res.writableEnded) {
            res.write(`data: ${JSON.stringify({ type: 'think', text: reasoning })}\n\n`);
          }
          if (onThink) onThink(reasoning);
        },
        onFinish: (result) => {
          if (onFinish) onFinish(result.content);
        },
        apiKey: getEffectiveKey(directAdapter.id, profileId),
        baseUrl: params.baseUrl
      });
      const durationMs = Date.now() - startedAt;
      const metadata = saveUsageEvent({ requestId: currentRequestId, profileId, sessionId, agentId, requestType, providerId: directAdapter.id, model: chosenModel, messages, output: streamRes?.content, usage: streamRes?.usage, durationMs });
      writeUsageMetadata(res, metadata);
      if (res && typeof res.write === 'function' && !res.writableEnded) {
        res.write(`data: ${JSON.stringify({ type: 'done', fullText: streamRes?.content || '' })}\n\n`);
        res.end();
      }
      persistQuotaSnapshots(directAdapter.id, profileId, streamRes?.rateLimits);
      return streamRes;
    } catch (adapterErr) {
      persistQuotaSnapshots(directAdapter.id, profileId, adapterErr.rateLimits);
      const statusCode = adapterErr.statusCode || Number(String(adapterErr.message).match(/\bHTTP(?: error)?\s*(\d{3})\b/i)?.[1]) || null;
      saveUsageEvent({ requestId: currentRequestId, profileId, sessionId, agentId, requestType, providerId: directAdapter.id, model: chosenModel, messages, durationMs: Date.now() - startedAt, status: adapterErr.name === 'AbortError' ? 'cancelled' : 'failed', errorCode: statusCode ? `HTTP_${statusCode}` : adapterErr.name, rateLimitEvent: statusCode === 429 || /rate.?limit|quota/i.test(adapterErr.message) });
      if (res && typeof res.write === 'function' && !res.writableEnded) {
        res.write(`data: ${JSON.stringify({ type: 'error', message: adapterErr.message })}\n\n`);
        return res.end();
      }
      throw adapterErr;
    }
  }

  const resolved = resolveProvider(chosenModel);
  if (!resolved) {
    const err = new Error(`Unsupported cloud model identifier: ${chosenModel}`);
    saveUsageEvent({ requestId: currentRequestId, profileId, sessionId, agentId, requestType, providerId: 'unknown', model: chosenModel || 'unknown', messages, durationMs: Date.now() - startedAt, status: 'failed', errorCode: 'UNSUPPORTED_MODEL' });
    if (res && typeof res.write === 'function') {
      res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
      return res.end();
    }
    throw err;
  }

  const { providerId, rawModel, meta } = resolved;
  const streamStartTime = Date.now();
  const cfg = loadStoredConfig(profileId);
  let apiKey = getEffectiveKey(providerId, profileId);
  if (providerId === 'kilo' && !apiKey) apiKey = 'anonymous';
  const isKeyless = Boolean(meta.keyless || providerId === 'kilo' || providerId === 'llm7' || providerId === 'ovhcloud');
  const baseUrl = providerId === 'custom' ? (cfg.custom?.baseUrl || '') : meta.baseUrl;

  if (!isKeyless && providerId !== 'custom' && !apiKey) {
    const err = new Error(`API key not configured for ${meta.name}. Please enter your free API key in Settings -> AI Providers.`);
    saveUsageEvent({ requestId: currentRequestId, profileId, sessionId, agentId, requestType, providerId, model: rawModel, messages, durationMs: Date.now() - startedAt, status: 'failed', errorCode: 'MISSING_API_KEY' });
    if (res && typeof res.write === 'function') {
      res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
      return res.end();
    }
    throw err;
  }
  if (!baseUrl) {
    const err = new Error(`Base URL not configured for ${meta.name}.`);
    saveUsageEvent({ requestId: currentRequestId, profileId, sessionId, agentId, requestType, providerId, model: rawModel, messages, durationMs: Date.now() - startedAt, status: 'failed', errorCode: 'MISSING_BASE_URL' });
    if (res && typeof res.write === 'function') {
      res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
      return res.end();
    }
    throw err;
  }

  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
  const headers = {
    'Content-Type': 'application/json'
  };
  if (apiKey && providerId !== 'ovhcloud') {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }
  if (providerId === 'openrouter') {
    headers['HTTP-Referer'] = 'http://localhost:8000';
    headers['X-Title'] = 'AXOM';
  }

  // Format messages for standard OpenAI format (clean strings)
  const formattedMessages = messages.map(m => ({
    role: m.role === 'tool' ? 'tool' : (m.role === 'assistant' ? 'assistant' : (m.role === 'system' ? 'system' : 'user')),
    content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {})
  }));

  const payload = {
    model: rawModel,
    messages: formattedMessages,
    stream: true,
    ...(providerId !== 'custom' ? { stream_options: { include_usage: true } } : {}),
    temperature: typeof temperature === 'number' ? temperature : (typeof params.temperature === 'number' ? params.temperature : 0.6),
    max_tokens: typeof max_tokens === 'number' ? max_tokens : (typeof params.max_tokens === 'number' ? params.max_tokens : 2048),
    ...(Array.isArray(params.stop) && params.stop.length ? { stop: params.stop } : {})
  };

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal
    });
  } catch (fetchErr) {
    const errMsg = fetchErr.name === 'AbortError' ? 'Generation stopped.' : `Network error connecting to ${meta.name}: ${fetchErr.message}`;
    if (fetchErr.name !== 'AbortError' && enableFailover) {
      if (!candidates) candidates = getFailoverCandidates(chosenModel, profileId);
      if (attempt < candidates.length) {
        const next = candidates[attempt];
        console.warn(`[AI_FAILOVER] ${meta.name} failed: ${errMsg}. Auto-cascading to ${next.name} (${next.modelId})...`);
        if (res && typeof res.write === 'function' && !res.writableEnded) {
          res.write(`data: ${JSON.stringify({ type: 'failover_notice', from: meta.name, to: next.name, toModel: next.modelId, reason: errMsg })}\n\n`);
        }
        return await streamProviderChat({
          model: next.modelId,
          messages,
          temperature,
          max_tokens,
          params,
          res,
          signal,
          isBasic,
          onChunk,
          onThink,
          onFinish,
          enableFailover: true,
          attempt: attempt + 1,
          candidates,
          profileId, sessionId, agentId, requestType, requestId: currentRequestId, requestStartedAt: startedAt
        });
      }
    }
    saveUsageEvent({ requestId: currentRequestId, profileId, sessionId, agentId, requestType, providerId, model: rawModel, messages, durationMs: Date.now() - startedAt, status: fetchErr.name === 'AbortError' ? 'cancelled' : 'failed', errorCode: fetchErr.code || fetchErr.name });
    if (res && typeof res.write === 'function') {
      res.write(`data: ${JSON.stringify({ type: 'error', message: errMsg })}\n\n`);
      return res.end();
    }
    throw new Error(errMsg);
  }

  if (!response.ok) {
    persistQuotaSnapshots(providerId, profileId, readOpenAiQuotaHeaders(response.headers));
    const errText = await response.text().catch(() => '');
    let msg = errText;
    try {
      const parsed = JSON.parse(errText);
      msg = parsed.error?.message || parsed.message || errText;
    } catch (e) {}
    const fullErrMsg = `${meta.name} error (${response.status}): ${msg}`;
    // If rate limit (429), quota exceeded, or service overloaded (500, 502, 503, 504), cascade automatically!
    if (enableFailover && (response.status === 429 || response.status >= 500)) {
      if (!candidates) candidates = getFailoverCandidates(chosenModel, profileId);
      if (attempt < candidates.length) {
        const next = candidates[attempt];
        console.warn(`[AI_FAILOVER] ${meta.name} returned HTTP ${response.status}. Auto-cascading to ${next.name} (${next.modelId})...`);
        if (res && typeof res.write === 'function' && !res.writableEnded) {
          res.write(`data: ${JSON.stringify({ type: 'failover_notice', from: meta.name, to: next.name, toModel: next.modelId, reason: `HTTP ${response.status}: ${msg.slice(0, 80)}` })}\n\n`);
        }
        return await streamProviderChat({
          model: next.modelId,
          messages,
          temperature,
          max_tokens,
          params,
          res,
          signal,
          isBasic,
          onChunk,
          onThink,
          onFinish,
          enableFailover: true,
          attempt: attempt + 1,
          candidates,
          profileId, sessionId, agentId, requestType, requestId: currentRequestId, requestStartedAt: startedAt
        });
      }
    }
    saveUsageEvent({ requestId: currentRequestId, profileId, sessionId, agentId, requestType, providerId, model: rawModel, messages, durationMs: Date.now() - startedAt, status: 'failed', errorCode: `HTTP_${response.status}`, rateLimitEvent: response.status === 429 });
    if (res && typeof res.write === 'function') {
      res.write(`data: ${JSON.stringify({ type: 'error', message: fullErrMsg })}\n\n`);
      return res.end();
    }
    throw new Error(fullErrMsg);
  }

  persistQuotaSnapshots(providerId, profileId, readOpenAiQuotaHeaders(response.headers));

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let fullText = '';
  let fullReasoning = '';
  let streamUsage = null;
  let streamStatus = 'success';
  let streamErrorCode = null;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':')) continue;

        if (trimmed === 'data: [DONE]') {
          if (!fullText.trim() && fullReasoning.trim()) {
            fullText = fullReasoning.trim();
            if (res && typeof res.write === 'function' && !res.writableEnded) {
              res.write(`data: ${JSON.stringify({ text: fullText, content: fullText })}\n\n`);
            }
          }
          const durationMs = Date.now() - startedAt;
          const metadata = saveUsageEvent({ requestId: currentRequestId, profileId, sessionId, agentId, requestType, providerId, model: rawModel, messages, output: fullText, usage: streamUsage, durationMs });
          writeUsageMetadata(res, metadata);
          if (res && typeof res.write === 'function' && !res.writableEnded) {
            res.write(`data: ${JSON.stringify({ type: 'done', fullText })}\n\n`);
            res.end();
          }
          if (onFinish) onFinish(fullText);
          return { content: fullText, reasoning: fullReasoning, usage: streamUsage };
        }

        if (trimmed.startsWith('data: ')) {
          const jsonStr = trimmed.slice(6);
          try {
            const parsed = JSON.parse(jsonStr);
            if (parsed.usage) {
              streamUsage = {
                inputTokens: parsed.usage.prompt_tokens ?? parsed.usage.input_tokens,
                outputTokens: parsed.usage.completion_tokens ?? parsed.usage.output_tokens,
                cachedInputTokens: parsed.usage.prompt_tokens_details?.cached_tokens ?? parsed.usage.cache_read_input_tokens,
                reasoningTokens: parsed.usage.completion_tokens_details?.reasoning_tokens
              };
            }
            const delta = parsed.choices?.[0]?.delta;
            if (!delta) continue;

            // Check for reasoning / thinking tokens (DeepSeek-R1 / QwQ)
            // If prompt is basic chit-chat, suppress thinking completely for instant reply
            if (!isBasic && (delta.reasoning_content || delta.reasoning)) {
              const rChunk = delta.reasoning_content || delta.reasoning;
              fullReasoning += rChunk;
              if (res && typeof res.write === 'function') {
                res.write(`data: ${JSON.stringify({ type: 'think', text: rChunk })}\n\n`);
              }
              if (onThink) onThink(rChunk);
            }

            if (delta.content) {
              let cleanContent = delta.content;
              if (isBasic) {
                cleanContent = cleanContent.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<\/?think>/gi, '');
              }
              if (cleanContent) {
                fullText += cleanContent;
                if (res && typeof res.write === 'function') {
                  res.write(`data: ${JSON.stringify({ type: 'content', text: cleanContent })}\n\n`);
                }
                if (onChunk) onChunk(cleanContent);
              }
            }
          } catch (e) {
            // Ignore partial or unparseable SSE line
          }
        }
      }
    }
  } catch (streamErr) {
    streamStatus = streamErr.name === 'AbortError' ? 'cancelled' : 'failed';
    streamErrorCode = streamErr.code || streamErr.name || 'STREAM_ERROR';
    if (streamErr.name !== 'AbortError') {
      console.warn('[AI_PROVIDERS] Stream read warning:', streamErr.message);
    }
  }

  if (!fullText.trim() && fullReasoning.trim()) {
    fullText = fullReasoning.trim();
    if (res && typeof res.write === 'function' && !res.writableEnded) {
      res.write(`data: ${JSON.stringify({ text: fullText, content: fullText })}\n\n`);
    }
  }

  const durationMs = Date.now() - startedAt;
  const metadata = saveUsageEvent({ requestId: currentRequestId, profileId, sessionId, agentId, requestType, providerId, model: rawModel, messages, output: fullText, usage: streamUsage, durationMs, status: streamStatus, errorCode: streamErrorCode });
  writeUsageMetadata(res, metadata);
  if (res && typeof res.write === 'function' && !res.writableEnded) {
    res.write(`data: ${JSON.stringify({ type: 'done', fullText })}\n\n`);
    res.end();
  }
  if (onFinish) onFinish(fullText);
  return { content: fullText, reasoning: fullReasoning, usage: streamUsage };
}

module.exports = {
  PROVIDER_METADATA,
  loadStoredConfig,
  saveStoredConfig,
  saveProvidersConfig,
  maskApiKey,
  getEffectiveKey,
  getProviderStatusList,
  getCombinedModelList,
  getCombinedModelListAsync,
  fetchProviderLiveModels,
  fetchLocalOllamaModels,
  selectBestModelForTask,
  isCloudModel,
  resolveProvider,
  getFailoverCandidates,
  testProviderConnection,
  streamProviderChat,
  providerRegistry,
  isBasicPrompt,
  isComplexTask
};
