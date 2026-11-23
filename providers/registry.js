/**
 * ABYX AI Providers — Central Provider Registry & Orchestrator
 * 
 * Features:
 * - Unified provider registry: OpenAI, Anthropic, Gemini, Ollama, LM Studio, Custom, and Free Distributors
 * - OS-backed secret store (DPAPI) integration per profile
 * - Reliable capability metadata (tools, vision, reasoning, context size)
 * - Connection testing with actionable error messages
 * - Local runtime manager coordination
 */

const OpenAIAdapter = require('./openai_adapter');
const AnthropicAdapter = require('./anthropic_adapter');
const GeminiAdapter = require('./gemini_adapter');
const OllamaAdapter = require('./ollama_adapter');
const LMStudioAdapter = require('./lmstudio_adapter');
const CustomOpenAIAdapter = require('./custom_adapter');
const LocalRuntimeManager = require('./local_runtime_manager');

const credentialStore = require('../security/credential_store');
const db = require('../db');
const freeApisService = require('../services/free_apis_service');

class ProviderRegistry {
  constructor() {
    this.adapters = {
      openai: new OpenAIAdapter(),
      anthropic: new AnthropicAdapter(),
      gemini: new GeminiAdapter(),
      ollama: new OllamaAdapter(),
      lmstudio: new LMStudioAdapter(),
      custom: new CustomOpenAIAdapter()
    };

    this.localRuntimeManager = new LocalRuntimeManager({
      ollamaAdapter: this.adapters.ollama,
      lmStudioAdapter: this.adapters.lmstudio
    });
  }

  getAdapter(providerId) {
    if (!providerId) return null;
    const pId = providerId.toLowerCase().trim();
    return this.adapters[pId] || null;
  }

  /**
   * Test connection to any provider
   */
  async testProvider({ providerId, apiKey, baseUrl, model, profileId = 'prof_default', signal }) {
    const adapter = this.getAdapter(providerId);
    let key = apiKey;

    // If key not passed in payload, fetch from DPAPI vault
    if (!key && profileId) {
      key = credentialStore.getSecret(profileId, providerId);
    }

    if (adapter) {
      return await adapter.testConnection({ apiKey: key, baseUrl, model, signal });
    }

    // Fallback to free APIs service (Groq, OpenRouter, Cerebras, etc.)
    const freeRes = await freeApisService.testEndpoint(providerId, model, key);
    return {
      ok: freeRes.ok,
      latencyMs: freeRes.latency_ms || 0,
      model: freeRes.model,
      sampleReply: freeRes.reply,
      error: freeRes.error
    };
  }

  /**
   * Get comprehensive provider status list for a profile
   */
  getProviderStatusList(profileId = 'prof_default') {
    const list = [];
    const dbCreds = db.listProviderCredentialMetadata(profileId);
    const credMap = new Map(dbCreds.map(c => [c.provider_id, c]));

    // 1. Core Modular Providers
    for (const [id, adapter] of Object.entries(this.adapters)) {
      const cred = credMap.get(id);
      const hasKey = Boolean(cred || !adapter.requiresApiKey);
      const maskedKey = cred ? cred.key_masked : (adapter.requiresApiKey ? '' : 'Local (No Key Required)');

      let isConfigured = hasKey;
      if (id === 'custom') {
        const storedCustom = this.getCustomEndpointConfig(profileId);
        isConfigured = Boolean(storedCustom?.baseUrl);
      }

      list.push({
        id,
        name: adapter.name,
        type: adapter.type,
        requiresApiKey: adapter.requiresApiKey,
        isConfigured,
        hasKey,
        maskedKey,
        defaultBaseUrl: adapter.defaultBaseUrl,
        contextWindow: adapter.defaultContextWindow
      });
    }

    // 2. Preserve Awesome Free LLM Providers from catalog
    const freeCatalog = freeApisService.getCatalog();
    const freeUsage = freeApisService.getUsageStats(profileId);

    for (const p of freeCatalog.providers) {
      if (this.adapters[p.id]) continue; // already added

      const cred = credMap.get(p.id);
      const hasKey = Boolean(cred || p.keyless);
      const maskedKey = cred ? cred.key_masked : (p.keyless ? 'Keyless (Free)' : '');
      const pUsage = freeUsage.providers[p.id] || { requestsToday: 0, percentUsed: 0 };

      list.push({
        id: p.id,
        name: p.name,
        type: 'cloud_free',
        requiresApiKey: !p.keyless,
        isConfigured: hasKey,
        hasKey,
        maskedKey,
        tagline: p.tagline,
        badge: p.badge,
        freeTier: p.badge || p.tagline,
        usage: pUsage,
        baseUrl: p.baseUrl,
        models: (p.models || []).map(m => m.rawId || m.id)
      });
    }

    return {
      providers: list,
      activeModel: 'abyx:1.1'
    };
  }

