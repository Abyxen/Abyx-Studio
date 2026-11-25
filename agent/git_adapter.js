'use strict';

const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const runFile = promisify(execFile);

class GitAdapter {
  constructor(pathGuard, options = {}) {
    this.pathGuard = pathGuard;
    this.timeoutMs = options.timeoutMs || 10000;
    this.maxOutputBytes = options.maxOutputBytes || 128 * 1024;
  }

  async run(args, { cwd = '.', signal } = {}) {
    if (!Array.isArray(args) || args.some(arg => typeof arg !== 'string' || arg.includes('\0'))) throw new TypeError('Git arguments must be strings');
    const safeCwd = this.pathGuard.resolveSafePath(cwd);
    const { stdout, stderr } = await runFile('git', ['-c', 'core.fsmonitor=false', '-c', 'diff.external=', '-c', 'diff.mnemonicPrefix=false', ...args], {
      cwd: safeCwd, shell: false, windowsHide: true, timeout: this.timeoutMs, signal,
      maxBuffer: this.maxOutputBytes, env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' }
    });
    return { stdout: stdout.slice(0, this.maxOutputBytes), stderr: stderr.slice(0, this.maxOutputBytes) };
  }

  async status(options = {}) { return (await this.run(['status', '--porcelain=v1', '--branch', '--untracked-files=normal'], options)).stdout; }
  async diff(options = {}) { return (await this.run(['-c', 'core.quotePath=true', 'diff', '--no-ext-diff', '--no-textconv', '--', '.'], options)).stdout; }
  async log(options = {}) { return (await this.run(['log', '-10', '--oneline', '--decorate=short'], options)).stdout; }
  async branch(options = {}) { return (await this.run(['branch', '--show-current'], options)).stdout.trim(); }
}

module.exports = GitAdapter;
