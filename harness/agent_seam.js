/**
 * AXOM DeepSeek Harness: Agent & Session Integration Seam (Stage 1 & 2)
 * Connects the AXOM HTTP Server & UI to the Harness Microkernel Agent Execution Loop.
 * 
 * Invariants:
 * - Local-in-process execution on loopback (no unauthenticated external listener)
 * - Typed request & event contracts (SSE and JSON)
 * - Explicit execution timeouts & AbortSignal cancellation
 * - Durable session log persistence in data/sessions/<sessionId>.json
 * - Isolated from SQLite permanent profile until explicit user review
 */

const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const aiProviders = require('../services/ai_providers');
const { dataDir } = require('../data_paths');

const SESSIONS_DIR = path.join(dataDir, 'sessions');
if (!fs.existsSync(SESSIONS_DIR)) {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

class HarnessSessionStore {
  static getSessionPath(sessionId) {
    const safeId = String(sessionId).replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(SESSIONS_DIR, `${safeId}.json`);
  }

  static loadSession(sessionId) {
    const file = this.getSessionPath(sessionId);
    if (fs.existsSync(file)) {
      try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch (e) {
        console.warn(`[HarnessSessionStore] Warning loading session ${sessionId}:`, e.message);
      }
    }
    return {
      sessionId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      events: [],
      turns: []
    };
  }

  static appendEvent(sessionId, event) {
    const session = this.loadSession(sessionId);
    session.updatedAt = new Date().toISOString();
    session.events.push({
      ...event,
      timestamp: new Date().toISOString()
    });
    fs.writeFileSync(this.getSessionPath(sessionId), JSON.stringify(session, null, 2), 'utf8');
    return session;
  }

  static recordTurn(sessionId, turnData) {
    const session = this.loadSession(sessionId);
    session.updatedAt = new Date().toISOString();
    session.turns.push({
      ...turnData,
      completedAt: new Date().toISOString()
    });
    fs.writeFileSync(this.getSessionPath(sessionId), JSON.stringify(session, null, 2), 'utf8');
    return session;
  }
}

/**
 * Harness Agent Execution Loop
 */
class HarnessAgentLoop extends EventEmitter {
  constructor(harness, options = {}) {
    super();
    this.harness = harness;
    this.options = {
      maxSteps: options.maxSteps || 6,
      turnTimeoutMs: options.turnTimeoutMs || 90000,
      ollamaBase: options.ollamaBase || 'http://127.0.0.1:11434',
      ...options
    };
  }

  /**
   * Execute an autonomous agent turn with streaming SSE output
   * @param {object} params
   * @param {string} params.sessionId
   * @param {Array} params.messages
   * @param {string} params.model
   * @param {string} params.systemPrompt
   * @param {boolean} params.webSearchEnabled
   * @param {boolean} params.researchModeEnabled
   * @param {AbortSignal} params.signal
   * @param {function} params.onEvent - callback for SSE event emission
   */
  async runTurn({
    sessionId = 'default_session',
    messages = [],
    model = 'axom:1.1',
    systemPrompt = '',
    webSearchEnabled = true,
    researchModeEnabled = false,
    signal = null,
    onEvent = () => {}
  }) {
    throw new Error('Legacy harness execution is disabled; use the policy-enforced AgentExecutionEngine route.');

    const emit = (event) => {
      onEvent(event);
      HarnessSessionStore.appendEvent(sessionId, event);
      this.emit('event', { sessionId, ...event });
    };

    emit({
      type: 'session_init',
      sessionId,
      runtime: 'deepseek-harness',
      model,
      timestamp: new Date().toISOString()
    });

    const consumerTools = this.harness.get('consumer_tools');
    const availableTools = consumerTools.getAvailableTools({
      webSearchEnabled,
      researchModeEnabled,
      mcpEnabled: true,
      skillsEnabled: true
    });

    // Build working conversation chain
    const conversationChain = [];
    if (systemPrompt) {
      conversationChain.push({ role: 'system', content: systemPrompt });
    }
    for (const m of messages) {
      if (m && m.role && m.content) {
        conversationChain.push({ role: m.role, content: m.content });
      }
    }

    let step = 0;
    let fullAssistantResponse = '';
    const executedTools = [];

    // If target model is a cloud provider, stream directly via ai_providers
    if (aiProviders.isCloudModel(model)) {
      emit({ type: 'step_start', step: 1, maxSteps: 1 });
      emit({ type: 'status', message: `Routing through ${model}...` });

      try {
        const timeout = AbortSignal.timeout(this.options.turnTimeoutMs);
        const reqSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;

        await aiProviders.streamProviderChat({
          model,
          messages: conversationChain,
          temperature: this.options.temperature || 0.4,
          max_tokens: 2048,
          signal: reqSignal,
          res: {
            write: (chunk) => {
              const match = chunk.match(/^data: (.*)\n\n$/);
              if (match) {
                try {
                  const parsed = JSON.parse(match[1]);
                  const token = parsed.text || parsed.content || '';
                  if (token) {
                    fullAssistantResponse += token;
                    emit({ type: 'delta', delta: token, text: token, token });
                  } else if (parsed.type === 'think') {
                    emit({ type: 'think', text: parsed.text || '' });
                  }
                } catch (e) {}
              }
            },
            end: () => {}
          },
          enableFailover: true
        });
      } catch (cloudErr) {
        emit({ type: 'error', error: cloudErr.message, message: cloudErr.message });
        throw cloudErr;
      }

      step = 1;
    } else {
      // Local Ollama model execution with autonomous tool execution loop
      while (step < this.options.maxSteps) {
        if (signal?.aborted) {
          emit({ type: 'cancellation', reason: 'Aborted by user' });
          break;
        }

        step++;
        emit({ type: 'step_start', step, maxSteps: this.options.maxSteps });
        emit({ type: 'status', message: `Step ${step}/${this.options.maxSteps}: Running local inference...` });

        const requestPayload = {
          model,
          messages: conversationChain,
          stream: true,
          options: { temperature: 0.3 }
        };

        if (availableTools.length > 0) {
          requestPayload.tools = availableTools;
        }

        let res;
        try {
          const timeout = AbortSignal.timeout(this.options.turnTimeoutMs);
          const reqSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;

          res = await fetch(`${this.options.ollamaBase}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestPayload),
            signal: reqSignal
          });
        } catch (fetchErr) {
          emit({ type: 'error', error: fetchErr.message, message: fetchErr.message });
          throw fetchErr;
        }

        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          const errMsg = `Model provider returned HTTP ${res.status}: ${errText}`;
          emit({ type: 'error', error: errMsg, message: errMsg });
          throw new Error(errMsg);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let streamBuffer = '';
        let stepContent = '';
        let toolCalls = [];

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          streamBuffer += decoder.decode(value, { stream: true });
          const lines = streamBuffer.split('\n');
          streamBuffer = lines.pop();

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const data = JSON.parse(line);
              if (data.message) {
                if (data.message.content) {
                  stepContent += data.message.content;
                  fullAssistantResponse += data.message.content;
                  emit({ type: 'delta', delta: data.message.content, text: data.message.content, token: data.message.content });
                }
                if (Array.isArray(data.message.tool_calls) && data.message.tool_calls.length > 0) {
                  toolCalls.push(...data.message.tool_calls);
                }
              }
            } catch (jsonErr) {}
          }
        }

        // If the model called tools, dispatch them through the seam
        if (toolCalls.length > 0) {
          conversationChain.push({
            role: 'assistant',
            content: stepContent || '',
            tool_calls: toolCalls
          });

          for (const tc of toolCalls) {
            const fn = tc.function || tc;
            const toolName = fn.name;
            const toolId = tc.id || `tc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
            let toolArgs = {};
            try {
              toolArgs = typeof fn.arguments === 'string' ? JSON.parse(fn.arguments) : (fn.arguments || {});
            } catch (e) {
              toolArgs = {};
            }

            emit({
              type: 'tool_start',
              id: toolId,
              name: toolName,
              args: toolArgs,
              tool: toolName,
              step
            });

            let toolOutput;
            const t0 = Date.now();
            try {
              toolOutput = await consumerTools.executeTool(toolName, toolArgs);
            } catch (toolExecErr) {
              toolOutput = { success: false, error: toolExecErr.message };
            }
            const duration = Date.now() - t0;

            executedTools.push({
              tool: toolName,
              args: toolArgs,
              result: toolOutput,
              duration
            });

            emit({
              type: 'tool_end',
              id: toolId,
              name: toolName,
              result: toolOutput,
              duration,
              step
            });

            if (toolOutput && toolOutput.file) {
              emit({ type: 'file_download_ready', file: toolOutput.file });
            }

            conversationChain.push({
              role: 'tool',
              content: typeof toolOutput === 'string' ? toolOutput : JSON.stringify(toolOutput)
            });
          }

          // Loop continues to let model process tool outputs
          continue;
        } else {
          // Model provided final text response without tool calls; turn complete
          break;
        }
      }
    }

    emit({
      type: 'turn_done',
      done: true,
      sessionId,
      totalSteps: step,
      toolsExecuted: executedTools.length,
      responseLength: fullAssistantResponse.length
    });

    HarnessSessionStore.recordTurn(sessionId, {
      model,
      totalSteps: step,
      toolsExecuted: executedTools,
      assistantResponse: fullAssistantResponse
    });

    return {
      sessionId,
      totalSteps: step,
      response: fullAssistantResponse,
      executedTools
    };
  }
}

module.exports = {
  HarnessSessionStore,
  HarnessAgentLoop
};
