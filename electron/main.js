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

async function startBackendServer() {
  const nodeExe = path.join(ROOT, 'app', 'tools', 'node-win', 'node.exe');
  const serveCjs = path.join(ROOT, 'scripts', 'server', 'serve.cjs');

  if (!fs.existsSync(nodeExe)) {
    throw new Error(`Bundled Node.js runtime missing at: ${nodeExe}`);
  }
  if (!fs.existsSync(serveCjs)) {
    throw new Error(`Server entrypoint missing at: ${serveCjs}`);
  }

  activePort = await resolvePort(1420);

  const rootWritable = isWritableDir(ROOT);
  const dataDir = rootWritable
    ? path.join(ROOT, 'app', 'data')
    : path.join(app.getPath('userData'), 'data');
  const workspaceDir = rootWritable
    ? path.join(ROOT, 'app', 'workspace')
    : path.join(app.getPath('documents'), 'ABYX Workspace');

  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(workspaceDir)) fs.mkdirSync(workspaceDir, { recursive: true });

  const env = {
    ...process.env,
    FRONTEND_PORT: String(activePort),
    PORT: String(activePort),
    ABYX_DATA_DIR: dataDir,
    ABYX_WORKSPACE_DIR: workspaceDir,
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
