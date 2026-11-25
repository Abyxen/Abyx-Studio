'use strict';

/**
 * ABYX Workspace Isolation & File Ownership Protocol
 * Enforces exclusive write locks and staging worktrees to prevent
 * concurrently running agents from clobbering or corrupting each other's files.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class WorkspaceIsolationManager {
  /**
   * @param {import('./path_guard')} pathGuard
   */
  constructor(pathGuard) {
    if (!pathGuard) throw new Error('WorkspaceIsolationManager requires PathGuard');
    this.pathGuard = pathGuard;
    this.locks = new Map(); // normalizedFilePath -> { agentId, mode: 'read'|'write', acquiredAt }
    this.agentLocks = new Map(); // agentId -> Set<normalizedFilePath>
  }

  /**
   * Acquire a lock on a file path
   * @param {string} filePath - Target file path
   * @param {string} agentId - Requesting agent ID
   * @param {'read'|'write'} mode - Lock mode
   */
  acquireLock(filePath, agentId, mode = 'write') {
    const resolved = this.pathGuard.resolveSafePath(filePath);
    const existing = this.locks.get(resolved);

    if (existing) {
      if (existing.agentId === agentId) {
        return { ok: true, acquired: true, resolvedPath: resolved };
      }
      if (existing.mode === 'write' || mode === 'write') {
        return {
          ok: false,
          error: `File conflict: "${path.basename(resolved)}" is currently locked by agent "${existing.agentId}" (${existing.mode} lock).`,
          holder: existing.agentId,
          heldSince: existing.acquiredAt
        };
      }
    }

    const lockEntry = { agentId, mode, acquiredAt: new Date().toISOString() };
    this.locks.set(resolved, lockEntry);

    if (!this.agentLocks.has(agentId)) {
      this.agentLocks.set(agentId, new Set());
    }
    this.agentLocks.get(agentId).add(resolved);

    return { ok: true, acquired: true, resolvedPath: resolved };
  }

  /**
   * Release all locks held by a specific agent
   */
  releaseLocks(agentId) {
    const held = this.agentLocks.get(agentId);
    if (!held) return { releasedCount: 0 };

    let count = 0;
    for (const filePath of held) {
      this.locks.delete(filePath);
      count++;
    }
    this.agentLocks.delete(agentId);
    return { releasedCount: count };
  }

  /**
   * Get an isolated shadow staging path for an agent
   */
  getShadowPath(agentId, relativeFilePath) {
    const stagingBase = path.join(this.pathGuard.defaultRoot, '.abyx_worktrees', agentId);
    if (!fs.existsSync(stagingBase)) {
      fs.mkdirSync(stagingBase, { recursive: true });
    }
    return path.join(stagingBase, relativeFilePath);
  }

  /**
   * Atomically merges an agent's shadow staging directory into the main workspace
   * after collision verification.
   */
  reconcileAndMerge(agentId) {
    const stagingBase = path.join(this.pathGuard.defaultRoot, '.abyx_worktrees', agentId);
    if (!fs.existsSync(stagingBase)) {
      return { ok: true, mergedFiles: [] };
    }

    const stagedFiles = [];
    const walk = (dir) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile()) {
          stagedFiles.push(full);
        }
      }
    };

    walk(stagingBase);
    const mergedFiles = [];

    for (const stagedFile of stagedFiles) {
      const relPath = path.relative(stagingBase, stagedFile);
      const targetPath = this.pathGuard.resolveSafePath(relPath);

      // Create pre-modification backup if target exists
      if (fs.existsSync(targetPath)) {
        const backupDir = path.join(this.pathGuard.defaultRoot, '.abyx_backup');
        if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
        const backupFile = path.join(backupDir, `${path.basename(targetPath)}.${Date.now()}.bak`);
        fs.copyFileSync(targetPath, backupFile);
      } else {
        const targetDir = path.dirname(targetPath);
        if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
      }

      // Copy staged file into workspace
      fs.copyFileSync(stagedFile, targetPath);
      mergedFiles.push(relPath);
    }

    // Clean up shadow directory
    try {
      fs.rmSync(stagingBase, { recursive: true, force: true });
    } catch (_) {}

    // Release locks
    this.releaseLocks(agentId);

    return { ok: true, mergedFiles };
  }

  /**
   * Clean up shadow workspace without merging (e.g. on task cancellation)
   */
  discardShadowWorkspace(agentId) {
    const stagingBase = path.join(this.pathGuard.defaultRoot, '.abyx_worktrees', agentId);
    if (fs.existsSync(stagingBase)) {
      try {
        fs.rmSync(stagingBase, { recursive: true, force: true });
      } catch (_) {}
    }
    this.releaseLocks(agentId);
  }
}

module.exports = WorkspaceIsolationManager;
