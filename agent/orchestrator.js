'use strict';

const { EventEmitter } = require('node:events');
const TaskScheduler = require('./scheduler');
const TaskStore = require('./task_store');
const EventStore = require('./event_store');
const AgentSharedMemory = require('./shared_memory');
const MessageBus = require('./message_bus');
const AgentRegistry = require('./agent_registry');
const WorkflowCheckpointer = require('./workflow_checkpointer');

/**
 * Orchestrator - Master Multi-Agent StateGraph Engine (LangGraph + OpenCode Architecture)
 * 
 * Features:
 * - Dynamic task decomposition into dependency-aware DAG workflows
 * - Durable SQLite checkpoints and interrupted workflow recovery
 * - Specialist roles: Planner, Researcher, Developer, Debugger, Reviewer, Tester
 * - Single-agent vs multi-agent execution routing to prevent overhead
 * - Automatic retry policies and downstream failure propagation
 * - Independent subagent contexts with role-scoped permissions and context boundaries
 * - Shared task memory, message bus, and structured result aggregation
 */
class Orchestrator extends EventEmitter {
  constructor({ modelRouter, toolGateway, policyEngine, securityEngine = null, workspaceIsolation = null, logger = null, options = {} }) {
    super();
    this.modelRouter = modelRouter;
    this.toolGateway = toolGateway;
    this.policyEngine = policyEngine;
    this.securityEngine = securityEngine;
    this.workspaceIsolation = workspaceIsolation;
    this.logger = logger;
    this.options = options;

    this.scheduler = new TaskScheduler({ maxConcurrency: options.concurrency || 4 });
    this.taskStore = new TaskStore();
    this.eventStore = new EventStore();
    this.sharedMemory = new AgentSharedMemory();
    this.messageBus = new MessageBus();
    this.agentRegistry = new AgentRegistry();
    this.checkpointer = new WorkflowCheckpointer({ workspaceRoot: options.workspaceRoot || process.cwd() });

    this.activeRun = null;
    this.activeOrchestrations = new Map();
  }

  /**
   * Determine if goal requires multi-agent parallel decomposition or single-agent execution
   */
  shouldUseMultiAgent(goal, customTasks = null) {
    if (Array.isArray(customTasks) && customTasks.length > 1) return true;
    if (!goal || typeof goal !== 'string') return false;

    const multiAgentTriggers = [
      /\b(multi-agent|pipeline|workflow|decompose|parallel|team|stage)\b/i,
      /\b(architect.*implement|build.*test|review.*fix)\b/i,
      /\b(full.*stack|end-to-end|ground-up|system)\b/i
    ];
    return multiAgentTriggers.some(p => p.test(goal));
  }

  /**
   * Decompose goal into dependency-aware DAG tasks
   */
  async decomposeGoalIntoTasks(goal, customTasks = null) {
    if (Array.isArray(customTasks) && customTasks.length > 0) {
      return customTasks.map((t, idx) => ({
        id: t.id || `task_${idx + 1}`,
        description: t.description || t.task || `Subtask ${idx + 1}`,
        agentId: t.agentId || 'developer',
        dependencies: Array.isArray(t.dependencies) ? t.dependencies : [],
        priority: t.priority || (10 - idx),
        status: t.status || 'pending',
        result: t.result || null,
        error: t.error || null,
        maxRetries: t.maxRetries !== undefined ? t.maxRetries : 2,
        retryCount: t.retryCount || 0,
        verification: t.verification || null,
        verificationSteps: Array.isArray(t.verificationSteps) ? t.verificationSteps : null
      }));
    }

    // Default specialist 4-stage multi-agent DAG: Planner -> Developer -> Tester & Reviewer (Parallel)
    return [
      {
        id: 'task_1',
        description: `Plan architecture, component boundaries and implementation strategy for: ${goal}`,
        agentId: 'planner',
        dependencies: [],
        priority: 10,
        maxRetries: 2,
        retryCount: 0
      },
      {
        id: 'task_2',
        description: `Implement production-grade code modifications for: ${goal}`,
        agentId: 'developer',
        dependencies: ['task_1'],
        priority: 8,
        maxRetries: 2,
        retryCount: 0
      },
      {
        id: 'task_3',
        description: `Author automated verification tests and validate edge cases for: ${goal}`,
        agentId: 'tester',
        dependencies: ['task_2'],
        priority: 6,
        maxRetries: 2,
        retryCount: 0
      },
      {
        id: 'task_4',
        description: `Review code quality, verify security bounds and audit patterns for: ${goal}`,
        agentId: 'reviewer',
        dependencies: ['task_2'],
        priority: 5,
        maxRetries: 2,
        retryCount: 0
      }
    ];
  }

