'use strict';

const path = require('node:path');
const fs = require('node:fs');

/**
 * WorkflowCheckpointer - Durable SQLite-Backed Workflow Checkpointer & State Recoverer
 * 
 * References: LangGraph.js checkpoint pattern + OpenCode session snapshots
 * 
 * Invariants:
 * - Persists workflow checkpoints durably using SQLite (node:sqlite) or structured JSON fallback
 * - Enables resumption of interrupted orchestrations from the latest validated state
 * - Stores task states, shared findings, retry counts, and execution results
 */
class WorkflowCheckpointer {
  constructor(options = {}) {
    this.workspaceRoot = options.workspaceRoot || process.cwd();
    this.dbDir = options.dbDir || path.join(this.workspaceRoot, 'app', 'data', 'checkpoints');
    this.dbPath = path.join(this.dbDir, 'orchestrations.sqlite');
    this.jsonFallbackPath = path.join(this.dbDir, 'checkpoints.json');
    this.db = null;
    this.useSqlite = false;

    this._initStorage();
  }

  _initStorage() {
    try {
      if (!fs.existsSync(this.dbDir)) {
        fs.mkdirSync(this.dbDir, { recursive: true });
      }

      // Try node:sqlite DatabaseSync
      const { DatabaseSync } = require('node:sqlite');
      this.db = new DatabaseSync(this.dbPath);
      this.useSqlite = true;

      this.db.exec(`
        CREATE TABLE IF NOT EXISTS orchestrations (
          id TEXT PRIMARY KEY,
          goal TEXT,
          status TEXT,
          config TEXT,
          created_at TEXT,
          updated_at TEXT
        );

        CREATE TABLE IF NOT EXISTS tasks (
          id TEXT,
          orch_id TEXT,
          description TEXT,
          agent_id TEXT,
          dependencies TEXT,
          priority INTEGER,
          status TEXT,
          result TEXT,
          error TEXT,
          retry_count INTEGER,
          max_retries INTEGER,
          created_at TEXT,
          completed_at TEXT,
          PRIMARY KEY (id, orch_id)
        );

        CREATE TABLE IF NOT EXISTS checkpoints (
          id TEXT PRIMARY KEY,
          orch_id TEXT,
          step INTEGER,
          state_json TEXT,
          created_at TEXT
        );
      `);
    } catch (_) {
      // Fallback to JSON-based persistence if sqlite is unavailable
      this.useSqlite = false;
      this._initJsonFallback();
    }
  }

  _initJsonFallback() {
    if (!fs.existsSync(this.jsonFallbackPath)) {
      fs.writeFileSync(this.jsonFallbackPath, JSON.stringify({ orchestrations: {}, tasks: {}, checkpoints: {} }, null, 2), 'utf8');
    }
  }

  _readJson() {
    try {
      if (fs.existsSync(this.jsonFallbackPath)) {
        return JSON.parse(fs.readFileSync(this.jsonFallbackPath, 'utf8'));
      }
    } catch (_) {}
    return { orchestrations: {}, tasks: {}, checkpoints: {} };
  }

  _writeJson(data) {
    try {
      fs.writeFileSync(this.jsonFallbackPath, JSON.stringify(data, null, 2), 'utf8');
    } catch (_) {}
  }

  saveOrchestration(orchId, goal, status = 'running', config = {}) {
    const now = new Date().toISOString();
    if (this.useSqlite && this.db) {
      const stmt = this.db.prepare(`
        INSERT INTO orchestrations (id, goal, status, config, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET status=excluded.status, updated_at=excluded.updated_at;
      `);
      stmt.run(orchId, goal, status, JSON.stringify(config), now, now);
    } else {
      const data = this._readJson();
      data.orchestrations[orchId] = {
        id: orchId,
        goal,
        status,
        config,
        createdAt: data.orchestrations[orchId]?.createdAt || now,
        updatedAt: now
      };
      this._writeJson(data);
    }
  }

