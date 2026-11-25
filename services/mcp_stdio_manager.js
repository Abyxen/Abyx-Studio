'use strict';

const { EventEmitter } = require('node:events');
const { spawn, spawnSync } = require('node:child_process');
const { validateSchemaDefinition } = require('../agent/tool_registry');

const MAX_FRAME_BYTES = 1024 * 1024;
const SAFE_ENV_KEYS = new Set(['PATH', 'Path', 'PATHEXT', 'SYSTEMROOT', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'HOME', 'LANG', 'LC_ALL']);

class McpStdioManager extends EventEmitter {
  constructor({ spawnProcess = spawn, requestTimeoutMs = 15000, maxFrameBytes = MAX_FRAME_BYTES } = {}) {
    super();
    this.spawnProcess = spawnProcess;
    this.requestTimeoutMs = requestTimeoutMs;
    this.maxFrameBytes = maxFrameBytes;
    this.servers = new Map();
    this.nextRequestId = 1;
  }

  async connect(serverId, config, { signal } = {}) {
    if (!/^[a-z0-9_-]{2,64}$/.test(serverId)) throw new Error('Invalid MCP server id');
    if (config?.transport !== 'stdio') throw new Error('Only explicitly configured MCP stdio servers are supported');
    if (config.executionApproved !== true) throw new Error('Explicit approval is required before starting an MCP server process');
    if (typeof config.command !== 'string' || !config.command.trim() || config.command.length > 1024) throw new Error('MCP server command is invalid');
    const args = config.args || [];
    if (!Array.isArray(args) || args.length > 128 || args.some(arg => typeof arg !== 'string' || arg.length > 4096 || /[\0\r\n]/.test(arg))) throw new Error('MCP server arguments are invalid');
    await this.disconnect(serverId);

    const env = {};
    for (const key of SAFE_ENV_KEYS) if (process.env[key]) env[key] = process.env[key];
    for (const [key, value] of Object.entries(config.resolvedSecretEnv || {})) {
      if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(key) || typeof value !== 'string' || value.length > 16384) throw new Error('MCP secret environment reference resolved to an invalid value');
      env[key] = value;
    }
    const child = this.spawnProcess(config.command, args, { cwd: process.cwd(), env, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const state = { serverId, child, status: 'connecting', buffer: '', pending: new Map(), tools: [], nextId: 1, error: null };
    this.servers.set(serverId, state);
    child.stdout.on('data', chunk => this.onData(state, chunk));
    child.stderr.on('data', chunk => {
      state.stderrBytes = (state.stderrBytes || 0) + chunk.length;
      if (state.stderrBytes > 64 * 1024) this.disconnect(serverId).catch(() => {});
    });
    child.once('error', error => this.fail(state, error));
    child.once('exit', (code, exitSignal) => this.fail(state, new Error(`MCP server exited (${code ?? exitSignal ?? 'unknown'})`)));

    try {
      await this.request(state, 'initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'Abyx', version: '1.0.0' }
      }, { signal });
      this.notify(state, 'notifications/initialized', {});
      const response = await this.request(state, 'tools/list', {}, { signal });
      const tools = response?.tools;
      if (!Array.isArray(tools) || tools.length > 512) throw new Error('MCP server returned an invalid tool list');
      const names = new Set();
      state.tools = tools.map(tool => {
        if (!tool || typeof tool.name !== 'string' || !/^[a-zA-Z0-9._-]{1,128}$/.test(tool.name) || names.has(tool.name)) throw new Error('MCP server returned an invalid or duplicate tool name');
        names.add(tool.name);
        const inputSchema = tool.inputSchema || { type: 'object', properties: {} };
        if (inputSchema.type !== 'object') throw new Error(`MCP tool ${tool.name} input schema must describe an object`);
        validateSchemaDefinition(inputSchema, `MCP tool ${tool.name} inputSchema`);
        return { name: tool.name, description: String(tool.description || '').slice(0, 2000), inputSchema };
      });
      state.status = 'connected';
      this.emit('status', { serverId, status: state.status, toolCount: state.tools.length });
      return { serverId, status: state.status, tools: state.tools };
    } catch (error) {
      state.error = String(error?.message || 'MCP connection failed').slice(0, 300);
      await this.disconnect(serverId);
      throw new Error(`MCP server connection failed: ${state.error}`);
    }
  }

