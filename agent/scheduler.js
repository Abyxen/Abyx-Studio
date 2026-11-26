'use strict';

/**
 * TaskScheduler - LangGraph-style DAG Task Scheduler
 * Validates dependencies, detects circular references, performs topological sorting,
 * and yields parallel task batches respecting concurrency limits.
 */
class TaskScheduler {
  constructor(options = {}) {
    this.maxConcurrency = options.maxConcurrency || 4;
  }

  /**
   * Validates DAG tasks and checks for cycles
   */
  validateDAG(tasks) {
    const taskMap = new Map();
    tasks.forEach(t => taskMap.set(t.id, t));

    // Validate that all declared dependencies exist
    for (const task of tasks) {
      if (Array.isArray(task.dependencies)) {
        for (const depId of task.dependencies) {
          if (!taskMap.has(depId)) {
            throw new Error(`Task '${task.id}' depends on non-existent task '${depId}'`);
          }
        }
      }
    }

    // Cycle detection via DFS with 3-color marking
    const visited = new Map(); // 0: unvisited, 1: visiting, 2: visited

    const visit = (taskId, pathStack = []) => {
      const state = visited.get(taskId) || 0;
      if (state === 1) {
        throw new Error(`Circular dependency detected: ${pathStack.join(' -> ')} -> ${taskId}`);
      }
      if (state === 2) return;

      visited.set(taskId, 1);
      const currentTask = taskMap.get(taskId);
      if (currentTask && Array.isArray(currentTask.dependencies)) {
        for (const depId of currentTask.dependencies) {
          visit(depId, [...pathStack, taskId]);
        }
      }
      visited.set(taskId, 2);
    };

    for (const task of tasks) {
      if ((visited.get(task.id) || 0) === 0) {
        visit(task.id, []);
      }
    }

    return true;
  }

  /**
   * Returns next batch of tasks ready to run (dependencies satisfied)
   */
  getRunnableTasks(tasks, activeRunningCount = 0) {
    const availableSlots = Math.max(0, this.maxConcurrency - activeRunningCount);
    if (availableSlots <= 0) return [];

    const completedTaskIds = new Set(
      tasks.filter(t => t.status === 'completed').map(t => t.id)
    );

    const runnable = tasks.filter(task => {
      if (task.status !== 'pending') return false;
      const deps = Array.isArray(task.dependencies) ? task.dependencies : [];
      return deps.every(depId => completedTaskIds.has(depId));
    });

    // Sort by priority (higher first)
    runnable.sort((a, b) => (b.priority || 1) - (a.priority || 1));
    return runnable.slice(0, availableSlots);
  }

  /**
   * Topological sorting of tasks
   */
  topologicalSort(tasks) {
    this.validateDAG(tasks);
    const taskMap = new Map();
    tasks.forEach(t => taskMap.set(t.id, t));

    const inDegree = new Map();
    const adj = new Map();

    tasks.forEach(t => {
      inDegree.set(t.id, (t.dependencies || []).length);
      adj.set(t.id, []);
    });

    tasks.forEach(t => {
      (t.dependencies || []).forEach(depId => {
        if (adj.has(depId)) {
          adj.get(depId).push(t.id);
        }
      });
    });

    const queue = [];
    tasks.forEach(t => {
      if ((inDegree.get(t.id) || 0) === 0) queue.push(t.id);
    });

    const sortedIds = [];
    while (queue.length > 0) {
      const u = queue.shift();
      sortedIds.push(u);

      const neighbors = adj.get(u) || [];
      for (const v of neighbors) {
        inDegree.set(v, inDegree.get(v) - 1);
        if (inDegree.get(v) === 0) {
          queue.push(v);
        }
      }
    }

    if (sortedIds.length !== tasks.length) {
      throw new Error('Circular dependency detected in graph during topological sort');
    }

    return sortedIds.map(id => taskMap.get(id));
  }
}

module.exports = TaskScheduler;
