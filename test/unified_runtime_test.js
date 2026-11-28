'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  createAgentEngine,
  ProviderRegistry,
  ModelAdapter,
  EventNormalizer,
  CancellationManager,
  SessionManager,
  RuntimeController
} = require('../agent');

async function ensureLocalServerRunning() {
  try {
    const res = await fetch('http://127.0.0.1:10086/health', { signal: AbortSignal.timeout(1000) });
    if (res.ok) return true;
  } catch (_) {}

  const exePath = path.join(process.cwd(), 'app', 'llm-backend', 'win', 'cuda', 'llama-server.exe');
  const modelPath = path.join(process.cwd(), 'app', 'llm-models', 'AbyxV2 9B.gguf');
  if (fs.existsSync(exePath) && fs.existsSync(modelPath)) {
    const { spawn } = require('child_process');
    spawn(exePath, ['-m', modelPath, '--host', '127.0.0.1', '--port', '10086', '-ngl', '99', '-c', '32768'], {
      detached: true,
      stdio: 'ignore'
    }).unref();

    const start = Date.now();
    while (Date.now() - start < 15000) {
      try {
        const ping = await fetch('http://127.0.0.1:10086/health', { signal: AbortSignal.timeout(500) });
        if (ping.ok) return true;
      } catch (_) {
        await new Promise(r => setTimeout(r, 500));
      }
    }
  }
  return false;
}

test('ProviderRegistry catalogs local and cloud providers with capability detection', async () => {
  await ensureLocalServerRunning();
  const registry = new ProviderRegistry({ localEndpoint: 'http://127.0.0.1:10086' });
  const providers = registry.listProviders();
  assert.ok(providers.length >= 6);

  const localProv = registry.getProvider('local_llama_server');
  assert.ok(localProv);
  assert.strictEqual(localProv.capabilities.nativeToolCalling, true);
  assert.strictEqual(localProv.capabilities.supportsReasoning, true);
  assert.strictEqual(localProv.capabilities.maxContextWindow, 262144);

  // Cloud provider capabilities
  const geminiProv = registry.getProvider('gemini');
  assert.ok(geminiProv);
  assert.strictEqual(geminiProv.capabilities.maxContextWindow, 1048576);

  // Local model connection check
  const online = await registry.isLocalModelOnline();
  assert.strictEqual(online, true);
});

test('SessionManager supports full session lifecycle, persistence and restoration', () => {
  const tempSessionsDir = path.join(process.cwd(), 'app', 'data', 'test_sessions');
  const sm = new SessionManager({ sessionsDir: tempSessionsDir });

  // 1. Create Session
  const session = sm.createSession({
    id: 'test_sess_001',
    goal: 'Test Session Management',
    model: 'AbyxV2 9B.gguf'
  });

  assert.strictEqual(session.id, 'test_sess_001');
  assert.strictEqual(session.status, 'idle');
  assert.strictEqual(session.messages.length, 2);

  // Verify file created on disk
  const filePath = path.join(tempSessionsDir, 'test_sess_001.json');
  assert.ok(fs.existsSync(filePath));

  // 2. Pause & Resume
  sm.pauseSession('test_sess_001');
  assert.strictEqual(sm.getSession('test_sess_001').status, 'paused');

  sm.resumeSession('test_sess_001');
  assert.strictEqual(sm.getSession('test_sess_001').status, 'idle');

  // 3. Restore in new manager
  const sm2 = new SessionManager({ sessionsDir: tempSessionsDir });
  const restored = sm2.restoreSession('test_sess_001');
  assert.ok(restored);
  assert.strictEqual(restored.goal, 'Test Session Management');

  // 4. Dispose
  sm.disposeSession('test_sess_001');
  assert.strictEqual(fs.existsSync(filePath), false);

  // Cleanup test dir
  try { fs.rmSync(tempSessionsDir, { recursive: true, force: true }); } catch (_) {}
});

test('CancellationManager cancels signals and handles timeouts', async () => {
  const cm = new CancellationManager();

  // Manual cancellation
  const token = cm.createToken('sess_cancel_test');
  assert.strictEqual(token.signal.aborted, false);

  cm.cancel('sess_cancel_test', 'User interrupted');
  assert.strictEqual(token.signal.aborted, true);
  assert.match(token.signal.reason.message, /User interrupted/i);

  // Timeout cancellation
  const timeoutToken = cm.createToken('sess_timeout_test', 50);
  assert.strictEqual(timeoutToken.signal.aborted, false);

  await new Promise(r => setTimeout(r, 80));
  assert.strictEqual(timeoutToken.signal.aborted, true);
  assert.match(timeoutToken.signal.reason.message, /timed out/i);
});

