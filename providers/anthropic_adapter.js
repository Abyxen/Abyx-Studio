/**
 * ABYX AI Providers — Official Anthropic Claude Adapter
 */

const BaseProviderAdapter = require('./base_adapter');

const KNOWN_ANTHROPIC_MODELS = [
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet (Hybrid Reasoning)',
    contextWindow: 200000,
    capabilities: { tools: true, vision: true, reasoning: true, streaming: true }
  },
  {
    id: 'claude-3-5-sonnet-20241022',
    name: 'Claude 3.5 Sonnet (Frontier Coding & Vision)',
    contextWindow: 200000,
    capabilities: { tools: true, vision: true, reasoning: false, streaming: true }
  },
  {
    id: 'claude-3-5-haiku-20241022',
    name: 'Claude 3.5 Haiku (Fast & Lightweight)',
    contextWindow: 200000,
    capabilities: { tools: true, vision: false, reasoning: false, streaming: true }
  },
  {
    id: 'claude-3-opus-20240229',
    name: 'Claude 3 Opus',
    contextWindow: 200000,
    capabilities: { tools: true, vision: true, reasoning: false, streaming: true }
  }
];

class AnthropicAdapter extends BaseProviderAdapter {
  constructor() {
    super({
      id: 'anthropic',
      name: 'Anthropic',
      type: 'cloud',
      defaultBaseUrl: 'https://api.anthropic.com/v1',
      requiresApiKey: true,
      defaultContextWindow: 200000
    });
  }

