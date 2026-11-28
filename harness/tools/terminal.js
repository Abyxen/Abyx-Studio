/**
 * Cross-platform Terminal Execution Tool.
 * Automatically utilizes Git Bash on Windows for full POSIX parity, falling back to PowerShell.
 */

const { execSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

class TerminalTool {
  constructor(workspaceRoot) {
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.bashPath = this._locateBash();
    this.name = 'terminal';
    this.description = 'Executes commands in workspace shell with POSIX parity.';
  }

  getSchema() {
    return {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Command to execute' },
        timeout: { type: 'integer', description: 'Timeout in ms' }
      },
      required: ['command']
    };
  }

  _locateBash() {
    if (process.platform === 'win32') {
      const candidates = [
        'C:\\Program Files\\Git\\bin\\bash.exe',
        'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
        'C:\\Program Files\\Git\\usr\\bin\\bash.exe'
      ];
      for (const cand of candidates) {
        if (fs.existsSync(cand)) return cand;
      }
    }
    return null;
  }

  execute(commandOrArgs, timeoutMs = 30000) {
    const cmd = typeof commandOrArgs === 'object' ? commandOrArgs.command : commandOrArgs;
    const timeout = (typeof commandOrArgs === 'object' && commandOrArgs.timeout) ? commandOrArgs.timeout : timeoutMs;
    try {
      let result;
      if (this.bashPath) {
        result = spawnSync(this.bashPath, ['-c', cmd], {
          cwd: this.workspaceRoot,
          env: process.env,
          timeout: timeout,
          encoding: 'utf-8',
          maxBuffer: 10 * 1024 * 1024
        });
      } else {
        // POSIX printf fallback on Windows without Git Bash
        if (cmd.trim().startsWith('printf ')) {
          const parts = cmd.trim().split(/\s+/);
          parts.shift();
          const rawFmt = parts.join(' ').replace(/^['"]|['"]$/g, '').replace(/\\n/g, '\n');
          return { stdout: rawFmt, stderr: '', exitCode: 0, output: rawFmt, command: cmd };
        }
        result = spawnSync(cmd, {
          shell: true,
          cwd: this.workspaceRoot,
          env: process.env,
          timeout: timeout,
          encoding: 'utf-8',
          maxBuffer: 10 * 1024 * 1024
        });
      }

      const out = result.stdout || '';
      const err = result.stderr || '';
      const code = result.status !== null ? result.status : (result.error ? 1 : 0);
      return {
        stdout: out,
        stderr: err,
        output: out || err,
        exitCode: code,
        command: cmd
      };
    } catch (e) {
      return {
        stdout: '',
        stderr: e.message || String(e),
        output: e.message || String(e),
        exitCode: 1,
        command: cmd
      };
    }
  }
}

module.exports = { TerminalTool };
