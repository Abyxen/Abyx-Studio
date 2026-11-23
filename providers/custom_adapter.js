/**
 * ABYX AI Providers — Configurable Custom OpenAI-Compatible Adapter
 * 
 * Supports:
 * - Local inference engines: vLLM, llama.cpp, LocalAI, Jan, text-generation-webui
 * - Custom self-hosted proxies and enterprise gateway endpoints
 * - Flexible URL validation, custom authorization headers, and dynamic model discovery
 */

const BaseProviderAdapter = require('./base_adapter');

class CustomOpenAIAdapter extends BaseProviderAdapter {
  constructor() {
    super({
      id: 'custom',
      name: 'Custom (OpenAI-Compatible)',
      type: 'custom',
      defaultBaseUrl: 'http://127.0.0.1:8080/v1',
      requiresApiKey: false,
      defaultContextWindow: 8192
    });
  }

  /**
   * Validate custom URL syntax
   */
  validateUrl(url) {
    if (!url || typeof url !== 'string') {
      throw new Error('Endpoint URL is required');
    }
    const trimmed = url.trim();
    if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
      throw new Error('Endpoint URL must start with http:// or https://');
    }
    try {
      new URL(trimmed);
      return trimmed.replace(/\/+$/, '');
    } catch (e) {
      throw new Error(`Invalid endpoint URL: ${e.message}`);
    }
  }

  async testConnection({ apiKey, baseUrl, model = 'default', signal }) {
    let endpoint;
    try {
      endpoint = this.validateUrl(baseUrl || this.defaultBaseUrl);
    } catch (err) {
      return { ok: false, latencyMs: 0, error: err.message };
    }

    const start = Date.now();
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey && apiKey.trim()) {
      headers['Authorization'] = `Bearer ${apiKey.trim()}`;
    }

    // Try GET /models first
    try {
      const modelsRes = await fetch(`${endpoint}/models`, {
        method: 'GET',
        headers,
        signal: signal || AbortSignal.timeout(5000)
      });

      if (modelsRes.ok) {
        const data = await modelsRes.json().catch(() => ({}));
        const models = (data.data || []).map(m => m.id);
        return {
          ok: true,
          latencyMs: Date.now() - start,
          endpoint,
          modelCount: models.length,
          models
        };
      }
    } catch (e) {
      // Continue to test completion probe
    }

    // Fallback: test minimal chat turn
    try {
      const chatRes = await fetch(`${endpoint}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'test' }],
          max_tokens: 1
        }),
        signal: signal || AbortSignal.timeout(6000)
      });

      const latencyMs = Date.now() - start;
      if (!chatRes.ok) {
        const errText = await chatRes.text().catch(() => '');
        return {
          ok: false,
          latencyMs,
          error: `Endpoint returned HTTP ${chatRes.status}: ${errText.slice(0, 100)}`
        };
      }

      return {
        ok: true,
        latencyMs,
        endpoint,
        model
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

  async listModels({ apiKey, baseUrl, signal } = {}) {
    let endpoint;
    try {
      endpoint = this.validateUrl(baseUrl || this.defaultBaseUrl);
    } catch (e) {
      return [];
    }

    const headers = {};
    if (apiKey && apiKey.trim()) {
      headers['Authorization'] = `Bearer ${apiKey.trim()}`;
    }

    try {
      const res = await fetch(`${endpoint}/models`, {
        method: 'GET',
        headers,
        signal: signal || AbortSignal.timeout(4000)
      });

      if (!res.ok) return [];
      const data = await res.json();
      return (data.data || []).map(m => ({
        id: m.id,
        name: m.id,
        model: m.id,
        contextWindow: 8192,
        capabilities: {
          tools: true,
          vision: false,
          reasoning: false,
          streaming: true
        }
      }));
    } catch (err) {
      return [];
    }
  }

  async streamChat({ model, messages, temperature = 0.4, maxTokens = 4096, signal, onChunk, onReasoning, onFinish, apiKey, baseUrl }) {
    const endpoint = this.validateUrl(baseUrl || this.defaultBaseUrl);
    const cleanMessages = this.normalizeMessages(messages);

    const headers = { 'Content-Type': 'application/json' };
    if (apiKey && apiKey.trim()) {
      headers['Authorization'] = `Bearer ${apiKey.trim()}`;
    }

    const payload = {
      model,
      messages: cleanMessages,
      temperature,
      max_tokens: maxTokens,
      stream: true,
      stream_options: { include_usage: true }
    };

    const res = await fetch(`${endpoint}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: signal || AbortSignal.timeout(60000)
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      const formatted = this.formatError(new Error(`Custom endpoint error ${res.status}: ${errText}`));
      throw new Error(formatted.actionable);
    }

    let fullContent = '';
    let fullReasoning = '';
    let usage = null;
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
          if (!trimmed.startsWith('data:')) continue;
          const dataStr = trimmed.slice(5).trim();
          if (dataStr === '[DONE]') break;

          try {
            const parsed = JSON.parse(dataStr);
            if (parsed.usage) usage = {
              inputTokens: parsed.usage.prompt_tokens,
              outputTokens: parsed.usage.completion_tokens,
              cachedInputTokens: parsed.usage.prompt_tokens_details?.cached_tokens,
              reasoningTokens: parsed.usage.completion_tokens_details?.reasoning_tokens
            };
            const delta = parsed.choices?.[0]?.delta;
            if (!delta) continue;

            if (delta.reasoning_content) {
              fullReasoning += delta.reasoning_content;
              if (onReasoning) onReasoning(delta.reasoning_content);
            }
            if (delta.content) {
              fullContent += delta.content;
              if (onChunk) onChunk(delta.content);
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

    const result = { content: fullContent, reasoning: fullReasoning, usage };
    if (onFinish) onFinish(result);
    return result;
  }
}

module.exports = CustomOpenAIAdapter;
