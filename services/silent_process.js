'use strict';

const { spawn, spawnSync } = require('node:child_process');

function runSilentProcess(command, args = [], options = {}) {
  if (typeof command !== 'string' || !command || !Array.isArray(args) || args.some(arg => typeof arg !== 'string')) {
    return Promise.resolve({ ok: false, exitCode: 1, stdout: '', stderr: 'Invalid process arguments', killed: false });
  }
  const timeoutMs = Math.min(Math.max(Number(options.timeoutMs) || 10000, 1), 10 * 60 * 1000);
  const outputLimit = Math.min(Math.max(Number(options.maxOutputBytes) || 100000, 1024), 2 * 1024 * 1024);
  if (options.signal?.aborted) return Promise.resolve({ ok: false, exitCode: 130, stdout: '', stderr: 'Execution cancelled', killed: true });

  return new Promise(resolve => {
    const child = spawn(command, args, {
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...(options.env || {}) },
      shell: false,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    let killed = false;
    let timedOut = false;
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
    const onAbort = () => { killed = true; killTree(); };
    const timer = setTimeout(() => { timedOut = true; killed = true; killTree(); }, timeoutMs);
    options.signal?.addEventListener('abort', onAbort, { once: true });
    if (options.signal?.aborted) onAbort();
    const collect = (target, chunk) => {
      const text = chunk.toString('utf8');
      receivedOutputBytes += chunk.length;
      if (target === 'stdout') stdout = (stdout + text).slice(-outputLimit);
      else stderr = (stderr + text).slice(-outputLimit);
      if (receivedOutputBytes > outputLimit * 2 && !killed) { killed = true; killTree(); }
    };
    child.stdout.on('data', chunk => collect('stdout', chunk));
    child.stderr.on('data', chunk => collect('stderr', chunk));
    child.once('error', error => finish(null, error));
    child.once('close', code => finish(code, null));

    function finish(code, error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      resolve({
        ok: !error && code === 0 && !killed,
        exitCode: code ?? (timedOut ? 124 : killed ? 130 : 1),
        stdout: stdout.trim(),
        stderr: error ? 'Process could not be started' : stderr.trim(),
        killed,
        timedOut
      });
    }
  });
}

module.exports = { runSilentProcess };
