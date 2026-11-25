'use strict';

/**
 * ABYX Model Router & Real Inference Bridge
 * Direct OpenAI-compatible bridge to local llama-server (127.0.0.1:10086)
 * with thinking model reasoning extraction, cloud fallback, and full hardware/inference parameter controls.
 */

const http = require('node:http');
const https = require('node:https');
const credentialStore = require('../security/credential_store');

class ModelRouter {
  constructor(options = {}) {
    this.localBaseUrl = options.localBaseUrl || 'http://127.0.0.1:10086';
    this.defaultModel = options.defaultModel || 'AbyxV2 9B.gguf';
    this.timeoutMs = options.timeoutMs || 240000; // 4 min timeout for deep reasoning

    // Hardware and Inference Configuration Defaults (from Abyx harness settings)
    this.harnessSettings = {
      systemPrompt: 'You are Abyx AI, a powerful, precise, autonomous software engineering agent.',
      contextSize: 0, // 0 = model default (up to 256k / 262,144)
      temperature: 0.7,
      maxResponseTokens: 'auto', // 'auto' (2048-4096) or numeric
      seed: -1,
      performanceProfile: 'balanced', // 'potato', 'balanced', 'high', 'custom'
      textBackend: 'cuda', // 'cuda', 'vulkan', 'cpu'
      cpuThreads: 16,
      gpuLayers: 50, // 50 = all
      batchSize: 512,
      kvCache: 'q8_0', // 'q4_0', 'q8_0', 'f16'
      ropeFreqBase: 10000,
      ropeFreqScale: 1.0,
      ...options.harnessSettings
    };
  }

  /**
   * Update harness settings dynamically from frontend or profile
   */
  updateHarnessSettings(newSettings) {
    if (newSettings && typeof newSettings === 'object') {
      this.harnessSettings = {
        ...this.harnessSettings,
        ...newSettings
      };
    }
    return { ...this.harnessSettings };
  }

  /**
   * Get current harness settings
   */
  getHarnessSettings() {
    return { ...this.harnessSettings };
  }