  /**
   * Save a provider configuration securely
   */
  saveProviderConfig(profileId = 'prof_default', payload = {}) {
    const pid = profileId || 'prof_default';

    for (const [providerId, rawKey] of Object.entries(payload)) {
      if (providerId === 'custom_url' || providerId === 'custom_model' || providerId === 'active_model') continue;

      if (typeof rawKey === 'string') {
        const val = rawKey.trim();
        if (val && !val.includes('••••') && !val.includes('...')) {
          // Encrypt in OS-backed secret store (DPAPI)
          const meta = credentialStore.storeSecret(pid, providerId, val);
          if (meta) {
            db.saveProviderCredentialMetadata(meta);
          }
        } else if (val === '') {
          // User requested deletion of key
          credentialStore.removeSecret(pid, providerId);
          db.removeProviderCredentialMetadata(pid, providerId);
        }
      }
    }

    // Handle Custom Endpoint URL
    if (typeof payload.custom_url === 'string') {
      const customUrl = payload.custom_url.trim();
      const customKey = payload.custom_key || payload.custom || '';
      if (customKey && !customKey.includes('...') && !customKey.includes('••••')) {
        const meta = credentialStore.storeSecret(pid, 'custom', customKey);
        if (meta) db.saveProviderCredentialMetadata(meta);
      }
      db.getDb().prepare(`
        INSERT INTO user_profile_memory (profile_id, key, value, category, confidence_score, reasoning, created_at, updated_at)
        VALUES (?, 'custom_endpoint_url', ?, 'system_setting', 1.0, 'User custom model endpoint', datetime('now'), datetime('now'))
        ON CONFLICT(profile_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `).run(pid, customUrl);
    }

    return {
      ok: true,
      status: this.getProviderStatusList(pid)
    };
  }

  getCustomEndpointConfig(profileId = 'prof_default') {
    const row = db.getDb().prepare("SELECT value FROM user_profile_memory WHERE profile_id = ? AND key = 'custom_endpoint_url'").get(profileId);
    return {
      baseUrl: row ? row.value : 'http://127.0.0.1:8080/v1'
    };
  }

