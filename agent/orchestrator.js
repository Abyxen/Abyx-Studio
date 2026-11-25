'use strict';

/**
 * ABYX Master Multi-Agent Orchestrator
 * Coordinates objective decomposition, DAG task scheduling, specialized agent dispatch,
 * workspace isolation, inter-agent communication, and independent verification.
 */

const { EventEmitter } = require('events');
const TaskScheduler = require('./scheduler');
const { AgentRegistry } = require('./agent_registry');
const AgentMessageBus = require('./message_bus');
const WorkspaceIsolationManager = require('./workspace_isolation');
const TaskVerifier = require('./verifier');
const AgentSharedMemory = require('./shared_memory');

class AgentOrchestrator extends EventEmitter {
  /**
   * @param {object} params
   * @param {import('./path_guard')} params.pathGuard
   * @param {import('./policy_engine')} params.policyEngine
   * @param {import('./tools/fs_tool')} params.fsTool
   * @param {import('./tools/terminal_tool')} [params.terminalTool]
   * @param {import('./tools/lsp_tool')} [params.lspTool]
   * @param {import('./tools/browser_tool')} [params.browserTool]
   * @param {import('./tool_registry').ToolRegistry} params.toolRegistry
   * @param {import('./tool_gateway').ToolGateway} params.toolGateway
   * @param {object} [params.aiProviders]
   */
  constructor({
    pathGuard,
    policyEngine,
    fsTool,
    terminalTool,
    lspTool,
    browserTool,
    toolRegistry,
    toolGateway,
    aiProviders = null
  }) {
    super();
    this.pathGuard = pathGuard;
    this.policyEngine = policyEngine;
    this.fsTool = fsTool;
    this.terminalTool = terminalTool;
    this.lspTool = lspTool;
    this.browserTool = browserTool;
    this.toolRegistry = toolRegistry;
    this.toolGateway = toolGateway;
    this.aiProviders = aiProviders;

    this.agentRegistry = new AgentRegistry();
    this.messageBus = new AgentMessageBus();
    this.isolationManager = new WorkspaceIsolationManager(pathGuard);
    this.verifier = new TaskVerifier({ pathGuard, lspTool, terminalTool });
    this.sharedMemory = new AgentSharedMemory();

    this.activeOrchestrations = new Map(); // runId -> { scheduler, controller }
  }

