/**
 * ABYX Agentic Engine — Controlled Execution Loop & Watchdog
 * 
 * Enforces:
 * - Bounded step limits (maxSteps) & execution timeouts
 * - Central backend policy validation (model cannot grant itself permissions)
 * - Human-in-the-loop approval pause/resume for high-impact actions
 * - Live activity timeline emissions (SSE & EventEmitter)
 * - Clean user cancellation via AbortController
 * - Secret scrubbing on all persisted logs and timeline events
 */

const { EventEmitter } = require('node:events');
const {
  AgentRunStatus,
  StepStatus,
  RiskLevel,
  ApprovalStatus,
  createAgentRun,
  createPlan,
  createToolCall,
  createTimelineEvent
} = require('./types');
const ExecutionLogger = require('./execution_logger');
const { validateValue } = require('./tool_gateway');

class AgentExecutionEngine extends EventEmitter {
  constructor({ pathGuard, policyEngine, fsTool, terminalTool, browserTool, providerRegistry, toolRegistry, toolGateway, modelRouter, logger, options = {} } = {}) {
    super();
    this.pathGuard = pathGuard;
    this.policyEngine = policyEngine;
    this.fsTool = fsTool;
    this.terminalTool = terminalTool;
    this.browserTool = browserTool;
    this.providerRegistry = providerRegistry;
    this.modelRouter = modelRouter || providerRegistry || null;
    this.toolRegistry = toolRegistry || null;
    this.toolGateway = toolGateway || null;
    this.logger = logger || null;
    this.maxSteps = options.maxSteps || 15;
    this.state = 'idle';

    // Active runs registry: runId -> { run, controller, approvalResolvers: Map }
    this.activeRuns = new Map();
    this.toolGateway?.on('audit', event => {
      const active = event.runId ? this.activeRuns.get(event.runId) : null;
      if (active) this.emitTimeline(active.run, 'tool_gateway_audit', event, active.onEvent);
    });
  }

  setState(newState, payload = {}) {
    const prevState = this.state;
    this.state = newState;
    this.emit('state:change', { previous: prevState, current: newState, ...payload });
  }

  /**
   * Helper to emit timeline events and record them in the run log
   */
  emitTimeline(run, type, payload = {}, onEvent = null) {
    const rawEvent = createTimelineEvent(type, { runId: run.id, ...payload });
    const cleanEvent = ExecutionLogger.scrub(rawEvent);

    run.timeline.push(cleanEvent);
    this.emit('timeline', cleanEvent);

    if (typeof onEvent === 'function') {
      try { onEvent(cleanEvent); } catch (e) {}
    }
    return cleanEvent;
  }

  /**
   * Resolves a pending human approval for an active run
   */
  resolveApproval(approvalId, decision = 'approve') {
    const request = this.policyEngine.resolveApproval(approvalId, decision);
    const active = this.activeRuns.get(request.runId);

    if (active && active.approvalResolvers.has(approvalId)) {
      const resolver = active.approvalResolvers.get(approvalId);
      active.approvalResolvers.delete(approvalId);
      resolver(request);
    }

    return request;
  }

  /**
   * Cancels a currently running execution
   */
  cancelRun(runId, reason = 'Cancelled by user') {
    const active = this.activeRuns.get(runId);
    if (!active) return { ok: false, error: 'Run not found or already inactive' };

    active.run.status = AgentRunStatus.CANCELLED;
    active.run.error = reason;
    active.run.endTime = new Date().toISOString();

    // Abort controller
    active.controller.abort(reason);

    // Cancel all pending approval resolvers
    for (const [apprId, resolver] of active.approvalResolvers.entries()) {
      try {
        const req = this.policyEngine.pendingApprovals.get(apprId);
        if (req) {
          req.status = ApprovalStatus.DENIED;
          req.decision = 'deny';
          req.resolvedAt = new Date().toISOString();
        }
        resolver(req);
      } catch (e) {}
    }
    active.approvalResolvers.clear();

    this.emitTimeline(active.run, 'run_cancelled', { reason });
    ExecutionLogger.saveRun(active.run);
    this.activeRuns.delete(runId);

    return { ok: true, runId, status: AgentRunStatus.CANCELLED };
  }

