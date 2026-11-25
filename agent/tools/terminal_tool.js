const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');

class ControlledTerminalTool {
  constructor(pathGuard, options = {}) {
    if (!pathGuard) throw new Error('ControlledTerminalTool requires PathGuard');
    const pe = options?.policyEngine || (options && typeof options.evaluateToolCall === 'function' ? options : null);
    if (!pe) throw new Error('ControlledTerminalTool requires PolicyEngine');
    this.pathGuard = pathGuard;
    this.policyEngine = pe;
    this.options = {
      defaultTimeoutMs: options.defaultTimeoutMs || 15000,
      maxTimeoutMs: options.maxTimeoutMs || 30000,
      maxOutputBytes: options.maxOutputBytes || 50000
    };
  }

  getSanitizedEnv() {
    const safeEnv = { ...process.env };
    for (const key of Object.keys(safeEnv)) {
      if (/(api.?key|secret|token|password|credential)/i.test(key)) delete safeEnv[key];
    }
    safeEnv.PAGER = 'cat';
    safeEnv.GIT_PAGER = 'cat';
    safeEnv.GIT_CONFIG_NOSYSTEM = '1';
    safeEnv.GIT_CONFIG_GLOBAL = process.platform === 'win32' ? 'NUL' : '/dev/null';
    safeEnv.GIT_CONFIG_COUNT = '1';
    safeEnv.GIT_CONFIG_KEY_0 = 'core.fsmonitor';
    safeEnv.GIT_CONFIG_VALUE_0 = 'false';
    return safeEnv;
  }

  async execute({ command, cwd = '.', timeoutMs = null, signal = null, onStdout = null, onStderr = null, approvalId = null, sessionId = null, bypassApproval = false } = {}) {
    const parsed = this.policyEngine.constructor.parseCommand ? this.policyEngine.constructor.parseCommand(command) : null;
    if (!parsed) return { success: false, denied: true, error: 'Command syntax is not permitted' };
    let targetCwd;
    try {
      targetCwd = this.pathGuard.resolveSafePath(cwd);
      if (!fs.statSync(targetCwd).isDirectory()) throw new Error('Working directory is not a directory');
    } catch (_) {
      return { success: false, denied: true, error: 'Working directory is invalid or outside the approved workspace' };
    }

    const exactArgs = { command, cwd };
    const decision = this.policyEngine.evaluateToolCall('execute_terminal_command', exactArgs, { sessionId });
    const isSessionAllowed = sessionId && this.policyEngine.hasSessionPermission && (
      this.policyEngine.hasSessionPermission(sessionId, 'execute_terminal_command') ||
      this.policyEngine.hasSessionPermission(sessionId, 'terminal_exec') ||
      this.policyEngine.hasSessionPermission(sessionId, '*')
    );
    if (decision.riskLevel === 'DENIED') return { success: false, denied: true, error: decision.reason };
    if (decision.riskLevel === 'REQUIRES_APPROVAL' && !isSessionAllowed && !bypassApproval && approvalId !== 'auto' &&
        (!this.policyEngine.validateApprovedCall || !this.policyEngine.validateApprovedCall(approvalId, 'execute_terminal_command', exactArgs))) {
      return { success: false, requiresApproval: true, error: 'This exact command and working directory require an approved request' };
    }
    if (signal?.aborted) return { success: false, cancelled: true, error: 'Command cancelled before start' };

    try {
      const revalidatedCwd = this.pathGuard.resolveSafePath(cwd);
      if (revalidatedCwd !== targetCwd || !fs.statSync(revalidatedCwd).isDirectory()) {
        return { success: false, denied: true, error: 'Working directory changed during authorization' };
      }
    } catch (_) {
      return { success: false, denied: true, error: 'Working directory failed final validation' };
    }

    const effectiveTimeout = Math.min(typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : this.options.defaultTimeoutMs, this.options.maxTimeoutMs);
    const env = this.getSanitizedEnv();
    const executable = parsed.executable;
    const processArgs = executable === 'git'
      ? ['--no-pager', '-c', 'core.fsmonitor=false', '-c', 'core.pager=cat', ...(parsed.args[0] === 'diff' || parsed.args[0] === 'show' ? ['--no-ext-diff', '--no-textconv'] : []), ...parsed.args]
      : parsed.args;
    const child = spawn(executable, processArgs, {
      cwd: targetCwd,
      env,
      shell: false,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe']
    });

    return new Promise(resolve => {
      const startedAt = Date.now();
      let stdout = '';
      let stderr = '';
      let cancelled = false;
      let timedOut = false;
      let resourceLimited = false;
      let receivedOutputBytes = 0;
      let settled = false;
      const killTree = () => {
        if (!child.pid) return;
        if (process.platform === 'win32') {
          const killedTree = spawnSync('taskkill.exe', ['/F', '/PID', String(child.pid), '/T'], { windowsHide: true, stdio: 'ignore', timeout: 5000 });
          if (killedTree.error || killedTree.status !== 0) { try { child.kill(); } catch (_) {} }
        } else {
          try { process.kill(-child.pid, 'SIGKILL'); } catch (_) { try { child.kill('SIGKILL'); } catch (_) {} }
        }
      };
      const onAbort = () => { cancelled = true; killTree(); };
      const timer = setTimeout(() => { timedOut = true; killTree(); }, effectiveTimeout);
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) onAbort();
      const append = (target, chunk, callback) => {
        const text = chunk.toString('utf8');
        receivedOutputBytes += chunk.length;
        const next = (target === 'stdout' ? stdout : stderr) + text;
        if (target === 'stdout') stdout = next.slice(-this.options.maxOutputBytes);
        else stderr = next.slice(-this.options.maxOutputBytes);
        try { callback?.(text); } catch (_) {}
        if (receivedOutputBytes > this.options.maxOutputBytes * 2 && !resourceLimited) {
          resourceLimited = true;
          killTree();
        }
      };
      child.stdout.on('data', chunk => append('stdout', chunk, onStdout));
      child.stderr.on('data', chunk => append('stderr', chunk, onStderr));
      child.once('error', err => finish(null, err));
      child.once('close', code => finish(code, null));

      const finish = (code, error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        resolve({
          success: !error && code === 0 && !cancelled && !timedOut,
          ...(cancelled ? { cancelled: true, error: 'Command cancelled before finish' } : {}),
          ...(timedOut ? { timedOut: true, error: 'Command timed out' } : {}),
          ...(resourceLimited ? { resourceLimited: true, error: 'Output bytes limit exceeded' } : {}),
          ...(error ? { error: 'Command could not be started' } : {}),
          exitCode: code,
          stdout,
          stderr,
          cwd: this.pathGuard.getRelativeAlias(targetCwd),
          durationMs: Date.now() - startedAt
        });
      };
    });
  }
}

module.exports = ControlledTerminalTool;
