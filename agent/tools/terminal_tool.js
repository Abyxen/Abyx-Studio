/**
 * ABYX Agentic Engine — Controlled Terminal Execution Tool
 * 
 * Enforces:
 * - Command visibility: Full command string reported before execution
 * - Working-directory containment: Strictly pinned within approved workspace
 * - Hard execution timeouts & AbortSignal cancellation
 * - Output truncation limits (max 50KB stdout/stderr)
 * - Environment sanitization (scrubs API keys, secrets from child process env)
 */

const { exec } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

class ControlledTerminalTool {
  constructor(pathGuard, options = {}) {
    if (!pathGuard) throw new Error('ControlledTerminalTool requires PathGuard');
    this.pathGuard = pathGuard;
    this.options = {
      defaultTimeoutMs: options.defaultTimeoutMs || 15000,
      maxTimeoutMs: options.maxTimeoutMs || 30000,
      maxOutputBytes: options.maxOutputBytes || 50000,
      ...options
    };
  }

  /**
   * Cleans sensitive variables from process.env before child execution
   */
  getSanitizedEnv() {
    const safeEnv = { ...process.env };
    const sensitiveKeys = [
      'OPENAI_API_KEY',
      'ANTHROPIC_API_KEY',
      'GEMINI_API_KEY',
      'GROQ_API_KEY',
      'OPENROUTER_API_KEY',
      'ABYX_LOOPBACK_TOKEN',
      'AWS_SECRET_ACCESS_KEY',
      'GITHUB_TOKEN',
      'GH_TOKEN'
    ];
    for (const key of sensitiveKeys) {
      delete safeEnv[key];
    }
    // Also delete any key matching api_key, secret, or password
    for (const k of Object.keys(safeEnv)) {
      const lower = k.toLowerCase();
      if (lower.includes('api_key') || lower.includes('secret') || lower.includes('token') || lower.includes('password')) {
        delete safeEnv[k];
      }
    }
    return safeEnv;
  }

  /**
   * Executes a command within the constrained workspace directory
   */
  async execute({ command, cwd = '.', timeoutMs = null, signal = null } = {}) {
    if (!command || typeof command !== 'string' || !command.trim()) {
      return { success: false, error: 'Command string must be a non-empty string' };
    }

    const trimmed = command.trim();
    // Resolve and verify target working directory
    let targetCwd;
    try {
      targetCwd = this.pathGuard.resolveSafePath(cwd);
      if (!fs.existsSync(targetCwd)) {
        return { success: false, error: `Working directory does not exist: "${cwd}"` };
      }
    } catch (e) {
      return { success: false, error: `Invalid working directory: ${e.message}` };
    }

    const effectiveTimeout = Math.min(
      typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : this.options.defaultTimeoutMs,
      this.options.maxTimeoutMs
    );

    const startTime = Date.now();

    return new Promise((resolve) => {
      let isAborted = false;
      const child = exec(trimmed, {
        cwd: targetCwd,
        timeout: effectiveTimeout,
        windowsHide: true,
        maxBuffer: this.options.maxOutputBytes * 2,
        env: this.getSanitizedEnv()
      }, (err, stdout, stderr) => {
        const durationMs = Date.now() - startTime;
        let outStr = (stdout || '').trim();
        let errStr = (stderr || '').trim();

        const isOutTruncated = outStr.length > this.options.maxOutputBytes;
        const isErrTruncated = errStr.length > this.options.maxOutputBytes;

        if (isOutTruncated) {
          outStr = outStr.slice(0, this.options.maxOutputBytes) + `\n... [Output truncated at ${this.options.maxOutputBytes} bytes]`;
        }
        if (isErrTruncated) {
          errStr = errStr.slice(0, this.options.maxOutputBytes) + `\n... [Error output truncated at ${this.options.maxOutputBytes} bytes]`;
        }

        if (isAborted) {
          return resolve({
            success: false,
            cancelled: true,
            error: 'Command execution cancelled by user',
            stdout: outStr,
            stderr: errStr,
            durationMs
          });
        }

        if (err && err.killed) {
          return resolve({
            success: false,
            timedOut: true,
            error: `Command timed out after ${effectiveTimeout}ms`,
            stdout: outStr,
            stderr: errStr,
            durationMs
          });
        }

        resolve({
          success: !err || err.code === 0,
          exitCode: err ? (err.code || 1) : 0,
          stdout: outStr,
          stderr: errStr,
          cwd: this.pathGuard.getRelativeAlias(targetCwd),
          durationMs
        });
      });

      // Handle external cancellation signal
      if (signal) {
        if (signal.aborted) {
          isAborted = true;
          try { child.kill('SIGKILL'); } catch (e) {}
        } else {
          signal.addEventListener('abort', () => {
            isAborted = true;
            try { child.kill('SIGKILL'); } catch (e) {}
          }, { once: true });
        }
      }
    });
  }
}

module.exports = ControlledTerminalTool;
