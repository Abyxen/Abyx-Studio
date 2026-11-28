'use strict';

const { exec, spawn } = require('node:child_process');

/**
 * TerminalTool - Hardened Terminal Execution Subsystem
 * 
 * Supports:
 * - Default shell execution (cmd/PowerShell)
 * - Explicit PowerShell execution (`powershell -NoProfile -NonInteractive`)
 * - WSL execution where available (`wsl.exe`)
 * - Working directory bounds validation via PathGuard
 * - Process tree cancellation and timeouts
 * - Exit code, duration, stdout, and stderr reporting
 */
class TerminalTool {
  constructor(pathGuard, options = {}) {
    this.pathGuard = pathGuard;
    this.timeoutMs = options.timeoutMs || 45000;
    this.maxBufferBytes = options.maxBufferBytes || 128 * 1024; // 128KB output cap
    this.policyEngine = options.policyEngine || null;

    // Dangerous commands that must NEVER be executed automatically
    this.blockedPatterns = [
      /\brm\s+-[rf]{1,2}\s+[\/\\]/i,
      /\bdel\s+\/[sfq]\s+[a-z]:\\/i,
      /\bformat\s+[a-z]:/i,
      /\bdiskpart\b/i,
      /\bshutdown\b/i,
      /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, // Fork bomb
      /\bInvoke-WebRequest.*\|\s*iex\b/i,
      /\bcurl.*\|\s*(bash|sh|powershell)\b/i
    ];

    this._wslAvailable = null;
  }

  /**
   * Produce a strictly sanitized environment without secrets or credentials
   */
  getSanitizedEnv(customEnv = {}) {
    const sourceEnv = { ...process.env, ...customEnv };
    const sanitized = {};

    const sensitivePatterns = [
      /API[_-]?KEY/i,
      /TOKEN/i,
      /SECRET/i,
      /PASSWORD/i,
      /PRIVATE[_-]?KEY/i,
      /^AWS_/i,
      /^AZURE_/i,
      /^GCP_/i,
      /^GITHUB_/i,
      /AUTH/i,
      /CREDENTIAL/i
    ];

    // Safe base system variables necessary for system commands to execute
    const safeAllowlist = new Set([
      'PATH', 'PATHEXT', 'SYSTEMROOT', 'SYSTEMDRIVE', 'TEMP', 'TMP',
      'COMSPEC', 'WINDIR', 'APPDATA', 'LOCALAPPDATA', 'USERPROFILE',
      'HOMEDRIVE', 'HOMEPATH', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE',
      'PROCESSOR_IDENTIFIER', 'PROCESSOR_LEVEL', 'PROCESSOR_REVISION',
      'OS', 'PROGRAMDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)', 'COMMONPROGRAMFILES',
      'HOME', 'USER', 'SHELL', 'LANG', 'LC_ALL', 'TMPDIR', 'TERM', 'HOSTNAME'
    ]);

    for (const [key, value] of Object.entries(sourceEnv)) {
      if (sensitivePatterns.some(p => p.test(key))) {
        continue; // Purge all secrets, tokens, keys
      }
      const upper = key.toUpperCase();
      if (safeAllowlist.has(upper) || key in customEnv) {
        sanitized[key] = value;
      }
    }

    sanitized.NODE_ENV = customEnv.NODE_ENV || 'test';
    sanitized.CI = 'true';
    return sanitized;
  }

  isCommandBlocked(command) {
    if (!command || typeof command !== 'string') return true;
    return this.blockedPatterns.some(pattern => pattern.test(command));
  }

  async checkWslAvailability() {
    if (this._wslAvailable !== null) return this._wslAvailable;
    return new Promise((resolve) => {
      exec('wsl.exe --status', { timeout: 3000, windowsHide: true }, (err) => {
        this._wslAvailable = !err;
        resolve(this._wslAvailable);
      });
    });
  }