  saveTask(task, orchId) {
    const now = new Date().toISOString();
    const depsStr = JSON.stringify(task.dependencies || []);
    const retryCount = task.retryCount || 0;
    const maxRetries = task.maxRetries || 2;

    if (this.useSqlite && this.db) {
      const stmt = this.db.prepare(`
        INSERT INTO tasks (id, orch_id, description, agent_id, dependencies, priority, status, result, error, retry_count, max_retries, created_at, completed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id, orch_id) DO UPDATE SET
          status=excluded.status,
          result=excluded.result,
          error=excluded.error,
          retry_count=excluded.retry_count,
          completed_at=excluded.completed_at;
      `);
      stmt.run(
        task.id,
        orchId,
        task.description,
        task.agentId,
        depsStr,
        task.priority || 1,
        task.status || 'pending',
        task.result || null,
        task.error || null,
        retryCount,
        maxRetries,
        task.createdAt || now,
        task.completedAt || null
      );
    } else {
      const data = this._readJson();
      if (!data.tasks[orchId]) data.tasks[orchId] = {};
      data.tasks[orchId][task.id] = {
        ...task,
        orchId,
        retryCount,
        maxRetries,
        createdAt: task.createdAt || now
      };
      this._writeJson(data);
    }
  }

  saveCheckpoint(orchId, step, state) {
    const id = `chk_${orchId}_step_${step}`;
    const now = new Date().toISOString();
    const stateStr = JSON.stringify(state);

    if (this.useSqlite && this.db) {
      const stmt = this.db.prepare(`
        INSERT INTO checkpoints (id, orch_id, step, state_json, created_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET state_json=excluded.state_json, created_at=excluded.created_at;
      `);
      stmt.run(id, orchId, step, stateStr, now);
    } else {
      const data = this._readJson();
      if (!data.checkpoints[orchId]) data.checkpoints[orchId] = [];
      data.checkpoints[orchId].push({ id, orchId, step, state, createdAt: now });
      this._writeJson(data);
    }
    return { ok: true, checkpointId: id, step };
  }

  getLatestCheckpoint(orchId) {
    if (this.useSqlite && this.db) {
      const stmt = this.db.prepare(`
        SELECT step, state_json, created_at
        FROM checkpoints
        WHERE orch_id = ?
        ORDER BY step DESC
        LIMIT 1;
      `);
      const row = stmt.get(orchId);
      if (row) {
        return {
          step: row.step,
          createdAt: row.created_at,
          state: JSON.parse(row.state_json)
        };
      }
    } else {
      const data = this._readJson();
      const chks = data.checkpoints[orchId];
      if (Array.isArray(chks) && chks.length > 0) {
        const last = chks[chks.length - 1];
        return { step: last.step, createdAt: last.createdAt, state: last.state };
      }
    }
    return null;
  }

  loadTasksForOrchestration(orchId) {
    if (this.useSqlite && this.db) {
      const stmt = this.db.prepare(`
        SELECT id, description, agent_id, dependencies, priority, status, result, error, retry_count, max_retries
        FROM tasks
        WHERE orch_id = ?
        ORDER BY priority DESC;
      `);
      const rows = stmt.all(orchId);
      return rows.map(r => ({
        id: r.id,
        description: r.description,
        agentId: r.agent_id,
        dependencies: JSON.parse(r.dependencies || '[]'),
        priority: r.priority,
        status: r.status,
        result: r.result,
        error: r.error,
        retryCount: r.retry_count,
        maxRetries: r.max_retries
      }));
    } else {
      const data = this._readJson();
      const taskMap = data.tasks[orchId] || {};
      return Object.values(taskMap);
    }
  }

  /**
   * Recovers an interrupted orchestration for resumption
   */
  recoverOrchestration(orchId) {
    const latestCheckpoint = this.getLatestCheckpoint(orchId);
    const tasks = this.loadTasksForOrchestration(orchId);

    if (tasks.length === 0) {
      return { ok: false, error: `No tasks found for orchestration '${orchId}'` };
    }

    // Reset any tasks that were running at the time of interruption back to pending for retry
    const recoveredTasks = tasks.map(t => {
      if (t.status === 'running') {
        t.status = 'pending';
        t.retryCount = (t.retryCount || 0) + 1;
      }
      return t;
    });

    return {
      ok: true,
      orchId,
      step: latestCheckpoint ? latestCheckpoint.step : 0,
      state: latestCheckpoint ? latestCheckpoint.state : null,
      tasks: recoveredTasks,
      completedCount: recoveredTasks.filter(t => t.status === 'completed').length,
      pendingCount: recoveredTasks.filter(t => t.status === 'pending').length
    };
  }
}

module.exports = WorkflowCheckpointer;
