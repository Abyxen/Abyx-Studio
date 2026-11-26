'use strict';

const ProviderRegistry = require('./provider_registry');

/**
 * ModelAdapter - Clean Bridge between Unified Runtime and ModelRouter
 * 
 * Adapts model generation across heterogeneous backends:
 * - Detects provider tool-calling capability (native OpenAI tools vs text-prompt fallback)
 * - Normalizes reasoning tokens (choices.reasoning_content vs <think> XML tags)
 * - Preserves existing model_router.js implementation without duplication
 */
class ModelAdapter {
  constructor({ modelRouter, providerRegistry = null, options = {} }) {
    this.modelRouter = modelRouter;
    this.registry = providerRegistry || new ProviderRegistry();
    this.options = options;
  }

  /**
   * Formats prompt with tool declarations when provider lacks native tool-calling
   */
  _injectPromptBasedTools(messages, tools) {
    if (!tools || tools.length === 0) return messages;

    const toolDescriptions = tools.map(t => {
      const fn = t.function || t;
      return `- ${fn.name}: ${fn.description} (Parameters: ${JSON.stringify(fn.parameters?.properties || {})})`;
    }).join('\n');

    const instruction = `
You have access to the following tools:
${toolDescriptions}

To invoke a tool, respond with a JSON code block in this exact format:
\`\`\`json
{
  "tool": "tool_name",
  "args": { "param1": "value" }
}
\`\`\`
If you do not need to call a tool, answer normally.
`;

    const cloned = messages.map(m => ({ ...m }));
    if (cloned.length > 0 && cloned[0].role === 'system') {
      cloned[0].content += `\n\n${instruction}`;
    } else {
      cloned.unshift({ role: 'system', content: instruction });
    }
    return cloned;
  }

  /**
   * Extracts tool calls from model text if native tool_calls were not returned
   */
  _extractPromptBasedToolCall(text) {
    if (!text || typeof text !== 'string') return null;

    // Look for JSON block ```json ... ```
    const match = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    const jsonStr = match ? match[1].trim() : text.trim();

    try {
      const parsed = JSON.parse(jsonStr);
      if (parsed && (parsed.tool || parsed.name)) {
        return [
          {
            id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            type: 'function',
            function: {
              name: parsed.tool || parsed.name,
              arguments: JSON.stringify(parsed.args || parsed.parameters || {})
            }
          }
        ];
      }
    } catch (_) {}
    return null;
  }

  /**
   * Extracts reasoning content (<think>...</think>) from text if not in reasoning_content field
   */
  _extractReasoningTags(text) {
    if (!text || typeof text !== 'string') return { text, reasoning: '' };
    
    const thinkMatch = text.match(/<think>([\s\S]*?)<\/think>/i);
    if (thinkMatch) {
      const reasoning = thinkMatch[1].trim();
      const cleanText = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
      return { text: cleanText, reasoning };
    }
    return { text, reasoning: '' };
  }

  /**
   * Primary inference gateway called by AgentExecutionLoop / RuntimeController
   */
  async chat({
    messages = [],
    tools = null,
    model = 'auto',
    provider = 'local_llama_server',
    temperature,
    maxTokens,
    seed,
    signal,
    onChunk
  }) {
    const caps = this.registry.detectCapabilities(provider, model);
    let effectiveMessages = messages;
    let effectiveTools = tools;

    // Fallback if provider doesn't support native tool calling
    if (tools && tools.length > 0 && !caps.nativeToolCalling) {
      effectiveMessages = this._injectPromptBasedTools(messages, tools);
      effectiveTools = null;
    }

    // Call underlying ModelRouter
    const response = await this.modelRouter.chat({
      messages: effectiveMessages,
      tools: effectiveTools,
      model,
      temperature,
      maxTokens,
      seed,
      signal,
      onChunk
    });

    const choice = response.choices && response.choices[0];
    const message = choice ? choice.message : { content: '' };

    let content = message.content || '';
    let reasoning = message.reasoning_content || '';
    let toolCalls = message.tool_calls || [];

    // If reasoning wasn't separated natively, extract from <think> tags
    if (!reasoning && content.includes('<think>')) {
      const extracted = this._extractReasoningTags(content);
      content = extracted.text;
      reasoning = extracted.reasoning;
    }

    // If native tool calls were absent, check prompt fallback
    if (toolCalls.length === 0 && (!caps.nativeToolCalling || content.includes('```json'))) {
      const fallbackCalls = this._extractPromptBasedToolCall(content);
      if (fallbackCalls) {
        toolCalls = fallbackCalls;
      }
    }

    return {
      id: response.id || `chat_${Date.now()}`,
      model: response.model || model,
      provider: response.provider || provider,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content,
            reasoning_content: reasoning,
            tool_calls: toolCalls
          },
          finish_reason: choice?.finish_reason || 'stop'
        }
      ],
      usage: response.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      durationMs: response.durationMs || 0
    };
  }
}

module.exports = ModelAdapter;
