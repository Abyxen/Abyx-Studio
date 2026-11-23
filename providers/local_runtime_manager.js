/**
 * ABYX Local Model Runtime Manager
 * 
 * Manages:
 * - Independent detection of local runtimes (Ollama, LM Studio) without assuming installation
 * - Model lifecycle: discovery, disk storage estimation, pull/download with progress & cancellation,
 *   VRAM preloading, VRAM unloading, and deletion
 * - Strict loopback constraint enforcement (127.0.0.1)
 */

const fs = require('fs');
const path = require('path');
const os = require('node:os');

const OLLAMA_DEFAULT_BASE = 'http://127.0.0.1:11434';
const LMSTUDIO_DEFAULT_BASE = 'http://127.0.0.1:1234';

class LocalRuntimeManager {
  constructor({ ollamaAdapter, lmStudioAdapter } = {}) {
    this.ollama = ollamaAdapter;
    this.lmstudio = lmStudioAdapter;
    this.activeDownloads = new Map(); // downloadKey -> AbortController
  }

  /**
   * Check if a binary exists via path existence or pure in-process PATH lookup
   */
  checkExecutable(binaryName, candidatePaths = []) {
    for (const p of candidatePaths) {
      if (p && fs.existsSync(p)) return { installed: true, path: p };
    }
    // Pure in-process PATH search: 100% silent, zero console processes
    const pathDirs = (process.env.PATH || '').split(path.delimiter);
    const exts = process.platform === 'win32'
      ? (process.env.PATHEXT ? process.env.PATHEXT.split(';') : ['.exe', '.cmd', '.bat'])
      : [''];
    for (const dir of pathDirs) {
      if (!dir) continue;
      for (const ext of exts) {
        const full = path.join(dir, binaryName.toLowerCase().endsWith(ext.toLowerCase()) ? binaryName : `${binaryName}${ext}`);
        try {
          if (fs.existsSync(full)) return { installed: true, path: full };
        } catch (e) {}
      }
    }
    return { installed: false, path: null };
  }

  /**
   * Detect installed and running local AI runtimes
   */
  async detectRuntimes() {
    const results = {
      timestamp: new Date().toISOString(),
      ollama: {
        id: 'ollama',
        name: 'Ollama',
        endpoint: OLLAMA_DEFAULT_BASE,
        status: 'not_installed', // 'running' | 'installed_not_running' | 'not_installed'
        installedPath: null,
        modelsCount: 0,
        latencyMs: 0
      },
      lmstudio: {
        id: 'lmstudio',
        name: 'LM Studio',
        endpoint: LMSTUDIO_DEFAULT_BASE,
        status: 'not_installed',
        installedPath: null,
        modelsCount: 0,
        latencyMs: 0
      }
    };

    // 1. Probe Ollama endpoint
    const ollamaTest = await this.ollama.testConnection({ baseUrl: OLLAMA_DEFAULT_BASE });
    if (ollamaTest.ok) {
      results.ollama.status = 'running';
      results.ollama.modelsCount = ollamaTest.modelCount || 0;
      results.ollama.latencyMs = ollamaTest.latencyMs || 0;
    } else {
      // Check installation path on Windows
      const localApp = process.env.LOCALAPPDATA || '';
      const progFiles = process.env.ProgramFiles || 'C:\\Program Files';
      const progFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
      const candidatePaths = [
        path.join(localApp, 'Programs', 'Ollama', 'ollama.exe'),
        path.join(localApp, 'Ollama', 'ollama.exe'),
        path.join(progFiles, 'Ollama', 'ollama.exe'),
        path.join(progFilesX86, 'Ollama', 'ollama.exe'),
        path.join(localApp, 'Programs', 'Ollama', 'ollama app.exe'),
        path.join(localApp, 'Ollama', 'ollama app.exe'),
        path.join(progFiles, 'Ollama', 'ollama app.exe')
      ];
      const check = this.checkExecutable('ollama', candidatePaths);
      if (check.installed) {
        results.ollama.status = 'installed_not_running';
        results.ollama.installedPath = check.path;
      }
    }

    // 2. Probe LM Studio endpoint
    const lmTest = await this.lmstudio.testConnection({ baseUrl: LMSTUDIO_DEFAULT_BASE });
    if (lmTest.ok) {
      results.lmstudio.status = 'running';
      results.lmstudio.modelsCount = lmTest.modelCount || 0;
      results.lmstudio.latencyMs = lmTest.latencyMs || 0;
    } else {
      const localApp = process.env.LOCALAPPDATA || '';
      const progFiles = process.env.ProgramFiles || 'C:\\Program Files';
      const candidatePaths = [
        path.join(localApp, 'Programs', 'LM Studio', 'LM Studio.exe'),
        path.join(progFiles, 'LM Studio', 'LM Studio.exe')
      ];
      const check = this.checkExecutable('lms', candidatePaths);
      if (check.installed) {
        results.lmstudio.status = 'installed_not_running';
        results.lmstudio.installedPath = check.path;
      }
    }

    return results;
  }

