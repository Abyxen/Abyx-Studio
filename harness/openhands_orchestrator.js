/**
 * Central ABYX Agent Harness Orchestrator
 * Coordinates all 23 mandatory subsystems and implements the full agent lifecycle.
 */

const path = require('node:path');
const { HarnessContext } = require('./kernel');
const { AgentState, ActionType, ActionEvent, ObservationEvent, MessageEvent } = require('./state');
const { EnvironmentProvisioner, SecretInjector, RepositoryHydrator, BoundaryAllowlist } = require('./environment');
const { ProgressiveContextAssembler, OutputPaginator, CompactionEngine } = require('./context_engine');
const { TaskDecomposer, LinearConstraintEnforcer } = require('./task_spec');
const { SubAgentOrchestrator } = require('./subagents');
const { DoomLoopDetector, PermissionMatrix, ExecutionCaps } = require('./control_flow');
const { VerificationHooks, VisualRuntimeInspector, AutomatedJudge, StructuredErrorFeedback } = require('./verification_eval');
const { TrajectoryTracer, CheckpointManager, SessionHandoff, OfflineEvalDataset } = require('./trajectory_state');

// Tools
const { ToolRegistry } = require('./tools/registry');
const { TerminalTool } = require('./tools/terminal');
const { SmartFileEditor } = require('./tools/file_editor');
const { DocumentGeneratorTool } = require('./tools/doc_generator');
const { BrowserInspectorTool } = require('./tools/browser');
const { TaskTrackerTool } = require('./tools/task_tracker');
const { PlannerTool } = require('./tools/planner');
const { PythonDocRunner } = require('./tools/python_doc_runner');
const { PlaywrightBrowserTool } = require('./tools/playwright_browser');
const { InternetResearchTool } = require('./tools/internet_research');

class AbyxAgentHarness {
  constructor(options = {}) {
    this.sessionId = options.sessionId || `abyx_session_${Date.now()}`;
    this.workspaceDir = options.workspaceDir || path.resolve(process.cwd(), '.abyx_workspace');
    this.kernel = new HarnessContext(`harness:${this.sessionId}`);

    // Subsystem 1: Environment & Isolation
    this.envProvisioner = new EnvironmentProvisioner(this.workspaceDir);
    this.secretInjector = new SecretInjector();
    this.repoHydrator = new RepositoryHydrator(this.workspaceDir);
    this.boundary = new BoundaryAllowlist(this.workspaceDir);

    // Subsystem 2: Context Engine
    this.contextAssembler = new ProgressiveContextAssembler();
    this.outputPaginator = new OutputPaginator();
    this.compactionEngine = new CompactionEngine(options.tokenBudget || 8000);

    // Subsystem 3: Task & Linear Constraints
    this.taskDecomposer = new TaskDecomposer();
    this.linearConstraint = new LinearConstraintEnforcer();

    // Subsystem 4: Subagents
    this.subagents = new SubAgentOrchestrator(this.workspaceDir);

    // Subsystem 5: Control Flow & Guardrails
    this.doomDetector = new DoomLoopDetector();
    this.permissionMatrix = new PermissionMatrix();
    this.caps = new ExecutionCaps(options.maxTurns || 30, options.maxTimeSeconds || 300, options.costBudget || 2.0);

    // Subsystem 6: Verification & Judge
    this.verificationHooks = new VerificationHooks();
    this.visualInspector = new VisualRuntimeInspector();
    this.judge = new AutomatedJudge();
    this.errorFeedback = new StructuredErrorFeedback();

    // Subsystem 7: Trajectory & Recovery
    this.trajectory = new TrajectoryTracer(this.sessionId, this.workspaceDir);
    this.checkpoints = new CheckpointManager(this.workspaceDir);
    this.handoff = new SessionHandoff();
    this.offlineEval = new OfflineEvalDataset(this.workspaceDir);

    // Subsystem 8: Tools Registry & Core Tools
    this.tools = new ToolRegistry();
    this._registerCoreTools();

    // Register all services in Kernel context
    this._bindKernelServices();

    this.state = AgentState.INIT;
    this.turn = 0;
  }

