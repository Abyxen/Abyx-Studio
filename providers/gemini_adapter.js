/**
 * ABYX AI Providers — Official Google Gemini Adapter
 */

const BaseProviderAdapter = require('./base_adapter');

const KNOWN_GEMINI_MODELS = [
  {
    id: 'gemini-2.0-flash',
    name: 'Gemini 2.0 Flash (Next-Gen Speed & Vision)',
    contextWindow: 1048576,
    capabilities: { tools: true, vision: true, reasoning: true, streaming: true }
  },
  {
    id: 'gemini-1.5-pro',
    name: 'Gemini 1.5 Pro (2M Long Context)',
    contextWindow: 2097152,
    capabilities: { tools: true, vision: true, reasoning: true, streaming: true }
  },
  {
    id: 'gemini-1.5-flash',
    name: 'Gemini 1.5 Flash (1M High-Throughput)',
    contextWindow: 1048576,
    capabilities: { tools: true, vision: true, reasoning: false, streaming: true }
  }
];

class GeminiAdapter extends BaseProviderAdapter {
  constructor() {
    super({
      id: 'gemini',
      name: 'Google Gemini',
      type: 'cloud',
      defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
      requiresApiKey: true,
      defaultContextWindow: 1048576
    });
  }

  async testConnection({ apiKey, baseUrl, model = 'gemini-2.0-flash', signal }) {
    if (!apiKey) {
      return { ok: false, latencyMs: 0, error: 'Google Gemini API key is required' };
    }
    const endpoint = (baseUrl || this.defaultBaseUrl).replace(/\/+$/, '');
    const start = Date.now();

    try {
      const res = await fetch(`${endpoint}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey.trim()}`
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'hi' }],
          max_tokens: 2
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
    if (!apiKey) return [...KNOWN_GEMINI_MODELS];
    const endpoint = (baseUrl || this.defaultBaseUrl).replace(/\/openai\/?$/, '').replace(/\/+$/, '');
    try {
      const res = await fetch(`${endpoint}/models?pageSize=1000`, { headers: { 'x-goog-api-key': apiKey.trim() }, signal: signal || AbortSignal.timeout(6000) });
      if (!res.ok) return [];
      const data = await res.json();
      const known = new Map(KNOWN_GEMINI_MODELS.map(item => [item.id, item]));
      return (Array.isArray(data.models) ? data.models : []).filter(item => (item.supportedGenerationMethods || []).some(method => method === 'generateContent' || method === 'streamGenerateContent')).map(item => {
        const id = String(item.name || '').replace(/^models\//, '');
        return { ...(known.get(id) || {}), id, name: item.displayName || known.get(id)?.name || id, available: true,
          contextWindow: item.inputTokenLimit || known.get(id)?.contextWindow || null, maxOutputTokens: item.outputTokenLimit || null,
          capabilities: known.get(id)?.capabilities || { tools: false, vision: false, reasoning: false, streaming: (item.supportedGenerationMethods || []).includes('streamGenerateContent') } };
      });
    } catch { return []; }
  }

  async streamChat({ model = 'gemini-2.0-flash', messages, temperature = 0.4, maxTokens = 4096, signal, onChunk, onReasoning, onFinish, apiKey, baseUrl }) {
    if (!apiKey) {
      throw new Error('Google Gemini API key is required for execution');
    }
    const endpoint = (baseUrl || this.defaultBaseUrl).replace(/\/+$/, '');
    const cleanMessages = this.normalizeMessages(messages);

    const payload = {
      model,
      messages: cleanMessages,
      temperature,
      max_tokens: maxTokens,
      stream: true
    };

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
      let errMsg = `Gemini error ${res.status}`;
      try {
        const json = JSON.parse(errBody);
        if (json.error?.message) errMsg = json.error.message;
      } catch (e) {}
      const formatted = this.formatError(new Error(errMsg));
      const error = new Error(formatted.actionable);
      error.statusCode = res.status;
      throw error;
    }

    let fullContent = '';
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
            if (delta && delta.content) {
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

    const result = { content: fullContent, usage };
    if (onFinish) onFinish(result);
    return result;
  }
}

module.exports = GeminiAdapter;
