'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('dashboard analytics aggregate real records and remain profile-scoped', t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'abyx-stage8-dashboard-'));
  const dataDir = path.join(temp, 'data');
  process.env.ABYX_DATA_DIR = dataDir;
  process.env.ABYX_WORKSPACE_DIR = path.join(temp, 'workspace');
  const db = require('../../db');
  db.initDatabase(path.join(dataDir, 'abyx_memory.db'));
  t.after(() => {
    try { require('../../services/automation_service').getEngine('prof_default').stopScheduler(); } catch {}
    try { db.getDb().close(); } catch {}
    fs.rmSync(temp, { recursive: true, force: true });
    delete process.env.ABYX_DATA_DIR;
    delete process.env.ABYX_WORKSPACE_DIR;
  });
  const sql = db.getDb();
  const now = new Date().toISOString();
  const yesterday = new Date(Date.now() - 86400000).toISOString();
  sql.prepare(`INSERT INTO profiles(id, username, password_hash, display_name, avatar, created_at, updated_at, last_active_at, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')`).run('prof_stage8_other', 'stage8-other', '$argon2id$test', 'Other', 'OT', now, now, now);

  sql.prepare('INSERT INTO chat_logs(session_id, role, content, timestamp, profile_id) VALUES (?, ?, ?, ?, ?)').run('s1', 'user', 'hello', now, 'prof_default');
  sql.prepare('INSERT INTO chat_logs(session_id, role, content, timestamp, profile_id) VALUES (?, ?, ?, ?, ?)').run('s1', 'assistant', 'hi', now, 'prof_default');
  sql.prepare('INSERT INTO chat_logs(session_id, role, content, timestamp, profile_id) VALUES (?, ?, ?, ?, ?)').run('s2', 'user', 'other', now, 'prof_stage8_other');
  sql.prepare(`INSERT INTO knowledge_sources(id, profile_id, name, file_path, file_type, file_size, file_hash, chunk_count, total_chars, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('src8', 'prof_default', 'indexed.pdf', 'indexed.pdf', 'pdf', 12, 'hash8', 1, 10, 'indexed', now, now);
  sql.prepare(`INSERT INTO knowledge_sources(id, profile_id, name, file_path, file_type, file_size, file_hash, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('src8-failed', 'prof_default', 'failed.pdf', 'failed.pdf', 'pdf', 12, 'hash-failed', 'failed', now, now);
  sql.prepare('INSERT INTO studybooks(id, profile_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('book8', 'prof_default', 'Test book', now, now);
  sql.prepare(`INSERT INTO studybook_materials(id, studybook_id, profile_id, type, title, content, score, total_items, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('quiz8', 'book8', 'prof_default', 'quiz', 'Quiz', '[]', 4, 5, now, now);

  db.recordAiUsageEvent({ requestId: 'stage8-a', profileId: 'prof_default', providerId: 'fixture-provider', model: 'fixture-model', inputTokens: 10, outputTokens: 5, createdAt: now, status: 'success', tokenSource: 'actual' });
  db.recordAiUsageEvent({ requestId: 'stage8-b', profileId: 'prof_default', providerId: 'fixture-provider', model: 'fixture-model', inputTokens: 3, outputTokens: 2, createdAt: yesterday, status: 'failed', tokenSource: 'estimated' });
  db.recordAiUsageEvent({ requestId: 'stage8-c', profileId: 'prof_stage8_other', providerId: 'other-provider', model: 'other-model', inputTokens: 900, outputTokens: 100, createdAt: now, status: 'success', tokenSource: 'actual' });

  const ExecutionLogger = require('../../agent/execution_logger');
  ExecutionLogger.saveRun({ id: 'run8-ok', profileId: 'prof_default', goal: 'fixture success', status: 'completed', startTime: now, endTime: now });
  ExecutionLogger.saveRun({ id: 'run8-fail', profileId: 'prof_default', goal: 'fixture failure', status: 'failed', startTime: yesterday, endTime: now });
  ExecutionLogger.saveRun({ id: 'run8-other', profileId: 'prof_stage8_other', goal: 'other profile', status: 'completed', startTime: now, endTime: now });

  const automationService = require('../../services/automation_service');
  automationService.saveTasks([{ id: 'automation8', name: 'Fixture automation', enabled: true, status: 'active', runHistory: [
    { runId: 'auto8-ok', status: 'success', startedAt: now, finishedAt: now },
    { runId: 'auto8-fail', status: 'failed', startedAt: yesterday, finishedAt: now }
  ] }], 'prof_default');

  const result = db.getDashboardStats('prof_default');
  assert.equal(result.conversations, 1);
  assert.equal(result.messages, 2);
  assert.equal(result.knowledgeSources, 1, 'failed sources are excluded from indexed totals');
  assert.equal(result.studybooks, 1);
  assert.equal(result.quizzes, 1);
  assert.equal(result.completedQuizzes, 1);
  assert.equal(result.avgQuizScore, 80);
  assert.equal(result.agentStats.total, 2);
  assert.equal(result.agentStats.completed, 1);
  assert.equal(result.agentStats.failed, 1);
  assert.equal(result.agentStats.successRate, 50, 'success rate uses completed + failed terminal runs');
  assert.equal(result.taskStats.completed, 2);
  assert.equal(result.taskStats.failed, 2);
  assert.equal(result.activeAutomations, 1);
  assert.equal(result.automationActivity.length, 2);
  assert.equal(db.getAiUsageAnalytics('prof_default').summary.requests, 2);
  assert.equal(db.getAiUsageAnalytics('prof_default').summary.total_tokens, 20);
  assert.equal(db.getAiUsageAnalytics('prof_stage8_other').summary.total_tokens, 1000);
  assert.equal(ExecutionLogger.listRecentRuns(100, 'prof_default').length, 2);

  const filtered = db.getDashboardStats('prof_default', { start: now.slice(0, 10) + 'T00:00:00.000Z' });
  assert.equal(filtered.documentActivity.length, 1);
  assert.equal(filtered.taskActivity.length, 1);

});
