'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('AI usage events are persisted, filterable, budgeted, and profile-isolated', async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'abyx-stage6-usage-'));
  const dataDir = path.join(temp, 'data');
  process.env.ABYX_DATA_DIR = dataDir;
  process.env.ABYX_WORKSPACE_DIR = path.join(temp, 'workspace');
  const db = require('../../db');
  db.initDatabase(path.join(dataDir, 'abyx_memory.db'));
  t.after(() => {
    try { db.getDb().close(); } catch {}
    fs.rmSync(temp, { recursive: true, force: true });
    delete process.env.ABYX_DATA_DIR;
    delete process.env.ABYX_WORKSPACE_DIR;
  });

  const sql = db.getDb();
  const now = new Date().toISOString();
  sql.prepare(`INSERT INTO profiles(id, username, password_hash, display_name, avatar, created_at, updated_at, last_active_at, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')`).run('prof_stage6', 'usage-other', '$argon2id$test', 'Other', 'OT', now, now, now);

  db.recordAiUsageEvent({ requestId: 'req-a', profileId: 'prof_default', providerId: 'openai', model: 'gpt-test', inputTokens: 100, outputTokens: 25, tokenSource: 'actual', durationMs: 350, status: 'success' });
  db.recordAiUsageEvent({ requestId: 'req-b', profileId: 'prof_default', providerId: 'openai', model: 'gpt-test', inputTokens: 40, outputTokens: 10, tokenSource: 'estimated', durationMs: 900, status: 'failed', errorCode: 'HTTP_429', rateLimitEvent: true });
  db.recordAiUsageEvent({ requestId: 'req-c', profileId: 'prof_stage6', providerId: 'anthropic', model: 'claude-test', inputTokens: 900, outputTokens: 100, tokenSource: 'actual', durationMs: 200, status: 'success' });

  const primary = db.getAiUsageAnalytics('prof_default');
  assert.equal(primary.summary.requests, 2);
  assert.equal(primary.summary.input_tokens, 140);
  assert.equal(primary.summary.output_tokens, 35);
  assert.equal(primary.summary.actual_requests, 1);
  assert.equal(primary.summary.estimated_requests, 1);
  assert.equal(primary.summary.rate_limit_events, 1);
  assert.equal(primary.byProvider[0].provider_id, 'openai');
  assert.equal(db.getAiUsageAnalytics('prof_stage6').summary.total_tokens, 1000);
  assert.equal(db.getAiUsageAnalytics('prof_default', { provider: 'anthropic' }).summary.requests, 0);
  assert.throws(() => db.recordAiUsageEvent({ requestId: 'cross', profileId: 'missing-profile', providerId: 'openai', model: 'bad' }), /FOREIGN KEY/);

  const originalFetch = global.fetch;
  process.env.GROQ_API_KEY = 'fixture-key';
  global.fetch = async () => new Response([
    'data: {"choices":[{"delta":{"content":"answer"}}]}\n\n',
    'data: {"choices":[],"usage":{"prompt_tokens":8,"completion_tokens":2}}\n\n',
    'data: [DONE]\n\n'
  ].join(''), { status: 200, headers: {
    'content-type': 'text/event-stream',
    'x-ratelimit-limit-requests': '100',
    'x-ratelimit-remaining-requests': '97',
    'x-ratelimit-reset-requests': '1m'
  } });
  try {
    const aiProviders = require('../../services/ai_providers');
    const reply = await aiProviders.streamProviderChat({
      model: 'groq/openai/gpt-oss-120b', messages: [{ role: 'user', content: 'hello' }],
      profileId: 'prof_default', sessionId: 'usage-session', requestType: 'agent'
    });
    assert.equal(reply.content, 'answer');
  } finally {
    global.fetch = originalFetch;
    delete process.env.GROQ_API_KEY;
  }
  const streamed = db.getAiUsageAnalytics('prof_default', { provider: 'groq' });
  assert.equal(streamed.summary.requests, 1);
  assert.equal(streamed.summary.total_tokens, 10);
  assert.equal(streamed.events[0].token_source, 'actual');
  assert.equal(streamed.events[0].request_type, 'agent');
  assert.equal(db.listProviderQuotaSnapshots('prof_default')[0].remaining_value, 97);

  const budget = db.saveAiUsageBudget('prof_default', { scopeType: 'global', period: 'monthly', tokenLimit: 10000, costLimitUsd: 5, warningPercent: 90 });
  assert.equal(budget.token_limit, 10000);
  assert.equal(db.listAiUsageBudgets('prof_stage6').length, 0);
  assert.throws(() => db.saveAiUsageBudget('prof_default', { scopeType: 'global', period: 'daily', tokenLimit: -1 }), /Invalid usage budget/);
});

