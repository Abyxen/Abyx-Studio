'use strict';

const http = require('node:http');

/**
 * ProviderRegistry - Model Provider Catalog & Capability Detector
 * 
 * Invariants:
 * - Singleton connection to local model (127.0.0.1:10086) to prevent multiple model instances
 * - Explicit capability detection (native tool calling vs prompt fallback, reasoning tokens, context size)
 * - Supports AbyxV2 9B GGUF, local llama-server, Ollama, and cloud providers (OpenAI, Anthropic, Gemini, Groq)
 */
class ProviderRegistry {
  constructor(options = {}) {
    this.localEndpoint = options.localEndpoint || 'http://127.0.0.1:10086';
    this.providers = new Map();
    this._registerKnownProviders();
  }

  _registerKnownProviders() {
    // 1. Local Llama Server (AbyxV2 9B GGUF)
    this.providers.set('local_llama_server', {
      id: 'local_llama_server',
      name: 'Local Abyx Llama Server',
      type: 'local',
      baseUrl: this.localEndpoint,
      defaultModel: 'AbyxV2 9B.gguf',
      capabilities: {
        nativeToolCalling: true,
        supportsReasoning: true, // DeepSeek reasoning_content extraction
        supportsStreaming: true,
        maxContextWindow: 262144, // 256k context
        requiresApiKey: false
      }
    });

    // 2. Ollama
    this.providers.set('ollama', {
      id: 'ollama',
      name: 'Ollama Local Runtime',
      type: 'local',
      baseUrl: 'http://127.0.0.1:11434',
      defaultModel: 'qwen2.5-coder:7b',
      capabilities: {
        nativeToolCalling: true,
        supportsReasoning: false,
        supportsStreaming: true,
        maxContextWindow: 32768,
        requiresApiKey: false
      }
    });

    // 3. OpenAI
    this.providers.set('openai', {
      id: 'openai',
      name: 'OpenAI API',
      type: 'cloud',
      baseUrl: 'https://api.openai.com/v1',
      defaultModel: 'gpt-4o',
      capabilities: {
        nativeToolCalling: true,
        supportsReasoning: true,
        supportsStreaming: true,
        maxContextWindow: 128000,
        requiresApiKey: true
      }
    });

    // 4. Anthropic
    this.providers.set('anthropic', {
      id: 'anthropic',
      name: 'Anthropic Claude',
      type: 'cloud',
      baseUrl: 'https://api.anthropic.com/v1',
      defaultModel: 'claude-3-5-sonnet-20241022',
      capabilities: {
        nativeToolCalling: true,
        supportsReasoning: true,
        supportsStreaming: true,
        maxContextWindow: 200000,
        requiresApiKey: true
      }
    });

    // 5. Google Gemini
    this.providers.set('gemini', {
      id: 'gemini',
      name: 'Google Gemini',
      type: 'cloud',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      defaultModel: 'gemini-1.5-pro',
      capabilities: {
        nativeToolCalling: true,
        supportsReasoning: false,
        supportsStreaming: true,
        maxContextWindow: 1048576, // 1M tokens
        requiresApiKey: true
      }
    });

    // 6. Groq
    this.providers.set('groq', {
      id: 'groq',
      name: 'Groq Cloud',
      type: 'cloud',
      baseUrl: 'https://api.groq.com/openai/v1',
      defaultModel: 'llama-3.3-70b-versatile',
      capabilities: {
        nativeToolCalling: true,
        supportsReasoning: true,
        supportsStreaming: true,
        maxContextWindow: 131072,
        requiresApiKey: true
      }
    });
  }

  getProvider(id) {
    return this.providers.get(id) || null;
  }

  listProviders() {
    return Array.from(this.providers.values());
  }

  detectCapabilities(providerId, modelName = '') {
    const prov = this.getProvider(providerId) || this.getProvider('local_llama_server');
    const caps = { ...prov.capabilities };

    // Model-specific overrides
    const lower = (modelName || '').toLowerCase();
    if (lower.includes('abyxv2') || lower.includes('deepseek') || lower.includes('r1')) {
      caps.supportsReasoning = true;
    }
    if (lower.includes('embedding') || lower.includes('tts') || lower.includes('whisper')) {
      caps.nativeToolCalling = false;
    }

    return caps;
  }

  async isLocalModelOnline() {
    return new Promise((resolve) => {
      try {
        const url = new URL('/v1/models', this.localEndpoint);
        const req = http.get(url.href, { timeout: 2500 }, (res) => {
          resolve(res.statusCode === 200);
        });
        req.on('error', () => resolve(false));
        req.on('timeout', () => { req.destroy(); resolve(false); });
      } catch (_) {
        resolve(false);
      }
    });
  }
}

module.exports = ProviderRegistry;
