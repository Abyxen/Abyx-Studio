/**
 * ABYX AI Providers — Local Ollama Runtime Adapter
 * 
 * Provides:
 * - Local inference without internet access
 * - Model lifecycle management: pull, load into VRAM, unload, delete
 * - Streaming chat completions with thinking/reasoning token extraction
 * - Loopback security enforcement (127.0.0.1)
 */

const BaseProviderAdapter = require('./base_adapter');

class OllamaAdapter extends BaseProviderAdapter {
  constructor() {
    super({
      id: 'ollama',
      name: 'Ollama (Local)',
      type: 'local',
      defaultBaseUrl: 'http://127.0.0.1:11434',
      requiresApiKey: false,
      defaultContextWindow: 16384
    });
  }

  async testConnection({ baseUrl, signal } = {}) {
    const endpoint = (baseUrl || this.defaultBaseUrl).replace(/\/+$/, '');
    const start = Date.now();

    try {
      const res = await fetch(`${endpoint}/api/tags`, {
        method: 'GET',
        signal: signal || AbortSignal.timeout(3000)
      });

      const latencyMs = Date.now() - start;
      if (!res.ok) {
        return {
          ok: false,
          latencyMs,
          error: `Ollama service returned HTTP ${res.status}`
        };
      }

      const data = await res.json().catch(() => ({}));
      const modelCount = Array.isArray(data.models) ? data.models.length : 0;

      return {
        ok: true,
        latencyMs,
        endpoint,
        modelCount,
        models: (data.models || []).map(m => m.name)
      };
    } catch (err) {
      const formatted = this.formatError(err);
      return {
        ok: false,
        latencyMs: Date.now() - start,
        error: formatted.actionable
      };
    }
  }

  async listModels({ baseUrl, signal } = {}) {
    const endpoint = (baseUrl || this.defaultBaseUrl).replace(/\/+$/, '');

    try {
      const res = await fetch(`${endpoint}/api/tags`, {
        method: 'GET',
        signal: signal || AbortSignal.timeout(4000)
      });

      if (!res.ok) return [];
      const data = await res.json();
      const models = (data.models || []).map(m => {
        const sizeBytes = m.size || 0;
        const sizeGb = (sizeBytes / (1024 * 1024 * 1024)).toFixed(2);
        const nameLower = (m.name || '').toLowerCase();
        const isVision = nameLower.includes('vision') || nameLower.includes('moondream') || nameLower.includes('llava') || nameLower.includes('vl');
        const isReasoning = nameLower.includes('deepseek-r1') || nameLower.includes('r1') || nameLower.includes('qwq');

        return {
          id: m.name,
          name: m.name,
          model: m.model || m.name,
          sizeBytes,
          sizeFormatted: `${sizeGb} GB`,
          modifiedAt: m.modified_at,
          contextWindow: nameLower.includes('1.1') || nameLower.includes('abyx') ? 32768 : 8192,
          capabilities: {
            tools: !isReasoning,
            vision: isVision,
            reasoning: isReasoning,
            streaming: true
          }
        };
      });

      return models;
    } catch (err) {
      return [];
    }
  }

  /**
   * List currently loaded models in VRAM (Ollama ps)
   */
  async listLoadedModels({ baseUrl, signal } = {}) {
    const endpoint = (baseUrl || this.defaultBaseUrl).replace(/\/+$/, '');
    try {
      const res = await fetch(`${endpoint}/api/ps`, {
        method: 'GET',
        signal: signal || AbortSignal.timeout(3000)
      });
      if (res.ok) {
        const data = await res.json();
        return data.models || [];
      }
    } catch (e) {}
    return [];
  }

  /**
   * Preload a model into VRAM with keep_alive duration
   */
  async loadModel(modelName, { baseUrl, keepAlive = '10m', signal } = {}) {
    const endpoint = (baseUrl || this.defaultBaseUrl).replace(/\/+$/, '');
    try {
      const res = await fetch(`${endpoint}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: modelName, keep_alive: keepAlive }),
        signal: signal || AbortSignal.timeout(30000)
      });
      return { ok: res.ok, model: modelName };
    } catch (err) {
      throw new Error(`Failed to preload ${modelName}: ${err.message}`);
    }
  }

  /**
   * Unload a model from VRAM immediately (keep_alive: 0)
   */
  async unloadModel(modelName, { baseUrl, signal } = {}) {
    const endpoint = (baseUrl || this.defaultBaseUrl).replace(/\/+$/, '');
    try {
      const res = await fetch(`${endpoint}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: modelName, keep_alive: 0 }),
        signal: signal || AbortSignal.timeout(10000)
      });
      return { ok: res.ok, unloaded: modelName };
    } catch (err) {
      throw new Error(`Failed to unload ${modelName}: ${err.message}`);
    }
  }

  /**
   * Delete a model from disk
   */
  async deleteModel(modelName, { baseUrl, signal } = {}) {
    const endpoint = (baseUrl || this.defaultBaseUrl).replace(/\/+$/, '');
    try {
      const res = await fetch(`${endpoint}/api/delete`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: modelName }),
        signal: signal || AbortSignal.timeout(15000)
      });
      return { ok: res.ok, deleted: modelName };
    } catch (err) {
      throw new Error(`Failed to delete ${modelName}: ${err.message}`);
    }
  }

  /**
   * Pull/download a model with streaming progress and abort support
   */
  async pullModel({ name, baseUrl, onProgress, signal }) {
    const endpoint = (baseUrl || this.defaultBaseUrl).replace(/\/+$/, '');
    const res = await fetch(`${endpoint}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, stream: true }),
      signal
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Ollama pull failed (${res.status}): ${errText}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf8');
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const event = JSON.parse(trimmed);
            const total = Number(event.total || 0);
            const completed = Number(event.completed || 0);
            const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

            if (onProgress) {
              onProgress({
                status: event.status || 'downloading',
                digest: event.digest || '',
                total,
                completed,
                percent,
                done: event.status === 'success'
              });
            }
          } catch (e) {}
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error(`Model download for "${name}" was cancelled.`);
      }
      throw err;
    }

    return { ok: true, name };
  }

  async streamChat({ model = 'abyx:1.1', messages, temperature = 0.4, maxTokens = 4096, signal, onChunk, onReasoning, onFinish, baseUrl, options = {} }) {
    const endpoint = (baseUrl || this.defaultBaseUrl).replace(/\/+$/, '');
    const cleanMessages = this.normalizeMessages(messages);

    const payload = {
      model,
      messages: cleanMessages,
      stream: true,
      options: {
        temperature,
        num_predict: maxTokens,
        num_ctx: options.num_ctx || 32768
      }
    };

    const res = await fetch(`${endpoint}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      const formatted = this.formatError(new Error(`Ollama error ${res.status}: ${errText}`));
      throw new Error(formatted.actionable);
    }

    let fullContent = '';
    let fullReasoning = '';
    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf8');
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const parsed = JSON.parse(trimmed);
            if (parsed.message?.thinking) {
              fullReasoning += parsed.message.thinking;
              if (onReasoning) onReasoning(parsed.message.thinking);
            }
            if (parsed.message?.content) {
              fullContent += parsed.message.content;
              if (onChunk) onChunk(parsed.message.content);
            }
          } catch (e) {}
        }
      }
    } catch (streamErr) {
      if (streamErr.name === 'AbortError') {
        throw new Error('Request was cancelled by the user.');
      }
      throw streamErr;
    }

    const result = { content: fullContent, reasoning: fullReasoning };
    if (onFinish) onFinish(result);
    return result;
  }
}

module.exports = OllamaAdapter;