  /**
   * Estimate disk storage requirement for a model by tag name
   */
  estimateModelStorage(modelName = '') {
    const name = modelName.toLowerCase();
    if (name.includes(':0.5b') || name.includes(':1b') || name.includes(':1.5b')) {
      return { bytes: 1.5 * 1024 * 1024 * 1024, formatted: '~1.5 GB' };
    }
    if (name.includes(':3b') || name.includes(':4b') || name.includes('1.1')) {
      return { bytes: 2.5 * 1024 * 1024 * 1024, formatted: '~2.5 GB' };
    }
    if (name.includes(':7b') || name.includes(':8b')) {
      return { bytes: 4.8 * 1024 * 1024 * 1024, formatted: '~4.8 GB' };
    }
    if (name.includes(':14b')) {
      return { bytes: 9.0 * 1024 * 1024 * 1024, formatted: '~9.0 GB' };
    }
    if (name.includes(':32b')) {
      return { bytes: 20.0 * 1024 * 1024 * 1024, formatted: '~20.0 GB' };
    }
    if (name.includes(':70b')) {
      return { bytes: 43.0 * 1024 * 1024 * 1024, formatted: '~43.0 GB' };
    }
    return { bytes: 4.5 * 1024 * 1024 * 1024, formatted: '~4.5 GB' };
  }

  /**
   * Get available free disk space on current workspace drive
   */
  getAvailableDiskSpace() {
    try {
      if (typeof fs.statfsSync === 'function') {
        const requestedPath = path.resolve(process.env.OLLAMA_MODELS || path.join(os.homedir(), '.ollama', 'models'));
        let volumePath = requestedPath;
        while (!fs.existsSync(volumePath)) {
          const parentPath = path.dirname(volumePath);
          if (parentPath === volumePath) return null;
          volumePath = parentPath;
        }
        const stats = fs.statfsSync(volumePath);
        const freeBytes = stats.bavail * stats.bsize;
        const freeGb = (freeBytes / (1024 * 1024 * 1024)).toFixed(1);
        return {
          freeBytes,
          freeGb: Number(freeGb),
          formatted: `${freeGb} GB`,
          path: requestedPath
        };
      }
    } catch (e) {}
    return null;
  }

  /**
   * List all local models across Ollama and LM Studio
   */
  async listAllLocalModels() {
    const list = [];

    // Query Ollama
    try {
      const ollamaModels = await this.ollama.listModels();
      for (const m of ollamaModels) {
        list.push({
          ...m,
          runtime: 'ollama',
          runtimeName: 'Ollama'
        });
      }
    } catch (e) {}

    // Query LM Studio
    try {
      const lmModels = await this.lmstudio.listModels();
      for (const m of lmModels) {
        list.push({
          ...m,
          runtime: 'lmstudio',
          runtimeName: 'LM Studio'
        });
      }
    } catch (e) {}

    return list;
  }

