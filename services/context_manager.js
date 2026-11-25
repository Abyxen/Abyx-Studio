'use strict';

const MODEL_CONTEXT_LIMITS = Object.freeze({
  'inkling-2-mini': 8192,
  inkling: 8192,
  abyxv2: 32768,
  abyx: 32768,
  'gemma-4-26b': 16384,
  gemma: 8192,
  'qwen2.5-coder': 32768,
  qwen: 32768,
  'llama-3': 8192,
  'deepseek-r1': 65536,
  'claude-3-5': 200000,
  'gpt-4o': 128000,
  'gemini-1.5': 1000000,
  'gemini-2.0': 1000000,
  default: 8192
});

function messageText(message) {
  if (typeof message?.content === 'string') return message.content;
  try { return JSON.stringify(message?.content ?? ''); }
  catch { return ''; }
}

function validLimit(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 2_000_000 ? parsed : null;
}

function usageInputTokens(usage) {
  const value = usage?.input_tokens ?? usage?.prompt_tokens ?? usage?.promptTokens ?? usage?.inputTokens;
  return Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null;
}

function usageOutputTokens(usage) {
  const value = usage?.output_tokens ?? usage?.completion_tokens ?? usage?.completionTokens ?? usage?.outputTokens;
  return Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null;
}

class ContextManager {
  constructor({ tokenCounter = null } = {}) {
    this.tokenCounter = tokenCounter;
  }

  estimateTokens(text) {
    if (!text || typeof text !== 'string') return 0;
    if (this.tokenCounter) {
      try {
        const counted = this.tokenCounter(text);
        if (Number.isSafeInteger(counted) && counted >= 0) return counted;
      } catch {}
    }
    const isCode = /(?:function\s|const\s|import\s|def\s|class\s|=>)/.test(text);
    const isJson = /^\s*[{[]/.test(text) && /[}\]]\s*$/.test(text);
    const charsPerToken = isJson ? 2.9 : isCode ? 3.3 : 3.8;
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    return Math.max(text.length ? 1 : 0, Math.round((text.length / charsPerToken * 0.7) + (words * 0.39)));
  }

  calculateConversationTokens(messages = []) {
    const breakdown = { systemTokens: 0, userTokens: 0, assistantTokens: 0, toolTokens: 0 };
    for (const message of Array.isArray(messages) ? messages : []) {
      const tokens = this.estimateTokens(messageText(message)) + 4;
      if (message?.role === 'system') breakdown.systemTokens += tokens;
      else if (message?.role === 'user') breakdown.userTokens += tokens;
      else if (message?.role === 'assistant') breakdown.assistantTokens += tokens;
      else breakdown.toolTokens += tokens;
    }
    const totalTokens = Object.values(breakdown).reduce((total, count) => total + count, 3);
    return { totalTokens, breakdown };
  }

  resolveModelCeiling(modelName = '', configuredContext = null, providerContextWindow = null) {
    const explicit = validLimit(providerContextWindow) || validLimit(configuredContext);
    if (explicit) return explicit;
    const model = String(modelName || '').toLowerCase();
    const match = Object.keys(MODEL_CONTEXT_LIMITS).find(key => key !== 'default' && model.includes(key));
    return MODEL_CONTEXT_LIMITS[match || 'default'];
  }

  getTelemetry(messages = [], modelName = '', configuredContext = null, options = {}) {
    const estimate = this.calculateConversationTokens(messages);
    const inputTokens = usageInputTokens(options.usage);
    const outputTokens = usageOutputTokens(options.usage);
    const actualAvailable = inputTokens !== null;
    const measuredTokens = actualAvailable ? inputTokens : estimate.totalTokens;
    const maxContext = this.resolveModelCeiling(modelName, configuredContext, options.providerContextWindow);
    const reservedOutputTokens = Math.min(validLimit(options.reservedOutputTokens) || 0, maxContext);
    const effectiveLimit = Math.max(1, maxContext - reservedOutputTokens);
    const percentage = Math.min(100, Math.round((measuredTokens / effectiveLimit) * 100));
    const status = percentage >= 85 ? 'critical' : percentage >= 70 ? 'warning' : 'safe';
    return {
      provider: options.providerId || null,
      model: modelName || null,
      tokenSource: actualAvailable ? 'actual' : 'estimated',
      totalTokens: measuredTokens,
      estimatedTokens: estimate.totalTokens,
      actualInputTokens: inputTokens,
      actualOutputTokens: outputTokens,
      maxContext,
      reservedOutputTokens,
      usableInputTokens: effectiveLimit,
      percentage,
      status,
      needsCompaction: percentage >= 80,
      breakdown: estimate.breakdown
    };
  }