  /**
   * List all models across all providers with reliable capabilities
   */
  async listAllModels({ profileId = 'prof_default' } = {}) {
    const allModels = [];

    // 1. Local Models from Ollama & LM Studio
    try {
      const localModels = await this.localRuntimeManager.listAllLocalModels();
      for (const lm of localModels) {
        allModels.push({
          id: lm.id,
          name: `${lm.name} (${lm.runtimeName})`,
          provider: lm.runtime,
          type: 'local',
          contextWindow: lm.contextWindow,
          capabilities: lm.capabilities
        });
      }
    } catch (e) {}

    // 2. Models from configured Cloud Providers
    const dbCreds = db.listProviderCredentialMetadata(profileId);
    const configuredProviders = new Set(dbCreds.map(c => c.provider_id));

    // Check OpenAI
    if (configuredProviders.has('openai') || process.env.OPENAI_API_KEY) {
      const openaiModels = await this.adapters.openai.listModels({ apiKey: credentialStore.getSecret(profileId, 'openai') || process.env.OPENAI_API_KEY });
      for (const m of openaiModels) {
        allModels.push({ ...m, provider: 'openai', type: 'cloud' });
      }
    }

    // Check Anthropic
    if (configuredProviders.has('anthropic') || process.env.ANTHROPIC_API_KEY) {
      const anthropicModels = await this.adapters.anthropic.listModels({ apiKey: credentialStore.getSecret(profileId, 'anthropic') || process.env.ANTHROPIC_API_KEY });
      for (const m of anthropicModels) {
        allModels.push({ ...m, provider: 'anthropic', type: 'cloud' });
      }
    }

    // Check Gemini
    if (configuredProviders.has('gemini') || process.env.GEMINI_API_KEY) {
      const geminiModels = await this.adapters.gemini.listModels({ apiKey: credentialStore.getSecret(profileId, 'gemini') || process.env.GEMINI_API_KEY });
      for (const m of geminiModels) {
        allModels.push({ ...m, provider: 'gemini', type: 'cloud' });
      }
    }

    // 3. Awesome Free LLM Catalog models
    const freeCatalog = freeApisService.getCatalog();
    for (const p of freeCatalog.providers) {
      if (this.adapters[p.id]) continue;
      if (configuredProviders.has(p.id) || p.keyless || (p.env && process.env[p.env])) {
        for (const m of (p.models || [])) {
          const rawId = m.rawId || m.id;
          const fullId = (rawId.includes('/') || rawId.startsWith(p.id + '/')) ? rawId : `${p.id}/${rawId}`;
          allModels.push({
            id: fullId,
            rawId,
            name: `${m.name || m.id} (${p.name})`,
            provider: p.id,
            type: 'cloud_free',
            contextWindow: m.contextWindow || 8192,
            capabilities: {
              tools: Boolean(m.tools !== false),
              vision: Boolean(m.vision === true),
              reasoning: Boolean(m.reasoning === true),
              streaming: true
            }
          });
        }
      }
    }

    return allModels;
  }

  /**
   * Unified stream chat dispatcher across all modular adapters
   */
  async streamChat({ model, messages, temperature = 0.4, maxTokens = 4096, signal, onChunk, onReasoning, onFinish, profileId = 'prof_default', options = {} }) {
    if (!model) {
      throw new Error('Model identifier is required for execution');
    }

    // Determine target provider
    let providerId = 'ollama';
    let targetModel = model;

    if (model.startsWith('gpt-') || model.startsWith('o1') || model.startsWith('o3')) {
      providerId = 'openai';
    } else if (model.startsWith('claude-')) {
      providerId = 'anthropic';
    } else if (model.startsWith('gemini-')) {
      providerId = 'gemini';
    } else if (model.includes('/') && !model.includes('127.0.0.1')) {
      // Model format like "openrouter/anthropic/claude-3.5-sonnet" or "groq/llama-3.3-70b"
      const parts = model.split('/');
      const pCandidate = parts[0].toLowerCase();
      if (this.adapters[pCandidate]) {
        providerId = pCandidate;
        targetModel = parts.slice(1).join('/');
      } else {
        // Free cloud distributor
        providerId = pCandidate;
        targetModel = parts.slice(1).join('/');
      }
    }

    const adapter = this.getAdapter(providerId);
    const apiKey = credentialStore.getSecret(profileId, providerId);

    if (adapter) {
      const customConfig = providerId === 'custom' ? this.getCustomEndpointConfig(profileId) : {};
      const baseUrl = customConfig.baseUrl || adapter.defaultBaseUrl;

      return await adapter.streamChat({
        model: targetModel,
        messages,
        temperature,
        maxTokens,
        signal,
        onChunk,
        onReasoning,
        onFinish,
        apiKey,
        baseUrl,
        options
      });
    }

    // Fallback: delegate to aiProviders universal cloud streaming (Groq, OpenRouter, DeepSeek, Cerebras, Mistral, Cohere, Pollinations)
    const aiProviders = require('../services/ai_providers');
    if (aiProviders.isCloudModel(model) || aiProviders.resolveProvider(model)) {
      return await aiProviders.streamProviderChat({
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
        signal,
        onChunk,
        onThink: onReasoning,
        onFinish: (content) => {
          if (onFinish) onFinish({ content, reasoning: '', usage: null });
        },
        profileId,
        params: options
      });
    }

    throw new Error(`Unsupported provider or model "${model}". Ensure the provider is configured in Settings.`);
  }
}

module.exports = new ProviderRegistry();
