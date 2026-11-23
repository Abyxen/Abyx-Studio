/**
 * ABYX AI Providers — Base Provider Adapter Interface
 * 
 * Defines consistent contracts for:
 * - Request parameters & message formats
 * - Real-time SSE streaming (content chunks, reasoning tokens, completion events)
 * - Model listing with verified capabilities (tools, vision, reasoning, context size)
 * - Connection health testing & latency telemetry
 * - Actionable, human-readable error classification
 */

class BaseProviderAdapter {
  constructor({ id, name, type = 'cloud', defaultBaseUrl = '', requiresApiKey = true, defaultContextWindow = 4096 }) {
    if (!id || !name) {
      throw new Error('Provider adapter requires id and name');
    }
    this.id = id;
    this.name = name;
    this.type = type; // 'local' | 'cloud' | 'custom'
    this.defaultBaseUrl = defaultBaseUrl;
    this.requiresApiKey = requiresApiKey;
    this.defaultContextWindow = defaultContextWindow;
  }

  /**
   * Test network and credential connectivity
   * @param {Object} params - { apiKey, baseUrl, model, signal }
   * @returns {Promise<{ ok: boolean, latencyMs: number, error?: string, model?: string }>}
   */
  async testConnection(params = {}) {
    throw new Error(`testConnection not implemented for ${this.name}`);
  }

  /**
   * List available models with verified capabilities
   * @param {Object} params - { apiKey, baseUrl, signal }
   * @returns {Promise<Array<{ id: string, name: string, capabilities: Object, contextWindow: number }>>}
   */
  async listModels(params = {}) {
    throw new Error(`listModels not implemented for ${this.name}`);
  }

  /**
   * Stream a chat completion with consistent SSE callbacks
   * @param {Object} params - { model, messages, temperature, maxTokens, signal, onChunk, onReasoning, onFinish, options }
   * @returns {Promise<{ content: string, reasoning?: string, usage?: Object }>}
   */
  async streamChat(params = {}) {
    throw new Error(`streamChat not implemented for ${this.name}`);
  }

  /**
   * Standardize raw errors into actionable user messages
   * @param {Error|Object} err 
   * @returns {{ code: string, message: string, actionable: string }}
   */
  formatError(err) {
    const rawMsg = err ? `${err.message || ''} ${err.cause?.message || ''} ${err.cause?.code || ''}`.trim() : 'Unknown error';
    let code = 'PROVIDER_ERROR';
    let actionable = 'Check your provider configuration and network connection.';

    if (rawMsg.includes('ECONNREFUSED') || rawMsg.includes('connect ECONNREFUSED')) {
      code = 'CONNECTION_REFUSED';
      actionable = `${this.name} service is not reachable on the specified endpoint. Ensure the runtime application is running and accessible on loopback (127.0.0.1).`;
    } else if (rawMsg.includes('401') || rawMsg.includes('Unauthorized') || rawMsg.includes('invalid_api_key') || rawMsg.toLowerCase().includes('api key') || rawMsg.toLowerCase().includes('incorrect')) {
      code = 'AUTHENTICATION_FAILED';
      actionable = `Invalid or expired API key for ${this.name}. Please enter a valid API key in Settings -> AI Providers.`;
    } else if (rawMsg.includes('429') || rawMsg.includes('rate_limit') || rawMsg.includes('quota')) {
      code = 'RATE_LIMIT_EXCEEDED';
      actionable = `${this.name} quota or rate limit exceeded. Please wait a moment or check your provider account tier.`;
    } else if (rawMsg.includes('AbortError') || rawMsg.includes('aborted')) {
      code = 'REQUEST_CANCELLED';
      actionable = 'The request was cancelled by the user.';
    } else if (rawMsg.includes('ETIMEDOUT') || rawMsg.includes('timeout')) {
      code = 'CONNECTION_TIMEOUT';
      actionable = `Connection to ${this.name} timed out. Verify your internet connection or proxy settings.`;
    }

    return {
      code,
      message: rawMsg,
      actionable
    };
  }

  /**
   * Normalize incoming chat messages into standard role/content format
   */
  normalizeMessages(messages = []) {
    if (!Array.isArray(messages)) return [];
    return messages.map(m => {
      let role = m.role || 'user';
      if (role === 'system' || role === 'user' || role === 'assistant' || role === 'tool') {
        // Valid role
      } else {
        role = 'user';
      }
      return {
        role,
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content || '')
      };
    });
  }
}

module.exports = BaseProviderAdapter;
