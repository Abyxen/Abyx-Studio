'use strict';

const { EventEmitter } = require('node:events');
const SessionManager = require('./session_manager');
const ModelAdapter = require('./model_adapter');
const CancellationManager = require('./cancellation_manager');
const EventNormalizer = require('./event_normalizer');
const ContextManager = require('./context_manager');

/**
 * RuntimeController - Master Execution Controller for Unified Agent Sessions
 * 
 * Primary reference: Pi + OpenCode
 * Responsibilities:
 * - Bounded autonomous turn loop (step ceiling, turn timeouts)
 * - Provider capability aware inference via ModelAdapter
 * - Dynamic context construction via ContextManager (instructions, skills, memories, tools)
 * - Tool-output filtering: truncates excessive tool observations to prevent context pollution
 * - Robust tool-call handling (JSON repair, multi-tool execution)
 * - Error recovery: captures error observations so model can adapt
 * - Automatic compaction with recent-message retention
 * - Immutable persistent transcript preservation
 */
class RuntimeController extends EventEmitter {
  constructor({
    modelRouter,
    toolGateway,
    policyEngine = null,
    logger = null,
    options = {}
  }) {
    super();
    this.modelAdapter = new ModelAdapter({ modelRouter });
    this.toolGateway = toolGateway;
    this.policyEngine = policyEngine;
    this.logger = logger;
    this.options = options;

    this.sessionManager = new SessionManager(options);
    this.cancellationManager = new CancellationManager();

    this.maxSteps = options.maxSteps || 15;
    this.contextWindowLimit = options.contextWindowLimit || 8192;

    this.contextManager = new ContextManager({
      workspaceRoot: options.workspaceRoot || process.cwd(),
      sharedMemory: options.sharedMemory || null,
      defaultContextLimit: this.contextWindowLimit,
      compactionThreshold: options.compactionThreshold || 0.75
    });
  }

  /**
   * Safe JSON argument parser with repair capabilities
   */
  parseToolArguments(rawArgs) {
    if (typeof rawArgs === 'object' && rawArgs !== null) return rawArgs;
    if (!rawArgs || typeof rawArgs !== 'string') return {};

    try {
      return JSON.parse(rawArgs);
    } catch (_) {
      // Attempt repair: strip markdown code blocks
      const clean = rawArgs.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      try {
        return JSON.parse(clean);
      } catch (err) {
        return { _raw: rawArgs, _parseError: err.message };
      }
    }
  }