  /**
   * Execute single task in its dedicated subagent session
   */
  async executeSingleTask(task, { signal, onEvent, runId = 'default' }) {
    this.taskStore.setTaskStatus(task.id, 'running');
    this.checkpointer.saveTask({ ...task, status: 'running' }, runId);

    const agentDef = this.agentRegistry.get(task.agentId) || this.agentRegistry.get('developer');

    // Dedicated task workspace provisioning
    let taskWorkspaceDir = null;
    if (this.workspaceIsolation) {
      const ws = this.workspaceIsolation.createTaskWorkspace(task.id, task.agentId);
      taskWorkspaceDir = ws.workspaceDir;
    }

    const emitEvent = (type, data) => {
      this.emit(type, data);
      this.eventStore.append({ type, taskId: task.id, agentId: task.agentId, data });
      if (typeof onEvent === 'function') {
        try { onEvent(type, data); } catch (_) {}
      }
    };

    emitEvent('task:start', {
      taskId: task.id,
      agentId: task.agentId,
      agentName: agentDef.name,
      description: task.description,
      workspaceDir: taskWorkspaceDir
    });

    const findings = this.sharedMemory.getAllFindings();
    const contextPrompt = findings.length > 0
      ? `\nPrior findings from team:\n${findings.map(f => `- [${f.agentId}] ${f.text}`).join('\n')}`
      : '';

    try {
      const response = await this.modelRouter.chat({
        messages: [
          { role: 'system', content: `${agentDef.systemPrompt}${contextPrompt}` },
          { role: 'user', content: task.description }
        ],
        model: 'auto',
        signal
      });

      const choice = response.choices && response.choices[0];
      const resultText = choice?.message?.content || '';
      const reasoningText = choice?.message?.reasoning_content || '';

      if (!resultText.trim()) {
        throw new Error('Model returned no task result.');
      }

      // A text response is useful evidence for the next agent, but it cannot
      // prove that code, files, tests, or acceptance criteria were satisfied.
      // Completion remains a workflow state; verified success is decided only
      // by a verification result attached by the caller/runtime.
      let verification = task.verification?.passed === true
        ? task.verification
        : { passed: false, reason: 'No independent verification evidence was recorded for this task.' };
      if (Array.isArray(task.verificationSteps) && task.verificationSteps.length > 0) {
        if (!this.verificationEngine?.runSuite) {
          verification = { passed: false, reason: 'Verification steps were supplied, but no verification engine is configured.' };
        } else {
          verification = await this.verificationEngine.runSuite({ steps: task.verificationSteps });
        }
      }

      // Record finding to shared memory
      this.sharedMemory.recordFinding({
        agentId: task.agentId,
        category: 'task_output',
        text: `Result from ${task.id} (${agentDef.name}): ${resultText.slice(0, 300)}...`
      });

      this.taskStore.setTaskStatus(task.id, 'completed', {
        result: resultText,
        reasoning: reasoningText,
        verification
      });

      this.checkpointer.saveTask({
        ...task,
        status: 'completed',
        result: resultText
      }, runId);

      emitEvent(verification.passed ? 'task:complete' : 'task:unverified', {
        taskId: task.id,
        agentId: task.agentId,
        result: resultText,
        reasoning: reasoningText,
        verification
      });

      return { ok: true, verified: verification.passed, taskId: task.id, result: resultText, verification };
    } catch (err) {
      task.retryCount = (task.retryCount || 0) + 1;

      if (task.retryCount <= (task.maxRetries || 2)) {
        // Retry policy: re-queue task
        this.taskStore.setTaskStatus(task.id, 'pending', {
          retryCount: task.retryCount,
          error: `Retry ${task.retryCount}: ${err.message}`
        });
        emitEvent('task:retry', {
          taskId: task.id,
          agentId: task.agentId,
          retryCount: task.retryCount,
          error: err.message
        });
        return { ok: false, taskId: task.id, retrying: true, error: err.message };
      }

      // Max retries exhausted: mark failed
      this.taskStore.setTaskStatus(task.id, 'failed', { error: err.message });
      this.checkpointer.saveTask({
        ...task,
        status: 'failed',
        error: err.message
      }, runId);

      emitEvent('task:error', {
        taskId: task.id,
        agentId: task.agentId,
        error: err.message
      });

      // Propagate failure to all downstream dependent tasks
      this._propagateFailure(task.id, emitEvent, runId);

      return { ok: false, taskId: task.id, error: err.message };
    }
  }

