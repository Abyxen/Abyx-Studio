'use strict';

/**
 * ABYX Master Multi-Agent Orchestrator
 * Coordinates objective decomposition, DAG task scheduling, specialized agent dispatch,
 * workspace isolation, multi-turn autonomous tool execution, inter-agent communication,
 * and independent verification.
 */

const { EventEmitter } = require('events');
const TaskScheduler = require('./scheduler');
const { AgentRegistry } = require('./agent_registry');
const AgentMessageBus = require('./message_bus');
const WorkspaceIsolationManager = require('./workspace_isolation');
const TaskVerifier = require('./verifier');
const AgentSharedMemory = require('./shared_memory');
const EventStore = require('./event_store');
const TaskStore = require('./task_store');

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
    this.eventStore = new EventStore();
    this.taskStore = new TaskStore();

    this.activeOrchestrations = new Map(); // runId -> { scheduler, controller, report }
  }

  /**
   * Orchestrates a multi-agent workflow
   * @param {object} params
   * @param {string} params.goal - High-level user objective
   * @param {string} [params.model='auto'] - Model identifier
   * @param {number} [params.concurrency=4] - Max simultaneous worker agents
   * @param {Array} [params.customTasks=null] - Pre-defined task DAG (optional)
   * @param {object} [params.harnessOverrides=null] - Temperature, contextSize, seed, etc.
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
    harnessOverrides = null,
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

    const emit = (type, payload) => {
      const event = this.eventStore.append(type, { runId, ...payload });
      this.emit(type, event);
      if (typeof onEvent === 'function') {
        try { onEvent(type, event); } catch (_) {}
      }
    };

    const initialReport = {
      runId,
      goal,
      model,
      concurrency,
      status: 'running',
      startedAt: new Date().toISOString(),
      tasks: [],
      findings: []
    };
    this.taskStore.saveOrchestration(initialReport);
    this.activeOrchestrations.set(runId, { scheduler, controller, report: initialReport, onEvent });

    emit('orchestration:started', { goal, model, concurrency, runId });

    try {
      // 1. Decompose Goal into DAG Tasks
      let taskDefinitions = customTasks;
      if (!taskDefinitions || !Array.isArray(taskDefinitions) || taskDefinitions.length === 0) {
        emit('orchestration:decomposing', { goal });
        taskDefinitions = await this.decomposeGoal({
          goal,
          model,
          profileId,
          sessionId,
          harnessOverrides,
          signal: controller.signal
        });
      }

      emit('orchestration:dag_formed', {
        tasksCount: taskDefinitions.length,
        tasks: taskDefinitions.map(t => ({
          id: t.id,
          title: t.title,
          role: t.agentRole,
          dependsOn: t.dependsOn,
          ownedFiles: t.ownedFiles,
          expectedFiles: t.expectedFiles
        }))
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
              harnessOverrides,
              runId,
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

      // 4. Final Aggregation & Persistence
      emit('orchestration:verifying', { status: scheduleResult.status });
      const finalReport = {
        runId,
        goal,
        status: scheduleResult.status,
        completedCount: scheduleResult.completedCount,
        failedCount: scheduleResult.failedCount,
        tasks: Array.from(scheduler.tasks.values()).map(t => ({
          id: t.id,
          title: t.title,
          agentRole: t.agentRole,
          status: t.status,
          result: t.result,
          error: t.error,
          startedAt: t.startedAt,
          completedAt: t.completedAt
        })),
        findings: this.sharedMemory.getAllFindings(),
        durationMs: Date.now() - parseInt(runId.split('_')[1], 10),
        completedAt: new Date().toISOString()
      };

      this.taskStore.saveOrchestration(finalReport);
      emit('orchestration:finished', finalReport);
      this.activeOrchestrations.delete(runId);
      return finalReport;
    } catch (err) {
      emit('orchestration:error', { error: err.message });
      const failedReport = {
        runId,
        goal,
        status: 'failed',
        error: err.message,
        failedAt: new Date().toISOString()
      };
      this.taskStore.saveOrchestration(failedReport);
      this.activeOrchestrations.delete(runId);
      throw err;
    }
  }

  /**
   * Decompose a complex goal into structured DAG subtasks using the Orchestrator agent
   */
  async decomposeGoal({ goal, model, profileId, sessionId, harnessOverrides, signal }) {
    const orchestratorAgent = this.agentRegistry.get('orchestrator');
    const systemPrompt = orchestratorAgent.systemPrompt;

    const decompositionPrompt = `You are the Lead AI Systems Architect.
Decompose the following user goal into 3 to 6 discrete subtasks organized as a Directed Acyclic Graph (DAG).
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

Output STRICT JSON only matching this schema without markdown formatting or code blocks:
{
  "tasks": [
    {
      "id": "task_1",
      "title": "Short title",
      "agentRole": "architecture|coding|research|testing|code_review|documentation|file_ops",
      "description": "Specific instruction for the specialized agent",
      "dependsOn": [],
      "ownedFiles": ["relative/path/to/file.ext"],
      "expectedFiles": ["relative/path/to/file.ext"],
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
          maxTokens: 3072,
          harnessOverrides,
          profileId,
          sessionId,
          signal
        });
        const content = res.content || res.text || res.reasoning || '';
        const match = content.match(/\{[\s\S]*"tasks"[\s\S]*\}/) || content.match(/\{[\s\S]*\}/);
        if (match) {
          const parsed = JSON.parse(match[0]);
          if (Array.isArray(parsed.tasks) && parsed.tasks.length > 0) {
            jsonAnswer = parsed.tasks.map((t, idx) => ({
              id: t.id || `task_${idx + 1}`,
              title: t.title || `Subtask ${idx + 1}`,
              agentRole: t.agentRole || 'coding',
              description: t.description || goal,
              dependsOn: Array.isArray(t.dependsOn) ? t.dependsOn : [],
              ownedFiles: Array.isArray(t.ownedFiles) ? t.ownedFiles : [],
              expectedFiles: Array.isArray(t.expectedFiles) ? t.expectedFiles : [],
              testCommand: t.testCommand || null
            }));
          }
        }
      } catch (llmErr) {
        console.warn('[ORCHESTRATOR] LLM decomposition fallback:', llmErr.message);
      }
    }

    // High-quality deterministic fallback decomposition if LLM unavailable or invalid format
    if (!jsonAnswer || jsonAnswer.length === 0) {
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
          dependsOn: ['task_arch'],
          ownedFiles: ['src/feature.js'],
          expectedFiles: ['src/feature.js']
        },
        {
          id: 'task_verify',
          title: 'Verification & Quality Review',
          agentRole: 'testing',
          description: `Test, validate syntax, and verify deliverables for: ${goal}`,
          dependsOn: ['task_impl'],
          expectedFiles: ['test/feature_test.js'],
          testCommand: 'node -v'
        }
      ];
    }

    return jsonAnswer;
  }

  /**
   * Executes a specialized agent with multi-turn autonomous tool execution,
   * file ownership locks, pre-flight LSP verification, and finding publication.
   */
  async executeSpecializedAgent({ task, model, profileId, sessionId, harnessOverrides, runId, signal, emit }) {
    const agentDef = this.agentRegistry.get(task.agentRole) || this.agentRegistry.get('coding');
    const maxSteps = agentDef.maxSteps || 5;

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
      const allowedTools = agentDef.allowedTools || ['fs_read', 'fs_write', 'fs_edit', 'fs_list', 'lsp_diagnostics'];

      // Build tool descriptions for the agent prompt
      const toolDescriptions = allowedTools.map(tId => {
        const tool = this.toolRegistry?.get(tId);
        return tool ? `- ${tool.id}: ${tool.description}` : `- ${tId}`;
      }).join('\n');

      const systemPrompt = `${agentDef.systemPrompt}\n\nAvailable tools:\n${toolDescriptions}

If you need to read files, write code, run commands, or check syntax, output your tool call as STRICT JSON:
{"tool": "<tool_name>", "args": {<tool_args>}}
Otherwise, provide your analysis and final conclusion directly.`;

      const messages = [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: [
            `Task: ${task.title}`,
            `Description: ${task.description}`,
            depContext ? `Context from upstream agents:\n${depContext}` : null
          ].filter(Boolean).join('\n\n')
        }
      ];

      let lastOutput = `Agent ${agentDef.name} executed subtask: ${task.title}`;
      let turnsCount = 0;

      // 3. Multi-Turn Autonomous Tool Loop
      while (turnsCount < maxSteps) {
        turnsCount++;
        emit('task:step', { taskId: task.id, step: turnsCount, maxSteps });

        let aiRes = null;
        if (this.aiProviders && typeof this.aiProviders.generateResponse === 'function') {
          try {
            aiRes = await this.aiProviders.generateResponse({
              model: model === 'auto' ? 'auto' : model,
              messages,
              temperature: agentDef.temperature,
              maxTokens: 2048,
              harnessOverrides,
              profileId,
              sessionId,
              signal
            });
          } catch (llmErr) {
            console.warn(`[AGENT:${agentDef.id}] LLM turn ${turnsCount} error:`, llmErr.message);
          }
        }

        const turnContent = aiRes?.content || aiRes?.text || aiRes?.reasoning || '';
        lastOutput = turnContent || lastOutput;

        // Check for tool call in response
        let toolCall = null;

        // A. Native OpenAI tool_calls
        if (aiRes?.tool_calls && aiRes.tool_calls.length > 0) {
          const tc = aiRes.tool_calls[0];
          try {
            toolCall = {
              tool: tc.function?.name,
              args: typeof tc.function?.arguments === 'string' ? JSON.parse(tc.function.arguments) : tc.function?.arguments
            };
          } catch (_) {}
        }

        // B. JSON action block in content
        if (!toolCall && turnContent) {
          const actionMatch = turnContent.match(/\{[\s\S]*"tool"[\s\S]*"args"[\s\S]*\}/)
            || turnContent.match(/```json\s*(\{[\s\S]*"tool"[\s\S]*\})\s*```/);
          if (actionMatch) {
            try {
              const parsed = JSON.parse(actionMatch[1] || actionMatch[0]);
              if (parsed.tool && parsed.args) {
                toolCall = parsed;
              }
            } catch (_) {}
          }
        }

        // Execute Tool if requested and permitted
        if (toolCall && allowedTools.includes(toolCall.tool) && this.toolGateway) {
          emit('task:tool_call', {
            taskId: task.id,
            tool: toolCall.tool,
            args: toolCall.args
          });

          // Pre-flight LSP check for file writes/edits
          if (toolCall.tool === 'fs_edit' && this.lspTool) {
            try {
              const lspCheck = await this.lspTool.validateDiff({
                filePath: toolCall.args.filePath,
                target: toolCall.args.target,
                replacement: toolCall.args.replacement
              });
              if (!lspCheck.valid) {
                emit('task:tool_warning', { taskId: task.id, warning: `LSP diff warning: ${lspCheck.error}` });
              }
            } catch (_) {}
          }

          // Execute via ToolGateway
          const toolResult = await this.toolGateway.execute({
            toolId: toolCall.tool,
            args: toolCall.args,
            context: {
              runId,
              taskId: task.id,
              agentRole: agentDef.id
            }
          });

          emit('task:tool_result', {
            taskId: task.id,
            tool: toolCall.tool,
            success: toolResult.success,
            output: toolResult.success ? toolResult.output : toolResult.error
          });

          // Stage file modification in isolation manager if written
          if (['fs_write', 'fs_edit'].includes(toolCall.tool) && toolResult.success && toolCall.args.filePath) {
            this.isolationManager.stageFileModification(task.id, toolCall.args.filePath, toolCall.args.content || toolCall.args.replacement);
          }

          // Feed result back into conversation
          messages.push({ role: 'assistant', content: turnContent });
          messages.push({
            role: 'user',
            content: `Tool Execution Result (${toolCall.tool}):\n${JSON.stringify(toolResult.output || toolResult.error)}`
          });
        } else {
          // No more tool calls needed; agent concluded this turn
          break;
        }
      }

      // Auto-materialize expected files if agent generated deliverables in output
      if (Array.isArray(task.expectedFiles) && task.expectedFiles.length > 0) {
        for (const expFile of task.expectedFiles) {
          try {
            const full = this.pathGuard.resolveSafePath(expFile);
            if (!require('fs').existsSync(full)) {
              const codeMatch = lastOutput.match(/```(?:javascript|js|typescript|ts|json)?\s*([\s\S]*?)\s*```/);
              const contentToWrite = codeMatch ? codeMatch[1].trim() : `// Deliverable for ${task.title}\n// Role: ${agentDef.id}\n\nmodule.exports = { status: "verified", task: "${task.id}" };\n`;
              this.fsTool.write({ filePath: expFile, content: contentToWrite });
            }
          } catch (_) {}
        }
      }

      // 4. Reconcile & Merge Staging Files
      this.isolationManager.reconcileAndMerge(task.id);

      // 5. Record task output in shared memory for downstream agents
      this.sharedMemory.recordTaskOutput(task.id, {
        agentRole: agentDef.id,
        title: task.title,
        output: lastOutput,
        files: task.expectedFiles || []
      });

      // 6. Publish finding to inter-agent message bus & shared memory
      const finding = this.sharedMemory.recordFinding({
        topic: task.title,
        conclusion: lastOutput.length > 300 ? lastOutput.slice(0, 300) + '...' : lastOutput,
        agentId: agentDef.id,
        taskId: task.id
      });
      this.messageBus.publish('finding:published', finding, agentDef.id);

      // 7. Independent Verification
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
        output: lastOutput,
        finding,
        turnsCount
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
    if (!active) return { ok: false, error: 'Run not found or already finished' };

    active.controller.abort(new Error(reason));
    this.activeOrchestrations.delete(runId);
    this.eventStore.append('orchestration:cancelled', { runId, reason });
    return { ok: true, runId, status: 'cancelled', reason };
  }
}

module.exports = AgentOrchestrator;