  onData(state, chunk) {
    state.buffer += chunk.toString('utf8');
    if (Buffer.byteLength(state.buffer) > this.maxFrameBytes) {
      this.fail(state, new Error('MCP server response exceeded the frame limit'));
      this.disconnect(state.serverId).catch(() => {});
      return;
    }
    let newline;
    while ((newline = state.buffer.indexOf('\n')) !== -1) {
      const line = state.buffer.slice(0, newline).trim();
      state.buffer = state.buffer.slice(newline + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); }
      catch { this.fail(state, new Error('MCP server sent malformed JSON-RPC')); continue; }
      if (message.id !== undefined && state.pending.has(message.id)) {
        const pending = state.pending.get(message.id);
        state.pending.delete(message.id);
        clearTimeout(pending.timer);
        pending.signal?.removeEventListener('abort', pending.abort);
        if (message.error) pending.reject(new Error(String(message.error.message || 'MCP request failed').slice(0, 300)));
        else pending.resolve(message.result);
      }
    }
  }

  request(state, method, params, { signal, timeoutMs = this.requestTimeoutMs } = {}) {
    if (state.status === 'closed' || state.child.killed || state.child.exitCode !== null) return Promise.reject(new Error('MCP server is not running'));
    if (signal?.aborted) return Promise.reject(signal.reason || new Error('MCP request cancelled'));
    if (state.pending.size >= 32) return Promise.reject(new Error('MCP server request concurrency limit reached'));
    timeoutMs = Math.min(Math.max(Number(timeoutMs) || this.requestTimeoutMs, 100), 120000);
    const id = state.nextId++;
    return new Promise((resolve, reject) => {
      const pending = { resolve, reject, signal, timer: null, abort: null };
      const cleanup = () => {
        clearTimeout(pending.timer);
        signal?.removeEventListener('abort', pending.abort);
        state.pending.delete(id);
      };
      pending.resolve = value => { cleanup(); resolve(value); };
      pending.reject = error => { cleanup(); reject(error); };
      pending.timer = setTimeout(() => {
        try { this.notify(state, 'notifications/cancelled', { requestId: id, reason: 'Request timed out' }); } catch {}
        pending.reject(new Error(`MCP request timed out: ${method}`));
      }, timeoutMs);
      pending.abort = () => {
        try { this.notify(state, 'notifications/cancelled', { requestId: id, reason: 'Caller cancelled' }); } catch {}
        pending.reject(signal.reason || new Error('MCP request cancelled'));
      };
      signal?.addEventListener('abort', pending.abort, { once: true });
      state.pending.set(id, pending);
      const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params });
      if (Buffer.byteLength(payload) > this.maxFrameBytes) {
        pending.reject(new Error('MCP request exceeded the frame limit'));
        return;
      }
      state.child.stdin.write(`${payload}\n`, error => { if (error) pending.reject(error); });
    });
  }

  notify(state, method, params) {
    if (state.child.stdin.destroyed) return;
    state.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  }

  async callTool(serverId, toolName, args, { signal, timeoutMs } = {}) {
    const state = this.servers.get(serverId);
    if (!state || state.status !== 'connected') throw new Error(`MCP server "${serverId}" is disconnected`);
    if (!state.tools.some(tool => tool.name === toolName)) throw new Error('MCP tool is not registered by this server');
    const response = await this.request(state, 'tools/call', { name: toolName, arguments: args }, { signal, timeoutMs });
    if (response?.isError === true) throw new Error('MCP tool returned an error');
    return response;
  }

  fail(state, error) {
    if (!state || state.status === 'closed' || state.status === 'failed') return;
    state.status = 'failed';
    state.error = String(error?.message || 'MCP server failed').slice(0, 300);
    for (const pending of state.pending.values()) pending.reject(new Error(state.error));
    state.pending.clear();
    if (state.child.exitCode === null && !state.child.killed) {
      if (process.platform === 'win32' && state.child.pid) {
        const killer = spawn('taskkill.exe', ['/PID', String(state.child.pid), '/T', '/F'], { shell: false, windowsHide: true, stdio: 'ignore' });
        killer.unref?.();
      } else {
        try { state.child.kill('SIGTERM'); } catch {}
      }
    }
    this.emit('status', { serverId: state.serverId, status: state.status, error: state.error });
  }

  async disconnect(serverId) {
    const state = this.servers.get(serverId);
    if (!state) return { serverId, status: 'disconnected' };
    state.status = 'closed';
    for (const pending of state.pending.values()) pending.reject(new Error('MCP server disconnected'));
    state.pending.clear();
    try { state.child.stdin.end(); } catch {}
    if (state.child.exitCode === null) {
      if (process.platform === 'win32' && state.child.pid) {
        const killer = spawn('taskkill.exe', ['/PID', String(state.child.pid), '/T', '/F'], { shell: false, windowsHide: true, stdio: 'ignore' });
        await new Promise(resolve => {
          const timer = setTimeout(done, 1500);
          function done() { clearTimeout(timer); killer.removeListener('error', done); killer.removeListener('exit', done); resolve(); }
          killer.once('error', done); killer.once('exit', done);
        });
      } else {
        try { state.child.kill('SIGTERM'); } catch {}
      }
    }
    this.servers.delete(serverId);
    this.emit('status', { serverId, status: 'disconnected' });
    return { serverId, status: 'disconnected' };
  }

  status(serverId) {
    const state = this.servers.get(serverId);
    return state ? { serverId, status: state.status, error: state.error, tools: state.tools.map(tool => tool.name) } : { serverId, status: 'disconnected', tools: [] };
  }

  terminateAll() {
    for (const state of this.servers.values()) {
      state.status = 'closed';
      for (const pending of state.pending.values()) pending.reject(new Error('Abyx is shutting down'));
      state.pending.clear();
      try { state.child.stdin.destroy(); } catch {}
      if (state.child.exitCode !== null || state.child.killed) continue;
      if (process.platform === 'win32' && state.child.pid) {
        spawnSync('taskkill.exe', ['/F', '/PID', String(state.child.pid), '/T'], { windowsHide: true, stdio: 'ignore', timeout: 2000 });
      } else {
        try { state.child.kill('SIGTERM'); } catch {}
      }
    }
    this.servers.clear();
  }
}

module.exports = McpStdioManager;