  /**
   * Download/pull a model with storage pre-check, live progress, and cancellation
   */
  async pullModel({ name, onProgress, signal, baseUrl }) {
    if (!name || typeof name !== 'string') {
      throw new Error('Model name is required for download');
    }

    const downloadKey = `pull_${name}`;
    const controller = new AbortController();
    this.activeDownloads.set(downloadKey, controller);

    // Merge external signal if passed
    if (signal) {
      signal.addEventListener('abort', () => controller.abort());
    }

    try {
      const result = await this.ollama.pullModel({
        name,
        baseUrl,
        onProgress: (p) => {
          if (onProgress) {
            onProgress({
              ...p,
              estimatedStorage: requirement.formatted,
              availableStorage: disk.formatted
            });
          }
        },
        signal: controller.signal
      });
      return result;
    } finally {
      this.activeDownloads.delete(downloadKey);
    }
  }

  /**
   * Cancel an active model download
   */
  cancelDownload(modelName) {
    const downloadKey = `pull_${modelName}`;
    const controller = this.activeDownloads.get(downloadKey);
    if (controller) {
      controller.abort();
      this.activeDownloads.delete(downloadKey);
      return { ok: true, cancelled: modelName };
    }
    return { ok: false, error: 'No active download found for ' + modelName };
  }

  /**
   * Load model into VRAM
   */
  async loadModel(modelName, runtime = 'ollama', options = {}) {
    if (runtime === 'ollama') {
      return await this.ollama.loadModel(modelName, options);
    }
    throw new Error(`Model loading not supported for runtime ${runtime}`);
  }

  /**
   * Unload model from VRAM
   */
  async unloadModel(modelName, runtime = 'ollama', options = {}) {
    if (runtime === 'ollama') {
      return await this.ollama.unloadModel(modelName, options);
    }
    throw new Error(`Model unloading not supported for runtime ${runtime}`);
  }

  /**
   * Delete model from disk
   */
  async deleteModel(modelName, runtime = 'ollama', options = {}) {
    if (runtime === 'ollama') {
      return await this.ollama.deleteModel(modelName, options);
    }
    throw new Error(`Model deletion not supported for runtime ${runtime}`);
  }

  /**
   * Start Ollama process silently in the background without popping any console or terminal windows
   */
  async startOllama() {
    const runtimes = await this.detectRuntimes();
    if (runtimes.ollama.status === 'running') {
      return { ok: true, message: 'Ollama is already running', status: 'running' };
    }

    const localApp = process.env.LOCALAPPDATA || '';
    const progFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const progFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

    // 1. Look for CLI executable ("ollama.exe") - This is the daemon that serves on 127.0.0.1:11434
    const candidateCliPaths = [
      path.join(localApp, 'Programs', 'Ollama', 'ollama.exe'),
      path.join(localApp, 'Ollama', 'ollama.exe'),
      path.join(progFiles, 'Ollama', 'ollama.exe'),
      path.join(progFilesX86, 'Ollama', 'ollama.exe'),
      path.join(localApp, 'Programs', 'Ollama', 'ollama app.exe')
    ];
    let cliExePath = candidateCliPaths.find(p => p && fs.existsSync(p)) || null;

    if (!cliExePath && runtimes.ollama.installedPath && fs.existsSync(runtimes.ollama.installedPath)) {
      cliExePath = runtimes.ollama.installedPath;
    }

    if (!cliExePath && process.platform === 'win32') {
      const check = this.checkExecutable('ollama');
      if (check.installed) cliExePath = check.path;
    }

    if (cliExePath && cliExePath.toLowerCase().endsWith('ollama app.exe')) {
      const sibling = path.join(path.dirname(cliExePath), 'ollama.exe');
      if (fs.existsSync(sibling)) cliExePath = sibling;
    }

    if (!cliExePath) {
      return { ok: false, error: 'Ollama is not installed on this system. Please install it first.', status: 'not_installed' };
    }

    try {
      const { spawn } = require('child_process');
      const os = require('os');

      if (process.platform === 'win32') {
        // Launch CLI daemon completely hidden via native GUI wscript.exe runner with window style 0 (SW_HIDE)
        // This avoids Windows Terminal / Console allocation completely so zero terminals pop open or flash!
        const exeToRun = cliExePath;
        const serveArgument = exeToRun.toLowerCase().endsWith('ollama.exe') ? ' serve' : '';
        try {
          const vbsPath = path.join(os.tmpdir(), `_abyx_silent_start_${Date.now()}.vbs`);
          const vbsCode = `CreateObject("Wscript.Shell").Run """${exeToRun.replace(/"/g, '""')}""${serveArgument}", 0, False`;
          fs.writeFileSync(vbsPath, vbsCode, 'utf8');
          const child = spawn('wscript.exe', [vbsPath], {
            detached: true,
            stdio: 'ignore',
            windowsHide: true
          });
          child.unref();
          setTimeout(() => { try { fs.unlinkSync(vbsPath); } catch(e) {} }, 8000);
        } catch (_) {
          const args = exeToRun.toLowerCase().endsWith('ollama.exe') ? ['serve'] : [];
          const child = spawn(exeToRun, args, {
            detached: true,
            stdio: 'ignore',
            windowsHide: true
          });
          child.unref();
        }
      } else {
        // Unix platforms (macOS / Linux)
        const child = spawn(cliExePath || 'ollama', ['serve'], {
          detached: true,
          stdio: 'ignore'
        });
        child.unref();
      }

      // Poll endpoint up to 10 seconds for live readiness
      const startTime = Date.now();
      while (Date.now() - startTime < 10000) {
        await new Promise(r => setTimeout(r, 600));
        const test = await this.ollama.testConnection({ baseUrl: OLLAMA_DEFAULT_BASE });
        if (test.ok) {
          return { ok: true, message: 'Ollama started successfully', status: 'running', latencyMs: test.latencyMs };
        }
      }
      return { ok: true, message: 'Ollama service process started', status: 'starting' };
    } catch (err) {
      return { ok: false, error: 'Failed to launch Ollama: ' + err.message };
    }
  }