  async testConnection({ apiKey, baseUrl, model = 'claude-3-5-haiku-20241022', signal }) {
    if (!apiKey) {
      return { ok: false, latencyMs: 0, error: 'Anthropic API key is required' };
    }
    const endpoint = (baseUrl || this.defaultBaseUrl).replace(/\/+$/, '');
    const start = Date.now();

    try {
      const res = await fetch(`${endpoint}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey.trim(),
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model,
          max_tokens: 1,
          messages: [{ role: 'user', content: 'ping' }]
        }),
        signal: signal || AbortSignal.timeout(8000)
      });

      const latencyMs = Date.now() - start;
      if (!res.ok) {
        const errorText = await res.text().catch(() => '');
        let errMsg = `HTTP ${res.status}`;
        try {
          const parsed = JSON.parse(errorText);
          if (parsed.error?.message) errMsg = parsed.error.message;
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
    if (!apiKey) return [...KNOWN_ANTHROPIC_MODELS];
    const endpoint = (baseUrl || this.defaultBaseUrl).replace(/\/+$/, '');
    try {
      const res = await fetch(`${endpoint}/models?limit=1000`, { headers: { 'x-api-key': apiKey.trim(), 'anthropic-version': '2023-06-01' }, signal: signal || AbortSignal.timeout(6000) });
      if (!res.ok) return [];
      const data = await res.json();
      const known = new Map(KNOWN_ANTHROPIC_MODELS.map(item => [item.id, item]));
      return (Array.isArray(data.data) ? data.data : []).filter(item => typeof item.id === 'string').map(item => ({
        ...(known.get(item.id) || {}), id: item.id, name: item.display_name || known.get(item.id)?.name || item.id,
        available: true, contextWindow: known.get(item.id)?.contextWindow ?? null,
        capabilities: known.get(item.id)?.capabilities || { tools: true, vision: false, reasoning: false, streaming: true }
      }));
    } catch { return []; }
  }

  /**
   * Translate generic messages into Anthropic format:
   * - System messages extracted to top-level `system` string
   * - Consecutive messages of the same role merged
   */
  formatAnthropicMessages(messages = []) {
    let system = '';
    const formatted = [];

    for (const m of messages) {
      if (m.role === 'system') {
        system += (system ? '\n\n' : '') + m.content;
      } else {
        const role = m.role === 'assistant' ? 'assistant' : 'user';
        const last = formatted[formatted.length - 1];
        if (last && last.role === role) {
          last.content += '\n\n' + m.content;
        } else {
          formatted.push({ role, content: m.content });
        }
      }
    }

    if (formatted.length === 0) {
      formatted.push({ role: 'user', content: 'Hello' });
    }

    return { system, messages: formatted };
  }

  async streamChat({ model = 'claude-3-5-sonnet-20241022', messages, temperature = 0.4, maxTokens = 4096, signal, onChunk, onReasoning, onFinish, apiKey, baseUrl }) {
    if (!apiKey) {
      throw new Error('Anthropic API key is required for execution');
    }
    const endpoint = (baseUrl || this.defaultBaseUrl).replace(/\/+$/, '');
    const { system, messages: anthropicMessages } = this.formatAnthropicMessages(messages);

    const payload = {
      model,
      messages: anthropicMessages,
      max_tokens: maxTokens,
      temperature,
      stream: true
    };
    if (system) {
      payload.system = system;
    }

    const res = await fetch(`${endpoint}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey.trim(),
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(payload),
      signal: signal || AbortSignal.timeout(60000)
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      let errMsg = `Anthropic error ${res.status}`;
      try {
        const json = JSON.parse(errBody);
        if (json.error?.message) errMsg = json.error.message;
      } catch (e) {}
      const formatted = this.formatError(new Error(errMsg));
      const error = new Error(formatted.actionable);
      error.statusCode = res.status;
      error.rateLimits = [];
      for (const [quotaKind, prefix] of [['requests', 'anthropic-ratelimit-requests'], ['tokens', 'anthropic-ratelimit-tokens']]) {
        const limit = res.headers.get(`${prefix}-limit`);
        const remaining = res.headers.get(`${prefix}-remaining`);
        const resetRaw = res.headers.get(`${prefix}-reset`);
        const resetTimestamp = resetRaw ? Date.parse(resetRaw) : NaN;
        if (limit != null || remaining != null) error.rateLimits.push({ quotaKind, limitValue: limit == null ? null : Number(limit), remainingValue: remaining == null ? null : Number(remaining), resetAt: Number.isFinite(resetTimestamp) ? new Date(resetTimestamp).toISOString() : null });
      }
      throw error;
    }

    let fullContent = '';
    let fullReasoning = '';
    let usage = {};
    const rateLimits = [];
    for (const [quotaKind, prefix] of [['requests', 'anthropic-ratelimit-requests'], ['tokens', 'anthropic-ratelimit-tokens']]) {
      const limit = res.headers.get(`${prefix}-limit`);
      const remaining = res.headers.get(`${prefix}-remaining`);
      const resetRaw = res.headers.get(`${prefix}-reset`);
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
        buffer = lines.pop();

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const dataStr = trimmed.slice(5).trim();

          try {
            const parsed = JSON.parse(dataStr);
            if (parsed.type === 'message_start' && parsed.message?.usage) {
              usage = { ...usage, inputTokens: parsed.message.usage.input_tokens, cachedInputTokens: parsed.message.usage.cache_read_input_tokens };
            }
            if (parsed.type === 'message_delta' && parsed.usage) {
              usage = { ...usage, outputTokens: parsed.usage.output_tokens };
            }
            if (parsed.type === 'content_block_delta') {
              if (parsed.delta?.type === 'text_delta' && parsed.delta.text) {
                fullContent += parsed.delta.text;
                if (onChunk) onChunk(parsed.delta.text);
              } else if (parsed.delta?.type === 'thinking_delta' && parsed.delta.thinking) {
                fullReasoning += parsed.delta.thinking;
                if (onReasoning) onReasoning(parsed.delta.thinking);
              }
            }
          } catch (e) {
            // Ignore partial SSE lines
          }
        }
      }
    } catch (streamErr) {
      if (streamErr.name === 'AbortError') {
        throw new Error('Request was cancelled by the user.');
      }
      throw streamErr;
    }

    const result = { content: fullContent, reasoning: fullReasoning, usage: Object.keys(usage).length ? usage : null, rateLimits };
    if (onFinish) onFinish(result);
    return result;
  }
}

module.exports = AnthropicAdapter;
