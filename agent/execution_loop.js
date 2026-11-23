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
const universalFileGenerator = require('../services/universal_file_generator');
const browserService = require('../services/browser_service');

class AgentExecutionEngine extends EventEmitter {
  constructor({ pathGuard, policyEngine, fsTool, terminalTool, browserTool, providerRegistry } = {}) {
    super();
    this.pathGuard = pathGuard;
    this.policyEngine = policyEngine;
    this.fsTool = fsTool;
    this.terminalTool = terminalTool;
    this.browserTool = browserTool;
    this.providerRegistry = providerRegistry;

    // Active runs registry: runId -> { run, controller, approvalResolvers: Map }
    this.activeRuns = new Map();
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
  async executeToolInternal(toolName, args, signal) {
    const t0 = Date.now();
    let res;

    try {
      // 1. Filesystem Tools
      if (toolName === 'fs_list' || toolName === 'list_files') {
        res = await this.fsTool.list(args);
      } else if (toolName === 'fs_read' || toolName === 'read_file') {
        res = await this.fsTool.read(args);
      } else if (toolName === 'fs_search' || toolName === 'search_files') {
        res = await this.fsTool.search(args);
      } else if (toolName === 'fs_write' || toolName === 'write_file') {
        res = await this.fsTool.write({
          filePath: args.filePath || args.file_path || args.path || args.filename,
          content: args.content || ''
        });
      } else if (toolName === 'fs_edit' || toolName === 'edit_file') {
        res = await this.fsTool.edit({
          filePath: args.filePath || args.file_path || args.path,
          target: args.target,
          replacement: args.replacement
        });
      } else if (toolName === 'fs_mkdir' || toolName === 'mkdir' || toolName === 'create_directory') {
        res = await this.fsTool.mkdir({
          dirPath: args.dirPath || args.path || args.directory
        });
      } else if (toolName === 'fs_move' || toolName === 'move_file' || toolName === 'rename_file') {
        res = await this.fsTool.move({
          sourcePath: args.sourcePath || args.source || args.from || args.oldPath,
          destinationPath: args.destinationPath || args.destination || args.to || args.newPath
        });
      } else if (toolName === 'fs_delete' || toolName === 'delete_file') {
        res = await this.fsTool.delete({
          filePath: args.filePath || args.path || args.file
        });
      }

      // Universal Document & PDF Generator
      else if (toolName === 'generate_file' || toolName === 'generate_pdf' || toolName === 'generate_document') {
        const fileType = toolName === 'generate_pdf' ? 'pdf' : (args.fileType || args.type || 'txt');
        res = await universalFileGenerator.generateFile({
          filePath: args.filePath || args.file_path || args.path || args.filename,
          fileType,
          content: args.content || '',
          title: args.title,
          author: args.author
        });
      }

      // 2. Controlled Terminal Execution
      else if (toolName === 'execute_terminal_command' || toolName === 'run_terminal') {
        res = await this.terminalTool.execute({
          command: args.command,
          cwd: args.cwd,
          timeoutMs: args.timeoutMs,
          signal
        });
      }

      // 3. Controlled Web / Browser Tools
      else if (toolName === 'search_web') {
        res = await this.browserTool.searchWeb({ query: args.query, maxResults: args.maxResults });
      } else if (toolName === 'fetch_web_page' || toolName === 'browse_url' || toolName === 'browse_page') {
        res = await this.browserTool.fetchPage({ url: args.url, signal });
      } else if (toolName === 'open_browser') {
        res = browserService.openBrowserWindow(args.url);
      }

      else {
        res = { success: false, error: `Unrecognized tool: ${toolName}` };
      }
    } catch (toolErr) {
      res = { success: false, error: toolErr.message };
    }

    const durationMs = Date.now() - t0;
    return {
      success: res.success !== false,
      output: res,
      durationMs
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
    stepExecutor = null
  }) {
    // 1. Initialize Plan
    const effectivePlan = plan && plan.steps ? plan : createPlan(goal, Array.isArray(plan) ? plan : [goal]);

    // 2. Initialize Agent Run Record
    const run = createAgentRun({
      sessionId,
      profileId,
      goal,
      model,
      plan: effectivePlan,
      maxSteps: Math.min(maxSteps || 8, 15) // Hard ceiling of 15 steps
    });
    run.profileId = profileId;

    const controller = new AbortController();
    const activeEntry = {
      run,
      controller,
      approvalResolvers: new Map()
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

    return run;
  }

  /**
   * Internal pipeline for policy check, approval request, and tool execution
   */
  async requestAndExecuteTool(run, step, toolName, toolArgs, signal, onEvent) {
    run.toolsExecuted++;

    // 1. Detect if target file exists (for overwrite risk evaluation)
    let isOverwrite = false;
    if (['fs_write', 'write_file', 'generate_file'].includes(toolName)) {
      const p = toolArgs.filePath || toolArgs.file_path || toolArgs.path || toolArgs.filename;
      try {
        const safeP = this.pathGuard.resolveSafePath(p, { allowCreate: true });
        isOverwrite = require('node:fs').existsSync(safeP);
      } catch (e) {}
    }

    // 2. Central Policy Engine Evaluation
    const policyResult = this.policyEngine.evaluateToolCall(toolName, toolArgs, {
      isOverwrite,
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

    const result = await this.executeToolInternal(toolName, toolArgs, signal);

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