  _bindKernelServices() {
    this.kernel.provide('environment', this.envProvisioner);
    this.kernel.provide('secrets', this.secretInjector);
    this.kernel.provide('boundary', this.boundary);
    this.kernel.provide('context', this.contextAssembler);
    this.kernel.provide('tasks', this.taskDecomposer);
    this.kernel.provide('linear_constraints', this.linearConstraint);
    this.kernel.provide('subagents', this.subagents);
    this.kernel.provide('doom_detector', this.doomDetector);
    this.kernel.provide('permissions', this.permissionMatrix);
    this.kernel.provide('caps', this.caps);
    this.kernel.provide('verification', this.verificationHooks);
    this.kernel.provide('judge', this.judge);
    this.kernel.provide('trajectory', this.trajectory);
    this.kernel.provide('checkpoints', this.checkpoints);
    this.kernel.provide('tools', this.tools);
  }

  _registerCoreTools() {
    const term = new TerminalTool(this.workspaceDir);
    const editor = new SmartFileEditor(this.workspaceDir);
    const docGen = new DocumentGeneratorTool(this.workspaceDir);
    const browser = new BrowserInspectorTool(this.boundary);
    const tracker = new TaskTrackerTool();
    const planner = new PlannerTool(this.workspaceDir);
    const pyDoc = new PythonDocRunner(this.workspaceDir);
    const pwBrowser = new PlaywrightBrowserTool(this.workspaceDir);
    const research = new InternetResearchTool(this.workspaceDir);

    this.tools.register(term.name, term.description, term.getSchema(), (args) => term.execute(args));
    this.tools.register(editor.name, editor.description, editor.getSchema(), (args) => editor.execute(args));
    this.tools.register(docGen.name, docGen.description, docGen.getSchema(), (args) => docGen.execute(args));
    this.tools.register(browser.name, browser.description, browser.getSchema(), (args) => browser.execute(args));
    this.tools.register(tracker.name, tracker.description, tracker.getSchema(), (args) => tracker.execute(args));
    this.tools.register(planner.name, planner.description, planner.getSchema(), (args) => planner.execute(args));
    this.tools.register(pyDoc.name, pyDoc.description, pyDoc.getSchema(), (args) => pyDoc.execute(args));
    this.tools.register(pwBrowser.name, pwBrowser.description, pwBrowser.getSchema(), (args) => pwBrowser.execute(args));
    this.tools.register(research.name, research.description, research.getSchema(), (args) => research.execute(args));
  }

  async initialize(userPrompt, initialFiles = {}) {
    this.state = AgentState.INIT;
    this.envProvisioner.provision();

    // Hydrate workspace with initial files
    if (Object.keys(initialFiles).length > 0) {
      this.repoHydrator.hydrateFromMap(initialFiles);
    }

    // Set up progressive context
    this.contextAssembler.setSystemInstruction('You are the ABYX Autonomous Software Engineer. Adhere to StageGates, execute tools responsibly, verify outcomes, and record all trajectories.');
    this.contextAssembler.setTaskContext(`Primary Task: ${userPrompt}`);
    this.contextAssembler.setRepositoryContext(this.repoHydrator.summarizeRepository());

    // Decompose task
    this.taskDecomposer.addTask('task_root', `Execute: ${userPrompt}`);

    // Create initial checkpoint
    this.checkpoints.createCheckpoint('initial_state');

    // Transition state
    this.state = AgentState.IDLE;
    this.trajectory.logEvent(new MessageEvent('user', userPrompt));

    return {
      sessionId: this.sessionId,
      workspace: this.workspaceDir,
      state: this.state,
      ready: true
    };
  }

