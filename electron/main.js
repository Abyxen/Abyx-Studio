const { app, BrowserWindow, shell, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const net = require('net');
const http = require('http');
const { spawn, execSync } = require('child_process');

const ROOT = app.isPackaged
  ? process.resourcesPath
  : path.resolve(__dirname, '..');

let mainWindow = null;
let serverProcess = null;
let activePort = 1420;
let isQuitting = false;

function isWritableDir(dirPath) {
  try {
    const testFile = path.join(dirPath, `.abyx-write-test-${Date.now()}`);
    fs.writeFileSync(testFile, 'ok');
    fs.unlinkSync(testFile);
    return true;
  } catch {
    return false;
  }
}

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

async function resolvePort(startPort = 1420) {
  for (let p = startPort; p <= startPort + 79; p++) {
    if (await isPortAvailable(p)) return p;
  }
  return startPort;
}

function waitForHealth(port, timeoutMs = 30000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      const req = http.get(`http://127.0.0.1:${port}/api/health`, (res) => {
        res.resume();
        if (res.statusCode === 200) return resolve(true);
        retry();
      });
      req.on('error', retry);
      req.setTimeout(1000, () => {
        req.destroy();
        retry();
      });
    };
    const retry = () => {
      if (Date.now() - start > timeoutMs) {
        return reject(new Error('Timed out waiting for ABYX backend server.'));
      }
      setTimeout(poll, 250);
    };
    poll();
  });
}

function killServerTree() {
  if (!serverProcess || serverProcess.killed) return;
  const pid = serverProcess.pid;
  try {
    if (process.platform === 'win32' && pid) {
      execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore', windowsHide: true });
    } else {
      serverProcess.kill('SIGTERM');
    }
  } catch {
    try { serverProcess.kill('SIGKILL'); } catch {}
  }
  serverProcess = null;
}

function getUserAppDir() {
  const docsDir = app.getPath('documents');
  return path.join(docsDir, '.abyx', 'app');
}

function checkMissingDependencies() {
  const missing = [];
  const userAppDir = getUserAppDir();

  const nodeExeCandidates = [
    path.join(ROOT, 'app', 'tools', 'node-win', 'node.exe'),
    path.join(userAppDir, 'tools', 'node-win', 'node.exe')
  ];
  const distHtmlCandidates = [
    path.join(ROOT, 'app', 'dist', 'index.html'),
    path.join(userAppDir, 'dist', 'index.html')
  ];
  const serveCjsCandidates = [
    path.join(ROOT, 'scripts', 'server', 'serve.cjs'),
    path.join(userAppDir, 'scripts', 'server', 'serve.cjs')
  ];

  const llmBackends = [
    path.join(ROOT, 'app', 'llm-backend', 'win', 'cuda', 'llama-server.exe'),
    path.join(ROOT, 'app', 'llm-backend', 'win', 'hip', 'llama-server.exe'),
    path.join(ROOT, 'app', 'llm-backend', 'win', 'vulkan', 'llama-server.exe'),
    path.join(ROOT, 'app', 'llm-backend', 'win', 'sycl', 'llama-server.exe'),
    path.join(ROOT, 'app', 'llm-backend', 'win', 'cpu', 'llama-server.exe'),
    path.join(userAppDir, 'llm-backend', 'win', 'cuda', 'llama-server.exe'),
    path.join(userAppDir, 'llm-backend', 'win', 'hip', 'llama-server.exe'),
    path.join(userAppDir, 'llm-backend', 'win', 'vulkan', 'llama-server.exe'),
    path.join(userAppDir, 'llm-backend', 'win', 'sycl', 'llama-server.exe'),
    path.join(userAppDir, 'llm-backend', 'win', 'cpu', 'llama-server.exe')
  ];

  const hasLlmBackend = llmBackends.some(p => fs.existsSync(p));
  const hasSdBackend = fs.existsSync(path.join(ROOT, 'app', 'backend', 'win', 'cuda', 'sd-cuda.exe')) ||
                       fs.existsSync(path.join(ROOT, 'app', 'backend', 'win', 'vulkan', 'sd-vulkan.exe')) ||
                       fs.existsSync(path.join(ROOT, 'app', 'backend', 'win', 'cpu', 'sd-cpu.exe')) ||
                       fs.existsSync(path.join(userAppDir, 'backend', 'win', 'cuda', 'sd-cuda.exe')) ||
                       fs.existsSync(path.join(userAppDir, 'backend', 'win', 'vulkan', 'sd-vulkan.exe')) ||
                       fs.existsSync(path.join(userAppDir, 'backend', 'win', 'cpu', 'sd-cpu.exe'));

  const hasSpeechBackend = fs.existsSync(path.join(ROOT, 'app', 'speech-backend', 'win', 'cpu', 'whisper-cli.exe')) ||
                           fs.existsSync(path.join(userAppDir, 'speech-backend', 'win', 'cpu', 'whisper-cli.exe'));

  const hasTtsRuntime = fs.existsSync(path.join(ROOT, 'app', 'tts-runtime', 'node_modules', 'kokoro-js')) ||
                        fs.existsSync(path.join(userAppDir, 'tts-runtime', 'node_modules', 'kokoro-js'));

  if (!nodeExeCandidates.some(p => fs.existsSync(p))) missing.push('Portable Node.js runtime');
  if (!distHtmlCandidates.some(p => fs.existsSync(p))) missing.push('Frontend distribution build');
  if (!serveCjsCandidates.some(p => fs.existsSync(p))) missing.push('Server entrypoint script');
  if (!hasLlmBackend) missing.push('llama.cpp text inference backend');
  if (!hasSpeechBackend) missing.push('whisper.cpp speech backend');
  if (!hasTtsRuntime) missing.push('Kokoro text-to-speech runtime');
  if (!hasSdBackend) missing.push('stable-diffusion image backend');

  return missing;
}