  async runCommand({ command, cwd = '.', timeout = null, shell = null, signal = null, env = null, approvalId = null, toolName = 'execute_terminal_command' }) {
    if (!command || typeof command !== 'string') {
      return { ok: false, error: 'Command must be a non-empty string' };
    }

    // Check policy engine approval if present
    if (this.policyEngine) {
      if (typeof this.policyEngine.evaluateToolCall === 'function') {
        const isAllowedByDefault = this.policyEngine.defaultPolicy === 'allow' ||
          this.policyEngine.options?.defaultAction === 'allow' ||
          this.policyEngine.policies?.[toolName] === 'allow' ||
          this.policyEngine.policies?.['run_powershell'] === 'allow';

        if (!isAllowedByDefault) {
          const decision = this.policyEngine.evaluateToolCall(toolName, { command, cwd });
          if (decision.riskLevel === 'DENIED') {
            return { ok: false, success: false, blocked: true, requiresApproval: false, error: decision.reason };
          }
          if (decision.riskLevel === 'REQUIRES_APPROVAL') {
            const isValid = (approvalId && typeof this.policyEngine.validateApprovedCall === 'function'
              ? this.policyEngine.validateApprovedCall(approvalId, toolName, { command, cwd })
              : false);
            if (!isValid) {
              return { ok: false, success: false, requiresApproval: true, blocked: true, error: 'Approval required for command' };
            }
          }
        }
      }
    }

    if (this.isCommandBlocked(command)) {
      return {
        ok: false,
        success: false,
        blocked: true,
        error: `TerminalTool: Command execution blocked by security policy: ${command}`
      };
    }

    let safeCwd;
    try {
      safeCwd = this.pathGuard ? this.pathGuard.resolveSafePath(cwd) : process.cwd();
    } catch (err) {
      return { ok: false, success: false, error: `Invalid working directory: ${err.message}` };
    }

    const effectiveTimeout = timeout ? Math.min(Number(timeout), 120000) : this.timeoutMs;
    const effectiveEnv = env ? this.getSanitizedEnv(env) : this.getSanitizedEnv();
    const startTime = Date.now();

    return new Promise((resolve) => {
      const child = exec(
        command,
        {
          cwd: safeCwd,
          timeout: effectiveTimeout,
          maxBuffer: this.maxBufferBytes,
          windowsHide: true,
          shell: shell || (process.platform === 'win32' ? 'powershell.exe' : '/bin/sh'),
          env: effectiveEnv
        },
        (error, stdout, stderr) => {
          const durationMs = Date.now() - startTime;
          const outStr = (stdout || '').slice(0, this.maxBufferBytes);
          const errStr = (stderr || '').slice(0, this.maxBufferBytes);

          if (error) {
            const isTimeout = error.killed || (Date.now() - startTime >= effectiveTimeout - 50);
            resolve({
              ok: false,
              success: false,
              exitCode: error.code !== undefined ? error.code : 1,
              killed: error.killed || isTimeout,
              signal: error.signal || null,
              durationMs,
              stdout: outStr,
              stderr: errStr || error.message,
              error: isTimeout ? `Command execution timed out after ${effectiveTimeout}ms` : error.message
            });
          } else {
            resolve({
              ok: true,
              success: true,
              exitCode: 0,
              durationMs,
              stdout: outStr,
              stderr: errStr
            });
          }
        }
      );

      // Support external cancellation signal
      if (signal) {
        signal.addEventListener('abort', () => {
          try {
            if (process.platform === 'win32' && child.pid) {
              exec(`taskkill /F /T /PID ${child.pid}`, { windowsHide: true });
            } else {
              child.kill('SIGTERM');
            }
          } catch (_) {}
        }, { once: true });
      }
    });
  }

  // Alias for tests and alternative callers
  async execute(options) {
    return this.runCommand(options);
  }

  async runPowerShell({ command, cwd = '.', timeout = null }) {
    const psCmd = 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "' + command.replace(/"/g, '\\"') + '"';
    return this.runCommand({ command: psCmd, cwd, timeout, shell: 'cmd.exe', toolName: 'run_powershell' });
  }

  async runPowershell(opts) {
    return this.runPowerShell(opts);
  }

  async runWsl({ command, cwd = '.', timeout = null }) {
    const available = await this.checkWslAvailability();
    if (!available) {
      return {
        ok: false,
        available: false,
        error: 'WSL is not available or not configured on this Windows host.'
      };
    }
    const wslCmd = `wsl.exe -- ${command}`;
    const res = await this.runCommand({ command: wslCmd, cwd, timeout });
    return { ...res, executionContext: 'wsl' };
  }
}

module.exports = TerminalTool;
