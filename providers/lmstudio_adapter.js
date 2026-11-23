/**
 * ABYX AI Providers — Local LM Studio Runtime Adapter
 * 
 * Provides:
 * - Local inference via LM Studio Local Server (OpenAI-compatible)
 * - Automatic loopback port 1234 detection
 * - Model discovery via GET /v1/models
 * - Streaming chat completions with SSE
 */

const BaseProviderAdapter = require('./base_adapter');

class LMStudioAdapter extends BaseProviderAdapter {
  constructor() {
    super({
      id: 'lmstudio',
      name: 'LM Studio (Local)',
      type: 'local',
      defaultBaseUrl: 'http://127.0.0.1:1234',
      requiresApiKey: false,
      defaultContextWindow: 8192
    });
  }

  formatError(err) {
    const rawMsg = err ? `${err.message || ''} ${err.cause?.message || ''} ${err.cause?.code || ''}`.trim() : 'Unknown error';
    if (rawMsg.includes('ECONNREFUSED') || rawMsg.includes('connect ECONNREFUSED')) {
      return {
        code: 'CONNECTION_REFUSED',
        message: rawMsg,
        actionable: 'LM Studio local server is offline on port 1234. In LM Studio, click the Local Server tab (<->) and click "Start Server".'
      };
    }
    return super.formatError(err);
  }

  async testConnection({ baseUrl, signal } = {}) {
    const endpoint = (baseUrl || this.defaultBaseUrl).replace(/\/+$/, '');
    const start = Date.now();

    try {
      const res = await fetch(`${endpoint}/v1/models`, {
        method: 'GET',
        signal: signal || AbortSignal.timeout(3000)
      });

      const latencyMs = Date.now() - start;
      if (!res.ok) {
        return {
          ok: false,
          latencyMs,
          error: `LM Studio returned HTTP ${res.status}`
        };
      }

      const data = await res.json().catch(() => ({}));
      const models = (data.data || []).map(m => m.id);

      return {
        ok: true,
        latencyMs,
        endpoint,
        modelCount: models.length,
        models
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
      const res = await fetch(`${endpoint}/v1/models`, {
        method: 'GET',
        signal: signal || AbortSignal.timeout(4000)
      });

      if (!res.ok) return [];
      const data = await res.json();
      return (data.data || []).map(m => {
        const idLower = (m.id || '').toLowerCase();
        const isVision = idLower.includes('vision') || idLower.includes('vl');
        const isReasoning = idLower.includes('r1') || idLower.includes('reasoning');

        return {
          id: m.id,
          name: m.id,
          model: m.id,
          contextWindow: 8192,
          capabilities: {
            tools: !isReasoning,
            vision: isVision,
            reasoning: isReasoning,
            streaming: true
          }
        };
      });
    } catch (err) {
      return [];
    }
  }

  async streamChat({ model, messages, temperature = 0.4, maxTokens = 4096, signal, onChunk, onReasoning, onFinish, baseUrl }) {
    const endpoint = (baseUrl || this.defaultBaseUrl).replace(/\/+$/, '');
    const cleanMessages = this.normalizeMessages(messages);

    const payload = {
      model,
      messages: cleanMessages,
      temperature,
      max_tokens: maxTokens,
      stream: true
    };

    const res = await fetch(`${endpoint}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      const formatted = this.formatError(new Error(`LM Studio error ${res.status}: ${errText}`));
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
          if (!trimmed.startsWith('data:')) continue;
          const dataStr = trimmed.slice(5).trim();
          if (dataStr === '[DONE]') break;

          try {
            const parsed = JSON.parse(dataStr);
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

    const result = { content: fullContent, reasoning: fullReasoning };
    if (onFinish) onFinish(result);
    return result;
  }
}

module.exports = LMStudioAdapter;