async function runSetupScript(missingReasons) {
  const setupScript = path.join(ROOT, 'scripts', 'setup', 'setup.ps1');
  if (!fs.existsSync(setupScript)) {
    throw new Error(`Setup script not found at: ${setupScript}`);
  }

  const userAppDir = getUserAppDir();
  const targetAppDir = isWritableDir(ROOT) ? path.join(ROOT, 'app') : userAppDir;

  console.log(`[abyx-electron] Missing dependencies detected: ${missingReasons.join(', ')}. Launching autonomous background setup into ${targetAppDir}...`);

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.executeJavaScript(`
      const p = document.querySelector('p');
      if (p) p.innerText = 'Downloading and installing AI components in background... please wait.';
    `).catch(() => {});
  }

  return new Promise((resolve, reject) => {
    const ps = spawn('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-WindowStyle', 'Hidden',
      '-ExecutionPolicy', 'Bypass',
      '-Command',
      `& '${setupScript}' -Autonomous -TargetAppDir '${targetAppDir}'; exit $LASTEXITCODE`
    ], {
      cwd: ROOT,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdoutData = '';
    let stderrData = '';
    if (ps.stdout) ps.stdout.on('data', d => { stdoutData += d.toString(); });
    if (ps.stderr) ps.stderr.on('data', d => { stderrData += d.toString(); });

    ps.on('close', (code) => {
      const stillMissing = checkMissingDependencies();
      if (stillMissing.length > 0) {
        const errorDetails = stderrData.trim() || stdoutData.trim();
        reject(new Error(`Setup exited with code ${code}. Still missing: ${stillMissing.join(', ')}${errorDetails ? `\nDetails: ${errorDetails.slice(-300)}` : ''}`));
      } else {
        resolve();
      }
    });

    ps.on('error', (err) => {
      reject(err);
    });
  });
}

async function startBackendServer() {
  const userAppDir = getUserAppDir();
  let nodeExe = path.join(ROOT, 'app', 'tools', 'node-win', 'node.exe');
  if (!fs.existsSync(nodeExe)) {
    nodeExe = path.join(userAppDir, 'tools', 'node-win', 'node.exe');
  }
  const serveCjs = path.join(ROOT, 'scripts', 'server', 'serve.cjs');

  if (!fs.existsSync(nodeExe)) {
    throw new Error(`Bundled Node.js runtime missing at: ${nodeExe}`);
  }
  if (!fs.existsSync(serveCjs)) {
    throw new Error(`Server entrypoint missing at: ${serveCjs}`);
  }

  activePort = await resolvePort(1420);

  const docsDir = app.getPath('documents');
  const docsAbyx = path.join(docsDir, '.abyx');
  const dataDir = path.join(docsAbyx, 'data');
  const workspaceDir = path.join(docsAbyx, 'workspace');
  const outputsDir = path.join(docsAbyx, 'outputs');
  const ttsOutputsDir = path.join(docsAbyx, 'tts-outputs');
  const videoOutputsDir = path.join(docsAbyx, 'video-outputs');

  [docsAbyx, dataDir, workspaceDir, outputsDir, ttsOutputsDir, videoOutputsDir].forEach((d) => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });

  const env = {
    ...process.env,
    FRONTEND_PORT: String(activePort),
    PORT: String(activePort),
    ABYX_DATA_DIR: dataDir,
    ABYX_WORKSPACE_DIR: workspaceDir,
    ABYX_OUTPUTS_DIR: outputsDir,
    ABYX_TTS_OUTPUTS_DIR: ttsOutputsDir,
    ABYX_VIDEO_OUTPUTS_DIR: videoOutputsDir,
    ELECTRON_APP: '1'
  };

  serverProcess = spawn(nodeExe, ['--experimental-sqlite', serveCjs], {
    cwd: ROOT,
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  serverProcess.stdout.on('data', (d) => {
    process.stdout.write(`[abyx-server] ${d}`);
  });
  serverProcess.stderr.on('data', (d) => {
    process.stderr.write(`[abyx-server:err] ${d}`);
  });
  serverProcess.on('exit', (code) => {
    if (!isQuitting && code !== 0) {
      console.error(`[abyx-electron] Backend exited unexpectedly with code ${code}`);
    }
  });

  await waitForHealth(activePort, 30000);
}

function createWindow() {
  const iconPath = path.join(ROOT, 'abyx.ico');

  mainWindow = new BrowserWindow({
    width: 1520,
    height: 940,
    minWidth: 1080,
    minHeight: 700,
    title: 'ABYX Unified AI Studio',
    backgroundColor: '#0c0d12',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(`http://127.0.0.1:${activePort}`) || url.startsWith(`http://localhost:${activePort}`)) {
      return { action: 'allow' };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.loadFile(path.join(__dirname, 'loading.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    createWindow();
    try {
      const missing = checkMissingDependencies();
      if (missing.length > 0) {
        console.log(`[abyx-electron] Missing portable dependencies: ${missing.join(', ')}`);
        await runSetupScript(missing);
      }
      await startBackendServer();
      if (mainWindow && !mainWindow.isDestroyed()) {
        await mainWindow.loadURL(`http://127.0.0.1:${activePort}`);
      }
    } catch (err) {
      dialog.showErrorBox('ABYX Startup Error', err.message || String(err));
      app.quit();
    }
  });

  app.on('before-quit', () => {
    isQuitting = true;
    killServerTree();
  });

  app.on('window-all-closed', () => {
    isQuitting = true;
    killServerTree();
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}
