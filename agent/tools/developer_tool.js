'use strict';

/**
 * DeveloperTool - Git, Build, Test, Lint, and Typecheck Engine
 * 
 * Invariants:
 * - Direct integration with GitAdapter for repository operations
 * - Execution through TerminalTool with cwd containment and timeout protection
 * - Structured test, build, lint, and typecheck reporting
 */
class DeveloperTool {
  constructor(gitAdapter, terminalTool, pathGuard) {
    this.gitAdapter = gitAdapter;
    this.terminalTool = terminalTool;
    this.pathGuard = pathGuard;
  }

  async gitStatus({ cwd = '.' } = {}) {
    if (!this.gitAdapter) return { ok: false, error: 'GitAdapter not configured' };
    try {
      const output = await this.gitAdapter.status({ cwd });
      const branch = await this.gitAdapter.branch({ cwd });
      return {
        ok: true,
        branch,
        clean: !output.trim(),
        statusText: output
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async gitDiff({ path: targetPath = '.', cwd = '.' } = {}) {
    if (!this.gitAdapter) return { ok: false, error: 'GitAdapter not configured' };
    try {
      const diffOutput = await this.gitAdapter.diff({ cwd });
      return {
        ok: true,
        hasChanges: Boolean(diffOutput.trim()),
        diff: diffOutput.slice(0, 50000) // 50k chars limit
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async gitLog({ limit = 10, cwd = '.' } = {}) {
    if (!this.gitAdapter) return { ok: false, error: 'GitAdapter not configured' };
    try {
      const logOutput = await this.gitAdapter.log(limit, { cwd });
      return {
        ok: true,
        count: logOutput.trim() ? logOutput.trim().split('\n').length : 0,
        commits: logOutput.trim() ? logOutput.trim().split('\n').filter(Boolean) : [],
        log: logOutput
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async gitBranch({ cwd = '.' } = {}) {
    if (!this.gitAdapter) return { ok: false, error: 'GitAdapter not configured' };
    try {
      const current = await this.gitAdapter.branch({ cwd });
      const res = await this.gitAdapter.run(['branch', '-a'], { cwd });
      return {
        ok: true,
        current,
        branches: res.stdout.split('\n').map(b => b.trim()).filter(Boolean)
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async gitWorktree({ action = 'list', path: wtPath = null, branch = null, cwd = '.' } = {}) {
    if (!this.gitAdapter) return { ok: false, error: 'GitAdapter not configured' };
    try {
      if (action === 'list') {
        const res = await this.gitAdapter.run(['worktree', 'list', '--porcelain'], { cwd });
        const worktrees = [];
        let current = {};
        for (const line of (res.stdout || '').split('\n')) {
          const trimmed = line.trim();
          if (trimmed.startsWith('worktree ')) {
            if (current.path) worktrees.push(current);
            current = { path: trimmed.replace(/^worktree\s+/, '') };
          } else if (trimmed.startsWith('branch ')) {
            current.branch = trimmed.replace(/^branch\s+/, '');
          } else if (trimmed.startsWith('HEAD ')) {
            current.head = trimmed.replace(/^HEAD\s+/, '');
          }
        }
        if (current.path) worktrees.push(current);
        return { ok: true, worktrees, output: res.stdout };
      }
      if (action === 'add') {
        if (!wtPath) return { ok: false, error: 'Worktree path required for action "add"' };
        const safeWtPath = this.pathGuard.resolveSafePath(wtPath);
        const args = ['worktree', 'add', safeWtPath];
        if (branch) args.push(branch);
        const res = await this.gitAdapter.run(args, { cwd });
        return { ok: res.exitCode === 0, output: res.stdout || res.stderr };
      }
      if (action === 'remove') {
        if (!wtPath) return { ok: false, error: 'Worktree path required for action "remove"' };
        const safeWtPath = this.pathGuard.resolveSafePath(wtPath);
        const res = await this.gitAdapter.run(['worktree', 'remove', safeWtPath], { cwd });
        return { ok: res.exitCode === 0, output: res.stdout || res.stderr };
      }
      return { ok: false, error: `Unknown worktree action: ${action}` };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async runTests({ command = null, cwd = '.', timeout = 60000 } = {}) {
    const testCmd = command || (process.platform === 'win32' ? 'npm.cmd test' : 'npm test');
    const res = await this.terminalTool.runCommand({ command: testCmd, cwd, timeout });
    return {
      ok: res.ok && res.exitCode === 0,
      exitCode: res.exitCode,
      durationMs: res.durationMs,
      passed: res.exitCode === 0,
      stdout: res.stdout,
      stderr: res.stderr,
      output: res.stdout || res.stderr
    };
  }

  async runBuild({ command = null, cwd = '.', timeout = 120000 } = {}) {
    const buildCmd = command || (process.platform === 'win32' ? 'npm.cmd run build' : 'npm run build');
    const res = await this.terminalTool.runCommand({ command: buildCmd, cwd, timeout });
    return {
      ok: res.ok && res.exitCode === 0,
      exitCode: res.exitCode,
      durationMs: res.durationMs,
      stdout: res.stdout,
      stderr: res.stderr,
      output: res.stdout || res.stderr
    };
  }

  async lintCode({ command = null, cwd = '.', timeout = 45000 } = {}) {
    const lintCmd = command || (process.platform === 'win32' ? 'npm.cmd run lint' : 'npm run lint');
    const res = await this.terminalTool.runCommand({ command: lintCmd, cwd, timeout });
    return {
      ok: res.ok && res.exitCode === 0,
      exitCode: res.exitCode,
      stdout: res.stdout,
      stderr: res.stderr,
      output: res.stdout || res.stderr
    };
  }

  async typeCheck({ command = null, cwd = '.', timeout = 45000 } = {}) {
    const typeCmd = command || 'npx tsc --noEmit';
    const res = await this.terminalTool.runCommand({ command: typeCmd, cwd, timeout });
    return {
      ok: res.ok && res.exitCode === 0,
      exitCode: res.exitCode,
      stdout: res.stdout,
      stderr: res.stderr,
      output: res.stdout || res.stderr
    };
  }
}

module.exports = DeveloperTool;