  /**
   * Dispatches a tool call to the appropriate restricted tool module
   */
  async #executeToolInternal(toolName, args, signal, approvalId = null, context = {}) {
    if (!this.toolGateway) return { success: false, output: { success: false, error: 'Tool Gateway is unavailable' }, durationMs: 0 };
    const result = await this.toolGateway.execute({
      toolId: toolName,
      args,
      signal,
      context: { ...context, approvalId }
    });
    return {
      success: result.success === true && result.output?.success !== false,
      output: result.output === undefined ? { success: false, error: result.error || 'Tool execution failed' } : result.output,
      durationMs: result.durationMs || 0,
      denied: result.denied === true,
      requiresApproval: result.requiresApproval === true
    };
  }

  /**
   * Execute an agentic run with plan tracking, human approval, and bounded steps
   * 
   * @param {Object} params
   * @param {string} params.sessionId
   * @param {string} params.profileId
   * @param {string} params.goal
   * @param {string} params.model
   * @param {Object|Array} params.plan - Structured plan or array of step strings
   * @param {number} params.maxSteps - Hard upper bound on steps
   * @param {AbortSignal} params.signal - External cancellation signal
   * @param {function} params.onEvent - SSE callback
   * @param {function} params.stepExecutor - Custom step/model generator function
   */
  async run({
    sessionId = 'default_session',
    profileId = 'prof_default',
    goal = 'Execute autonomous task',
    model = 'abyx:1.1',
    plan = null,
    maxSteps = 8,
    signal = null,
    onEvent = () => {},
    stepExecutor = null,
    messages = [],
    systemPrompt = 'You are an autonomous AI engineering agent.',
    mode = 'build'
  } = {}) {
    if (signal && signal.aborted) {
      this.setState('cancelled');
      if (typeof onEvent === 'function') onEvent('turn:cancelled', { reason: 'Client cancelled execution' });
      return { ok: false, cancelled: true, status: 'cancelled' };
    }

    if (this.modelRouter && typeof stepExecutor !== 'function') {
      this.setState('running', { goal, model, mode });
      if (this.policyEngine && typeof this.policyEngine.setMode === 'function') {
        this.policyEngine.setMode(mode);
      }

      const emitEvent = (type, data) => {
        this.emit(type, data);
        if (typeof onEvent === 'function') {
          try { onEvent(type, data); } catch (_) {}
        }
        if (this.logger && typeof this.logger.recordEvent === 'function') {
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
        while (stepCount < (maxSteps || this.maxSteps) && !completed) {
          if (signal && signal.aborted) {
            this.setState('cancelled');
            emitEvent('turn:cancelled', { reason: 'Client cancelled execution' });
            return { ok: false, cancelled: true, stepCount, timeline };
          }

          stepCount++;
          emitEvent('step:start', { step: stepCount, maxSteps: (maxSteps || this.maxSteps) });

          const toolSchemas = this.toolGateway?.registry?.getFunctionSchemas ? this.toolGateway.registry.getFunctionSchemas() : [];

          emitEvent('reasoning:start', { step: stepCount });
          const response = await this.modelRouter.chat({
            messages: activeMessages,
            tools: toolSchemas && toolSchemas.length > 0 ? toolSchemas : undefined,
            model,
            signal
          });

          const choice = response.choices && response.choices[0];
          const message = choice ? choice.message : { content: 'No response from model' };

          if (message.reasoning_content) {
            emitEvent('reasoning:delta', {
              step: stepCount,
              reasoning: message.reasoning_content
            });
          }

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
              } catch (_) {
                toolArgs = { raw: call.function.arguments };
              }

              emitEvent('tool:call', {
                step: stepCount,
                callId: call.id,
                tool: toolName,
                args: toolArgs
              });

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
          completed,
          stepCount,
          result: finalResult,
          timeline,
          status: 'completed'
        };
      } catch (err) {
        this.setState('failed', { error: err.message });
        emitEvent('run:error', { error: err.message, stepCount });
        return {
          ok: false,
          error: err.message,
          stepCount,
          timeline,
          status: 'failed'
        };
      }
    }
    // 1. Initialize Plan
    const effectivePlan = plan && plan.steps ? plan : createPlan(goal, Array.isArray(plan) ? plan : [goal]);

    // 2. Initialize Agent Run Record
    const run = createAgentRun({
      sessionId,
      profileId,
      goal,
      model,
      plan: effectivePlan,
      maxSteps: Math.min(Math.max(Number(maxSteps) || 8, 1), 30) // Scaled autonomous ceiling of 30 steps
    });
    run.profileId = profileId;
    run.subtasks = [];

    const controller = new AbortController();
    const activeEntry = {
      run,
      controller,
      approvalResolvers: new Map(),
      onEvent
    };
    this.activeRuns.set(run.id, activeEntry);

    // Chain external cancellation signal
    if (signal) {
      if (signal.aborted) {
        this.cancelRun(run.id, 'Cancelled prior to start');
        return run;
      }
      signal.addEventListener('abort', () => this.cancelRun(run.id, 'External signal aborted'), { once: true });
    }

    run.status = AgentRunStatus.RUNNING;
    this.emitTimeline(run, 'run_started', {
      goal: run.goal,
      model: run.model,
      maxSteps: run.maxSteps,
      totalPlanSteps: effectivePlan.steps.length
    }, onEvent);

    this.emitTimeline(run, 'plan_created', {
      plan: effectivePlan
    }, onEvent);

    try {
      while (run.stepsExecuted < run.maxSteps && run.status === AgentRunStatus.RUNNING) {
        if (controller.signal.aborted) break;

        const currentStepIndex = run.stepsExecuted;
        let currentPlanStep = effectivePlan.steps[currentStepIndex];

        if (!currentPlanStep) {
          // If execution exceeds initial plan steps, dynamically add continuing step
          currentPlanStep = {
            id: `step_${currentStepIndex + 1}_dyn`,
            stepNumber: currentStepIndex + 1,
            description: `Execute continuation step ${currentStepIndex + 1}`,
            status: StepStatus.PENDING,
            toolCalls: []
          };
          effectivePlan.steps.push(currentPlanStep);
        }

        currentPlanStep.status = StepStatus.IN_PROGRESS;
        currentPlanStep.startTime = new Date().toISOString();
        run.stepsExecuted++;

        this.emitTimeline(run, 'step_started', {
          stepNumber: currentPlanStep.stepNumber,
          description: currentPlanStep.description,
          progressPercent: Math.round((run.stepsExecuted / run.maxSteps) * 100)
        }, onEvent);

        // Execute step logic via provided stepExecutor or default plan progression
        let stepOutput = null;
        if (typeof stepExecutor === 'function') {
          stepOutput = await stepExecutor({
            run,
            step: currentPlanStep,
            signal: controller.signal,
            executeTool: async (toolName, toolArgs) => {
              return await this.requestAndExecuteTool(run, currentPlanStep, toolName, toolArgs, controller.signal, onEvent);
            }
          });
        }

        currentPlanStep.status = StepStatus.COMPLETED;
        currentPlanStep.endTime = new Date().toISOString();

        if (stepOutput && stepOutput.subtask) {
          const subtaskRecord = {
            id: `subtask_${run.subtasks.length + 1}`,
            title: String(stepOutput.subtask),
            status: stepOutput.status || 'in_progress',
            stepNumber: currentPlanStep.stepNumber,
            timestamp: new Date().toISOString()
          };
          run.subtasks.push(subtaskRecord);
          this.emitTimeline(run, 'subtask_updated', subtaskRecord, onEvent);
        }

        this.emitTimeline(run, 'step_completed', {
          stepNumber: currentPlanStep.stepNumber,
          description: currentPlanStep.description,
          result: stepOutput
        }, onEvent);

        // If step output indicated completion, break early
        if (stepOutput && stepOutput.done === true) {
          run.output = stepOutput.result || stepOutput.message || 'Task completed successfully';
          break;
        }

        // If all plan steps are complete
        if (run.stepsExecuted >= effectivePlan.steps.length && (!stepOutput || stepOutput.continue !== true)) {
          break;
        }
      }

      if (run.status === AgentRunStatus.RUNNING) {
        run.status = AgentRunStatus.COMPLETED;
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        run.status = AgentRunStatus.FAILED;
        run.error = err.message;
        this.emitTimeline(run, 'run_error', { error: err.message }, onEvent);
      }
    } finally {
      run.endTime = new Date().toISOString();
      this.activeRuns.delete(run.id);

      this.emitTimeline(run, 'run_completed', {
        status: run.status,
        stepsExecuted: run.stepsExecuted,
        toolsExecuted: run.toolsExecuted,
        approvalsGranted: run.approvalsGranted,
        approvalsDenied: run.approvalsDenied,
        output: run.output,
        error: run.error
      }, onEvent);

      // Persist scrubbed audit trail to disk
      ExecutionLogger.saveRun(run);
    }

    run.ok = (run.status === AgentRunStatus.COMPLETED);
    run.completed = (run.status === AgentRunStatus.COMPLETED);
    run.result = run.output;
    return run;
  }

  /**
   * Internal pipeline for policy check, approval request, and tool execution
   */
  async requestAndExecuteTool(run, step, toolName, toolArgs, signal, onEvent) {
    run.toolsExecuted++;

    const definition = this.toolRegistry?.get(toolName);
    if (!definition || !definition.enabled) {
      return this.toolGateway?.reject({ toolId: toolName, context: { runId: run.id, callId: `rejected_${Date.now()}` }, error: `Tool "${toolName}" is not registered or is disabled` }) || { success: false, denied: true, error: `Tool "${toolName}" is not registered or is disabled` };
    }
    const schemaError = validateValue(toolArgs, definition.inputSchema);
    if (schemaError) {
      return this.toolGateway.reject({ toolId: toolName, context: { runId: run.id, callId: `invalid_${Date.now()}` }, error: `Invalid tool arguments: ${schemaError}` });
    }

    // 1. Detect if target file exists (for overwrite risk evaluation)
    let isOverwrite = false;
    let changePreview = null;
    if (['fs_write', 'write_file', 'generate_file'].includes(toolName)) {
      const p = toolArgs.filePath || toolArgs.file_path || toolArgs.path || toolArgs.filename;
      try {
        const safeP = this.pathGuard.resolveSafePath(p, { allowCreate: true });
        isOverwrite = require('node:fs').existsSync(safeP);
        if (toolName === 'fs_write') {
          const fs = require('node:fs');
          const original = isOverwrite ? fs.readFileSync(safeP, 'utf8') : '';
          const currentHash = isOverwrite ? require('node:crypto').createHash('sha256').update(original).digest('hex') : null;
          if (isOverwrite && (!toolArgs.expectedHash || toolArgs.expectedHash !== currentHash)) {
            return { success: false, conflict: true, error: 'File changed or was not read before editing; inspect it again before requesting approval.' };
          }
          if (!isOverwrite && toolArgs.expectedHash) return { success: false, conflict: true, error: 'Target file appeared after review; inspect it again.' };
          const updated = toolArgs.content || '';
          const diff = this.fsTool.computeDiff(original, updated);
          changePreview = (JSON.stringify(diff.summary) + '\n' + diff.diffLines.slice(0, 80).map(line => `${line.type === 'added' ? '+' : line.type === 'deleted' ? '-' : ' '} ${line.text}`).join('\n')).slice(0, 8000);
        }
      } catch (e) { return { success: false, denied: true, error: 'File path could not be safely reviewed.' }; }
    } else if (toolName === 'fs_edit') {
      try {
        const safeP = this.pathGuard.resolveSafePath(toolArgs.filePath);
        const original = require('node:fs').readFileSync(safeP, 'utf8');
        const hash = require('node:crypto').createHash('sha256').update(original).digest('hex');
        if (!toolArgs.expectedHash || toolArgs.expectedHash !== hash) return { success: false, conflict: true, error: 'File changed or was not read before editing; inspect it again before requesting approval.' };
        const occurrences = original.split(toolArgs.target).length - 1;
        if (occurrences !== 1) return { success: false, conflict: true, error: 'Edit target must match exactly once; inspect the file and revise the edit.' };
        const diff = this.fsTool.computeDiff(original, original.replace(toolArgs.target, toolArgs.replacement));
        changePreview = (JSON.stringify(diff.summary) + '\n' + diff.diffLines.slice(0, 80).map(line => `${line.type === 'added' ? '+' : line.type === 'deleted' ? '-' : ' '} ${line.text}`).join('\n')).slice(0, 8000);
      } catch (e) { return { success: false, denied: true, error: 'File path could not be safely reviewed.' }; }
    }

    // 2. Central Policy Engine Evaluation
    const policyResult = this.policyEngine.evaluateToolCall(toolName, toolArgs, {
      isOverwrite,
      changePreview,
      profilePermissions: {}
    });

    const toolCall = createToolCall({
      name: toolName,
      args: toolArgs,
      riskLevel: policyResult.riskLevel,
      stepNumber: step.stepNumber
    });
    step.toolCalls.push(toolCall);

    this.emitTimeline(run, 'tool_call_scheduled', {
      toolCallId: toolCall.id,
      name: toolName,
      riskLevel: policyResult.riskLevel,
      reason: policyResult.reason,
      args: toolArgs
    }, onEvent);

    // 3. Handle DENIED Policy
    if (policyResult.riskLevel === RiskLevel.DENIED) {
      toolCall.status = 'denied';
      toolCall.error = policyResult.reason;
      this.emitTimeline(run, 'tool_call_denied', {
        toolCallId: toolCall.id,
        name: toolName,
        reason: policyResult.reason
      }, onEvent);

      return {
        success: false,
        denied: true,
        error: `Policy Violation: ${policyResult.reason}`
      };
    }

    // 4. Handle REQUIRES_APPROVAL Policy (Human-in-the-Loop)
    if (policyResult.riskLevel === RiskLevel.REQUIRES_APPROVAL) {
      run.approvalsRequested++;
      const approval = this.policyEngine.requestApproval({
        runId: run.id,
        stepNumber: step.stepNumber,
        toolCallId: toolCall.id,
        toolName,
        args: toolArgs,
        riskLevel: policyResult.riskLevel,
        reason: policyResult.reason,
        preview: policyResult.preview
      });

      toolCall.approvalId = approval.id;
      run.status = AgentRunStatus.WAITING_APPROVAL;
      step.status = StepStatus.WAITING_APPROVAL;

      this.emitTimeline(run, 'approval_required', {
        approvalId: approval.id,
        toolCallId: toolCall.id,
        toolName,
        reason: approval.reason,
        preview: approval.preview,
        args: toolArgs
      }, onEvent);

      // Wait for human decision or timeout
      const decisionResult = await new Promise((resolve) => {
        const active = this.activeRuns.get(run.id);
        if (active) {
          active.approvalResolvers.set(approval.id, resolve);
        }

        // Auto timeout
        const timeoutTimer = setTimeout(() => {
          if (approval.status === ApprovalStatus.PENDING) {
            approval.status = ApprovalStatus.TIMED_OUT;
            resolve(approval);
          }
        }, this.policyEngine.options.approvalTimeoutMs || 300000);

        if (signal) {
          signal.addEventListener('abort', () => {
            clearTimeout(timeoutTimer);
            resolve({ status: ApprovalStatus.DENIED, decision: 'deny' });
          }, { once: true });
        }
      });

      if (decisionResult.decision !== 'approve') {
        run.approvalsDenied++;
        toolCall.status = 'denied';
        run.status = AgentRunStatus.RUNNING;
        step.status = StepStatus.IN_PROGRESS;

        this.emitTimeline(run, 'approval_denied', {
          approvalId: approval.id,
          toolCallId: toolCall.id,
          reason: decisionResult.status === ApprovalStatus.TIMED_OUT ? 'Approval timed out' : 'Denied by user'
        }, onEvent);

        return {
          success: false,
          denied: true,
          error: `User denied execution of ${toolName}`
        };
      }

      run.approvalsGranted++;
      run.status = AgentRunStatus.RUNNING;
      step.status = StepStatus.IN_PROGRESS;

      this.emitTimeline(run, 'approval_granted', {
        approvalId: approval.id,
        toolCallId: toolCall.id
      }, onEvent);
    }

    // 5. Execute Approved / Safe Tool
    toolCall.status = 'executing';
    toolCall.executedAt = new Date().toISOString();

    this.emitTimeline(run, 'tool_call_started', {
      toolCallId: toolCall.id,
      name: toolName
    }, onEvent);

    const result = await this.#executeToolInternal(toolName, toolArgs, signal, toolCall.approvalId, {
      runId: run.id,
      callId: toolCall.id,
      policyContext: { isOverwrite }
    });

    toolCall.status = result.success ? 'completed' : 'failed';
    toolCall.completedAt = new Date().toISOString();
    toolCall.durationMs = result.durationMs;
    toolCall.result = result.output;
    toolCall.error = result.output?.error || null;

    this.emitTimeline(run, 'tool_call_completed', {
      toolCallId: toolCall.id,
      name: toolName,
      success: result.success,
      durationMs: result.durationMs,
      result: result.output
    }, onEvent);

    return result.output;
  }
}

module.exports = AgentExecutionEngine;
module.exports.AgentExecutionEngine = AgentExecutionEngine;
module.exports.AgentExecutionLoop = AgentExecutionEngine;
