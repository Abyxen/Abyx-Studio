/**
 * ABYX Silent Subprocess Runner
 * Guarantees 0ms terminal window popup on Windows 11/10 (including Windows Terminal interception bypass).
 * Uses WScript.Shell.Run with SW_HIDE (0) on Windows to ensure CREATE_NO_WINDOW.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFile, spawn } = require('node:child_process');

function runSilentProcess(cmd, args = [], options = {}) {
  const timeoutMs = options.timeoutMs || 10000;
  const cwd = options.cwd || process.cwd();

  if (process.platform !== 'win32') {
    return new Promise((resolve) => {
      const child = spawn(cmd, args, {
        cwd,
        env: { ...process.env, ...options.env }
      });
      let stdout = '';
      let stderr = '';
      let killed = false;

      const timer = setTimeout(() => {
        killed = true;
        try { child.kill('SIGKILL'); } catch (_) {}
      }, timeoutMs);

      child.stdout?.on('data', d => { if (stdout.length < 100000) stdout += d.toString(); });
      child.stderr?.on('data', d => { if (stderr.length < 100000) stderr += d.toString(); });

      child.on('close', code => {
        clearTimeout(timer);
        resolve({
          ok: code === 0 && !killed,
          exitCode: code ?? (killed ? 137 : 0),
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          killed
        });
      });

      child.on('error', err => {
        clearTimeout(timer);
        resolve({
          ok: false,
          exitCode: 1,
          stdout: '',
          stderr: err.message,
          killed: false
        });
      });
    });
  }

  // Windows: WScript.Shell.Run with SW_HIDE (0) guarantees no terminal window or tab is opened
  return new Promise((resolve) => {
    const tempDir = os.tmpdir();
    const id = `_abyx_silent_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const batPath = path.join(tempDir, `${id}.bat`);
    const vbsPath = path.join(tempDir, `${id}.vbs`);
    const outPath = path.join(tempDir, `${id}.out`);
    const errPath = path.join(tempDir, `${id}.err`);

    // Build command line for batch runner
    const fullCmd = [cmd, ...args.map(a => `"${String(a).replace(/"/g, '""')}"`)].join(' ');
    const batContent = `@echo off\r\nchcp 65001 >nul\r\ncd /d "${cwd}"\r\n${fullCmd} > "${outPath}" 2> "${errPath}"\r\n`;

    const vbsContent = [
      'Set s = CreateObject("WScript.Shell")',
      `s.Run "cmd.exe /c """"${batPath}""""", 0, True`
    ].join('\r\n');

    try {
      fs.writeFileSync(batPath, batContent, 'utf8');
      fs.writeFileSync(vbsPath, vbsContent, 'utf8');
    } catch (e) {
      return resolve({ ok: false, exitCode: 1, stdout: '', stderr: e.message, killed: false });
    }

    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      cleanup();
      resolve({ ok: false, exitCode: 124, stdout: '', stderr: 'Execution timed out', killed: true });
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timer);
      try { if (fs.existsSync(batPath)) fs.unlinkSync(batPath); } catch (_) {}
      try { if (fs.existsSync(vbsPath)) fs.unlinkSync(vbsPath); } catch (_) {}
      try { if (fs.existsSync(outPath)) fs.unlinkSync(outPath); } catch (_) {}
      try { if (fs.existsSync(errPath)) fs.unlinkSync(errPath); } catch (_) {}
    }

    execFile('wscript.exe', ['//B', '//Nologo', vbsPath], { timeout: timeoutMs + 1000, windowsHide: true }, (err) => {
      clearTimeout(timer);
      let stdout = '';
      let stderr = '';
      try { if (fs.existsSync(outPath)) stdout = fs.readFileSync(outPath, 'utf8'); } catch (_) {}
      try { if (fs.existsSync(errPath)) stderr = fs.readFileSync(errPath, 'utf8'); } catch (_) {}
      cleanup();

      const exitCode = err ? (err.code || 1) : 0;
      resolve({
        ok: exitCode === 0 && !killed,
        exitCode,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        killed
      });
    });
  });
}

module.exports = {
  runSilentProcess
};