  /**
   * Execute an autonomous session run
   */
  async runSession({
    sessionId = null,
    goal = null,
    model = 'auto',
    provider = 'local_llama_server',
    mode = 'build',
    systemPrompt = null,
    signal = null,
    onEvent = null
  }) {
    // 1. Resolve or create genuine session
    let session = sessionId ? this.sessionManager.getSession(sessionId) : null;
    if (!session) {
      session = this.sessionManager.createSession({
        id: sessionId,
        goal: goal || 'Untitled Task',
        model,
        provider,
        mode,
        ...(systemPrompt ? { systemPrompt } : {})
      });
    } else if (goal) {
      session.messages.push({ role: 'user', content: goal });
      session.transcript.push({
        type: 'user_prompt',
        content: goal,
        timestamp: new Date().toISOString()
      });
    }

    session.status = 'running';
    if (this.policyEngine) {
      this.policyEngine.setMode(mode || session.mode || 'build');
    }

    const normalizer = new EventNormalizer(session.id);
    const cancelToken = this.cancellationManager.createToken(session.id);

    const emitEvent = (type, data) => {
      const normalized = normalizer.normalize(type, data);
      this.emit(type, normalized);
      if (typeof onEvent === 'function') {
        try { onEvent(type, normalized); } catch (_) {}
      }
      if (this.logger) {
        this.logger.recordEvent({ ...normalized, timestamp: new Date().toISOString() });
      }
    };

    emitEvent('session:start', { sessionId: session.id, goal: session.goal, model: session.model });

    let stepCount = 0;
    let completed = false;
    let finalAnswer = null;

    try {
      while (stepCount < this.maxSteps && !completed) {
        // Check cancellation
        if ((signal && signal.aborted) || cancelToken.signal.aborted) {
          session.status = 'cancelled';
          this.sessionManager.saveSession(session);
          emitEvent('session:cancelled', { reason: 'Execution cancelled by user' });
          return { ok: false, cancelled: true, sessionId: session.id, turnsCount: session.turnsCount };
        }

        stepCount++;
        session.turnsCount = stepCount;
        emitEvent('turn:start', { step: stepCount, maxSteps: this.maxSteps });

        // Dynamic Context Construction & Token Budgeting (Pi + OpenCode)
        const allToolSchemas = this.toolGateway ? this.toolGateway.registry.getFunctionSchemas() : [];
        const dynamicCtx = this.contextManager.constructDynamicContext({
          session,
          taskQuery: session.goal,
          systemPrompt: session.systemPrompt,
          mode: session.mode,
          availableTools: allToolSchemas,
          maxContextTokens: this.contextWindowLimit
        });

        if (dynamicCtx.metadata.skillsInjected.length > 0) {
          emitEvent('context:skills_injected', { skills: dynamicCtx.metadata.skillsInjected });
        }

        // Model Inference Call
        emitEvent('reasoning:start', { step: stepCount });
        const response = await this.modelAdapter.chat({
          messages: dynamicCtx.messages,
          tools: dynamicCtx.tools.length > 0 ? dynamicCtx.tools : undefined,
          model: session.model,
          provider: session.provider,
          signal: cancelToken.signal
        });

        const choice = response.choices && response.choices[0];
        const message = choice ? choice.message : { content: '' };

        if (message.reasoning_content) {
          emitEvent('reasoning:delta', { step: stepCount, reasoning: message.reasoning_content });
        }

        const toolCalls = message.tool_calls || [];

        if (toolCalls.length > 0) {
          session.messages.push({
            role: 'assistant',
            content: message.content || '',
            reasoning_content: message.reasoning_content,
            tool_calls: toolCalls
          });

          for (const call of toolCalls) {
            const toolName = call.function ? call.function.name : call.name;
            const toolArgs = this.parseToolArguments(call.function?.arguments || call.args);

            emitEvent('tool:call:requested', { step: stepCount, callId: call.id, tool: toolName, args: toolArgs });

            let rawToolResult;
            try {
              rawToolResult = await this.toolGateway.execute(toolName, toolArgs, {
                sessionId: session.id,
                step: stepCount,
                callId: call.id
              });
            } catch (toolErr) {
              // Error Recovery: Record error as observation so model can adapt
              rawToolResult = { ok: false, error: toolErr.message };
            }

            // Filter tool output to protect context budget
            const filteredResult = this.contextManager.filterToolOutput(rawToolResult, toolName);

            emitEvent('tool:call:result', {
              step: stepCount,
              callId: call.id,
              tool: toolName,
              result: filteredResult
            });

            // Ephemeral message array receives filtered observation
            session.messages.push({
              role: 'tool',
              tool_call_id: call.id,
              name: toolName,
              content: JSON.stringify(filteredResult)
            });

            // Immutable persistent transcript receives complete turn record
            this.sessionManager.recordTurn(session.id, {
              step: stepCount,
              type: 'tool_execution',
              tool: toolName,
              args: toolArgs,
              result: rawToolResult,
              filtered: filteredResult !== rawToolResult
            });
          }
        } else {
          // Model completed answer
          finalAnswer = message.content;
          completed = true;

          session.messages.push({
            role: 'assistant',
            content: finalAnswer,
            reasoning_content: message.reasoning_content
          });

          // Record final answer in immutable transcript
          this.sessionManager.recordTurn(session.id, {
            step: stepCount,
            type: 'final_answer',
            content: finalAnswer
          });

          emitEvent('turn:end', { step: stepCount, answer: finalAnswer });
        }
      }

      session.status = completed ? 'completed' : 'failed';
      
      // Save context checkpoint
      this.sessionManager.addCheckpoint(session.id, {
        summary: `Session completed with ${session.turnsCount} turns`,
        finalAnswer: finalAnswer ? finalAnswer.slice(0, 200) : null
      });

      this.sessionManager.saveSession(session);
      this.cancellationManager.dispose(session.id);

      const summary = {
        ok: completed,
        sessionId: session.id,
        turnsCount: session.turnsCount,
        result: finalAnswer,
        session
      };

      emitEvent('session:completed', summary);
      return summary;
    } catch (err) {
      session.status = 'failed';
      session.lastError = err.message;
      this.sessionManager.saveSession(session);
      this.cancellationManager.dispose(session.id);

      emitEvent('session:error', { error: err.message, stepCount });
      return {
        ok: false,
        error: err.message,
        sessionId: session.id,
        turnsCount: session.turnsCount
      };
    }
  }

  cancelSession(sessionId, reason = 'Cancelled by user') {
    this.cancellationManager.cancel(sessionId, reason);
    return this.sessionManager.cancelSession(sessionId, reason);
  }

  branchSession(parentSessionId, options = {}) {
    return this.sessionManager.branchSession(parentSessionId, options);
  }
}

module.exports = RuntimeController;