  /**
   * Health check for local model endpoint
   */
  async checkHealth() {
    try {
      const url = new URL('/v1/models', this.localBaseUrl);
      const res = await new Promise((resolve, reject) => {
        const req = http.request(url, { method: 'GET', timeout: 3000 }, (r) => {
          let data = '';
          r.on('data', c => data += c);
          r.on('end', () => {
            try {
              resolve({ statusCode: r.statusCode, data: JSON.parse(data) });
            } catch (e) {
              resolve({ statusCode: r.statusCode, raw: data });
            }
          });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Health check timeout')); });
        req.end();
      });

      if (res.statusCode === 200 && res.data?.data) {
        const models = res.data.data;
        const active = models[0] || {};
        return {
          online: true,
          endpoint: this.localBaseUrl,
          model: active.id || this.defaultModel,
          ownedBy: active.owned_by || 'llamafile',
          modelsCount: models.length,
          harnessSettings: this.harnessSettings
        };
      }
      return { online: false, error: `HTTP ${res.statusCode}` };
    } catch (err) {
      return { online: false, error: err.message };
    }
  }

  /**
   * Unified generation method matching aiProviders contract
   * @param {object} params
   * @param {string} [params.model]
   * @param {Array} params.messages
   * @param {number} [params.temperature]
   * @param {number} [params.maxTokens]
   * @param {number} [params.seed]
   * @param {Array} [params.tools]
   * @param {string} [params.systemPrompt]
   * @param {object} [params.harnessOverrides]
   * @param {AbortSignal} [params.signal]
   * @param {function} [params.onChunk]
   */
  async generateResponse({
    model = 'auto',
    messages = [],
    temperature,
    maxTokens,
    seed,
    tools = null,
    systemPrompt = null,
    harnessOverrides = null,
    profileId = 'prof_default',
    sessionId = null,
    signal = null,
    onChunk = null
  }) {
    const startMs = Date.now();
    const effectiveSettings = {
      ...this.harnessSettings,
      ...(harnessOverrides || {})
    };

    // Calculate effective max response tokens
    let effectiveMaxTokens = 2048;
    if (typeof maxTokens === 'number' && maxTokens > 0) {
      effectiveMaxTokens = maxTokens;
    } else if (effectiveSettings.maxResponseTokens === 'auto') {
      effectiveMaxTokens = 3072; // Generous budget so thinking models can finish reasoning + output
    } else if (typeof effectiveSettings.maxResponseTokens === 'number') {
      effectiveMaxTokens = effectiveSettings.maxResponseTokens;
    }

    // Effective temperature
    const effectiveTemp = typeof temperature === 'number'
      ? temperature
      : (typeof effectiveSettings.temperature === 'number' ? effectiveSettings.temperature : 0.7);

    // Effective seed
    const effectiveSeed = typeof seed === 'number' && seed !== -1
      ? seed
      : (effectiveSettings.seed !== -1 ? effectiveSettings.seed : undefined);

    // Build message list with system prompt
    const finalMessages = [];
    const sysContent = systemPrompt || effectiveSettings.systemPrompt;
    if (sysContent && (!messages.length || messages[0].role !== 'system')) {
      finalMessages.push({ role: 'system', content: sysContent });
    }
    for (const msg of messages) {
      finalMessages.push(msg);
    }

    // Try Local Endpoint First
    try {
      const localResult = await this._callLocalEndpoint({
        model: model === 'auto' ? this.defaultModel : model,
        messages: finalMessages,
        temperature: effectiveTemp,
        maxTokens: effectiveMaxTokens,
        seed: effectiveSeed,
        tools,
        signal,
        onChunk
      });

      return {
        ...localResult,
        provider: 'local_llama_server',
        durationMs: Date.now() - startMs
      };
    } catch (localErr) {
      console.warn(`[MODEL_ROUTER] Local endpoint failed (${localErr.message}). Attempting fallback.`);

      // Attempt Cloud Fallback
      const cloudResult = await this._callCloudFallback({
        model,
        messages: finalMessages,
        temperature: effectiveTemp,
        maxTokens: effectiveMaxTokens,
        profileId,
        signal
      });

      if (cloudResult) {
        return {
          ...cloudResult,
          durationMs: Date.now() - startMs
        };
      }

      throw new Error(`Model inference failed: Local model offline (${localErr.message}) and no cloud credentials available.`);
    }
  }

  /**
   * Execute chat completion on local llama-server
   */
  async _callLocalEndpoint({ model, messages, temperature, maxTokens, seed, tools, signal, onChunk }) {
    const payload = {
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
      stream: false
    };

    if (seed !== undefined) {
      payload.seed = seed;
    }

    if (Array.isArray(tools) && tools.length > 0) {
      payload.tools = tools;
    }

    const payloadStr = JSON.stringify(payload);
    const url = new URL('/v1/chat/completions', this.localBaseUrl);

    return new Promise((resolve, reject) => {
      let aborted = false;
      const req = http.request(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payloadStr)
        },
        timeout: this.timeoutMs
      }, (res) => {
        let rawBody = '';
        res.on('data', chunk => {
          rawBody += chunk;
          if (typeof onChunk === 'function') {
            try { onChunk(chunk.toString()); } catch (_) {}
          }
        });

        res.on('end', () => {
          if (aborted) return;
          if (res.statusCode !== 200) {
            return reject(new Error(`Local endpoint HTTP ${res.statusCode}: ${rawBody.slice(0, 300)}`));
          }

          try {
            const parsed = JSON.parse(rawBody);
            const choice = parsed.choices?.[0] || {};
            const message = choice.message || {};

            let content = (message.content || '').trim();
            const reasoning = (message.reasoning_content || '').trim();
            const toolCalls = message.tool_calls || [];

            // Thinking Model Accommodation:
            // If content is empty but reasoning is present, extract solution or JSON from reasoning
            if (!content && reasoning) {
              const jsonMatch = reasoning.match(/```json\s*([\s\S]*?)\s*```/) || reasoning.match(/\{[\s\S]*\}/);
              if (jsonMatch) {
                content = jsonMatch[1] || jsonMatch[0];
              } else {
                content = reasoning;
              }
            }

            resolve({
              content,
              text: content,
              reasoning,
              tool_calls: toolCalls,
              model: parsed.model || model,
              finishReason: choice.finish_reason || 'stop',
              usage: parsed.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
            });
          } catch (err) {
            reject(new Error(`Failed to parse local model response: ${err.message}`));
          }
        });
      });

      req.on('error', (err) => {
        if (!aborted) reject(err);
      });

      req.on('timeout', () => {
        aborted = true;
        req.destroy();
        reject(new Error(`Local model request timed out after ${this.timeoutMs}ms`));
      });

      if (signal) {
        signal.addEventListener('abort', () => {
          aborted = true;
          req.destroy();
          reject(new Error('Inference aborted by client'));
        }, { once: true });
      }

      req.write(payloadStr);
      req.end();
    });
  }

  /**
   * Fallback to configured cloud providers if available
   */
  async _callCloudFallback({ model, messages, temperature, maxTokens, profileId, signal }) {
    // Check Groq
    const groqKey = credentialStore.getSecret ? credentialStore.getSecret(profileId, 'groq') : null;
    if (groqKey) {
      try {
        return await this._callOpenAICompatible({
          url: 'https://api.groq.com/openai/v1/chat/completions',
          apiKey: groqKey,
          model: model.startsWith('groq/') ? model.replace('groq/', '') : 'llama-3.3-70b-versatile',
          messages,
          temperature,
          maxTokens,
          provider: 'groq',
          signal
        });
      } catch (e) {
        console.warn('[MODEL_ROUTER] Groq fallback failed:', e.message);
      }
    }

    // Check OpenRouter
    const orKey = credentialStore.getSecret ? credentialStore.getSecret(profileId, 'openrouter') : null;
    if (orKey) {
      try {
        return await this._callOpenAICompatible({
          url: 'https://openrouter.ai/api/v1/chat/completions',
          apiKey: orKey,
          model: model.startsWith('openrouter/') ? model.replace('openrouter/', '') : 'meta-llama/llama-3.3-70b-instruct:free',
          messages,
          temperature,
          maxTokens,
          provider: 'openrouter',
          signal
        });
      } catch (e) {
        console.warn('[MODEL_ROUTER] OpenRouter fallback failed:', e.message);
      }
    }

    // Check DeepSeek
    const dsKey = credentialStore.getSecret ? credentialStore.getSecret(profileId, 'deepseek') : null;
    if (dsKey) {
      try {
        return await this._callOpenAICompatible({
          url: 'https://api.deepseek.com/chat/completions',
          apiKey: dsKey,
          model: 'deepseek-chat',
          messages,
          temperature,
          maxTokens,
          provider: 'deepseek',
          signal
        });
      } catch (e) {
        console.warn('[MODEL_ROUTER] DeepSeek fallback failed:', e.message);
      }
    }

    return null;
  }

  /**
   * Generic OpenAI-compatible HTTPS caller
   */
  async _callOpenAICompatible({ url, apiKey, model, messages, temperature, maxTokens, provider, signal }) {
    const payload = JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens: maxTokens
    });

    const parsedUrl = new URL(url);

    return new Promise((resolve, reject) => {
      const req = https.request(parsedUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'Content-Length': Buffer.byteLength(payload)
        },
        timeout: 45000
      }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          if (res.statusCode !== 200) {
            return reject(new Error(`${provider} returned HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
          }
          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.message?.content || '';
            resolve({
              content,
              text: content,
              reasoning: parsed.choices?.[0]?.message?.reasoning_content || '',
              model,
              provider,
              usage: parsed.usage
            });
          } catch (e) {
            reject(e);
          }
        });
      });

      req.on('error', reject);
      if (signal) signal.addEventListener('abort', () => req.destroy());
      req.write(payload);
      req.end();
    });
  }
}

module.exports = ModelRouter;
