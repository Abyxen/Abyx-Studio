'use strict';

const { EventEmitter } = require('node:events');

/**
 * AgentExecutionLoop - Pi-inspired Autonomous Agent Lifecycle Loop
 * 
 * Invariants:
 * - Session state machine: 'idle' -> 'running' -> 'waiting_approval' -> 'compacting' -> 'completed' / 'failed' / 'cancelled'
 * - Event-driven streaming deltas: emits typed SSE events for reasoning, tool calls, and step results
 * - Context Compaction: prunes redundant tool inputs and outputs when approaching 75% of context limit
 * - Strict step ceilings (default 15) and AbortSignal cancellation
 */
class AgentExecutionLoop extends EventEmitter {
  constructor({ modelRouter, toolGateway, policyEngine, logger = null, options = {} }) {
    super();
    this.modelRouter = modelRouter;
    this.toolGateway = toolGateway;
    this.policyEngine = policyEngine;
    this.logger = logger;
    
    this.maxSteps = options.maxSteps || 15;
    this.contextWindowLimit = options.contextWindowLimit || 8192;
    this.compactionThreshold = options.compactionThreshold || 0.75; // 75%
    this.state = 'idle';
  }

  setState(newState, payload = {}) {
    const prevState = this.state;
    this.state = newState;
    this.emit('state:change', { previous: prevState, current: newState, ...payload });
  }

  estimateTokens(messages) {
    if (!Array.isArray(messages)) return 0;
    // Approximating tokens: ~4 chars per token
    const totalChars = messages.reduce((acc, m) => {
      const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content || '');
      return acc + content.length;
    }, 0);
    return Math.ceil(totalChars / 4);
  }

  compactContext(messages) {
    this.setState('compacting');
    this.emit('compaction:start', { originalCount: messages.length });

    // Always preserve system prompt (index 0) and the original user goal (index 1)
    const preserved = [];
    const middle = [];
    const recent = [];

    messages.forEach((msg, idx) => {
      if (idx === 0 && msg.role === 'system') {
        preserved.push(msg);
      } else if (idx === 1 && msg.role === 'user') {
        preserved.push(msg);
      } else if (idx >= messages.length - 4) {
        // Keep last 4 messages verbatim
        recent.push(msg);
      } else {
        middle.push(msg);
      }
    });

    // Compact tool outputs in middle messages
    const compactedMiddle = middle.map(msg => {
      if (msg.role === 'tool' || msg.name) {
        const text = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
        if (text.length > 200) {
          return {
            ...msg,
            content: `[Compacted Observation: ${text.slice(0, 180)}... (${text.length} chars)]`
          };
        }
      }
      return msg;
    });

    const result = [...preserved, ...compactedMiddle, ...recent];
    this.emit('compaction:done', {
      originalCount: messages.length,
      compactedCount: result.length,
      estimatedTokens: this.estimateTokens(result)
    });
    this.setState('running');
    return result;
  }

  async run({
    goal,
    messages = [],
    systemPrompt = 'You are an autonomous AI engineering agent.',
    model = 'auto',
    mode = 'build',
    signal = null,
    onEvent = null
  }) {
    if (this.state === 'running') {
      throw new Error('ExecutionLoop is already running an active task');
    }

    this.setState('running', { goal, model, mode });
    if (this.policyEngine) {
      this.policyEngine.setMode(mode);
    }

    const emitEvent = (type, data) => {
      this.emit(type, data);
      if (typeof onEvent === 'function') {
        try { onEvent(type, data); } catch (_) {}
      }
      if (this.logger) {
        this.logger.recordEvent({ type, data, timestamp: new Date().toISOString() });
      }
    };

    let activeMessages = [
      { role: 'system', content: systemPrompt },
      ...(messages.length > 0 ? messages : [{ role: 'user', content: goal }])
    ];

    const timeline = [];
    let stepCount = 0;
    let completed = false;
    let finalResult = null;

    try {
      while (stepCount < this.maxSteps && !completed) {
        if (signal && signal.aborted) {
          this.setState('cancelled');
          emitEvent('turn:cancelled', { reason: 'Client cancelled execution' });
          return { ok: false, cancelled: true, stepCount, timeline };
        }

        stepCount++;
        emitEvent('step:start', { step: stepCount, maxSteps: this.maxSteps });

        // Check context compaction threshold
        const tokenEstimate = this.estimateTokens(activeMessages);
        if (tokenEstimate > this.contextWindowLimit * this.compactionThreshold) {
          activeMessages = this.compactContext(activeMessages);
        }

        // Get function calling schemas from ToolGateway
        const toolSchemas = this.toolGateway.registry.getFunctionSchemas();

        // Model Inference Call
        emitEvent('reasoning:start', { step: stepCount });
        const response = await this.modelRouter.chat({
          messages: activeMessages,
          tools: toolSchemas.length > 0 ? toolSchemas : undefined,
          model,
          signal
        });

        const choice = response.choices && response.choices[0];
        const message = choice ? choice.message : { content: 'No response from model' };

        // Handle reasoning content (e.g. DeepSeek reasoning)
        if (message.reasoning_content) {
          emitEvent('reasoning:delta', {
            step: stepCount,
            reasoning: message.reasoning_content
          });
        }

        // Check if model emitted tool calls
        const toolCalls = message.tool_calls || [];
        if (toolCalls.length > 0) {
          activeMessages.push({
            role: 'assistant',
            content: message.content || '',
            reasoning_content: message.reasoning_content,
            tool_calls: toolCalls
          });

          for (const call of toolCalls) {
            const toolName = call.function ? call.function.name : call.name;
            let toolArgs = {};
            try {
              toolArgs = typeof call.function?.arguments === 'string' 
                ? JSON.parse(call.function.arguments) 
                : (call.function?.arguments || {});
            } catch (err) {
              toolArgs = { raw: call.function.arguments };
            }

            emitEvent('tool:call', {
              step: stepCount,
              callId: call.id,
              tool: toolName,
              args: toolArgs
            });

            // Execute through audited ToolGateway
            const executionResult = await this.toolGateway.execute(toolName, toolArgs, {
              step: stepCount,
              callId: call.id
            });

            emitEvent('tool:result', {
              step: stepCount,
              callId: call.id,
              tool: toolName,
              result: executionResult
            });

            timeline.push({
              step: stepCount,
              type: 'tool_call',
              tool: toolName,
              args: toolArgs,
              result: executionResult
            });

            activeMessages.push({
              role: 'tool',
              tool_call_id: call.id,
              name: toolName,
              content: JSON.stringify(executionResult)
            });
          }
        } else {
          // Model completed its answer / conclusion
          finalResult = message.content;
          completed = true;
          activeMessages.push({
            role: 'assistant',
            content: finalResult,
            reasoning_content: message.reasoning_content
          });
          timeline.push({
            step: stepCount,
            type: 'answer',
            content: finalResult
          });
          emitEvent('step:answer', { step: stepCount, content: finalResult });
        }

        emitEvent('step:end', { step: stepCount });
      }

      this.setState('completed');
      emitEvent('run:completed', {
        stepCount,
        completed,
        result: finalResult,
        timeline
      });

      return {
        ok: true,
        stepCount,
        completed,
        result: finalResult,
        timeline
      };
    } catch (err) {
      this.setState('failed', { error: err.message });
      emitEvent('run:error', { error: err.message, stepCount });
      return {
        ok: false,
        error: err.message,
        stepCount,
        timeline
      };
    }
  }
}

module.exports = AgentExecutionLoop;