  /**
   * Propagate failure to all downstream dependent tasks (mark as skipped)
   */
  _propagateFailure(failedTaskId, emitEvent, runId) {
    const allTasks = this.taskStore.listTasks();
    const dependentTasks = allTasks.filter(t =>
      t.status === 'pending' && Array.isArray(t.dependencies) && t.dependencies.includes(failedTaskId)
    );

    for (const depTask of dependentTasks) {
      const reason = `Skipped due to upstream failure in task '${failedTaskId}'`;
      this.taskStore.setTaskStatus(depTask.id, 'skipped', { error: reason });
      this.checkpointer.saveTask({ ...depTask, status: 'skipped', error: reason }, runId);

      emitEvent('task:skipped', {
        taskId: depTask.id,
        agentId: depTask.agentId,
        reason
      });

      // Recursively cascade skip downstream
      this._propagateFailure(depTask.id, emitEvent, runId);
    }
  }

  /**
   * Execute multi-agent DAG workflow or single-agent shortcut with durable checkpoints
   */
  async orchestrate({
    goal,
    model = 'auto',
    concurrency = 4,
    customTasks = null,
    sessionId = null,
    signal = null,
    onEvent = null
  }) {
    const runId = sessionId || `orch_${Date.now()}`;
    this.activeRun = { runId, goal, status: 'running' };
    this.activeOrchestrations.set(runId, this.activeRun);
    this.checkpointer.saveOrchestration(runId, goal, 'running', { model, concurrency });

    const emitEvent = (type, data) => {
      this.emit(type, data);
      this.eventStore.append({ type, runId, data });
      if (typeof onEvent === 'function') {
        try { onEvent(type, data); } catch (_) {}
      }
    };

    emitEvent('orchestration:start', { runId, goal, model, concurrency });

    // 1. Single-agent execution shortcut for simple tasks without custom tasks
    if (!this.shouldUseMultiAgent(goal, customTasks)) {
      emitEvent('orchestration:single_agent_shortcut', {
        runId,
        goal,
        agentId: 'developer',
        reason: 'Task is focused; executing with single specialist agent to eliminate DAG overhead'
      });

      const requestedTask = Array.isArray(customTasks) && customTasks.length === 1 ? customTasks[0] : null;
      const singleTask = {
        id: requestedTask?.id || 'single_task_1',
        description: requestedTask?.description || requestedTask?.task || goal,
        agentId: requestedTask?.agentId || 'developer',
        dependencies: [],
        verification: requestedTask?.verification || null,
        verificationSteps: Array.isArray(requestedTask?.verificationSteps) ? requestedTask.verificationSteps : null
      };
      this.taskStore.clear();
      this.taskStore.createTask(singleTask);
      const res = await this.executeSingleTask(singleTask, { signal, onEvent, runId });

      const report = {
        runId,
        goal,
        status: res.ok ? (res.verified ? 'success' : 'requires_verification') : 'failed',
        mode: 'single_agent',
        totalTasks: 1,
        completedTasks: res.ok ? 1 : 0,
        result: res.result || res.error,
        findings: this.sharedMemory.getAllFindings(),
        tasks: this.taskStore.listTasks()
      };
      emitEvent('orchestration:done', report);
      this.checkpointer.saveOrchestration(runId, goal, report.status, report);
      this.activeOrchestrations.delete(runId);
      this.activeRun = null;
      return report;
    }

    // 2. Decompose goal into DAG tasks
    const rawTasks = await this.decomposeGoalIntoTasks(goal, customTasks);
    this.scheduler.validateDAG(rawTasks);

    this.taskStore.clear();
    const storedTasks = rawTasks.map(t => {
      const task = this.taskStore.createTask(t);
      this.checkpointer.saveTask(task, runId);
      return task;
    });

    emitEvent('orchestration:plan', {
      runId,
      tasks: storedTasks.map(t => ({
        id: t.id,
        description: t.description,
        agentId: t.agentId,
        dependencies: t.dependencies,
        priority: t.priority
      }))
    });

    const activePromises = new Map();
    let stepCount = 0;

    // 3. LangGraph-style StateGraph DAG loop
    while (true) {
      if (signal && signal.aborted) {
        emitEvent('orchestration:cancelled', { runId, reason: 'Aborted by client' });
        this.checkpointer.saveOrchestration(runId, goal, 'cancelled');
        this.activeRun = null;
        return { ok: false, cancelled: true, tasks: this.taskStore.listTasks() };
      }

      stepCount++;
      const allTasks = this.taskStore.listTasks();
      const allDone = allTasks.every(t => ['completed', 'failed', 'skipped'].includes(t.status));
      if (allDone && activePromises.size === 0) break;

      // Durable State Checkpoint at each step
      this.checkpointer.saveCheckpoint(runId, stepCount, {
        step: stepCount,
        tasks: allTasks,
        findingsCount: this.sharedMemory.getAllFindings().length
      });

      // Get next runnable tasks respecting dependency satisfaction & concurrency slots
      const runnable = this.scheduler.getRunnableTasks(allTasks, activePromises.size);

      for (const task of runnable) {
        this.taskStore.setTaskStatus(task.id, 'running');
        const p = this.executeSingleTask(task, { signal, onEvent, runId }).then(res => {
          activePromises.delete(task.id);
          return res;
        });
        activePromises.set(task.id, p);
      }

      if (activePromises.size > 0) {
        await Promise.race(activePromises.values());
      } else if (!allDone) {
        // No runnable tasks remaining due to dependency cascades
        break;
      }
    }

    // 4. Result Aggregation
    const finalTasks = this.taskStore.listTasks();
    const hasFailed = finalTasks.some(t => t.status === 'failed');
    const hasUnverified = finalTasks.some(t => t.status === 'completed' && t.verification?.passed !== true);
    const finalStatus = hasFailed ? 'failed_with_errors' : (hasUnverified ? 'requires_verification' : 'success');

    const report = this.aggregateResults(runId, goal, finalTasks, finalStatus);
    emitEvent('orchestration:done', report);

    this.checkpointer.saveOrchestration(runId, goal, finalStatus, report);
    this.activeOrchestrations.delete(runId);
    this.activeRun = null;
    return report;
  }

