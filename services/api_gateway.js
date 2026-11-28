'use strict';

/**
 * ABYX Unified API Gateway & Server
 * Exposes REST endpoints, Server-Sent Events (SSE), and WebSockets
 * for the desktop Electron app, external CLI runners, and web UI.
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const { createAgentEngine } = require('../agent/index');
const { AbyxWebSocketServer } = require('./websocket_server');

class ApiGateway {
  constructor(options = {}) {
    this.port = options.port || 3000;
    this.workspaceRoot = options.workspaceRoot || process.cwd();
    this.engine = options.engine || createAgentEngine({ workspaceRoot: this.workspaceRoot });
    this.server = null;
    this.wsServer = null;
    this.eventListeners = new Set();
  }

  broadcast(event) {
    for (const listener of this.eventListeners) {
      try { listener(event); } catch (_) {}
    }
  }

  start() {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => this._handleRequest(req, res));
      this.wsServer = new AbyxWebSocketServer(this.server, {
        subscribe: (cb) => {
          this.eventListeners.add(cb);
          return () => this.eventListeners.delete(cb);
        }
      });
      this.wsServer.start();

      this.server.listen(this.port, () => {
        resolve({ port: this.port, url: `http://localhost:${this.port}` });
      });
      this.server.on('error', reject);
    });
  }

  stop() {
    return new Promise((resolve) => {
      if (this.wsServer) {
        try { this.wsServer.stop(); } catch (_) {}
      }
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  async _handleRequest(req, res) {
    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;
    const method = req.method;

    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }

    try {
      // 1. Health
      if (pathname === '/api/health' && method === 'GET') {
        return this._sendJson(res, 200, {
          status: 'HEALTHY',
          app: 'ABYX Unified AI Studio',
          version: '1.0.0',
          workspace: this.workspaceRoot,
          timestamp: new Date().toISOString()
        });
      }

      // 2. Tools
      if (pathname === '/api/tools' && method === 'GET') {
        const schemas = this.engine.toolRegistry.getFunctionSchemas();
        return this._sendJson(res, 200, { tools: schemas });
      }

      // 3. Providers
      if (pathname === '/api/providers' && method === 'GET') {
        const providers = this.engine.providerRegistry?.list ? this.engine.providerRegistry.list() : [];
        return this._sendJson(res, 200, { providers });
      }

      // 4. SSE Stream
      if (pathname === '/api/events/stream' && method === 'GET') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        });
        res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

        const listener = (evt) => {
          res.write(`data: ${JSON.stringify(evt)}\n\n`);
        };
        this.eventListeners.add(listener);

        req.on('close', () => {
          this.eventListeners.delete(listener);
        });
        return;
      }

      // 5. Run autonomous agent task
      if (pathname === '/api/agent/run' && method === 'POST') {
        const body = await this._parseBody(req);
        const goal = body.goal || body.prompt || 'Execute task';
        const model = body.model || 'AbyxV2 9B.gguf';

        const runResult = await this.engine.engine.run({
          goal,
          model,
          maxSteps: body.maxSteps || 10,
          onEvent: (type, data) => this.broadcast({ type, data })
        });

        return this._sendJson(res, 200, runResult);
      }

      // 6. Direct Tool Execution
      if (pathname === '/api/tools/execute' && method === 'POST') {
        const body = await this._parseBody(req);
        const { tool, args } = body;
        const result = await this.engine.toolGateway.execute(tool, args || {});
        return this._sendJson(res, 200, result);
      }

      // 404
      return this._sendJson(res, 404, { error: `Endpoint not found: ${pathname}` });
    } catch (err) {
      return this._sendJson(res, 500, { error: err.message });
    }
  }

  _parseBody(req) {
    return new Promise((resolve) => {
      let data = '';
      req.on('data', chunk => { data += chunk; });
      req.on('end', () => {
        try {
          resolve(data ? JSON.parse(data) : {});
        } catch (_) {
          resolve({});
        }
      });
    });
  }

  _sendJson(res, statusCode, data) {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }
}

module.exports = { ApiGateway };