  async executeStep(actionPayload) {
    this.state = AgentState.RUNNING;
    this.turn += 1;

    // Check execution caps
    const capCheck = this.caps.checkCaps(this.turn, 50);
    if (!capCheck.allowed) {
      this.state = AgentState.ERROR;
      return {
        status: 'error',
        error: `Execution capped: ${capCheck.reason}`
      };
    }

    const { type, toolName, args, stage } = actionPayload;

    // Check stage gate linear constraints if stage provided
    if (stage) {
      const gate = this.linearConstraint.transition(stage);
      if (!gate.success) {
        return {
          status: 'rejected',
          reason: gate.error,
          currentStage: this.linearConstraint.getCurrentStage()
        };
      }
    }

    // Guardrail: Doom loop detection
    const doomCheck = this.doomDetector.recordAction(type, { toolName, args });
    if (doomCheck.detected) {
      this.state = AgentState.PAUSED;
      const repairSuggestion = this.errorFeedback.formatDiagnostic(
        'DOOM_LOOP_REPETITION',
        doomCheck.reason,
        'Break repetition by re-evaluating strategy or running verification.'
      );
      return {
        status: 'doom_loop_detected',
        warning: doomCheck.reason,
        diagnostic: repairSuggestion
      };
    }

    // Guardrail: Permission Matrix check
    const permCheck = this.permissionMatrix.checkPermission(toolName, args);
    if (!permCheck.allowed) {
      if (permCheck.requiresConfirmation) {
        this.state = AgentState.AWAITING_CONFIRMATION;
        return {
          status: 'awaiting_confirmation',
          action: actionPayload,
          prompt: `Action [${toolName}] requires explicit confirmation: ${permCheck.reason}`
        };
      }
      return {
        status: 'forbidden',
        reason: permCheck.reason
      };
    }

    // Action Execution
    const actionEvent = new ActionEvent(type, { toolName, args });
    this.trajectory.logEvent(actionEvent);

    let observationResult;
    try {
      if (type === ActionType.RUN_TOOL || type === 'run_tool') {
        const rawResult = await this.tools.dispatch(toolName, args);
        // Apply output pagination & truncation
        if (typeof rawResult === 'string') {
          observationResult = this.outputPaginator.smartTruncate(rawResult);
        } else if (rawResult && typeof rawResult.output === 'string') {
          observationResult = {
            ...rawResult,
            output: this.outputPaginator.smartTruncate(rawResult.output).output
          };
        } else {
          observationResult = rawResult;
        }
      } else if (type === ActionType.COMPLETE || type === 'complete') {
        this.state = AgentState.COMPLETED;
        observationResult = { status: 'task_completed', summary: args.summary || 'Task completed successfully' };
      } else {
        observationResult = { error: `Unhandled action type: ${type}` };
      }
    } catch (err) {
      observationResult = { error: err.message };
      this.errorFeedback.formatDiagnostic('TOOL_EXECUTION_FAILURE', err.message, 'Inspect tool parameters or environment state.');
    }

    const obsEvent = new ObservationEvent(actionEvent.id, observationResult);
    this.trajectory.logEvent(obsEvent);

    // Update conversation context
    this.contextAssembler.addTurn('user', `Executed ${toolName}`);
    this.contextAssembler.addTurn('assistant', JSON.stringify(observationResult));

    // Auto checkpoint every 5 turns
    if (this.turn % 5 === 0) {
      this.checkpoints.createCheckpoint(`turn_${this.turn}`);
    }

    if (this.state !== AgentState.COMPLETED) {
      this.state = AgentState.IDLE;
    }

    return {
      status: 'ok',
      turn: this.turn,
      state: this.state,
      actionId: actionEvent.id,
      observation: observationResult
    };
  }

  async verifyAndHandoff(verificationCriteria = {}) {
    this.linearConstraint.transition('VERIFICATION');

    const verifyReport = await this.verificationHooks.runVerification(this.workspaceDir, verificationCriteria);
    const judgeEvaluation = this.judge.evaluateOutcome(verifyReport.passed, verifyReport.details);

    this.linearConstraint.transition('HANDOFF');

    const handoffSummary = this.handoff.createHandoff(
      this.sessionId,
      judgeEvaluation.approved ? 'Completed verified session' : 'Session verified with warnings',
      [this.workspaceDir],
      {
        verified: judgeEvaluation.approved,
        score: judgeEvaluation.score,
        totalTurns: this.turn
      }
    );

    this.offlineEval.recordExample({
      sessionId: this.sessionId,
      turns: this.turn,
      evaluation: judgeEvaluation,
      timestamp: new Date().toISOString()
    });

    return {
      verified: judgeEvaluation.approved,
      judgeScore: judgeEvaluation.score,
      verificationReport: verifyReport,
      handoffSummary
    };
  }

  dispose() {
    this.kernel.dispose();
  }
}

module.exports = { AbyxAgentHarness };