test('OpenAI compatible streaming captures provider-reported token usage', async () => {
  const adapter = new (require('../../providers/openai_adapter'))();
  const originalFetch = global.fetch;
  let sentPayload;
  global.fetch = async (_url, init) => {
    sentPayload = JSON.parse(init.body);
    const stream = [
      'data: {"choices":[{"delta":{"content":"hello"}}]}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":3,"prompt_tokens_details":{"cached_tokens":4},"completion_tokens_details":{"reasoning_tokens":1}}}\n\n',
      'data: [DONE]\n\n'
    ].join('');
    return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  try {
    const result = await adapter.streamChat({ model: 'gpt-test', messages: [{ role: 'user', content: 'hi' }], apiKey: 'test-key' });
    assert.equal(sentPayload.stream_options.include_usage, true);
    assert.deepEqual(result.usage, { inputTokens: 12, outputTokens: 3, cachedInputTokens: 4, reasoningTokens: 1 });
    assert.equal(result.content, 'hello');
  } finally {
    global.fetch = originalFetch;
  }
});

test('Anthropic and Gemini stream usage extraction handles provider event formats', async () => {
  const originalFetch = global.fetch;
  global.fetch = async url => {
    const anthropic = String(url).endsWith('/messages');
    const chunks = anthropic ? [
      'data: {"type":"message_start","message":{"usage":{"input_tokens":21,"cache_read_input_tokens":5}}}\n\n',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"claude"}}\n\n',
      'data: {"type":"message_delta","usage":{"output_tokens":6}}\n\n'
    ] : [
      'data: {"choices":[{"delta":{"content":"gemini"}}],"usage":{"prompt_tokens":17,"completion_tokens":4}}\n\n',
      'data: [DONE]\n\n'
    ];
    return new Response(chunks.join(''), { status: 200, headers: { 'content-type':'text/event-stream' } });
  };
  try {
    const Anthropic = require('../../providers/anthropic_adapter');
    const Gemini = require('../../providers/gemini_adapter');
    const claude = await new Anthropic().streamChat({ model:'claude-fixture', messages:[{role:'user',content:'hi'}], apiKey:'fixture' });
    const gemini = await new Gemini().streamChat({ model:'gemini-fixture', messages:[{role:'user',content:'hi'}], apiKey:'fixture' });
    assert.deepEqual(claude.usage, { inputTokens:21, cachedInputTokens:5, outputTokens:6 });
    assert.deepEqual(gemini.usage, { inputTokens:17, outputTokens:4, cachedInputTokens:undefined, reasoningTokens:undefined });
    assert.equal(claude.content, 'claude');
    assert.equal(gemini.content, 'gemini');
  } finally {
    global.fetch = originalFetch;
  }
});

test('OpenAI discovery only reports models returned by the authenticated endpoint', async () => {
  const adapter = new (require('../../providers/openai_adapter'))();
  const originalFetch = global.fetch;
  let requestHeaders;
  global.fetch = async (_url, init) => {
    requestHeaders = init.headers;
    return Response.json({ data: [{ id: 'gpt-4o-mini', owned_by: 'fixture' }, { id: 'account-model-x' }] });
  };
  try {
    assert.deepEqual(await adapter.listModels({}), []);
    const discovered = await adapter.listModels({ apiKey: 'fixture-secret' });
    assert.equal(requestHeaders.Authorization, 'Bearer fixture-secret');
    assert.deepEqual(discovered.map(model => model.id), ['gpt-4o-mini', 'account-model-x']);
    assert.equal(discovered[1].available, true);
    assert.equal(discovered[1].contextWindow, null);
  } finally {
    global.fetch = originalFetch;
  }
});
