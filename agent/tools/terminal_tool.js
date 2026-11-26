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

  async runCommand({ command, cwd = '.', timeout = null, shell = null, signal = null }) {
    if (!command || typeof command !== 'string') {
      return { ok: false, error: 'Command must be a non-empty string' };
    }

    if (this.isCommandBlocked(command)) {
      return {
        ok: false,
        blocked: true,
        error: `TerminalTool: Command execution blocked by security policy: ${command}`
      };
    }

    let safeCwd;
    try {
      safeCwd = this.pathGuard ? this.pathGuard.resolveSafePath(cwd) : process.cwd();
    } catch (err) {
      return { ok: false, error: `Invalid working directory: ${err.message}` };
    }

    const effectiveTimeout = timeout ? Math.min(Number(timeout), 120000) : this.timeoutMs;
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
          env: {
            ...process.env,
            NODE_ENV: 'test',
            CI: 'true'
          }
        },
        (error, stdout, stderr) => {
          const durationMs = Date.now() - startTime;
          const outStr = (stdout || '').slice(0, this.maxBufferBytes);
          const errStr = (stderr || '').slice(0, this.maxBufferBytes);

          if (error) {
            const isTimeout = error.killed || (Date.now() - startTime >= effectiveTimeout - 50);
            resolve({
              ok: false,
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

  async runPowerShell({ command, cwd = '.', timeout = null }) {
    const psCmd = `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "${command.replace(/"/g, '`"')}"`;
    return this.runCommand({ command: psCmd, cwd, timeout, shell: 'cmd.exe' });
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