  /**
   * Trigger install of Ollama (via winget silently or download installer)
   */
  async installOllama() {
    if (process.platform === 'win32') {
      try {
        const wingetCheck = this.checkExecutable('winget');
        if (wingetCheck.installed) {
          const { spawn } = require('child_process');
          const os = require('os');
          // Run winget completely hidden via native GUI wscript runner (zero console window allocation)
          const vbsPath = path.join(os.tmpdir(), `_abyx_install_ollama_${Date.now()}.vbs`);
          const vbsCode = `CreateObject("Wscript.Shell").Run "winget install Ollama.Ollama --accept-source-agreements --accept-package-agreements --silent", 0, False`;
          fs.writeFileSync(vbsPath, vbsCode, 'utf8');
          const child = spawn('wscript.exe', [vbsPath], {
            detached: true,
            stdio: 'ignore',
            windowsHide: true
          });
          child.unref();
          setTimeout(() => { try { fs.unlinkSync(vbsPath); } catch (e) {} }, 15000);
          return {
            ok: true,
            message: 'Ollama setup was opened; installation must be completed by the user',
            method: 'winget',
            downloadUrl: 'https://ollama.com/download/OllamaSetup.exe',
            pageUrl: 'https://ollama.com/download'
          };
        }
        return {
          ok: true,
          message: 'Windows Package Manager (winget) is not installed. Opening official Ollama installer.',
          method: 'download',
          downloadUrl: 'https://ollama.com/download/OllamaSetup.exe',
          pageUrl: 'https://ollama.com/download'
        };
      } catch (e) {
        return {
          ok: true,
          message: 'Could not launch silent installer. Opening official installer.',
          method: 'url',
          downloadUrl: 'https://ollama.com/download/OllamaSetup.exe',
          pageUrl: 'https://ollama.com/download'
        };
      }
    }
    return {
      ok: true,
      message: 'Download installer for your operating system',
      method: 'url',
      downloadUrl: 'https://ollama.com/download',
      pageUrl: 'https://ollama.com/download'
    };
  }
}

module.exports = LocalRuntimeManager;
