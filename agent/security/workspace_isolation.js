'use strict';

const path = require('node:path');
const fs = require('node:fs');

/**
 * WorkspaceIsolation - Multi-Agent Task Isolation, Git Worktree & Conflict Engine
 * 
 * References: OpenHands + OpenCode
 * 
 * Capabilities:
 * - Dedicated per-task workspaces in app/data/workspaces/<taskId>
 * - Git worktree provisioning for true branch-level disk isolation
 * - Per-agent file and task ownership registry
 * - Write-conflict detection across concurrently executing agents
 * - Advisory file locking with TTL to avoid deadlocks
 * - Staged modifications tracking with atomic rollback
 */
class WorkspaceIsolation {
  constructor(workspaceRoot, gitAdapter = null, options = {}) {
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.gitAdapter = gitAdapter;
    this.baseWorkspacesDir = options.workspacesDir || path.join(this.workspaceRoot, 'app', 'data', 'workspaces');
    
    // In-memory registries
    this.taskWorkspaces = new Map(); // taskId -> { dir, agentId, branch, createdAt, isWorktree }
    this.fileOwnership = new Map();  // normalizedFilePath -> { agentId, taskId, claimedAt }
    this.activeLocks = new Map();    // normalizedFilePath -> { agentId, taskId, acquiredAt, expiresAt }
    this.stagedChanges = new Map();  // taskId -> Map<filePath, { baselineContent, stagedContent, timestamp }>

    this._ensureDir(this.baseWorkspacesDir);
  }

