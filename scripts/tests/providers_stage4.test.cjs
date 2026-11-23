/**
 * ABYX Phase 4 Automated Verification Test Suite
 * 
 * Verifies:
 * 1. Modular Provider Adapter Contracts & Error Formatting
 * 2. Mocked OpenAI Adapter: Streaming, Reasoning, Cancellation & 401/429 Errors
 * 3. Mocked Anthropic Adapter: System Extraction, Streaming, Thinking Delta
 * 4. Mocked Google Gemini Adapter: Streaming & 1M+ Context
 * 5. Mocked Ollama Runtime: VRAM Loading, Unloading, Pull Progress & Cancellation
 * 6. Mocked LM Studio Runtime: Port 1234 Detection & Streaming
 * 7. Custom OpenAI-Compatible Adapter: URL Validation & Custom Endpoints
 * 8. OS-Backed Secret Store (DPAPI): Zero Plaintext Exposure
 * 9. Local Runtimes Detection: Probes Without Assuming Installation
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const BaseProviderAdapter = require('../../providers/base_adapter');
const OpenAIAdapter = require('../../providers/openai_adapter');
const AnthropicAdapter = require('../../providers/anthropic_adapter');
const GeminiAdapter = require('../../providers/gemini_adapter');
const OllamaAdapter = require('../../providers/ollama_adapter');
const LMStudioAdapter = require('../../providers/lmstudio_adapter');
const CustomOpenAIAdapter = require('../../providers/custom_adapter');
const LocalRuntimeManager = require('../../providers/local_runtime_manager');
const providerRegistry = require('../../providers/registry');
const credentialStore = require('../../security/credential_store');
const db = require('../../db');

let passedTests = 0;
let failedTests = 0;

function assert(condition, testName, details = '') {
  if (condition) {
    console.log(`  [PASS] ${testName}`);
    passedTests++;
  } else {
    console.error(`  [FAIL] ${testName} - ${details}`);
    failedTests++;
  }
}

/**
 * Lightweight mock HTTP server on loopback to simulate cloud and runtime endpoints
 */
function createMockServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');

    // 1. Mock OpenAI
    if (url.pathname === '/v1/models' && req.headers.authorization?.includes('sk-valid')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ data: [{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }, { id: 'o1' }] }));
    }
    if (url.pathname === '/v1/models' && req.headers.authorization?.includes('sk-invalid')) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: { message: 'Incorrect API key provided' } }));
    }
    if (url.pathname === '/v1/chat/completions') {
      if (req.headers.authorization?.includes('sk-invalid')) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: { message: 'Incorrect API key' } }));
      }
      if (req.headers.authorization?.includes('sk-quota-exceeded')) {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: { message: 'You exceeded your current quota' } }));
      }

      // Stream valid OpenAI response
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: 'Planning response...' } }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Hello ' } }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'world!' } }] })}\n\n`);
      res.write('data: [DONE]\n\n');
      return res.end();
    }

    // 2. Mock Anthropic
    if (url.pathname === '/anthropic/v1/messages') {
      const apiKey = req.headers['x-api-key'];
      if (!apiKey || apiKey === 'ant-invalid') {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: { message: 'invalid_api_key' } }));
      }

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      });
      res.write(`data: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'Analyzing request...' } })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Anthropic reply' } })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'message_stop' })}\n\n`);
      return res.end();
    }

    // 3. Mock Ollama
    if (url.pathname === '/ollama/api/tags') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        models: [
          { name: 'abyx:1.1', size: 2684354560, modified_at: new Date().toISOString() },
          { name: 'moondream:latest', size: 1824522240, modified_at: new Date().toISOString() },
          { name: 'deepseek-r1:8b', size: 4939212800, modified_at: new Date().toISOString() }
        ]
      }));
    }
    if (url.pathname === '/ollama/api/generate') {
      // Handles load (keep_alive: 10m) and unload (keep_alive: 0)
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ done: true }));
    }
    if (url.pathname === '/ollama/api/delete') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ status: 'success' }));
    }
    if (url.pathname === '/ollama/api/pull') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.write(JSON.stringify({ status: 'pulling manifest' }) + '\n');
      res.write(JSON.stringify({ status: 'downloading', digest: 'sha256:abc', total: 1000, completed: 500 }) + '\n');
      res.write(JSON.stringify({ status: 'downloading', digest: 'sha256:abc', total: 1000, completed: 1000 }) + '\n');
      res.write(JSON.stringify({ status: 'success' }) + '\n');
      return res.end();
    }
    if (url.pathname === '/ollama/api/chat') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.write(JSON.stringify({ message: { thinking: 'Deep thought' } }) + '\n');
      res.write(JSON.stringify({ message: { content: 'Ollama local response' } }) + '\n');
      return res.end();
    }

    // 4. Mock LM Studio
    if (url.pathname === '/lmstudio/v1/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        data: [{ id: 'qwen2.5-coder-7b-instruct' }, { id: 'meta-llama-3.1-8b' }]
      }));
    }
    if (url.pathname === '/lmstudio/v1/chat/completions') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'LM Studio response' } }] })}\n\n`);
      res.write('data: [DONE]\n\n');
      return res.end();
    }

    res.writeHead(404);
    res.end('Not found');
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ server, port, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

async function runPhase4Tests() {
  console.log('====================================================');
  console.log('   ABYX PHASE 4: AI PROVIDERS & LOCAL MODEL TESTS    ');
  console.log('====================================================\n');

  db.initDatabase();
  const mock = await createMockServer();
  const mockBase = mock.baseUrl;

  // ----------------------------------------------------
  // TEST SUITE 1: Adapter Contracts & Error Formatting
  // ----------------------------------------------------
  console.log('--- Test Suite 1: Provider Adapter Interface Contracts ---');
  const openai = new OpenAIAdapter();
  const anthropic = new AnthropicAdapter();
  const gemini = new GeminiAdapter();
  const ollama = new OllamaAdapter();
  const lmstudio = new LMStudioAdapter();
  const custom = new CustomOpenAIAdapter();

  assert(openai.id === 'openai' && openai.requiresApiKey === true, 'OpenAI adapter contract verified');
  assert(anthropic.id === 'anthropic' && anthropic.requiresApiKey === true, 'Anthropic adapter contract verified');
  assert(gemini.id === 'gemini' && gemini.requiresApiKey === true, 'Gemini adapter contract verified');
  assert(ollama.id === 'ollama' && ollama.requiresApiKey === false, 'Ollama adapter contract verified');
  assert(lmstudio.id === 'lmstudio' && lmstudio.requiresApiKey === false, 'LM Studio adapter contract verified');
  assert(custom.id === 'custom' && custom.type === 'custom', 'Custom adapter contract verified');

  const errConn = openai.formatError(new Error('connect ECONNREFUSED 127.0.0.1:11434'));
  assert(errConn.code === 'CONNECTION_REFUSED' && errConn.actionable.includes('not reachable'), 'Connection refused formatted with actionable guidance');

  const errAuth = openai.formatError(new Error('HTTP 401 Unauthorized invalid_api_key'));
  assert(errAuth.code === 'AUTHENTICATION_FAILED' && errAuth.actionable.includes('Invalid or expired API key'), 'HTTP 401 formatted as AUTHENTICATION_FAILED with guidance');

  const errQuota = openai.formatError(new Error('HTTP 429 quota_exceeded'));
  assert(errQuota.code === 'RATE_LIMIT_EXCEEDED' && errQuota.actionable.includes('quota or rate limit'), 'HTTP 429 formatted as RATE_LIMIT_EXCEEDED with guidance');

  const errAbort = openai.formatError(new Error('AbortError: The operation was aborted'));
  assert(errAbort.code === 'REQUEST_CANCELLED', 'AbortError formatted as REQUEST_CANCELLED');

  // ----------------------------------------------------
  // TEST SUITE 2: Mocked OpenAI Adapter
  // ----------------------------------------------------
  console.log('\n--- Test Suite 2: Mocked OpenAI Adapter Tests ---');
  // 1. Connection test success
  const openAiTestOk = await openai.testConnection({ apiKey: 'sk-valid-key', baseUrl: `${mockBase}/v1` });
  assert(openAiTestOk.ok === true && openAiTestOk.latencyMs >= 0, 'OpenAI connection test succeeds with valid key');

  // 2. Connection test invalid key
  const openAiTestFail = await openai.testConnection({ apiKey: 'sk-invalid-key', baseUrl: `${mockBase}/v1` });
  assert(openAiTestFail.ok === false && openAiTestFail.error.includes('API key'), 'OpenAI connection test fails gracefully with invalid key');

  // 3. Model listing and capabilities
  const openAiModels = await openai.listModels({ apiKey: 'sk-valid-key', baseUrl: `${mockBase}/v1` });
  const gpt4o = openAiModels.find(m => m.id === 'gpt-4o');
  const o1 = openAiModels.find(m => m.id === 'o1');
  assert(gpt4o && gpt4o.capabilities.vision === true && gpt4o.capabilities.tools === true, 'GPT-4o capabilities include vision and tools');
  assert(o1 && o1.capabilities.reasoning === true && o1.contextWindow === 200000, 'o1 capabilities include reasoning and 200k context');

  // 4. Streaming chat completion
  let receivedContent = '';
  let receivedReasoning = '';
  const chatResult = await openai.streamChat({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'hello' }],
    apiKey: 'sk-valid-key',
    baseUrl: `${mockBase}/v1`,
    onChunk: (chunk) => { receivedContent += chunk; },
    onReasoning: (reasoning) => { receivedReasoning += reasoning; }
  });
  assert(chatResult.content === 'Hello world!', 'OpenAI streamed content matches mock chunks ("Hello world!")');
  assert(chatResult.reasoning === 'Planning response...', 'OpenAI streamed reasoning tokens captured');

  // 5. Cancellation test
  const abortCtrl = new AbortController();
  abortCtrl.abort();
  let cancelledCaught = false;
  try {
    await openai.streamChat({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'test' }],
      apiKey: 'sk-valid-key',
      baseUrl: `${mockBase}/v1`,
      signal: abortCtrl.signal
    });
  } catch (e) {
    cancelledCaught = true;
  }
  assert(cancelledCaught === true, 'OpenAI streaming cancellation handled cleanly via AbortSignal');

  // 6. Quota exceeded handling
  let quotaCaught = false;
  try {
    await openai.streamChat({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'test' }],
      apiKey: 'sk-quota-exceeded',
      baseUrl: `${mockBase}/v1`
    });
  } catch (e) {
    quotaCaught = true;
    assert(e.message.includes('quota') || e.message.includes('limit'), 'OpenAI quota error returns actionable message');
  }
  assert(quotaCaught === true, 'OpenAI quota exceeded handled without crash');

  // ----------------------------------------------------
  // TEST SUITE 3: Mocked Anthropic Claude Adapter
  // ----------------------------------------------------
  console.log('\n--- Test Suite 3: Mocked Anthropic Claude Adapter Tests ---');
  // Message formatting: extract system, merge consecutive user messages
  const formattedAnthropic = anthropic.formatAnthropicMessages([
    { role: 'system', content: 'You are an expert AI.' },
    { role: 'user', content: 'First message' },
    { role: 'user', content: 'Second message' },
    { role: 'assistant', content: 'Understood' }
  ]);
  assert(formattedAnthropic.system === 'You are an expert AI.', 'Anthropic adapter extracts system message to top-level system');
  assert(formattedAnthropic.messages.length === 2 && formattedAnthropic.messages[0].content.includes('First message\n\nSecond message'), 'Consecutive user messages merged for Anthropic API requirements');

  // Connection test
  const antTestOk = await anthropic.testConnection({ apiKey: 'ant-valid', baseUrl: `${mockBase}/anthropic/v1` });
  assert(antTestOk.ok === true, 'Anthropic connection test succeeds with valid key');

  const antTestFail = await anthropic.testConnection({ apiKey: 'ant-invalid', baseUrl: `${mockBase}/anthropic/v1` });
  assert(antTestFail.ok === false && antTestFail.error.includes('API key'), 'Anthropic test fails with actionable guidance on invalid key');

  // Model list
  const antModels = await anthropic.listModels();
  const sonnet = antModels.find(m => m.id.includes('claude-3-5-sonnet'));
  assert(sonnet && sonnet.contextWindow === 200000 && sonnet.capabilities.vision === true, 'Claude 3.5 Sonnet context is 200,000 tokens with vision capability');

  // Streaming with thinking delta
  let antText = '';
  let antThinking = '';
  const antRes = await anthropic.streamChat({
    model: 'claude-3-7-sonnet-20250219',
    messages: [{ role: 'user', content: 'think and answer' }],
    apiKey: 'ant-valid',
    baseUrl: `${mockBase}/anthropic/v1`,
    onChunk: (c) => { antText += c; },
    onReasoning: (t) => { antThinking += t; }
  });
  assert(antRes.content === 'Anthropic reply', 'Anthropic content chunk streaming verified');
  assert(antRes.reasoning === 'Analyzing request...', 'Anthropic thinking delta tokens streamed and captured');

  // ----------------------------------------------------
  // TEST SUITE 4: Mocked Google Gemini Adapter
  // ----------------------------------------------------
  console.log('\n--- Test Suite 4: Google Gemini Adapter Tests ---');
  const geminiModels = await gemini.listModels();
  const flash2 = geminiModels.find(m => m.id === 'gemini-2.0-flash');
  const pro15 = geminiModels.find(m => m.id === 'gemini-1.5-pro');

  assert(flash2 && flash2.contextWindow === 1048576, 'Gemini 2.0 Flash context window verified at 1,048,576 tokens (1M)');
  assert(pro15 && pro15.contextWindow === 2097152, 'Gemini 1.5 Pro context window verified at 2,097,152 tokens (2M)');
  assert(flash2.capabilities.vision === true && flash2.capabilities.tools === true, 'Gemini vision and tools capabilities reported accurately');

  // ----------------------------------------------------
  // TEST SUITE 5: Mocked Ollama Runtime & Lifecycle
  // ----------------------------------------------------
  console.log('\n--- Test Suite 5: Mocked Ollama Runtime & Lifecycle Tests ---');
  const localMgr = new LocalRuntimeManager({
    ollamaAdapter: ollama,
    lmStudioAdapter: lmstudio
  });

  // Test connection
  const ollamaTest = await ollama.testConnection({ baseUrl: `${mockBase}/ollama` });
  assert(ollamaTest.ok === true && ollamaTest.modelCount === 3, 'Ollama endpoint returns model count and connectivity');

  // List models and check reliable capability tagging
  const ollamaModels = await ollama.listModels({ baseUrl: `${mockBase}/ollama` });
  const moondream = ollamaModels.find(m => m.name.includes('moondream'));
  const r1 = ollamaModels.find(m => m.name.includes('deepseek-r1'));
  assert(moondream && moondream.capabilities.vision === true, 'Moondream recognized as vision-capable model');
  assert(r1 && r1.capabilities.reasoning === true, 'DeepSeek-R1 recognized as reasoning model');

  // Load and unload models
  const loadRes = await localMgr.loadModel('abyx:1.1', 'ollama', { baseUrl: `${mockBase}/ollama` });
  assert(loadRes.ok === true, 'Model preloading into VRAM succeeds');

  const unloadRes = await localMgr.unloadModel('abyx:1.1', 'ollama', { baseUrl: `${mockBase}/ollama` });
  assert(unloadRes.ok === true, 'Model unloading from VRAM (keep_alive: 0) succeeds');

  // Pull with progress
  const progressEvents = [];
  const pullRes = await ollama.pullModel({
    name: 'qwen2.5:3b',
    baseUrl: `${mockBase}/ollama`,
    onProgress: (p) => { progressEvents.push(p); }
  });
  assert(pullRes.ok === true, 'Model pull completes successfully');
  assert(progressEvents.length >= 3 && progressEvents.some(p => p.percent === 100), 'Model download streams progress events up to 100%');

  // Delete model
  const delRes = await localMgr.deleteModel('abyx:1.1', 'ollama', { baseUrl: `${mockBase}/ollama` });
  assert(delRes.ok === true, 'Model deletion completes successfully');

  // Storage estimation
  const est4b = localMgr.estimateModelStorage('qwen2.5:4b');
  const est70b = localMgr.estimateModelStorage('llama3.3:70b');
  assert(est4b.formatted === '~2.5 GB', '4B model estimated storage ~2.5 GB');
  assert(est70b.formatted === '~43.0 GB', '70B model estimated storage ~43.0 GB');

  // ----------------------------------------------------
  // TEST SUITE 6: Mocked LM Studio Runtime
  // ----------------------------------------------------
  console.log('\n--- Test Suite 6: Mocked LM Studio Runtime Tests ---');
  const lmTest = await lmstudio.testConnection({ baseUrl: `${mockBase}/lmstudio` });
  assert(lmTest.ok === true && lmTest.modelCount === 2, 'LM Studio port 1234 probe succeeds with model count');

  const lmModels = await lmstudio.listModels({ baseUrl: `${mockBase}/lmstudio` });
  assert(lmModels.length === 2 && lmModels[0].id.includes('qwen'), 'LM Studio model listing verified');

  let lmContent = '';
  const lmChat = await lmstudio.streamChat({
    model: 'qwen2.5-coder-7b-instruct',
    messages: [{ role: 'user', content: 'hi' }],
    baseUrl: `${mockBase}/lmstudio`,
    onChunk: (c) => { lmContent += c; }
  });
  assert(lmChat.content === 'LM Studio response', 'LM Studio streaming completion verified');

  // Missing runtime failure test
  const deadEndpointTest = await lmstudio.testConnection({ baseUrl: 'http://127.0.0.1:54321' });
  assert(deadEndpointTest.ok === false && deadEndpointTest.error.includes('1234'), 'Offline LM Studio provides actionable instructions to start local server');

  // ----------------------------------------------------
  // TEST SUITE 7: Custom OpenAI-Compatible Adapter
  // ----------------------------------------------------
  console.log('\n--- Test Suite 7: Custom OpenAI-Compatible Endpoint Tests ---');
  // URL Validation
  let invalidUrlCaught = false;
  try {
    custom.validateUrl('not_a_valid_url');
  } catch (e) {
    invalidUrlCaught = true;
  }
  assert(invalidUrlCaught === true, 'Custom adapter rejects invalid non-HTTP URL');

  const validUrl = custom.validateUrl('http://127.0.0.1:8080/v1/');
  assert(validUrl === 'http://127.0.0.1:8080/v1', 'Custom adapter normalizes trailing slash on valid URL');

  // Test custom connection against mock
  const customTest = await custom.testConnection({
    baseUrl: `${mockBase}/v1`,
    apiKey: 'sk-valid-key'
  });
  assert(customTest.ok === true, 'Custom OpenAI-compatible endpoint connects and discovers models');

  // ----------------------------------------------------
  // TEST SUITE 8: OS-Backed Credential Store Security (Zero Leaks)
  // ----------------------------------------------------
  console.log('\n--- Test Suite 8: OS-Backed Credential Store Security ---');
  const testProfile = 'prof_default';
  const rawKeyOpenAI = 'sk-proj-super-secret-openai-api-key-99999999';
  const rawKeyAnthropic = 'sk-ant-api03-super-secret-claude-key-88888888';

  // Save configurations
  providerRegistry.saveProviderConfig(testProfile, {
    openai: rawKeyOpenAI,
    anthropic: rawKeyAnthropic
  });

  // Verify status listing returns masked snippets, never plaintext
  const statusList = providerRegistry.getProviderStatusList(testProfile);
  const openAiStatus = statusList.providers.find(p => p.id === 'openai');
  const anthropicStatus = statusList.providers.find(p => p.id === 'anthropic');

  assert(openAiStatus && openAiStatus.hasKey === true, 'OpenAI configured for profile');
  assert(openAiStatus.maskedKey.includes('...'), 'OpenAI key masked in status listing');
  assert(!openAiStatus.maskedKey.includes(rawKeyOpenAI), 'OpenAI raw key NEVER exposed in status listing');

  // Verify SQLite stores only reference and non-sensitive metadata
  const dbCred = db.getProviderCredentialMetadata(testProfile, 'openai');
  assert(dbCred && dbCred.cred_ref && !dbCred.cred_ref.includes('sk-proj'), 'SQLite stores only vault filename reference');

  // Verify DPAPI decrypts accurately for active execution
  const decryptedOpenAI = credentialStore.getSecret(testProfile, 'openai');
  assert(decryptedOpenAI === rawKeyOpenAI, 'Windows DPAPI decrypts raw secret accurately into memory for execution');

  // Delete credentials
  providerRegistry.saveProviderConfig(testProfile, { openai: '', anthropic: '' });
  const afterDeleteKey = credentialStore.getSecret(testProfile, 'openai');
  const afterDeleteDb = db.getProviderCredentialMetadata(testProfile, 'openai');
  assert(afterDeleteKey === null && afterDeleteDb === null, 'Provider credentials cleanly deleted from vault and SQLite metadata');

  // ----------------------------------------------------
  // TEST SUITE 9: Runtime Detection Without Assuming Installation
  // ----------------------------------------------------
  console.log('\n--- Test Suite 9: Runtime Detection Without Assumption ---');
  const detected = await localMgr.detectRuntimes();
  assert(
    detected.ollama && ['running', 'installed_not_running', 'not_installed'].includes(detected.ollama.status),
    `Ollama runtime detection evaluated safely: status="${detected.ollama.status}"`
  );
  assert(
    detected.lmstudio && ['running', 'installed_not_running', 'not_installed'].includes(detected.lmstudio.status),
    `LM Studio runtime detection evaluated safely: status="${detected.lmstudio.status}"`
  );

  const diskSpace = localMgr.getAvailableDiskSpace();
  assert(diskSpace.freeGb > 0 && diskSpace.formatted.includes('GB'), `Drive space queried: ${diskSpace.formatted} available`);

  // Close mock server
  mock.server.close();

  // ----------------------------------------------------
  // FINAL REPORT
  // ----------------------------------------------------
  console.log('\n====================================================');
  console.log(`   PHASE 4 TEST SUMMARY: ${passedTests} PASSED, ${failedTests} FAILED`);
  console.log('====================================================');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runPhase4Tests().catch((err) => {
  console.error('[TEST SUITE ERROR]', err);
  process.exit(1);
});
