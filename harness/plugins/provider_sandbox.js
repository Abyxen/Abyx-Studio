/**
 * DSH Plugin: Subprocess Sandbox Provider
 * Executes code snippets with hard watchdog timers and stdout/stderr capture.
 */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { SEAMS } = require('../seams');
const { workspaceDir } = require('../../data_paths');
const workspaceService = require('../../services/workspace_service');
const { runSilentProcess } = require('../../services/silent_process');

const SandboxPlugin = {
  name: 'dsh-provider-sandbox',
  version: '1.2.0',
  category: 'Execution',
  description: 'Subprocess code execution sandbox for Python and Node.js with watchdog termination.',

  apply(ctx) {
    const sandboxService = {
      async runCode({ language = 'python', code = '', timeoutMs = 6000 }) {
        if (!code.trim()) {
          return { ok: false, error: 'Empty code string provided' };
        }

        const lang = language.toLowerCase();
        const t0 = Date.now();
        const sandboxDir = workspaceService.getActiveWorkspace()?.path || workspaceDir;
        if (!fs.existsSync(sandboxDir) || !fs.statSync(sandboxDir).isDirectory()) return { ok: false, error: 'The active project folder is unavailable' };

        // 1. JavaScript / Node.js in-process execution (0ms startup, 0 child processes, 0 window popups)
        if (lang === 'javascript' || lang === 'js' || lang === 'node') {
          const logs = [];
          const errs = [];
          const sandbox = {
            console: {
              log: (...args) => logs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')),
              error: (...args) => errs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')),
              warn: (...args) => logs.push('[WARN] ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '))
            },
            Math, Number, BigInt, String, Array, Object, Date, Intl, RegExp, JSON,
            parseInt, parseFloat, isFinite, isNaN, setTimeout: undefined, setInterval: undefined
          };

          try {
            const wrapped = `
              let __result;
              try {
                __result = (${code});
              } catch(__e) {
                ${code}
                __result = typeof result !== 'undefined' ? result : (typeof output !== 'undefined' ? output : undefined);
              }
              __result;
            `;
            const result = vm.runInNewContext(wrapped, sandbox, { timeout: timeoutMs });
            const dur = Date.now() - t0;
            const combinedOut = logs.length ? logs.join('\n') : (result !== undefined ? String(result) : '');
            return {
              ok: true,
              success: true,
              exitCode: 0,
              stdout: combinedOut,
              stderr: errs.join('\n'),
              duration_ms: dur,
              killed: false
            };
          } catch (jsErr) {
            return {
              ok: false,
              success: false,
              exitCode: 1,
              stdout: logs.join('\n'),
              stderr: jsErr.message,
              duration_ms: Date.now() - t0,
              killed: false
            };
          }
        }

        // 2. Python execution via Silent Runner (Zero terminal flash, zero Windows Terminal popup)
        if (lang === 'python' || lang === 'py') {
          const tempFile = path.join(sandboxDir, `_dsh_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.py`);
          fs.writeFileSync(tempFile, code, 'utf8');

          try {
            const res = await runSilentProcess('python', [tempFile], { cwd: sandboxDir, timeoutMs });
            try { if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile); } catch (_) {}
            const dur = Date.now() - t0;
            return {
              ok: res.ok,
              success: res.ok,
              exitCode: res.exitCode,
              stdout: res.stdout,
              stderr: res.stderr,
              duration_ms: dur,
              killed: !!res.killed
            };
          } catch (pyErr) {
            try { if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile); } catch (_) {}
            return {
              ok: false,
              success: false,
              exitCode: 1,
              stdout: '',
              stderr: pyErr.message,
              duration_ms: Date.now() - t0,
              killed: false
            };
          }
        }

        return { ok: false, error: `Unsupported language: ${language}` };
      }
    };

    SEAMS.SANDBOX.validateProvider(sandboxService);
    ctx.provide('sandbox', sandboxService);
  }
};

module.exports = SandboxPlugin;
