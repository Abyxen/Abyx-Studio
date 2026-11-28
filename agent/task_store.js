'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * TaskStore - Durable Multi-Agent Task Persistence (LangGraph Checkpoint Pattern)
 * Persists task states, dependencies, artifacts, and execution timelines.
 */
class TaskStore {
  constructor(options = {}) {
    this.storagePath = options.storagePath || path.join(process.cwd(), 'app', 'data', 'orchestrations.json');
    this.tasks = new Map();
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this.storagePath)) {
        const raw = fs.readFileSync(this.storagePath, 'utf8');
        const data = JSON.parse(raw);
        if (Array.isArray(data)) {
          data.forEach(t => this.tasks.set(t.id, t));
        }
      }
    } catch (_) {}
  }

  _save() {
    try {
      const dir = path.dirname(this.storagePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.storagePath, JSON.stringify(Array.from(this.tasks.values()), null, 2), 'utf8');
    } catch (_) {}
  }

  createTask({ id, description, agentId = 'coder', dependencies = [], priority = 1, status = 'pending', result = null, error = null, verification = null, verificationSteps = null, metadata = {} }) {
    const taskId = id || `task_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const task = {
      id: taskId,
      description,
      agentId,
      dependencies: Array.isArray(dependencies) ? dependencies : [],
      priority,
      status: status || 'pending', // 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
      result: result || null,
      error: error || null,
      verification,
      verificationSteps: Array.isArray(verificationSteps) ? verificationSteps : null,
      createdAt: new Date().toISOString(),
      startedAt: status === 'completed' ? new Date().toISOString() : null,
      completedAt: status === 'completed' ? new Date().toISOString() : null,
      metadata
    };
    this.tasks.set(taskId, task);
    this._save();
    return task;
  }

  getTask(id) {
    return this.tasks.get(id) || null;
  }

  updateTask(id, updates = {}) {
    const task = this.tasks.get(id);
    if (!task) return null;
    Object.assign(task, updates);
    this.tasks.set(id, task);
    this._save();
    return task;
  }

  setTaskStatus(id, status, extra = {}) {
    const task = this.tasks.get(id);
    if (!task) return null;
    task.status = status;
    if (status === 'running' && !task.startedAt) task.startedAt = new Date().toISOString();
    if (['completed', 'failed', 'skipped'].includes(status)) task.completedAt = new Date().toISOString();
    Object.assign(task, extra);
    this.tasks.set(id, task);
    this._save();
    return task;
  }

  listTasks() {
    return Array.from(this.tasks.values());
  }

  listOrchestrations(limit = 50) {
    return this.listTasks().slice(-limit);
  }

  getOrchestration(id) {
    return this.getTask(id);
  }

  clear() {
    this.tasks.clear();
    this._save();
  }
}

module.exports = TaskStore;