test('ModelAdapter normalizes tools and extracts reasoning tags', async () => {
  const mockRouter = {
    chat: async ({ messages }) => ({
      choices: [
        {
          message: {
            content: '<think>Deep analysis performed.</think>Result text here.'
          }
        }
      ]
    })
  };

  const adapter = new ModelAdapter({ modelRouter: mockRouter });
  const res = await adapter.chat({ messages: [{ role: 'user', content: 'hello' }] });

  const msg = res.choices[0].message;
  assert.strictEqual(msg.content, 'Result text here.');
  assert.strictEqual(msg.reasoning_content, 'Deep analysis performed.');
});

test('RuntimeController runs bounded session with tool execution and error recovery', async () => {
  const mockRouter = {
    step: 0,
    chat: async function() {
      this.step++;
      if (this.step === 1) {
        return {
          choices: [
            {
              message: {
                content: '',
                tool_calls: [
                  {
                    id: 'call_1',
                    type: 'function',
                    function: {
                      name: 'read_file',
                      arguments: '```json\n{"path": "non_existent_file.xyz"}\n```' // Tests JSON repair
                    }
                  }
                ]
              }
            }
          ]
        };
      }
      return {
        choices: [
          {
            message: {
              content: 'Recovered from missing file and concluded successfully.'
            }
          }
        ]
      };
    }
  };

  const engine = createAgentEngine({
    approvedRoots: [process.cwd()],
    modelRouter: mockRouter
  });

  const rc = new RuntimeController({
    modelRouter: mockRouter,
    toolGateway: engine.toolGateway,
    policyEngine: engine.policyEngine
  });

  engine.policyEngine.setPolicy('read_file', 'allow');

  const events = [];
  const res = await rc.runSession({
    goal: 'Test tool repair and error recovery',
    onEvent: (type, data) => events.push(type)
  });

  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.turnsCount, 2);
  assert.strictEqual(res.result, 'Recovered from missing file and concluded successfully.');
  assert.ok(events.includes('tool:call:requested'));
  assert.ok(events.includes('tool:call:result'));
  assert.ok(events.includes('session:completed'));
});

test('Live Model E2E: RuntimeController executes genuine session on AbyxV2 9B (port 10086)', async () => {
  const engine = createAgentEngine({
    approvedRoots: [process.cwd()]
  });

  const online = await engine.providerRegistry.isLocalModelOnline();
  assert.strictEqual(online, true, 'Local model on 127.0.0.1:10086 must be online');

  const rc = new RuntimeController({
    modelRouter: engine.modelRouter,
    toolGateway: engine.toolGateway,
    policyEngine: engine.policyEngine
  });

  engine.policyEngine.setPolicy('read_file', 'allow');

  const events = [];
  const startTime = Date.now();

  const res = await rc.runSession({
    sessionId: `live_sess_${Date.now()}`,
    goal: 'Use the read_file tool to read package.json and report the name field.',
    model: 'AbyxV2 9B.gguf',
    maxTokens: 250,
    onEvent: (type, data) => events.push(type)
  });

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`Live session completed in ${durationSec}s. Turns: ${res.turnsCount}`);
  console.log(`Model Result: ${res.result}`);

  assert.strictEqual(res.ok, true);
  assert.ok(res.result && res.result.includes('abyx'));
  assert.strictEqual(res.turnsCount, 2);
  assert.ok(events.includes('session:start'));
  assert.ok(events.includes('turn:start'));
  assert.ok(events.includes('tool:call:requested'));
  assert.ok(events.includes('tool:call:result'));
  assert.ok(events.includes('turn:end'));
  assert.ok(events.includes('session:completed'));

  // Verify session persisted to disk
  const persisted = rc.sessionManager.getSession(res.sessionId);
  assert.ok(persisted);
  assert.strictEqual(persisted.status, 'completed');
  assert.strictEqual(persisted.turnsCount, res.turnsCount);
  assert.ok(persisted.turnsCount >= 1);

  // Clean up test session file
  rc.sessionManager.disposeSession(res.sessionId);
});