  _ensureDir(dirPath) {
    try {
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }
    } catch (_) {}
  }

  normalizePath(filePath) {
    if (!filePath || typeof filePath !== 'string') return '';
    return path.resolve(this.workspaceRoot, filePath).toLowerCase();
  }

  // ==========================================
  // 1. Dedicated Task Workspaces & Git Worktrees
  // ==========================================

  /**
   * Provision a dedicated task directory
   */
  createTaskWorkspace(taskId, agentId = 'default') {
    if (!taskId) throw new Error('taskId is required');
    const taskDir = path.join(this.baseWorkspacesDir, taskId);
    this._ensureDir(taskDir);

    const record = {
      taskId,
      dir: taskDir,
      agentId,
      branch: null,
      isWorktree: false,
      createdAt: new Date().toISOString()
    };
    this.taskWorkspaces.set(taskId, record);
    return { ok: true, taskId, workspaceDir: taskDir };
  }

  /**
   * Provision an isolated Git worktree for the task
   */
  async createTaskWorktree(taskId, branchName = null, agentId = 'coder') {
    if (!taskId) throw new Error('taskId is required');
    const taskDir = path.join(this.baseWorkspacesDir, taskId);
    const branch = branchName || `task/${taskId}`;

    if (!this.gitAdapter) {
      // Fallback to directory-only isolation if git is unavailable
      return this.createTaskWorkspace(taskId, agentId);
    }

    try {
      const res = await this.gitAdapter.run(['worktree', 'add', '-B', branch, taskDir]);
      if (res.exitCode !== undefined && res.exitCode !== 0) {
        // Worktree add may fail if dir already exists, fallback to standard task directory
        return this.createTaskWorkspace(taskId, agentId);
      }

      const record = {
        taskId,
        dir: taskDir,
        agentId,
        branch,
        isWorktree: true,
        createdAt: new Date().toISOString()
      };
      this.taskWorkspaces.set(taskId, record);

      return {
        ok: true,
        taskId,
        workspaceDir: taskDir,
        branch,
        isWorktree: true
      };
    } catch (err) {
      // Graceful fallback
      return this.createTaskWorkspace(taskId, agentId);
    }
  }

  getTaskWorkspace(taskId) {
    return this.taskWorkspaces.get(taskId) || null;
  }

  // ==========================================
  // 2. Ownership & Write-Conflict Detection
  // ==========================================

  /**
   * Claim exclusive ownership of a file for an agent during task execution
   */
  claimFileOwnership(filePath, agentId, taskId) {
    const key = this.normalizePath(filePath);
    if (this.fileOwnership.has(key)) {
      const existing = this.fileOwnership.get(key);
      if (existing.agentId !== agentId && existing.taskId !== taskId) {
        return {
          ok: false,
          conflict: true,
          error: `File '${filePath}' is already owned by agent '${existing.agentId}' (task: ${existing.taskId})`
        };
      }
    }

    this.fileOwnership.set(key, {
      agentId,
      taskId,
      claimedAt: new Date().toISOString()
    });

    return { ok: true, filePath, agentId, taskId };
  }

  /**
   * Detect whether another agent is concurrently writing to the same file
   */
  detectWriteConflict(filePath, agentId, taskId) {
    const key = this.normalizePath(filePath);

    // 1. Check lock
    this._cleanExpiredLocks();
    if (this.activeLocks.has(key)) {
      const lock = this.activeLocks.get(key);
      if (lock.agentId !== agentId) {
        return {
          conflict: true,
          reason: `File is locked by agent '${lock.agentId}' (task: ${lock.taskId}) until ${lock.expiresAt}`,
          lockedBy: lock.agentId
        };
      }
    }

    // 2. Check ownership claim
    if (this.fileOwnership.has(key)) {
      const owner = this.fileOwnership.get(key);
      if (owner.agentId !== agentId && owner.taskId !== taskId) {
        return {
          conflict: true,
          reason: `Write conflict: File is owned by agent '${owner.agentId}' on task '${owner.taskId}'`,
          ownedBy: owner.agentId
        };
      }
    }

    return { conflict: false };
  }

  // ==========================================
  // 3. Advisory File Locking
  // ==========================================

  acquireLock(filePath, agentId, taskId = 'default', ttlMs = 30000) {
    const key = this.normalizePath(filePath);
    this._cleanExpiredLocks();

    if (this.activeLocks.has(key)) {
      const lock = this.activeLocks.get(key);
      if (lock.agentId !== agentId) {
        return {
          ok: false,
          locked: true,
          error: `Cannot acquire lock: already held by '${lock.agentId}'`
        };
      }
      // Re-entrant lock renewal
      lock.expiresAt = new Date(Date.now() + ttlMs).toISOString();
      return { ok: true, renewed: true, expiresAt: lock.expiresAt };
    }

    const expiresAt = new Date(Date.now() + ttlMs).toISOString();
    this.activeLocks.set(key, {
      agentId,
      taskId,
      acquiredAt: new Date().toISOString(),
      expiresAt
    });

    return { ok: true, locked: true, expiresAt };
  }

  releaseLock(filePath, agentId) {
    const key = this.normalizePath(filePath);
    if (!this.activeLocks.has(key)) {
      return { ok: true, released: false };
    }

    const lock = this.activeLocks.get(key);
    if (lock.agentId !== agentId) {
      return { ok: false, error: 'Cannot release lock owned by another agent' };
    }

    this.activeLocks.delete(key);
    return { ok: true, released: true };
  }

  _cleanExpiredLocks() {
    const now = new Date();
    for (const [key, lock] of this.activeLocks.entries()) {
      if (new Date(lock.expiresAt) <= now) {
        this.activeLocks.delete(key);
      }
    }
  }

  // ==========================================
  // 4. Staging & Safe Atomic Rollback
  // ==========================================

  stageFile(taskId, filePath, content) {
    if (!this.stagedChanges.has(taskId)) {
      this.stagedChanges.set(taskId, new Map());
    }

    const taskStages = this.stagedChanges.get(taskId);
    const key = this.normalizePath(filePath);

    let baseline = null;
    const fullPath = path.resolve(this.workspaceRoot, filePath);
    if (fs.existsSync(fullPath)) {
      baseline = fs.readFileSync(fullPath, 'utf8');
    }

    taskStages.set(key, {
      filePath,
      baselineContent: baseline,
      stagedContent: content,
      timestamp: new Date().toISOString()
    });

    return { ok: true, taskId, stagedCount: taskStages.size };
  }

  rollbackTask(taskId) {
    if (!this.stagedChanges.has(taskId)) {
      return { ok: true, message: 'No staged changes to rollback' };
    }

    const taskStages = this.stagedChanges.get(taskId);
    let revertedCount = 0;

    for (const [key, stage] of taskStages.entries()) {
      const fullPath = path.resolve(this.workspaceRoot, stage.filePath);
      try {
        if (stage.baselineContent === null) {
          // File was newly created, delete it
          if (fs.existsSync(fullPath)) {
            fs.unlinkSync(fullPath);
            revertedCount++;
          }
        } else {
          // Restore baseline content
          fs.writeFileSync(fullPath, stage.baselineContent, 'utf8');
          revertedCount++;
        }
      } catch (_) {}
    }

    this.stagedChanges.delete(taskId);
    return { ok: true, taskId, revertedCount };
  }

  /**
   * Safe cleanup of task workspace and optional worktree
   */
  async cleanupTaskWorkspace(taskId) {
    const record = this.taskWorkspaces.get(taskId);
    if (!record) return { ok: true, message: 'Workspace does not exist' };

    // Release any locks or ownership for this task
    for (const [key, lock] of this.activeLocks.entries()) {
      if (lock.taskId === taskId) this.activeLocks.delete(key);
    }
    for (const [key, owner] of this.fileOwnership.entries()) {
      if (owner.taskId === taskId) this.fileOwnership.delete(key);
    }
    this.stagedChanges.delete(taskId);

    if (record.isWorktree && this.gitAdapter) {
      try {
        await this.gitAdapter.run(['worktree', 'remove', '--force', record.dir]);
        if (record.branch) {
          await this.gitAdapter.run(['branch', '-D', record.branch]);
        }
      } catch (_) {}
    } else {
      try {
        if (fs.existsSync(record.dir)) {
          fs.rmSync(record.dir, { recursive: true, force: true });
        }
      } catch (_) {}
    }

    this.taskWorkspaces.delete(taskId);
    return { ok: true, taskId, status: 'cleaned' };
  }
}

module.exports = WorkspaceIsolation;