  /**
   * Synthesize individual task results into a coherent final report
   */
  aggregateResults(runId, goal, tasks, status) {
    const completed = tasks.filter(t => t.status === 'completed');
    const failed = tasks.filter(t => t.status === 'failed');
    const skipped = tasks.filter(t => t.status === 'skipped');
    const unverified = completed.filter(t => t.verification?.passed !== true);
    const findings = this.sharedMemory.getAllFindings();

    const summaryParts = [
      `## Multi-Agent Execution Summary for: ${goal}`,
      `**Status:** ${status.toUpperCase()} | **Completed:** ${completed.length}/${tasks.length}`,
      ''
    ];

    completed.forEach(t => {
      summaryParts.push(`### [${t.agentId.toUpperCase()}] ${t.id}: ${t.description}`);
      summaryParts.push(t.result ? t.result.slice(0, 400) : 'Completed successfully');
      summaryParts.push('');
    });

    if (failed.length > 0) {
      summaryParts.push(`### Failures:`);
      failed.forEach(t => summaryParts.push(`- **${t.id} (${t.agentId}):** ${t.error}`));
      summaryParts.push('');
    }

    if (skipped.length > 0) {
      summaryParts.push(`### Skipped:`);
      skipped.forEach(t => summaryParts.push(`- **${t.id}:** ${t.error}`));
      summaryParts.push('');
    }

    if (unverified.length > 0) {
      summaryParts.push('### Verification required:');
      unverified.forEach(t => summaryParts.push(`- **${t.id} (${t.agentId}):** ${t.verification?.reason || 'No evidence recorded'}`));
      summaryParts.push('');
    }

    return {
      runId,
      goal,
      status,
      summary: summaryParts.join('\n'),
      totalTasks: tasks.length,
      completedTasks: completed.length,
      failedTasks: failed.length,
      skippedTasks: skipped.length,
      verifiedTasks: completed.length - unverified.length,
      unverifiedTasks: unverified.length,
      findings,
      tasks
    };
  }

  /**
   * Recover an interrupted workflow from its latest checkpoint and resume execution
   */
  async recoverWorkflow(runId, { signal, onEvent } = {}) {
    const recovery = this.checkpointer.recoverOrchestration(runId);
    if (!recovery.ok) return recovery;

    // Restore tasks into TaskStore
    this.taskStore.clear();
    recovery.tasks.forEach(t => this.taskStore.createTask(t));

    // Resume execution
    return this.orchestrate({
      goal: recovery.state?.goal || `Resumed workflow ${runId}`,
      sessionId: runId,
      customTasks: recovery.tasks,
      signal,
      onEvent
    });
  }

  cancel(runId = null) {
    const targetRun = runId ? this.activeOrchestrations.get(runId) : this.activeRun;
    if (targetRun) {
      targetRun.status = 'cancelled';
      this.emit('orchestration:cancelled', { runId: targetRun.runId });
      this.checkpointer.saveOrchestration(targetRun.runId, targetRun.goal, 'cancelled');
      this.activeOrchestrations.delete(targetRun.runId);
      if (this.activeRun === targetRun) this.activeRun = null;
      return { ok: true, cancelled: true };
    }
    return { ok: false, error: 'No active run found' };
  }
}

module.exports = Orchestrator;
