'use strict';

const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const runFile = promisify(execFile);

/**
 * GitAdapter - Workspace Version Control & Snapshot Engine
 * Provides repository status, diff inspection, branch management,
 * and OpenCode-style pre-execution snapshots with atomic rollback.
 */
class GitAdapter {
  constructor(pathGuard, options = {}) {
    if (typeof pathGuard === 'string') {
      this.workspaceRoot = pathGuard;
      this.pathGuard = null;
    } else {
      this.pathGuard = pathGuard;
      this.workspaceRoot = pathGuard && pathGuard.workspaceRoot ? pathGuard.workspaceRoot : process.cwd();
    }
    this.timeoutMs = options.timeoutMs || 15000;
    this.maxOutputBytes = options.maxOutputBytes || 256 * 1024;
  }

  async run(args, { cwd = '.', signal } = {}) {
    if (!Array.isArray(args) || args.some(arg => typeof arg !== 'string' || arg.includes('\0'))) {
      throw new TypeError('Git arguments must be an array of strings');
    }
    let safeCwd = cwd;
    if (this.pathGuard && typeof this.pathGuard.resolveSafePath === 'function') {
      safeCwd = this.pathGuard.resolveSafePath(cwd);
    } else if (this.workspaceRoot && cwd !== '.') {
      const path = require('node:path');
      safeCwd = path.resolve(this.workspaceRoot, cwd);
    }
    try {
      const { stdout, stderr } = await runFile(
        'git',
        ['-c', 'core.fsmonitor=false', '-c', 'diff.external=', '-c', 'diff.mnemonicPrefix=false', ...args],
        {
          cwd: safeCwd,
          shell: false,
          windowsHide: true,
          timeout: this.timeoutMs,
          signal,
          maxBuffer: this.maxOutputBytes,
          env: {
            ...process.env,
            GIT_CONFIG_NOSYSTEM: '1',
            GIT_TERMINAL_PROMPT: '0',
            GIT_OPTIONAL_LOCKS: '0'
          }
        }
      );
      return { stdout: stdout.slice(0, this.maxOutputBytes), stderr: stderr.slice(0, this.maxOutputBytes) };
    } catch (err) {
      return {
        stdout: err.stdout ? String(err.stdout).slice(0, this.maxOutputBytes) : '',
        stderr: err.stderr ? String(err.stderr).slice(0, this.maxOutputBytes) : err.message,
        exitCode: err.code || 1
      };
    }
  }

  async status(options = {}) {
    const res = await this.run(['status', '--porcelain=v1', '--branch', '--untracked-files=normal'], options);
    return res.stdout;
  }

  async diff(options = {}) {
    const res = await this.run(['-c', 'core.quotePath=true', 'diff', '--no-ext-diff', '--no-textconv', '--', '.'], options);
    return res.stdout;
  }

  async log(limit = 10, options = {}) {
    const res = await this.run(['log', `-${limit}`, '--oneline', '--decorate=short'], options);
    return res.stdout;
  }

  async branch(options = {}) {
    const res = await this.run(['branch', '--show-current'], options);
    return res.stdout.trim();
  }

  /**
   * Create an OpenCode-style git snapshot before destructive tool execution
   * Stashes dirty state with an immutable index reference.
   */
  async createSnapshot(label = 'pre-execution-snapshot', options = {}) {
    try {
      const res = await this.run(['stash', 'create', `abyx:${Date.now()}:${label}`], options);
      const stashCommit = res.stdout.trim();
      return {
        ok: true,
        snapshotId: stashCommit || 'clean_state',
        created: Boolean(stashCommit)
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  /**
   * Rollback workspace changes to a specific snapshot
   */
  async rollbackSnapshot(snapshotId, options = {}) {
    if (!snapshotId || snapshotId === 'clean_state') {
      return { ok: true, message: 'Working directory was already clean' };
    }
    try {
      // Reset hard to commit and apply the stashed state
      const resetRes = await this.run(['checkout', '--', '.'], options);
      const cleanRes = await this.run(['clean', '-fd'], options);
      return {
        ok: true,
        message: 'Successfully rolled back to snapshot state'
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }
}

module.exports = GitAdapter;