  groupConversation(messages) {
    const groups = [];
    let current = [];
    for (const message of messages) {
      if (message?.role === 'system') continue;
      if (message?.role === 'user' && current.length) {
        groups.push(current);
        current = [];
      }
      current.push(message);
    }
    if (current.length) groups.push(current);
    return groups;
  }

  compactConversation(messages = [], targetOrOptions = 4096) {
    if (!Array.isArray(messages)) throw new TypeError('Messages must be an array');
    const options = typeof targetOrOptions === 'number' ? { maxTargetTokens: targetOrOptions } : (targetOrOptions || {});
    const maxTargetTokens = validLimit(options.maxTargetTokens) || 4096;
    const original = this.calculateConversationTokens(messages);
    if (original.totalTokens <= maxTargetTokens) return { compacted: false, messages, ...original, tokenSource: 'estimated' };

    const systems = messages.filter(message => message?.role === 'system');
    const groups = this.groupConversation(messages);
    const pinned = [];
    if (typeof options.activeTask === 'string' && options.activeTask.trim()) {
      pinned.push({ role: 'user', content: `[Active task]
${options.activeTask.trim()}`, isActiveTask: true });
    }
    if (Array.isArray(options.artifacts)) {
      for (const artifact of options.artifacts.slice(0, 32)) {
        const serialized = typeof artifact === 'string' ? artifact : JSON.stringify(artifact);
        if (serialized && serialized.length <= 200_000) pinned.push({ role: 'user', content: `[Active artifact]
${serialized}`, isActiveArtifact: true });
      }
    }

    const kept = [];
    const recentTurnCount = Math.min(groups.length, Math.max(1, Math.min(Number(options.recentTurns) || 4, 20)));
    const protectedStart = groups.length - recentTurnCount;
    const pinnedMessages = [...systems, ...pinned];
    const base = [...pinnedMessages];
    const mandatory = groups.slice(protectedStart);
    let mandatoryMessages = [...base, ...mandatory.flat()];
    if (this.calculateConversationTokens(mandatoryMessages).totalTokens > maxTargetTokens) {
      return {
        compacted: false,
        blocked: true,
        reason: 'Required system instructions, active task, artifacts, and recent complete turns exceed the target; no messages were removed.',
        messages,
        originalTokens: original.totalTokens,
        tokenSource: 'estimated'
      };
    }

    kept.push(...mandatory);
    let compactedMessages = [...pinnedMessages, ...kept.flat()];
    for (let index = protectedStart - 1; index >= 0; index--) {
      const candidate = [...pinnedMessages, ...groups[index], ...kept.flat()];
      if (this.calculateConversationTokens(candidate).totalTokens > maxTargetTokens) break;
      kept.unshift(groups[index]);
      compactedMessages = candidate;
    }

    const finalMetrics = this.calculateConversationTokens(compactedMessages);
    return {
      compacted: true,
      messages: compactedMessages,
      originalTokens: original.totalTokens,
      compactedTokens: finalMetrics.totalTokens,
      tokensSaved: original.totalTokens - finalMetrics.totalTokens,
      droppedTurns: groups.length - kept.length,
      tokenSource: 'estimated',
      telemetry: { estimate: finalMetrics.totalTokens, target: maxTargetTokens }
    };
  }

  getModelCeiling(modelName = '', configuredContext = null) {
    return this.resolveModelCeiling(modelName, configuredContext);
  }

  compactContext(messages = [], options = {}) {
    return this.compactConversation(messages, options).messages;
  }
}

const contextManager = new ContextManager();
module.exports = contextManager;
module.exports.ContextManager = ContextManager;
module.exports.MODEL_CONTEXT_LIMITS = MODEL_CONTEXT_LIMITS;
