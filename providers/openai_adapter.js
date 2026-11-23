/**
 * ABYX AI Providers — Official OpenAI Adapter
 */

const BaseProviderAdapter = require('./base_adapter');

const KNOWN_OPENAI_MODELS = [
  {
    id: 'gpt-4o',
    name: 'GPT-4o (Omni Frontier)',
    contextWindow: 128000,
    capabilities: { tools: true, vision: true, reasoning: false, streaming: true }
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini (Fast & Affordable)',
    contextWindow: 128000,
    capabilities: { tools: true, vision: true, reasoning: false, streaming: true }
  },
  {
    id: 'o1',
    name: 'o1 (Deep Reasoning Frontier)',
    contextWindow: 200000,
    capabilities: { tools: true, vision: true, reasoning: true, streaming: true }
  },
  {
    id: 'o3-mini',
    name: 'o3-mini (High-Speed Reasoning & Code)',
    contextWindow: 200000,
    capabilities: { tools: true, vision: false, reasoning: true, streaming: true }
  },
  {
    id: 'gpt-4-turbo',
    name: 'GPT-4 Turbo',
    contextWindow: 128000,
    capabilities: { tools: true, vision: true, reasoning: false, streaming: true }
  }
];

class OpenAIAdapter extends BaseProviderAdapter {
  constructor() {
    super({
      id: 'openai',
      name: 'OpenAI',
      type: 'cloud',
      defaultBaseUrl: 'https://api.openai.com/v1',
      requiresApiKey: true,
      defaultContextWindow: 128000
    });
  }

  async testConnection({ apiKey, baseUrl, model = 'gpt-4o-mini', signal }) {
    if (!apiKey) {
      return { ok: false, latencyMs: 0, error: 'OpenAI API key is required' };
    }
    const endpoint = (baseUrl || this.defaultBaseUrl).replace(/\/+$/, '');
    const start = Date.now();

    try {
      const res = await fetch(`${endpoint}/models`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey.trim()}`
        },
        signal: signal || AbortSignal.timeout(8000)
      });

      const latencyMs = Date.now() - start;
      if (!res.ok) {
        const errorText = await res.text().catch(() => '');
        let errMsg = `HTTP ${res.status}`;
        try {
          const parsed = JSON.parse(errorText);
          if (parsed.error?.message) errMsg = `HTTP ${res.status}: ${parsed.error.message}`;
        } catch (e) {}
        const formatted = this.formatError(new Error(errMsg));
        return { ok: false, latencyMs, error: formatted.actionable, statusCode: res.status };
      }

      return {
        ok: true,
        latencyMs,
        model,
        endpoint
      };
    } catch (err) {
      const formatted = this.formatError(err);
      return { ok: false, latencyMs: Date.now() - start, error: formatted.actionable };
    }
  }

  async listModels({ apiKey, baseUrl, signal } = {}) {
    if (!apiKey) return [];
    const endpoint = (baseUrl || this.defaultBaseUrl).replace(/\/+$/, '');
    try {
      const res = await fetch(`${endpoint}/models`, { method: 'GET', headers: { 'Authorization': `Bearer ${apiKey.trim()}` }, signal: signal || AbortSignal.timeout(6000) });
      if (!res.ok) return [];
      const data = await res.json();
      const known = new Map(KNOWN_OPENAI_MODELS.map(item => [item.id, item]));
      return (Array.isArray(data.data) ? data.data : []).filter(item => typeof item.id === 'string').map(item => ({
        ...(known.get(item.id) || {}),
        id: item.id,
        name: known.get(item.id)?.name || item.name || item.id,
        available: true,
        owner: item.owned_by || null,
        contextWindow: known.get(item.id)?.contextWindow ?? null,
        capabilities: known.get(item.id)?.capabilities || { tools: false, vision: false, reasoning: false, streaming: true }
      }));
    } catch { return []; }
  }

  async streamChat({ model = 'gpt-4o', messages, temperature = 0.4, maxTokens = 4096, signal, onChunk, onReasoning, onFinish, apiKey, baseUrl, options = {} }) {
    if (!apiKey) {
      throw new Error('OpenAI API key is required for execution');
    }
    const endpoint = (baseUrl || this.defaultBaseUrl).replace(/\/+$/, '');
    const cleanMessages = this.normalizeMessages(messages);

    const payload = {
      model,
      messages: cleanMessages,
      stream: true,
      stream_options: { include_usage: true }
    };

    // Models like o1/o3-mini use max_completion_tokens and do not support custom temperature
    const isReasoningModel = model.startsWith('o1') || model.startsWith('o3');
    if (isReasoningModel) {
      payload.max_completion_tokens = maxTokens;
    } else {
      payload.temperature = temperature;
      payload.max_tokens = maxTokens;
    }

    const res = await fetch(`${endpoint}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey.trim()}`
      },
      body: JSON.stringify(payload),
      signal: signal || AbortSignal.timeout(60000)
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      let errMsg = `OpenAI error ${res.status}`;
      try {
        const json = JSON.parse(errBody);
        if (json.error?.message) errMsg = json.error.message;
      } catch (e) {}
      const formatted = this.formatError(new Error(errMsg));
      const error = new Error(formatted.actionable);
      error.statusCode = res.status;
      error.rateLimits = [];
      for (const [quotaKind, suffix] of [['requests', 'requests'], ['tokens', 'tokens']]) {
        const limit = res.headers.get(`x-ratelimit-limit-${suffix}`);
        const remaining = res.headers.get(`x-ratelimit-remaining-${suffix}`);
        if (limit != null || remaining != null) error.rateLimits.push({ quotaKind, limitValue: limit == null ? null : Number(limit), remainingValue: remaining == null ? null : Number(remaining) });
      }
      throw error;
    }

    let fullContent = '';
    let fullReasoning = '';
    let usage = null;
    const rateLimits = [];
    for (const [quotaKind, suffix] of [['requests', 'requests'], ['tokens', 'tokens']]) {
      const limit = res.headers.get(`x-ratelimit-limit-${suffix}`);
      const remaining = res.headers.get(`x-ratelimit-remaining-${suffix}`);
      const resetRaw = res.headers.get(`x-ratelimit-reset-${suffix}`);
      const resetTimestamp = resetRaw ? Date.parse(resetRaw) : NaN;
      if (limit != null || remaining != null) rateLimits.push({ quotaKind, limitValue: limit == null ? null : Number(limit), remainingValue: remaining == null ? null : Number(remaining), resetAt: Number.isFinite(resetTimestamp) ? new Date(resetTimestamp).toISOString() : null });
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
        buffer = lines.pop(); // keep partial trailing line

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const dataStr = trimmed.slice(5).trim();
          if (dataStr === '[DONE]') break;

          try {
            const parsed = JSON.parse(dataStr);
            if (parsed.usage) {
              usage = {
                inputTokens: parsed.usage.prompt_tokens,
                outputTokens: parsed.usage.completion_tokens,
                cachedInputTokens: parsed.usage.prompt_tokens_details?.cached_tokens,
                reasoningTokens: parsed.usage.completion_tokens_details?.reasoning_tokens
              };
            }
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
          } catch (e) {
            // Ignore unparseable SSE frame
          }
        }
      }
    } catch (streamErr) {
      if (streamErr.name === 'AbortError') {
        throw new Error('Request was cancelled by the user.');
      }
      throw streamErr;
    }

    const result = { content: fullContent, reasoning: fullReasoning, usage, rateLimits };
    if (onFinish) onFinish(result);
    return result;
  }
}

module.exports = OpenAIAdapter;
