/**
 * ABYX Process Lifecycle Manager
 * 
 * Tracks live child-process handles and persists a recovery manifest.
 * The manifest is diagnostic/recovery metadata only: it is not authority to
 * terminate a PID after restart. Only a currently owned ChildProcess handle
 * can be terminated by this manager. Descendant cleanup is not guaranteed.
 * - Mutex lock preventing simultaneous conflicting model loads
 * - Pre-flight GPU VRAM and physical RAM checks to prevent OOM aborts
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

class ProcessLifecycleManager {
  constructor(configDir = null) {
    this.configDir = configDir || path.join(__dirname, '..', 'app', 'config');
    this.manifestPath = path.join(this.configDir, 'abyx-processes.json');
    this.activeProcesses = new Map();
    this.modelLoadLock = false;
    this.isShuttingDown = false;

    // Ensure config directory exists
    try {
      if (!fs.existsSync(this.configDir)) {
        fs.mkdirSync(this.configDir, { recursive: true });
      }
    } catch (_) {}

    // Attach lifecycle exit hooks
    this._attachExitHandlers();
  }

  /**
   * Register a newly spawned child process
   * @param {string} id Unique identifier (e.g., 'llm', 'backend', 'terminal_123')
   * @param {ChildProcess} child The Node.js ChildProcess instance
   * @param {Object} metadata Role, port, binary, command, model, etc.
   */
  register(id, child, metadata = {}) {
    if (!child || !Number.isInteger(child.pid) || child.pid <= 0 || typeof child.kill !== 'function' || typeof child.once !== 'function') {
      throw new TypeError('Process registration requires a live ChildProcess handle; bare PIDs are not ownership proof');
    }

    const record = {
      id,
      pid: child.pid,
      ppid: process.pid,
      role: metadata.role || 'general',
      port: metadata.port || null,
      binary: metadata.binary || '',
      command: metadata.command || '',
      model: metadata.model || '',
      metadata: { ...metadata },
      startedAt: new Date().toISOString(),
      processRef: child
    };

    this.activeProcesses.set(id, record);
    this._saveManifest();

    // Auto-unregister when process exits naturally
    if (child && typeof child.once === 'function') {
      child.once('exit', (code, signal) => {
        const current = this.activeProcesses.get(id);
        if (current && current.pid === child.pid) {
          this.activeProcesses.delete(id);
          this._saveManifest();
        }
      });
    }

    return record;
  }

  /**
   * Unregister process by ID
   */
  unregister(id) {
    if (this.activeProcesses.has(id)) {
      this.activeProcesses.delete(id);
      this._saveManifest();
    }
  }

  /**
   * Check if a PID is alive
   */
  isAlive(pid) {
    if (!pid || typeof pid !== 'number' || pid <= 0) return false;
    try {
      // Sending signal 0 tests whether the process exists and can receive signals
      process.kill(pid, 0);
      return true;
    } catch (e) {
      return e.code === 'EPERM'; // Exists but no permission to signal
    }
  }

  /**
   * Terminate a specific tracked process safely
   * 1. Attempts graceful shutdown (SIGTERM or taskkill without /F)
   * 2. Waits up to gracefulTimeoutMs
   * 3. Falls back to targeted PID-tree force termination
   */
  async terminate(id, options = {}) {
    const gracefulTimeoutMs = options.gracefulTimeoutMs !== undefined ? options.gracefulTimeoutMs : 2000;
    const record = this.activeProcesses.get(id);

    const procRef = record?.processRef;
    const targetPid = record?.pid;
    if (!record || !procRef || procRef.pid !== targetPid || typeof procRef.kill !== 'function' || typeof procRef.once !== 'function') {
      return { ok: false, terminated: false, ownershipVerified: false, message: 'Process ownership cannot be verified; persisted PIDs are never terminated.' };
    }

    if (!targetPid || procRef.exitCode != null || procRef.signalCode != null) {
      this.activeProcesses.delete(id);
      this._saveManifest();
      return { ok: true, terminated: false, message: 'Process was not running' };
    }

    // 1. Attempt graceful shutdown
    try { procRef.kill('SIGTERM'); } catch (_) {}

    // Wait for graceful exit
    const t0 = Date.now();
    while (Date.now() - t0 < gracefulTimeoutMs) {
      if (procRef.exitCode != null || procRef.signalCode != null) {
        this.activeProcesses.delete(id);
        this._saveManifest();
        return { ok: true, terminated: true, graceful: true, ownershipVerified: true };
      }
      await new Promise(r => setTimeout(r, 100));
    }

    // Force termination through the owned child handle; descendant jobs need a platform job object.
    if (procRef.exitCode == null && procRef.signalCode == null) {
      try { procRef.kill('SIGKILL'); } catch (_) {}
    }

    // Brief settling wait
    await new Promise(r => setTimeout(r, 200));

    const terminated = procRef.exitCode != null || procRef.signalCode != null;
    if (terminated) this.activeProcesses.delete(id);
    this._saveManifest();
    return { ok: terminated, terminated, graceful: false, ownershipVerified: true };
  }

  /**
   * Terminate all tracked processes belonging to this application
   */
  async cleanupAll(roleFilter = null) {
    const targets = Array.from(this.activeProcesses.entries())
      .filter(([_, rec]) => !roleFilter || rec.role === roleFilter);

    for (const [id, _] of targets) {
      try {
        await this.terminate(id, { gracefulTimeoutMs: 1000 });
      } catch (_) {}
    }

    this._saveManifest();
  }

  /**
   * Clean up stale or orphaned processes recorded from previous Abyx runs
   */
  async cleanupStaleProcesses() {
    const manifest = this._loadManifest();
    const unresolved = Object.values(manifest).filter(rec => rec && rec.pid && this.isAlive(rec.pid));
    if (unresolved.length) {
      console.warn(`  [process-manager] Found ${unresolved.length} prior process record(s); left untouched because PID identity cannot be verified safely.`);
    }
    return { examined: Object.keys(manifest).length, terminated: 0, unresolved: unresolved.length };
  }

  /**
   * Concurrency Lock for Model Operations
   */
  acquireModelLock() {
    if (this.modelLoadLock) return false;
    this.modelLoadLock = true;
    return true;
  }

  releaseModelLock() {
    this.modelLoadLock = false;
  }

  acquireLock(name = 'model_load') {
    return this.acquireModelLock();
  }

  releaseLock(name = 'model_load') {
    this.releaseModelLock();
  }

  registerProcess(id, childOrPid, metadata = {}) {
    let dummyChild = childOrPid;
    if (typeof childOrPid === 'number') {
      dummyChild = { pid: childOrPid };
    }
    return this.register(id, dummyChild, metadata);
  }

  getProcess(id) {
    return this.activeProcesses.get(id);
  }

  unregisterProcess(id) {
    return this.unregister(id);
  }

  /**
   * Pre-flight hardware capacity check before starting heavy workloads
   */
  checkSystemResources(requiredBytes = 0) {
    const freeRam = os.freemem();
    const totalRam = os.totalmem();

    let freeVramMb = null;
    let totalVramMb = null;

    if (process.platform === 'win32') {
      try {
        // Quick query via nvidia-smi if available
        const smi = spawnSync('nvidia-smi', ['--query-gpu=memory.free,memory.total', '--format=csv,noheader,nounits'], {
          encoding: 'utf8',
          windowsHide: true,
          timeout: 2000
        });
        if (smi.stdout) {
          const parts = smi.stdout.trim().split(',');
          if (parts.length >= 2) {
            freeVramMb = Number(parts[0].trim());
            totalVramMb = Number(parts[1].trim());
          }
        }
      } catch (_) {}
    }

    const freeRamMb = Math.round(freeRam / (1024 * 1024));
    const requiredMb = Math.round(requiredBytes / (1024 * 1024));

    const isSufficient = requiredBytes <= 0 || freeRam >= requiredBytes;

    return {
      sufficient: isSufficient,
      cpuThreads: os.cpus()?.length || 1,
      freeRamMb,
      totalRamMb: Math.round(totalRam / (1024 * 1024)),
      totalRamGb: Number((totalRam / (1024 * 1024 * 1024)).toFixed(1)),
      freeRamGb: Number((freeRam / (1024 * 1024 * 1024)).toFixed(1)),
      freeVramMb,
      totalVramMb,
      warning: !isSufficient ? `Low system memory: ${freeRamMb}MB available, ${requiredMb}MB recommended.` : null
    };
  }

  /**
   * Internal manifest persistence
   */
  _loadManifest() {
    try {
      if (fs.existsSync(this.manifestPath)) {
        return JSON.parse(fs.readFileSync(this.manifestPath, 'utf8'));
      }
    } catch (_) {}
    return {};
  }

  _saveManifest() {
    try {
      const data = {};
      for (const [id, rec] of this.activeProcesses.entries()) {
        data[id] = {
          id: rec.id,
          pid: rec.pid,
          ppid: rec.ppid,
          role: rec.role,
          port: rec.port,
          binary: rec.binary,
          model: rec.model,
          startedAt: rec.startedAt
        };
      }
      fs.writeFileSync(this.manifestPath, JSON.stringify(data, null, 2), 'utf8');
    } catch (_) {}
  }

  _attachExitHandlers() {
    const onExit = () => {
      if (this.isShuttingDown) return;
      this.isShuttingDown = true;
      for (const rec of this.activeProcesses.values()) {
        const child = rec.processRef;
        if (!child || child.pid !== rec.pid || typeof child.kill !== 'function' || child.exitCode != null || child.signalCode != null) continue;
        try { child.kill('SIGTERM'); } catch (_) {}
      }
    };

    process.once('exit', onExit);
    process.once('SIGINT', () => { onExit(); process.exit(0); });
    process.once('SIGTERM', () => { onExit(); process.exit(0); });
  }
}

// Singleton export
const processLifecycleManager = new ProcessLifecycleManager();
module.exports = processLifecycleManager;
module.exports.ProcessLifecycleManager = ProcessLifecycleManager;