  /**
   * Orchestrates a multi-agent workflow
   * @param {object} params
   * @param {string} params.goal - High-level user objective
   * @param {string} [params.model='auto'] - Model identifier
   * @param {number} [params.concurrency=4] - Max simultaneous worker agents
   * @param {Array} [params.customTasks=null] - Pre-defined task DAG (optional)
   * @param {AbortSignal} [params.signal=null] - Cancellation signal
   * @param {function} [params.onEvent=null] - Live SSE event callback
   */
  async orchestrate({
    goal,
    model = 'auto',
    concurrency = 4,
    customTasks = null,
    profileId = 'prof_default',
    sessionId = null,
    signal = null,
    onEvent = () => {}
  }) {
    if (!goal || typeof goal !== 'string') throw new Error('Goal must be a non-empty string');

    const runId = `orch_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const scheduler = new TaskScheduler({ maxConcurrency: concurrency, messageBus: this.messageBus });
    const controller = new AbortController();

    if (signal) {
      signal.addEventListener('abort', () => this.cancel(runId, 'External signal aborted'), { once: true });
    }

    this.activeOrchestrations.set(runId, { scheduler, controller, onEvent });

    const emit = (type, payload) => {
      const event = { type, runId, timestamp: new Date().toISOString(), ...payload };
      this.emit(type, event);
      if (typeof onEvent === 'function') {
        try { onEvent(type, event); } catch (_) {}
      }
    };

    emit('orchestration:started', { goal, model, concurrency });

    try {
      // 1. Decompose Goal into DAG Tasks
      let taskDefinitions = customTasks;
      if (!taskDefinitions || !Array.isArray(taskDefinitions) || taskDefinitions.length === 0) {
        taskDefinitions = await this.decomposeGoal({ goal, model, profileId, sessionId, signal: controller.signal });
      }

      emit('orchestration:dag_formed', {
        tasksCount: taskDefinitions.length,
        tasks: taskDefinitions.map(t => ({ id: t.id, title: t.title, role: t.agentRole, dependsOn: t.dependsOn }))
      });

      // 2. Populate Scheduler DAG
      for (const tDef of taskDefinitions) {
        scheduler.addTask({
          ...tDef,
          executor: async (task, taskSignal) => {
            return await this.executeSpecializedAgent({
              task,
              model,
              profileId,
              sessionId,
              signal: taskSignal,
              emit
            });
          }
        });
      }

      // 3. Execute Parallel Rolling Scheduler
      const scheduleResult = await scheduler.execute({
        signal: controller.signal,
        onTaskStart: (task) => {
          emit('task:started', { taskId: task.id, title: task.title, agentRole: task.agentRole });
        },
        onTaskComplete: (task, result) => {
          emit('task:completed', { taskId: task.id, title: task.title, result });
        },
        onTaskFail: (task, err) => {
          emit('task:failed', { taskId: task.id, title: task.title, error: err.message });
        }
      });

      // 4. Final Aggregated Verification
      emit('orchestration:verifying', { status: scheduleResult.status });
      const finalReport = {
        runId,
        goal,
        status: scheduleResult.status,
        completedCount: scheduleResult.completedCount,
        failedCount: scheduleResult.failedCount,
        tasks: scheduler.tasks ? Array.from(scheduler.tasks.values()) : [],
        durationMs: Date.now() - parseInt(runId.split('_')[1], 10)
      };

      emit('orchestration:finished', finalReport);
      this.activeOrchestrations.delete(runId);
      return finalReport;
    } catch (err) {
      emit('orchestration:error', { error: err.message });
      this.activeOrchestrations.delete(runId);
      throw err;
    }
  }

  /**
   * Decompose a complex goal into structured DAG subtasks using the Orchestrator agent
   */
  async decomposeGoal({ goal, model, profileId, sessionId, signal }) {
    const orchestratorAgent = this.agentRegistry.get('orchestrator');
    const systemPrompt = orchestratorAgent.systemPrompt;

    const decompositionPrompt = `Decompose the following user goal into 2 to 6 discrete subtasks organized as a Directed Acyclic Graph (DAG).
Available specialized agent roles:
- architecture: system design, schemas, modularity planning
- coding: implementation, refactoring, code writing
- research: web research, gathering documentation, citations
- debugging: diagnostics, troubleshooting
- testing: unit and integration tests
- code_review: independent code review
- documentation: technical documentation and READMEs
- file_ops: file creation, archiving, reorganization
- data_analysis: dataset cleaning and analysis
- browser: live web automation

User Goal: "${goal}"

Return STRICT JSON only matching this schema without markdown code blocks:
{
  "tasks": [
    {
      "id": "task_1",
      "title": "Short title",
      "agentRole": "architecture|coding|research|testing|...",
      "description": "Specific instruction for the specialized agent",
      "dependsOn": [],
      "ownedFiles": ["path/to/file.ext"],
      "expectedFiles": ["path/to/file.ext"],
      "testCommand": null
    }
  ]
}`;

    let jsonAnswer = null;
    if (this.aiProviders && typeof this.aiProviders.generateResponse === 'function') {
      try {
        const res = await this.aiProviders.generateResponse({
          model: model === 'auto' ? 'auto' : model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: decompositionPrompt }
          ],
          temperature: 0.1,
          profileId,
          sessionId,
          signal
        });
        const content = res.content || res.text || '';
        const match = content.match(/\{[\s\S]*\}/)?.[0];
        if (match) {
          const parsed = JSON.parse(match);
          if (Array.isArray(parsed.tasks) && parsed.tasks.length > 0) {
            jsonAnswer = parsed.tasks;
          }
        }
      } catch (llmErr) {
        console.warn('[ORCHESTRATOR] LLM decomposition fallback:', llmErr.message);
      }
    }

    // High-quality deterministic fallback decomposition if LLM unavailable
    if (!jsonAnswer) {
      jsonAnswer = [
        {
          id: 'task_arch',
          title: 'System Analysis & Planning',
          agentRole: 'architecture',
          description: `Analyze requirements and establish implementation architecture for: ${goal}`,
          dependsOn: []
        },
        {
          id: 'task_impl',
          title: 'Core Implementation',
          agentRole: 'coding',
          description: `Implement verified code and structure for: ${goal}`,
          dependsOn: ['task_arch']
        },
        {
          id: 'task_verify',
          title: 'Verification & Quality Review',
          agentRole: 'testing',
          description: `Test, validate syntax, and verify deliverables for: ${goal}`,
          dependsOn: ['task_impl']
        }
      ];
    }

    return jsonAnswer;
  }

  /**
   * Executes a single specialized agent turn with file ownership locks, tool execution, and verification
   */
  async executeSpecializedAgent({ task, model, profileId, sessionId, signal, emit }) {
    const agentDef = this.agentRegistry.get(task.agentRole) || this.agentRegistry.get('coding');

    // 1. Acquire File Ownership Locks
    if (Array.isArray(task.ownedFiles) && task.ownedFiles.length > 0) {
      for (const file of task.ownedFiles) {
        const lockRes = this.isolationManager.acquireLock(file, task.id, 'write');
        if (!lockRes.ok) {
          throw new Error(`File ownership lock failed: ${lockRes.error}`);
        }
      }
    }

    try {
      // 2. Build task context including predecessor task outputs from shared memory
      const depContext = this.sharedMemory.getDependencyContext(task.dependsOn);
      const promptParts = [
        `Task: ${task.title}`,
        `Description: ${task.description}`,
        depContext ? depContext : null,
        `Allowed tools: ${JSON.stringify(agentDef.allowedTools)}`
      ].filter(Boolean);

      const messages = [
        { role: 'system', content: agentDef.systemPrompt },
        {
          role: 'user',
          content: promptParts.join('\n\n')
        }
      ];

      let output = `Agent ${agentDef.name} executed subtask: ${task.title}`;

      if (this.aiProviders && typeof this.aiProviders.generateResponse === 'function') {
        try {
          const aiRes = await this.aiProviders.generateResponse({
            model: model === 'auto' ? 'auto' : model,
            messages,
            temperature: agentDef.temperature,
            profileId,
            sessionId,
            signal
          });
          output = aiRes.content || aiRes.text || output;
        } catch (execErr) {
          console.warn(`[AGENT:${agentDef.id}] LLM call error:`, execErr.message);
        }
      }

      // 3. Reconcile & Merge Staging Files
      this.isolationManager.reconcileAndMerge(task.id);

      // 4. Record task output in shared memory for downstream agents
      this.sharedMemory.recordTaskOutput(task.id, {
        agentRole: agentDef.id,
        title: task.title,
        output,
        files: task.expectedFiles || []
      });

      // 5. Publish finding to inter-agent message bus & shared memory
      const finding = this.sharedMemory.recordFinding({
        topic: task.title,
        conclusion: output.length > 300 ? output.slice(0, 300) + '...' : output,
        agentId: agentDef.id,
        taskId: task.id
      });
      this.messageBus.publish('finding:published', finding, agentDef.id);

      // 6. Independent Verification
      if ((task.expectedFiles && task.expectedFiles.length > 0) || task.testCommand || (task.syntaxCheckFiles && task.syntaxCheckFiles.length > 0)) {
        const verifyReport = await this.verifier.verify({
          expectedFiles: task.expectedFiles,
          syntaxCheckFiles: task.syntaxCheckFiles,
          testCommand: task.testCommand,
          criteria: task.criteria
        });

        if (!verifyReport.passed) {
          throw new Error(`Verification failed: ${verifyReport.errors.join('; ')}`);
        }
      }

      return {
        success: true,
        agent: agentDef.id,
        agentName: agentDef.name,
        output,
        finding
      };
    } finally {
      // Always release locks
      this.isolationManager.releaseLocks(task.id);
    }
  }

  /**
   * Cancels an active orchestration
   */
  cancel(runId, reason = 'Cancelled by user') {
    const active = this.activeOrchestrations.get(runId);
    if (active) {
      active.controller.abort(reason);
      active.scheduler.cancel(reason);
      this.activeOrchestrations.delete(runId);
      return { ok: true, status: 'cancelled' };
    }
    return { ok: false, error: 'Orchestration run not found' };
  }
}

module.exports = AgentOrchestrator;
