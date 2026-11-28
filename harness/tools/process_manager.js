/**
 * Long-Running Background Process Manager
 * Spawns and manages detached long-running processes (PowerShell, CMD, Python, Node, Dev Servers).
 * Streams logs to disk, tracks process health, supports cancellation, and persists state across restarts.
 */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

class ProcessManager {
  constructor(workspaceRoot = process.cwd()) {
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.processDir = path.join(this.workspaceRoot, '.abyx_processes');
    fs.mkdirSync(this.processDir, { recursive: true });
    this.activeProcesses = new Map();
    this.registryFile = path.join(this.processDir, 'registry.json');
    this._loadRegistry();
  }

  _loadRegistry() {
    if (fs.existsSync(this.registryFile)) {
      try {
        const data = JSON.parse(fs.readFileSync(this.registryFile, 'utf-8'));
        for (const [id, proc] of Object.entries(data)) {
          // If was running before restart, mark as unknown/stopped
          if (proc.status === 'RUNNING') {
            proc.status = 'STOPPED_ON_RESTART';
          }
          this.activeProcesses.set(id, proc);
        }
      } catch (_) {}
    }
  }

  _saveRegistry() {
    const serialized = {};
    for (const [id, p] of this.activeProcesses.entries()) {
      serialized[id] = {
        id: p.id,
        command: p.command,
        pid: p.pid,
        status: p.status,
        startTime: p.startTime,
        endTime: p.endTime,
        exitCode: p.exitCode,
        logFile: p.logFile
      };
    }
    fs.writeFileSync(this.registryFile, JSON.stringify(serialized, null, 2), 'utf-8');
  }

  spawnProcess(taskId, command, args = [], options = {}) {
    const id = taskId || `proc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const logFile = path.join(this.processDir, `${id}.log`);
    fs.writeFileSync(logFile, '');

    const fullCmd = [command, ...args].join(' ');
    const useShell = options.shell !== undefined ? options.shell : (process.platform === 'win32' && (command.endsWith('.cmd') || command.endsWith('.bat')));

    const child = spawn(command, args, {
      cwd: this.workspaceRoot,
      env: { ...process.env, ...options.env },
      detached: true,
      shell: useShell,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const info = {
      id,
      command: fullCmd,
      pid: child.pid,
      status: 'RUNNING',
      startTime: new Date().toISOString(),
      endTime: null,
      exitCode: null,
      logFile,
      childRef: child
    };

    if (child.stdout) {
      child.stdout.on('data', (chunk) => {
        try {
          fs.appendFileSync(logFile, chunk);
        } catch (_) {}
      });
    }

    if (child.stderr) {
      child.stderr.on('data', (chunk) => {
        try {
          fs.appendFileSync(logFile, chunk);
        } catch (_) {}
      });
    }

    child.on('exit', (code) => {
      info.status = 'EXITED';
      info.exitCode = code;
      info.endTime = new Date().toISOString();
      this._saveRegistry();
    });

    child.on('error', (err) => {
      info.status = 'ERROR';
      info.error = err.message;
      info.endTime = new Date().toISOString();
      this._saveRegistry();
    });

    child.unref(); // Detach from parent loop so server can continue

    this.activeProcesses.set(id, info);
    this._saveRegistry();

    return {
      id,
      pid: child.pid,
      status: 'RUNNING',
      logFile
    };
  }

  getProcess(id) {
    const p = this.activeProcesses.get(id);
    if (!p) return null;
    return {
      id: p.id,
      command: p.command,
      pid: p.pid,
      status: p.status,
      startTime: p.startTime,
      endTime: p.endTime,
      exitCode: p.exitCode,
      logFile: p.logFile
    };
  }

  readProcessLogs(id, tailLines = 100) {
    const p = this.activeProcesses.get(id);
    if (!p || !fs.existsSync(p.logFile)) return '';
    const content = fs.readFileSync(p.logFile, 'utf-8');
    const lines = content.split('\n');
    return lines.slice(-tailLines).join('\n');
  }

  cancelProcess(id) {
    const p = this.activeProcesses.get(id);
    if (!p) return { cancelled: false, error: 'Process not found' };

    if (p.pid) {
      try {
        if (process.platform === 'win32') {
          spawn('taskkill', ['/F', '/T', '/PID', String(p.pid)]);
        } else {
          process.kill(-p.pid, 'SIGKILL');
        }
      } catch (_) {}
    }

    p.status = 'CANCELLED';
    p.endTime = new Date().toISOString();
    this._saveRegistry();

    return { cancelled: true, id };
  }

  listProcesses() {
    return Array.from(this.activeProcesses.values()).map(p => ({
      id: p.id,
      command: p.command,
      pid: p.pid,
      status: p.status,
      startTime: p.startTime,
      endTime: p.endTime,
      exitCode: p.exitCode
    }));
  }
}

module.exports = { ProcessManager };
