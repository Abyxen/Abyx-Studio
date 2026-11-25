'use strict';

/**
 * ABYX Persistent Task & Orchestration Store
 * Persists complete multi-agent DAG runs, task status, execution metrics,
 * artifacts, and findings to disk for recovery and inspection.
 */

const fs = require('node:fs');
const path = require('node:path');
const { dataDir } = require('../data_paths');

const ORCH_FILE = path.join(dataDir, 'orchestrations.json');

class TaskStore {
  constructor(options = {}) {
    this.filePath = options.filePath || ORCH_FILE;
    this.runs = new Map(); // runId -> orchestration run object
    this._load();
  }

  _load() {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        const list = JSON.parse(raw);
        if (Array.isArray(list)) {
          for (const item of list) {
            if (item && item.runId) this.runs.set(item.runId, item);
          }
        }
      }
    } catch (err) {
      console.warn('[TASK_STORE] Load error:', err.message);
    }
  }

  _save() {
    try {
      const list = Array.from(this.runs.values());
      fs.writeFileSync(this.filePath, JSON.stringify(list, null, 2), 'utf8');
    } catch (err) {
      console.warn('[TASK_STORE] Save error:', err.message);
    }
  }

  /**
   * Upsert an orchestration run
   */
  saveOrchestration(report) {
    if (!report || !report.runId) return null;
    const existing = this.runs.get(report.runId) || {};
    const updated = {
      ...existing,
      ...report,
      updatedAt: new Date().toISOString()
    };
    this.runs.set(report.runId, updated);
    this._save();
    return updated;
  }

  /**
   * Get an orchestration run by runId
   */
  getOrchestration(runId) {
    return this.runs.get(runId) || null;
  }

  /**
   * List past orchestrations with summary metadata
   */
  listOrchestrations(limit = 50) {
    const all = Array.from(this.runs.values());
    all.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
    return all.slice(0, limit);
  }

  /**
   * Delete an orchestration
   */
  deleteOrchestration(runId) {
    const deleted = this.runs.delete(runId);
    if (deleted) this._save();
    return deleted;
  }
}

module.exports = TaskStore;
