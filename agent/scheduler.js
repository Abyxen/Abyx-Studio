'use strict';

/**
 * ABYX DAG Task Scheduler
 * Dependency-aware, parallel rolling worker pool for multi-agent workflows.
 * Guarantees cycle detection, concurrency limits, and failure handling.
 */

class TaskScheduler {
  /**
   * @param {object} params
   * @param {number} [params.maxConcurrency=4] - Maximum simultaneous active worker agents
   * @param {import('./message_bus')} [params.messageBus]
   */
  constructor({ maxConcurrency = 4, messageBus = null } = {}) {
    this.maxConcurrency = Math.max(1, Math.min(16, maxConcurrency));
    this.messageBus = messageBus;
    this.tasks = new Map(); // taskId -> TaskObject
    this.runningTasks = new Set();
    this.completedTasks = new Set();
    this.failedTasks = new Set();
    this.abortController = new AbortController();
  }

  /**
   * Add a task to the DAG
   */
  addTask({
    id,
    title,
    agentRole = 'coding',
    description = '',
    dependsOn = [],
    ownedFiles = [],
    expectedFiles = [],
    syntaxCheckFiles = [],
    testCommand = null,
    criteria = [],
    executor = null
  }) {
    if (!id || typeof id !== 'string') throw new Error('Task ID is required');
    if (this.tasks.has(id)) throw new Error(`Task "${id}" is already declared in DAG`);

    const task = {
      id,
      title: title || id,
      agentRole,
      description,
      dependsOn: Array.isArray(dependsOn) ? [...dependsOn] : [],
      ownedFiles: Array.isArray(ownedFiles) ? [...ownedFiles] : [],
      expectedFiles: Array.isArray(expectedFiles) ? [...expectedFiles] : [],
      syntaxCheckFiles: Array.isArray(syntaxCheckFiles) ? [...syntaxCheckFiles] : [],
      testCommand,
      criteria: Array.isArray(criteria) ? [...criteria] : [],
      executor,
      status: 'pending',
      result: null,
      error: null,
      startedAt: null,
      completedAt: null
    };

    this.tasks.set(id, task);
    return task;
  }

  /**
   * Validate that the graph has no circular dependencies using Kahn's algorithm
   */
  validateGraph() {
    const inDegree = new Map();
    const adj = new Map();

    for (const [id, task] of this.tasks.entries()) {
      inDegree.set(id, 0);
      adj.set(id, []);
    }

    for (const [id, task] of this.tasks.entries()) {
      for (const depId of task.dependsOn) {
        if (!this.tasks.has(depId)) {
          throw new Error(`Task "${id}" depends on non-existent task "${depId}"`);
        }
        adj.get(depId).push(id);
        inDegree.set(id, (inDegree.get(id) || 0) + 1);
      }
    }

    const queue = [];
    for (const [id, deg] of inDegree.entries()) {
      if (deg === 0) queue.push(id);
    }

    let visitedCount = 0;
    while (queue.length > 0) {
      const u = queue.shift();
      visitedCount++;
      for (const neighbor of adj.get(u)) {
        inDegree.set(neighbor, inDegree.get(neighbor) - 1);
        if (inDegree.get(neighbor) === 0) queue.push(neighbor);
      }
    }

    if (visitedCount !== this.tasks.size) {
      throw new Error('Circular dependency detected in agent task graph.');
    }

    return true;
  }

  /**
   * Execute the entire task graph using parallel rolling execution
   * @param {function} onTaskStart - Callback(task)
   * @param {function} onTaskComplete - Callback(task, result)
   * @param {function} onTaskFail - Callback(task, error)
   */
  async execute({ onTaskStart = () => {}, onTaskComplete = () => {}, onTaskFail = () => {}, signal = null } = {}) {
    this.validateGraph();

    if (signal) {
      signal.addEventListener('abort', () => this.cancel('Cancelled by external signal'), { once: true });
    }

    return new Promise((resolve, reject) => {
      const scheduleNext = () => {
        if (this.abortController.signal.aborted) {
          return resolve({
            status: 'cancelled',
            completed: Array.from(this.completedTasks),
            failed: Array.from(this.failedTasks)
          });
        }

        // Check if all tasks have finished
        if (this.completedTasks.size + this.failedTasks.size === this.tasks.size) {
          const allOk = this.failedTasks.size === 0;
          return resolve({
            status: allOk ? 'completed' : 'failed',
            completedCount: this.completedTasks.size,
            failedCount: this.failedTasks.size,
            tasks: Array.from(this.tasks.values())
          });
        }

        // Find tasks that are ready to run:
        // 1. status is 'pending'
        // 2. all dependencies are in completedTasks
        const readyTasks = [];
        for (const [id, task] of this.tasks.entries()) {
          if (task.status === 'pending') {
            const depsSatisfied = task.dependsOn.every(depId => this.completedTasks.has(depId));
            const depsFailed = task.dependsOn.some(depId => this.failedTasks.has(depId));

            if (depsFailed) {
              task.status = 'failed';
              task.error = 'Dependency failed';
              this.failedTasks.add(id);
              onTaskFail(task, new Error(task.error));
              this.messageBus?.publish('task:failed', { taskId: id, reason: task.error });
            } else if (depsSatisfied) {
              readyTasks.push(task);
            }
          }
        }

        // Dispatch tasks up to maxConcurrency
        while (this.runningTasks.size < this.maxConcurrency && readyTasks.length > 0) {
          const taskToRun = readyTasks.shift();
          this.runSingleTask(taskToRun, onTaskStart, onTaskComplete, onTaskFail, scheduleNext);
        }
      };

      // Kick off initial scheduling wave
      scheduleNext();
    });
  }

  /**
   * Run an individual task inside the pool
   */
  async runSingleTask(task, onTaskStart, onTaskComplete, onTaskFail, scheduleNext) {
    task.status = 'running';
    task.startedAt = new Date().toISOString();
    this.runningTasks.add(task.id);

    onTaskStart(task);
    this.messageBus?.publish('task:started', { taskId: task.id, role: task.agentRole, title: task.title });

    try {
      let result = null;
      if (typeof task.executor === 'function') {
        result = await task.executor(task, this.abortController.signal);
      } else {
        result = { success: true, message: `Completed task: ${task.title}` };
      }

      task.status = 'completed';
      task.result = result;
      task.completedAt = new Date().toISOString();
      this.completedTasks.add(task.id);
      this.runningTasks.delete(task.id);

      onTaskComplete(task, result);
      this.messageBus?.publish('task:completed', { taskId: task.id, role: task.agentRole, result });
    } catch (err) {
      task.status = 'failed';
      task.error = err.message;
      task.completedAt = new Date().toISOString();
      this.failedTasks.add(task.id);
      this.runningTasks.delete(task.id);

      onTaskFail(task, err);
      this.messageBus?.publish('task:failed', { taskId: task.id, role: task.agentRole, error: err.message });
    }

    // Immediately trigger next available task in rolling pool
    scheduleNext();
  }

  /**
   * Cancel execution of the scheduler
   */
  cancel(reason = 'Cancelled by user') {
    this.abortController.abort(reason);
    for (const [id, task] of this.tasks.entries()) {
      if (task.status === 'pending' || task.status === 'running') {
        task.status = 'cancelled';
        task.error = reason;
      }
    }
    this.runningTasks.clear();
    this.messageBus?.publish('task:cancelled', { reason });
  }
}

module.exports = TaskScheduler;
