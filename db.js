const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const migrations = require('./db_migrations');
const { dataDir: DATA_DIR } = require('./data_paths');
const DEFAULT_DB_PATH = fs.existsSync(path.join(DATA_DIR, 'abyx_memory.db'))
  ? path.join(DATA_DIR, 'abyx_memory.db')
  : (fs.existsSync(path.join(DATA_DIR, 'axom_memory.db'))
      ? path.join(DATA_DIR, 'axom_memory.db')
      : path.join(DATA_DIR, 'abyx_memory.db'));

let dbInstance = null;
let currentDbPath = DEFAULT_DB_PATH;

/**
 * Initialize SQLite database, verify integrity and apply migrations
 */
function initDatabase(dbFilePath = DEFAULT_DB_PATH) {
  currentDbPath = dbFilePath;
  const dir = path.dirname(dbFilePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // 1. Check integrity and run migrations engine
  migrations.runMigrations(dbFilePath);

  // 2. Open DB with WAL mode
  if (dbInstance) {
    try { dbInstance.close(); } catch (e) {}
    dbInstance = null;
  }
  const db = new DatabaseSync(dbFilePath);
  dbInstance = db;
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');

  try { maybeCreateAutomaticBackup(dbFilePath); } catch (error) {
    console.warn('[DB] Automatic backup skipped:', error.message);
  }

  return db;
}

function maybeCreateAutomaticBackup(dbPath) {
  const backupDir = path.join(path.dirname(dbPath), 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const autoFiles = fs.readdirSync(backupDir).filter(file => /^abyx_db_auto_.*\.db$/.test(file))
    .map(file => ({ file, mtime: fs.statSync(path.join(backupDir, file)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  if (autoFiles[0] && Date.now() - autoFiles[0].mtime < 24 * 60 * 60 * 1000) return null;
  const created = migrations.createPreMigrationBackup(dbPath, 'auto');
  if (!created || !migrations.validateDatabaseIntegrity(created).valid) throw new Error('Automatic backup could not be verified');
  for (const old of autoFiles.slice(6)) {
    try { fs.rmSync(path.join(backupDir, old.file), { force: true }); } catch {}
  }
  return created;
}

function getDb() {
  if (!dbInstance) {
    initDatabase();
  }
  return dbInstance;
}

function getDatabasePath() {
  return currentDbPath;
}

/**
 * Log a chat message with profile isolation
 */
function logChatMessage(sessionId, role, content, timestamp = new Date().toISOString(), profileId = 'prof_default') {
  const db = getDb();
  const pid = profileId || 'prof_default';

  const insertLog = db.prepare(`
    INSERT INTO chat_logs (session_id, role, content, timestamp, profile_id)
    VALUES (?, ?, ?, ?, ?)
  `);
  insertLog.run(sessionId, role, content, timestamp, pid);

  const existingSession = db.prepare('SELECT session_id, message_count FROM session_metadata WHERE session_id = ? AND profile_id = ?').get(sessionId, pid);
  if (existingSession) {
    const updateSession = db.prepare(`
      UPDATE session_metadata
      SET end_time = ?, message_count = message_count + 1, status = 'active'
      WHERE session_id = ? AND profile_id = ?
    `);
    updateSession.run(timestamp, sessionId, pid);
  } else {
    const insertSession = db.prepare(`
      INSERT INTO session_metadata (session_id, start_time, end_time, message_count, status, profile_id)
      VALUES (?, ?, ?, 1, 'active', ?)
    `);
    insertSession.run(sessionId, timestamp, timestamp, pid);
  }
}

/**
 * Get full raw transcript for a session scoped to profile
 */
function getSessionTranscript(sessionId, profileId = 'prof_default') {
  const db = getDb();
  const pid = profileId || 'prof_default';
  const rows = db.prepare(`
    SELECT timestamp, role, content
    FROM chat_logs
    WHERE session_id = ? AND profile_id = ?
    ORDER BY id ASC
  `).all(sessionId, pid);
  return rows || [];
}

/**
 * Get all active user profile memory entries for a specific profile
 */
function getAllProfileMemory(profileId = 'prof_default') {
  const db = getDb();
  const pid = profileId || 'prof_default';
  return db.prepare(`
    SELECT key, value, category, confidence_score, reasoning, created_at, updated_at
    FROM user_profile_memory
    WHERE profile_id = ?
    ORDER BY category ASC, key ASC
  `).all(pid) || [];
}

/**
 * Get dictionary snapshot of current profile for the reviewer prompt
 */
function getProfileSnapshot(profileId = 'prof_default') {
  const rows = getAllProfileMemory(profileId);
  const snapshot = {};
  for (const row of rows) {
    snapshot[row.key] = row.value;
  }
  return snapshot;
}

/**
 * Format profile key-value mappings into a context block
 */
function formatProfileContext(memoryRows = null, profileId = 'prof_default') {
  const rows = memoryRows || getAllProfileMemory(profileId);
  if (!rows || rows.length === 0) return '';

  const categories = {};
  for (const r of rows) {
    const cat = r.category || 'general_fact';
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(`  - ${r.key}: ${r.value}`);
  }

  const lines = [
    '# CORE IDENTITY & SYSTEM DIRECTIVE',
    'You are ABYX, a helpful, intelligent, empathetic, and highly capable AI assistant.',
    'You behave and communicate naturally, warmly, and thoughtfully like modern conversational AI assistants (such as ChatGPT or Claude).',
    '',
    'CORE PERSONALITY & BEHAVIORS:',
    '1. Conversational, Warm & Crisp: Speak naturally, warmly, and helpfully. When the user greets you with a simple greeting (e.g. "hi", "hello", "hey"), reply with a brief, friendly greeting such as: "Hi! What would you like to work on?" or "Hello! How can I help you today?" Keep initial greetings short, clean, and inviting—never ramble or give paragraphs of introductory filler.',
    '2. Direct Yet Thorough: When asked a question or given a task, dive straight into a clear, comprehensive, and well-explained answer. Do not repeat your name or self-introduction on every turn unless the user explicitly asks who you are.',
    '3. Formatting: Use clean Markdown (bullet points, bold text, structured sections, code blocks with syntax highlighting) to make information readable, structured, and easy to follow.',
    '4. Adaptable & Versatile: Excel at coding, debugging, creative brainstorming, writing, math, system architecture, and casual conversation. Match the user\'s tone and depth.',
    '5. Identity: You are ABYX. If asked about your identity, state clearly that you are the ABYX assistant.',
    '6. Strict Zero-Emoji Policy: Do NOT use emojis in your responses. Never use decorative emojis in headings, bullet points, titles, or paragraphs. Maintain a clean, mature, and professional tone matching high-end technical tools (like Cursor, Claude, or developer documentation). Format responses using clean Markdown, bold headers, and structured tables instead.',
    '',
    '# [BACKGROUND USER PROFILE & PASSIVE MEMORY]',
    'The following facts, preferences, and context represent background reference knowledge about the user:',
  ];

  for (const [category, items] of Object.entries(categories)) {
    lines.push(`• ${category}:`);
    lines.push(...items);
  }

  lines.push('');
  lines.push('OPERATIONAL USAGE RULES:');
  lines.push('1. Use this information as PASSIVE BACKGROUND REFERENCE. Do NOT force, recite, or proactively bring up past projects, tech stacks, or specific facts unless directly relevant to what the user is currently asking.');
  lines.push('2. If the user gives a greeting (e.g. "hi", "hello") or an open-ended statement, greet them naturally, helpfully, and concisely without assuming an agenda or mentioning background projects unprompted.');
  lines.push('3. When the user asks technical questions, write code, or requests assistance, subtly align with their known preferences and environment.');
  lines.push('4. Natural Memory Recall: When answering about people, preferences, or facts stored in memory, state the answer directly and naturally. NEVER preface with "Based on your profile", "According to your known list", "In your records", or similar meta-commentary.');
  lines.push('# [END BACKGROUND MEMORY]\n');
  return lines.join('\n');
}

/**
 * Mutate user_profile_memory with memory actions scoped to profile
 */
function applyMemoryActions(actions = [], sessionId = null, sessionSummary = null, profileId = 'prof_default') {
  const db = getDb();
  const pid = profileId || 'prof_default';
  const now = new Date().toISOString();
  const stats = { created: 0, updated: 0, deleted: 0, errors: [] };

  if (!Array.isArray(actions)) return stats;

  db.exec('BEGIN TRANSACTION');
  try {
    const upsertStmt = db.prepare(`
      INSERT INTO user_profile_memory (profile_id, key, value, category, confidence_score, reasoning, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(profile_id, key) DO UPDATE SET
        value = excluded.value,
        category = excluded.category,
        confidence_score = excluded.confidence_score,
        reasoning = excluded.reasoning,
        updated_at = excluded.updated_at
    `);

    const selectStmt = db.prepare('SELECT key FROM user_profile_memory WHERE profile_id = ? AND key = ?');
    const deleteStmt = db.prepare('DELETE FROM user_profile_memory WHERE profile_id = ? AND key = ?');

    for (const item of actions) {
      if (!item || !item.key || !item.action) continue;

      const action = String(item.action).trim().toUpperCase();
      const key = String(item.key).trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
      const category = String(item.category || 'general_fact').trim().toLowerCase();
      const value = typeof item.value === 'string' ? item.value.trim() : JSON.stringify(item.value);
      const confidence = typeof item.confidence_score === 'number' ? item.confidence_score : 1.0;
      const reasoning = item.reasoning ? String(item.reasoning).trim() : '';

      if (action === 'CREATE' || action === 'UPDATE' || action === 'UPSERT') {
        const existing = selectStmt.get(pid, key);
        upsertStmt.run(pid, key, value, category, confidence, reasoning, now, now);
        if (existing) {
          stats.updated++;
        } else {
          stats.created++;
        }
      } else if (action === 'DELETE') {
        deleteStmt.run(pid, key);
        stats.deleted++;
      }
    }

    if (sessionId) {
      const updateMeta = db.prepare(`
        UPDATE session_metadata
        SET summary = COALESCE(?, summary),
            last_reviewed_at = ?,
            status = 'reviewed'
        WHERE session_id = ? AND profile_id = ?
      `);
      updateMeta.run(sessionSummary || null, now, sessionId, pid);
    }

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    stats.errors.push(err.message);
    console.error('[DB] Error applying memory actions:', err);
  }

  return stats;
}

/**
 * Get session metadata scoped to profile
 */
function getSessionMetadata(sessionId, profileId = 'prof_default') {
  const db = getDb();
  const pid = profileId || 'prof_default';
  return db.prepare('SELECT * FROM session_metadata WHERE session_id = ? AND profile_id = ?').get(sessionId, pid) || null;
}

/**
 * Get all sessions scoped to profile
 */
function getAllSessions(profileId = 'prof_default') {
  const db = getDb();
  const pid = profileId || 'prof_default';
  return db.prepare(`
    SELECT session_id, start_time, end_time, summary, message_count, last_reviewed_at, status
    FROM session_metadata
    WHERE profile_id = ?
    ORDER BY end_time DESC
  `).all(pid) || [];
}

/**
 * Record token usage scoped to profile
 */
function recordTokenUsage(sessionId, model = 'abyx v1.1 (Local)', promptTokens = 0, completionTokens = 0, profileId = 'prof_default') {
  try {
    const db = getDb();
    const pid = profileId || 'prof_default';
    const totalTokens = promptTokens + completionTokens;
    db.prepare(`
      INSERT INTO token_usage (session_id, model, prompt_tokens, completion_tokens, total_tokens, created_at, profile_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(sessionId, model, promptTokens, completionTokens, totalTokens, new Date().toISOString(), pid);
  } catch (err) {
    console.error('[DB] recordTokenUsage error:', err.message);
  }
}

/**
 * Get comprehensive token usage analytics scoped to profile
 */
function getTokenUsageStats(profileId = 'prof_default') {
  try {
    const db = getDb();
    const pid = profileId || 'prof_default';
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();

    const queryRange = (sinceIso) => {
      let sql = 'SELECT COUNT(*) as requests, COALESCE(SUM(prompt_tokens), 0) as prompt_tokens, COALESCE(SUM(completion_tokens), 0) as completion_tokens, COALESCE(SUM(total_tokens), 0) as total_tokens FROM token_usage WHERE profile_id = ?';
      const params = [pid];
      if (sinceIso) {
        sql += ' AND created_at >= ?';
        params.push(sinceIso);
      }
      const row = db.prepare(sql).get(...params);
      return {
        requests: Number(row.requests || 0),
        prompt_tokens: Number(row.prompt_tokens || 0),
        completion_tokens: Number(row.completion_tokens || 0),
        total_tokens: Number(row.total_tokens || 0)
      };
    };

    const day = queryRange(startOfDay);
    const week = queryRange(sevenDaysAgo);
    const month = queryRange(thirtyDaysAgo);
    const lifetime = queryRange(null);

    const modelBreakdown = db.prepare(`
      SELECT model, COUNT(*) as requests, SUM(total_tokens) as tokens
      FROM token_usage
      WHERE profile_id = ?
      GROUP BY model
      ORDER BY tokens DESC
    `).all(pid).map(r => ({
      model: r.model || 'Unknown model',
      requests: Number(r.requests || 0),
      tokens: Number(r.tokens || 0)
    }));

    // Daily historical breakdown for real charts (last 90 days)
    const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000).toISOString();
    const dailyHistory = db.prepare(`
      SELECT substr(created_at, 1, 10) as date,
             COUNT(*) as requests,
             COALESCE(SUM(total_tokens), 0) as tokens,
             COALESCE(SUM(prompt_tokens), 0) as prompt_tokens,
             COALESCE(SUM(completion_tokens), 0) as completion_tokens
      FROM token_usage
      WHERE profile_id = ? AND created_at >= ?
      GROUP BY substr(created_at, 1, 10)
      ORDER BY date ASC
    `).all(pid, ninetyDaysAgo).map(r => ({
      date: r.date,
      requests: Number(r.requests || 0),
      tokens: Number(r.tokens || 0),
      prompt_tokens: Number(r.prompt_tokens || 0),
      completion_tokens: Number(r.completion_tokens || 0)
    }));

    return { day, week, month, lifetime, modelBreakdown, dailyHistory };
  } catch (err) {
    console.error('[DB] getTokenUsageStats error:', err.message);
    const empty = { requests: 0, prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    return { day: empty, week: empty, month: empty, lifetime: empty, modelBreakdown: [], dailyHistory: [] };
  }
}

function recordAiUsageEvent(event = {}) {
  const pid = event.profileId || 'prof_default';
  const requestId = String(event.requestId || require('node:crypto').randomUUID());
  const numericOrNull = value => Number.isFinite(Number(value)) && value !== null && value !== '' ? Math.max(0, Math.floor(Number(value))) : null;
  const cost = Number.isFinite(Number(event.estimatedCostUsd)) && event.estimatedCostUsd !== null ? Math.max(0, Number(event.estimatedCostUsd)) : null;
  const status = ['success', 'failed', 'cancelled'].includes(event.status) ? event.status : 'success';
  const tokenSource = ['actual', 'estimated', 'unavailable'].includes(event.tokenSource) ? event.tokenSource : 'unavailable';
  const token = getDb().prepare(`
    INSERT OR IGNORE INTO ai_usage_events
      (id, profile_id, request_id, created_at, provider_id, model, session_id, agent_id, request_type,
       input_tokens, output_tokens, cached_input_tokens, reasoning_tokens, token_source,
       estimated_cost_usd, duration_ms, status, error_code, rate_limit_event)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    event.id || require('node:crypto').randomUUID(), pid, requestId,
    event.createdAt || new Date().toISOString(), String(event.providerId || 'unknown').slice(0, 100),
    String(event.model || 'unknown').slice(0, 200), event.sessionId ? String(event.sessionId).slice(0, 200) : null,
    event.agentId ? String(event.agentId).slice(0, 100) : null, String(event.requestType || 'chat').slice(0, 50),
    numericOrNull(event.inputTokens), numericOrNull(event.outputTokens), numericOrNull(event.cachedInputTokens),
    numericOrNull(event.reasoningTokens), tokenSource, cost, numericOrNull(event.durationMs), status,
    event.errorCode ? String(event.errorCode).slice(0, 80) : null, event.rateLimitEvent ? 1 : 0
  );
  return { inserted: token.changes === 1, requestId };
}

function getAiUsageAnalytics(profileId = 'prof_default', filters = {}) {
  const pid = profileId || 'prof_default';
  const clauses = ['profile_id = ?'];
  const args = [pid];
  if (filters.start) { clauses.push('created_at >= ?'); args.push(filters.start); }
  if (filters.end) { clauses.push('created_at < ?'); args.push(filters.end); }
  if (filters.provider) { clauses.push('provider_id = ?'); args.push(filters.provider); }
  if (filters.model) { clauses.push('model = ?'); args.push(filters.model); }
  if (filters.agent) { clauses.push('agent_id = ?'); args.push(filters.agent); }
  if (filters.requestType) { clauses.push('request_type = ?'); args.push(filters.requestType); }
  const where = clauses.join(' AND ');
  const db = getDb();
  const summary = db.prepare(`
    SELECT COUNT(*) AS requests,
      SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS successful,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled,
      COALESCE(SUM(input_tokens),0) AS input_tokens, COALESCE(SUM(output_tokens),0) AS output_tokens,
      COALESCE(SUM(COALESCE(input_tokens,0)+COALESCE(output_tokens,0)),0) AS total_tokens,
      SUM(CASE WHEN token_source = 'estimated' THEN 1 ELSE 0 END) AS estimated_requests,
      SUM(CASE WHEN token_source = 'actual' THEN 1 ELSE 0 END) AS actual_requests,
      AVG(duration_ms) AS avg_duration_ms, SUM(rate_limit_event) AS rate_limit_events,
      SUM(estimated_cost_usd) AS estimated_cost_usd
    FROM ai_usage_events WHERE ${where}
  `).get(...args);
  const byProvider = db.prepare(`SELECT provider_id, COUNT(*) AS requests,
      COALESCE(SUM(input_tokens),0) AS input_tokens, COALESCE(SUM(output_tokens),0) AS output_tokens,
      COALESCE(SUM(COALESCE(input_tokens,0)+COALESCE(output_tokens,0)),0) AS total_tokens,
      SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS successful,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
      AVG(duration_ms) AS avg_duration_ms, SUM(rate_limit_event) AS rate_limit_events,
      SUM(estimated_cost_usd) AS estimated_cost_usd
    FROM ai_usage_events WHERE ${where} GROUP BY provider_id ORDER BY total_tokens DESC`).all(...args);
  const byModel = db.prepare(`SELECT provider_id, model, COUNT(*) AS requests,
      COALESCE(SUM(input_tokens),0) AS input_tokens, COALESCE(SUM(output_tokens),0) AS output_tokens,
      COALESCE(SUM(COALESCE(input_tokens,0)+COALESCE(output_tokens,0)),0) AS total_tokens,
      SUM(estimated_cost_usd) AS estimated_cost_usd
    FROM ai_usage_events WHERE ${where} GROUP BY provider_id, model ORDER BY total_tokens DESC`).all(...args);
  const byAgent = db.prepare(`SELECT agent_id, provider_id, model, COUNT(*) AS requests,
      COALESCE(SUM(input_tokens),0) AS input_tokens, COALESCE(SUM(output_tokens),0) AS output_tokens,
      COALESCE(SUM(COALESCE(input_tokens,0)+COALESCE(output_tokens,0)),0) AS total_tokens,
      SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS successful,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
      AVG(duration_ms) AS avg_duration_ms, SUM(estimated_cost_usd) AS estimated_cost_usd
    FROM ai_usage_events WHERE ${where} AND agent_id IS NOT NULL GROUP BY agent_id, provider_id, model ORDER BY total_tokens DESC`).all(...args);
  const daily = db.prepare(`SELECT substr(created_at,1,10) AS date, COUNT(*) AS requests,
      COALESCE(SUM(input_tokens),0) AS input_tokens, COALESCE(SUM(output_tokens),0) AS output_tokens,
      COALESCE(SUM(COALESCE(input_tokens,0)+COALESCE(output_tokens,0)),0) AS total_tokens,
      SUM(estimated_cost_usd) AS estimated_cost_usd
    FROM ai_usage_events WHERE ${where} GROUP BY substr(created_at,1,10) ORDER BY date`).all(...args);
  const limit = Math.min(500, Math.max(1, Number(filters.limit) || 100));
  const events = db.prepare(`SELECT id, request_id, created_at, provider_id, model, session_id, agent_id, request_type,
      input_tokens, output_tokens, cached_input_tokens, reasoning_tokens, token_source, estimated_cost_usd,
      duration_ms, status, error_code, rate_limit_event
    FROM ai_usage_events WHERE ${where} ORDER BY created_at DESC LIMIT ?`).all(...args, limit);
  return { summary, byProvider, byModel, byAgent, daily, events };
}

function listAiUsageBudgets(profileId = 'prof_default') {
  return getDb().prepare('SELECT scope_type, scope_id, period, token_limit, cost_limit_usd, warning_percent, hard_limit_enabled, updated_at FROM ai_usage_budgets WHERE profile_id = ? ORDER BY scope_type, scope_id, period').all(profileId || 'prof_default');
}

function saveAiUsageBudget(profileId = 'prof_default', budget = {}) {
  const scopeType = ['global', 'provider', 'model'].includes(budget.scopeType) ? budget.scopeType : null;
  const period = ['daily', 'monthly'].includes(budget.period) ? budget.period : null;
  const scopeId = scopeType === 'global' ? '' : String(budget.scopeId || '').trim();
  const validLimit = value => value === null || value === undefined || value === '' ? null : (Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : NaN);
  const tokenLimit = validLimit(budget.tokenLimit);
  const costLimit = validLimit(budget.costLimitUsd);
  const warningPercent = Number(budget.warningPercent || 75);
  if (!scopeType || !period || (scopeType !== 'global' && !scopeId) || Number.isNaN(tokenLimit) || Number.isNaN(costLimit) || ![50,75,90,100].includes(warningPercent)) {
    throw new Error('Invalid usage budget configuration');
  }
  getDb().prepare(`INSERT INTO ai_usage_budgets
      (profile_id, scope_type, scope_id, period, token_limit, cost_limit_usd, warning_percent, hard_limit_enabled, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(profile_id, scope_type, scope_id, period) DO UPDATE SET
      token_limit=excluded.token_limit, cost_limit_usd=excluded.cost_limit_usd,
      warning_percent=excluded.warning_percent, hard_limit_enabled=excluded.hard_limit_enabled, updated_at=excluded.updated_at`)
    .run(profileId || 'prof_default', scopeType, scopeId, period, tokenLimit, costLimit, warningPercent, budget.hardLimitEnabled ? 1 : 0, new Date().toISOString());
  return listAiUsageBudgets(profileId).find(item => item.scope_type === scopeType && item.scope_id === scopeId && item.period === period);
}

function saveProviderQuotaSnapshot(profileId = 'prof_default', snapshot = {}) {
  const quotaKind = ['requests', 'tokens'].includes(snapshot.quotaKind) ? snapshot.quotaKind : null;
  const source = ['provider_header', 'official_api', 'user_configured'].includes(snapshot.source) ? snapshot.source : null;
  const limitValue = snapshot.limitValue == null ? null : Number(snapshot.limitValue);
  const remainingValue = snapshot.remainingValue == null ? null : Number(snapshot.remainingValue);
  if (!snapshot.providerId || !quotaKind || !source || (limitValue !== null && (!Number.isFinite(limitValue) || limitValue < 0)) || (remainingValue !== null && (!Number.isFinite(remainingValue) || remainingValue < 0))) return false;
  getDb().prepare(`INSERT INTO provider_quota_snapshots
    (profile_id, provider_id, quota_kind, limit_value, remaining_value, reset_at, source, observed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(profile_id, provider_id, quota_kind) DO UPDATE SET
      limit_value=excluded.limit_value, remaining_value=excluded.remaining_value,
      reset_at=excluded.reset_at, source=excluded.source, observed_at=excluded.observed_at`)
    .run(profileId || 'prof_default', String(snapshot.providerId).slice(0, 100), quotaKind, limitValue, remainingValue,
      snapshot.resetAt || null, source, snapshot.observedAt || new Date().toISOString());
  return true;
}

function listProviderQuotaSnapshots(profileId = 'prof_default') {
  return getDb().prepare(`SELECT provider_id, quota_kind, limit_value, remaining_value, reset_at, source, observed_at
    FROM provider_quota_snapshots WHERE profile_id = ? ORDER BY provider_id, quota_kind`).all(profileId || 'prof_default');
}

function getDashboardStats(profileId = 'prof_default', filters = {}) {
  const db = getDb();
  const pid = profileId || 'prof_default';
  const count = (sql, ...params) => Number(db.prepare(sql).get(...params)?.count || 0);
  const withinRange = timestamp => Boolean(timestamp)
    && (!filters.start || timestamp >= filters.start)
    && (!filters.end || timestamp < filters.end);

  // 1. Core workspace counts
  const conversations = count('SELECT COUNT(DISTINCT session_id) AS count FROM chat_logs WHERE profile_id = ?', pid);
  const messages = count('SELECT COUNT(*) AS count FROM chat_logs WHERE profile_id = ?', pid);
  const knowledgeSources = count("SELECT COUNT(*) AS count FROM knowledge_sources WHERE profile_id = ? AND status = 'indexed'", pid);
  const indexedChunks = count('SELECT COUNT(*) AS count FROM knowledge_chunks WHERE profile_id = ?', pid);
  const studybooks = count('SELECT COUNT(*) AS count FROM studybooks WHERE profile_id = ?', pid);
  const studySources = count('SELECT COUNT(*) AS count FROM studybook_sources WHERE profile_id = ?', pid);
  const flashcards = count("SELECT COUNT(*) AS count FROM studybook_materials WHERE profile_id = ? AND lower(type) LIKE '%flashcard%'", pid);
  const quizzes = count("SELECT COUNT(*) AS count FROM studybook_materials WHERE profile_id = ? AND (lower(type) LIKE '%quiz%' OR lower(type) LIKE '%exam%')", pid);
  const completedQuizzes = count("SELECT COUNT(*) AS count FROM studybook_materials WHERE profile_id = ? AND score IS NOT NULL AND (lower(type) LIKE '%quiz%' OR lower(type) LIKE '%exam%')", pid);

  // 2. Real quiz score calculation
  let avgQuizScore = null;
  try {
    const scoreRow = db.prepare(`
      SELECT AVG(CAST(score AS FLOAT) / CASE WHEN total_items > 0 THEN total_items ELSE 1 END) * 100 as avg_pct
      FROM studybook_materials
      WHERE profile_id = ? AND score IS NOT NULL AND total_items > 0
    `).get(pid);
    if (scoreRow && scoreRow.avg_pct !== null && !isNaN(scoreRow.avg_pct)) {
      avgQuizScore = Math.round(Number(scoreRow.avg_pct));
    }
  } catch (e) {}

  // 3. Real Agent Execution History & Success Rates
  let agentStats = { total: 0, active: 0, completed: 0, failed: 0, successRate: null };
  let agentRuns = [];
  try {
    const ExecutionLogger = require('./agent/execution_logger');
    agentRuns = ExecutionLogger.listRecentRuns(Number.MAX_SAFE_INTEGER, pid);
    agentStats.total = agentRuns.length;
    agentStats.active = agentRuns.filter(r => r.status === 'running').length;
    agentStats.completed = agentRuns.filter(r => r.status === 'completed' || r.status === 'success').length;
    agentStats.failed = agentRuns.filter(r => r.status === 'failed' || r.status === 'error').length;
    const finishedAgentRuns = agentStats.completed + agentStats.failed;
    agentStats.successRate = finishedAgentRuns > 0
      ? Math.round((agentStats.completed / finishedAgentRuns) * 100)
      : null;
  } catch (e) {}

  // 4. Real Automations and Skills Catalogs
  let activeAutomations = 0;
  let automationRuns = [];
  try {
    const automations = require('./services/automation_service').loadTasks(pid);
    activeAutomations = Array.isArray(automations) ? automations.filter(t => t.enabled === true && t.status !== 'paused').length : 0;
    automationRuns = Array.isArray(automations) ? automations.flatMap(task => (task.runHistory || []).map(run => ({
      ...run,
      automationId: task.id,
      automationName: task.name || task.id
    }))) : [];
  } catch (e) {}

  const agentActivity = agentRuns.filter(run => withinRange(run.startTime)).map(run => ({
    date: String(run.startTime).slice(0, 10),
    status: run.status,
    id: run.id
  }));
  const filteredAutomationRuns = automationRuns.filter(run => withinRange(run.startedAt));
  const taskDailyMap = new Map();
  const automationDailyMap = new Map();
  const addTaskActivity = (timestamp, status, isAutomation = false) => {
    if (!withinRange(timestamp)) return;
    const date = String(timestamp).slice(0, 10);
    const entry = taskDailyMap.get(date) || { date, completed: 0, failed: 0, active: 0 };
    const normalizedStatus = String(status || '').toLowerCase();
    if (['completed', 'success', 'succeeded'].includes(normalizedStatus)) entry.completed++;
    else if (['failed', 'error'].includes(normalizedStatus)) entry.failed++;
    else if (['running', 'active'].includes(normalizedStatus)) entry.active++;
    taskDailyMap.set(date, entry);
    if (isAutomation) {
      const automationEntry = automationDailyMap.get(date) || { date, executions: 0, completed: 0, failed: 0 };
      automationEntry.executions++;
      if (['completed', 'success', 'succeeded'].includes(normalizedStatus)) automationEntry.completed++;
      if (['failed', 'error'].includes(normalizedStatus)) automationEntry.failed++;
      automationDailyMap.set(date, automationEntry);
    }
  };
  for (const run of agentRuns) addTaskActivity(run.startTime, run.status);
  for (const run of automationRuns) addTaskActivity(run.startedAt, run.status, true);
  const taskActivity = [...taskDailyMap.values()].sort((a, b) => a.date.localeCompare(b.date));
  const automationActivity = [...automationDailyMap.values()].sort((a, b) => a.date.localeCompare(b.date));
  const taskStats = {
    total: agentStats.total + automationRuns.length,
    active: agentStats.active,
    completed: agentStats.completed + automationRuns.filter(run => ['completed', 'success', 'succeeded'].includes(String(run.status).toLowerCase())).length,
    failed: agentStats.failed + automationRuns.filter(run => ['failed', 'error'].includes(String(run.status).toLowerCase())).length
  };

  let installedSkills = 0;
  try {
    const { createExtensionService } = require('./extensions/extension_service');
    const profileRoot = path.join(DATA_DIR, 'profiles', pid);
    installedSkills = createExtensionService(profileRoot).list().filter(extension => extension.kind === 'skill').length;
  } catch (e) {}

  // Count profile-owned files separately from the shared SQLite database/backups.
  const directoryBytes = directory => {
    let bytes = 0;
    if (!fs.existsSync(directory)) return bytes;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      try {
        if (entry.isDirectory()) bytes += directoryBytes(entryPath);
        else if (entry.isFile()) bytes += fs.statSync(entryPath).size;
      } catch (e) {}
    }
    return bytes;
  };
  let studySourcesBytes = 0;
  const studySourcesDir = path.join(DATA_DIR, 'study_sources', pid);
  try {
    if (fs.existsSync(studySourcesDir)) {
      studySourcesBytes = directoryBytes(studySourcesDir);
    }
  } catch (e) {}

  let backupsBytes = 0;
  const backupsDir = path.join(DATA_DIR, 'backups');
  try {
    if (fs.existsSync(backupsDir)) {
      const bFiles = fs.readdirSync(backupsDir);
      for (const f of bFiles) {
        try { backupsBytes += fs.statSync(path.join(backupsDir, f)).size; } catch (e) {}
      }
    }
  } catch (e) {}

  const profileBytes = studySourcesBytes + directoryBytes(path.join(DATA_DIR, 'profiles', pid));
  let dbSizeBytes = 0;
  try { if (fs.existsSync(currentDbPath)) dbSizeBytes = fs.statSync(currentDbPath).size; } catch (e) {}
  const formatBytes = (b) => {
    if (b >= 1024 * 1024 * 1024) return (b / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
    if (b >= 1024 * 1024) return (b / (1024 * 1024)).toFixed(1) + ' MB';
    if (b >= 1024) return (b / 1024).toFixed(1) + ' KB';
    return b + ' B';
  };

  const storage = {
    profileBytes,
    profileFormatted: formatBytes(profileBytes),
    studyBytes: studySourcesBytes,
    backupsBytes,
    sharedDatabaseBytes: dbSizeBytes,
    sharedBackupBytes: backupsBytes,
    sharedAppFormatted: formatBytes(dbSizeBytes + backupsBytes),
    formatted: formatBytes(profileBytes),
    studyFormatted: formatBytes(studySourcesBytes)
  };

  // 6. Real Unified Recent Activity
  let recentActivity = [];
  let documentActivity = [];
  try {
    const recentChats = db.prepare(`
      SELECT session_id, role, content, timestamp
      FROM chat_logs
      WHERE profile_id = ? AND (? IS NULL OR timestamp >= ?) AND (? IS NULL OR timestamp < ?)
      ORDER BY timestamp DESC
      LIMIT 6
    `).all(pid, filters.start || null, filters.start || null, filters.end || null, filters.end || null).map(r => ({
      type: 'chat',
      title: r.role === 'user' ? 'User Question' : 'AI Response',
      detail: (r.content || '').slice(0, 50).replace(/\n/g, ' '),
      sessionId: r.session_id,
      timestamp: r.timestamp
    }));

    const recentMaterials = db.prepare(`
      SELECT id, type, title, created_at
      FROM studybook_materials
      WHERE profile_id = ?
      AND (? IS NULL OR created_at >= ?) AND (? IS NULL OR created_at < ?)
      ORDER BY created_at DESC
      LIMIT 6
    `).all(pid, filters.start || null, filters.start || null, filters.end || null, filters.end || null).map(r => ({
      type: 'study',
      title: r.title || 'Study Material',
      detail: `Type: ${r.type}`,
      id: r.id,
      timestamp: r.created_at
    }));

    const recentDocuments = db.prepare(`SELECT id, name, created_at, status FROM knowledge_sources
      WHERE profile_id = ? AND status = 'indexed'
      AND (? IS NULL OR created_at >= ?) AND (? IS NULL OR created_at < ?)
      ORDER BY created_at DESC LIMIT 6`).all(pid, filters.start || null, filters.start || null, filters.end || null, filters.end || null)
      .map(source => ({ type: 'document', title: source.name, detail: 'Indexed document', id: source.id, timestamp: source.created_at }));

    const recentAiRequests = db.prepare(`SELECT id, provider_id, model, status, created_at FROM ai_usage_events
      WHERE profile_id = ? AND (? IS NULL OR created_at >= ?) AND (? IS NULL OR created_at < ?)
      ORDER BY created_at DESC LIMIT 6`).all(pid, filters.start || null, filters.start || null, filters.end || null, filters.end || null)
      .map(event => ({ type: 'ai', title: `${event.provider_id} · ${event.model}`, detail: `AI request ${event.status}`, id: event.id, timestamp: event.created_at }));

    documentActivity = db.prepare(`SELECT substr(created_at,1,10) AS date, COUNT(*) AS documents
      FROM knowledge_sources WHERE profile_id = ? AND status = 'indexed'
      AND (? IS NULL OR created_at >= ?) AND (? IS NULL OR created_at < ?)
      GROUP BY substr(created_at,1,10) ORDER BY date`).all(pid, filters.start || null, filters.start || null, filters.end || null, filters.end || null)
      .map(row => ({ date: row.date, documents: Number(row.documents || 0) }));

    const recentAutomationRuns = filteredAutomationRuns.map(run => ({
      type: 'automation', title: run.automationName, detail: `Automation ${run.status}`, id: run.runId, timestamp: run.finishedAt || run.startedAt
    }));
    const recentAgentRuns = agentRuns.filter(run => withinRange(run.startTime)).map(run => ({
      type: 'agent', title: run.goal || 'Agent run', detail: `Agent ${run.status}`, id: run.id, timestamp: run.endTime || run.startTime
    }));

    recentActivity = [...recentChats, ...recentMaterials, ...recentDocuments, ...recentAiRequests, ...recentAutomationRuns, ...recentAgentRuns]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 8);
  } catch (e) {
    recentActivity = [];
  }

  return {
    conversations,
    messages,
    knowledgeSources,
    indexedChunks,
    studybooks,
    studySources,
    flashcards,
    quizzes,
    completedQuizzes,
    avgQuizScore,
    agentStats,
    taskStats,
    agentActivity,
    taskActivity,
    automationActivity,
    documentActivity,
    automationRuns: filteredAutomationRuns.slice().sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt))).slice(0, 100),
    activeAutomations,
    installedSkills,
    storage,
    recentActivity
  };
}

/**
 * Create a verified backup of the active database
 */
function createBackup(label = 'manual') {
  const backupPath = migrations.createPreMigrationBackup(currentDbPath, label);
  if (!backupPath || !migrations.validateDatabaseIntegrity(backupPath).valid) {
    throw new Error('Backup creation failed validation');
  }
  return {
    success: Boolean(backupPath),
    backupPath
  };
}

/**
 * Restore database from an existing backup with rollback protection
 */
function restoreBackup(backupFilePath) {
  if (!fs.existsSync(backupFilePath)) {
    throw new Error(`Backup file does not exist: ${backupFilePath}`);
  }

  // Validate integrity of the backup file before restoring
  const integrity = migrations.validateDatabaseIntegrity(backupFilePath);
  if (!integrity.valid) {
    throw new Error(`Cannot restore corrupted backup file: ${integrity.error}`);
  }

  const activeCheck = migrations.validateDatabaseIntegrity(currentDbPath);
  if (!activeCheck.valid) throw new Error(`Cannot restore while the active database is invalid: ${activeCheck.error}`);

  // Checkpoint and close active DB connection before replacement.
  if (dbInstance) {
    const checkpoint = dbInstance.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
    if (checkpoint?.busy) throw new Error('Database is busy; restore was not started');
    dbInstance.close();
    dbInstance = null;
  }

  const safetySnapshot = migrations.createPreMigrationBackup(currentDbPath, 'pre_restore');
  const replacementTemp = `${currentDbPath}.restore.tmp-${process.pid}`;

  try {
    fs.copyFileSync(backupFilePath, replacementTemp);
    const stagedIntegrity = migrations.validateDatabaseIntegrity(replacementTemp);
    if (!stagedIntegrity.valid) throw new Error(`Staged restore failed validation: ${stagedIntegrity.error}`);

    // Clean up any stale WAL and SHM files so restored snapshot is pure
    const walFile = `${currentDbPath}-wal`;
    const shmFile = `${currentDbPath}-shm`;
    if (fs.existsSync(walFile)) {
      try { fs.unlinkSync(walFile); } catch (e) {}
    }
    if (fs.existsSync(shmFile)) {
      try { fs.unlinkSync(shmFile); } catch (e) {}
    }

    fs.copyFileSync(replacementTemp, currentDbPath);
    try { fs.unlinkSync(replacementTemp); } catch (_) {}

    initDatabase(currentDbPath);
    return { success: true, restoredFrom: backupFilePath };
  } catch (err) {
    if (fs.existsSync(safetySnapshot)) {
      const rollbackTemp = `${currentDbPath}.rollback.tmp-${process.pid}`;
      fs.copyFileSync(safetySnapshot, rollbackTemp);
      fs.copyFileSync(rollbackTemp, currentDbPath);
      try { fs.unlinkSync(rollbackTemp); } catch (_) {}
      for (const suffix of ['-wal', '-shm']) { try { fs.rmSync(`${currentDbPath}${suffix}`, { force: true }); } catch {} }
      try { initDatabase(currentDbPath); } catch {}
    }
    try { fs.rmSync(replacementTemp, { force: true }); } catch {}
    throw new Error(`Restore failed, rolled back to pre-restore state: ${err.message}`);
  }
}

/**
 * Delete a specific chat session scoped to profile
 */
function deleteChatSession(sessionId, profileId = 'prof_default') {
  const db = getDb();
  const pid = profileId || 'prof_default';
  db.exec('BEGIN TRANSACTION');
  try {
    db.prepare('DELETE FROM chat_logs WHERE session_id = ? AND profile_id = ?').run(sessionId, pid);
    db.prepare('DELETE FROM session_metadata WHERE session_id = ? AND profile_id = ?').run(sessionId, pid);
    db.prepare('DELETE FROM token_usage WHERE session_id = ? AND profile_id = ?').run(sessionId, pid);
    db.exec('COMMIT');
    return true;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

/**
 * Clear all chat logs for a specific profile
 */
function clearChatLogs(profileId = 'prof_default') {
  const db = getDb();
  const pid = profileId || 'prof_default';
  db.exec('BEGIN TRANSACTION');
  try {
    db.prepare('DELETE FROM chat_logs WHERE profile_id = ?').run(pid);
    db.prepare('DELETE FROM session_metadata WHERE profile_id = ?').run(pid);
    db.prepare('DELETE FROM token_usage WHERE profile_id = ?').run(pid);
    db.exec('COMMIT');
    return true;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

/**
 * Save provider credential metadata in SQLite
 */
function saveProviderCredentialMetadata(cred) {
  const db = getDb();
  const now = new Date().toISOString();
  const id = cred.id || `cred_${crypto.randomUUID()}`;
  db.prepare(`
    INSERT INTO provider_credentials (id, profile_id, provider_id, key_masked, key_length, store_type, cred_ref, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(profile_id, provider_id) DO UPDATE SET
      key_masked = excluded.key_masked,
      key_length = excluded.key_length,
      store_type = excluded.store_type,
      cred_ref = excluded.cred_ref,
      updated_at = excluded.updated_at
  `).run(id, cred.profileId, cred.providerId, cred.keyMasked, cred.keyLength, cred.storeType, cred.credRef, now, now);
  return { id, ...cred, updatedAt: now };
}

/**
 * Get provider credential metadata for a profile and provider
 */
function getProviderCredentialMetadata(profileId, providerId) {
  const db = getDb();
  return db.prepare('SELECT * FROM provider_credentials WHERE profile_id = ? AND provider_id = ?').get(profileId, providerId) || null;
}

/**
 * List all provider credential metadata for a profile
 */
function listProviderCredentialMetadata(profileId) {
  const db = getDb();
  return db.prepare('SELECT id, profile_id, provider_id, key_masked, key_length, store_type, created_at, updated_at FROM provider_credentials WHERE profile_id = ?').all(profileId) || [];
}

/**
 * Delete provider credential metadata for a profile and provider
 */
function removeProviderCredentialMetadata(profileId, providerId) {
  const db = getDb();
  return db.prepare('DELETE FROM provider_credentials WHERE profile_id = ? AND provider_id = ?').run(profileId, providerId);
}

function getProfileSetting(profileId, key, fallback = null) {
  if (!profileId || !key) return fallback;
  const row = getDb().prepare('SELECT setting_value FROM profile_settings WHERE profile_id = ? AND setting_key = ?').get(profileId, key);
  if (!row) return fallback;
  try { return JSON.parse(row.setting_value); } catch { return row.setting_value; }
}

function setProfileSetting(profileId, key, value) {
  if (!profileId || !key) throw new Error('Profile and setting key are required');
  const serialized = typeof value === 'string' ? JSON.stringify(value) : JSON.stringify(value);
  getDb().prepare(`
    INSERT INTO profile_settings(profile_id, setting_key, setting_value, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(profile_id, setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_at = excluded.updated_at
  `).run(profileId, key, serialized, new Date().toISOString());
}

/**
 * List all existing database backups
 */
function listBackups() {
  const currentDataDir = DATA_DIR;
  const backupDir = path.resolve(currentDataDir, 'backups');
  if (!fs.existsSync(backupDir)) return [];
  const files = fs.readdirSync(backupDir).filter(f => f.endsWith('.db') || f.endsWith('.bak'));
  return files.map(file => {
    const fullPath = path.join(backupDir, file);
    const stat = fs.statSync(fullPath);
    return {
      fileName: file,
      filePath: fullPath,
      sizeBytes: stat.size,
      createdAt: stat.mtime.toISOString()
    };
  }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

// ====================================================
// PHASE 7: KNOWLEDGE SOURCES & CHUNKS OPERATIONS
// ====================================================

function insertKnowledgeSource(src) {
  const db = getDb();
  const targetPid = src.profileId || src.profile_id || 'prof_default';
  if (!db.prepare('SELECT id FROM profiles WHERE id = ?').get(targetPid)) {
    throw new Error('Cannot create a knowledge source for an unknown profile');
  }

  return db.prepare(`
    INSERT INTO knowledge_sources (
      id, profile_id, name, file_path, file_type, file_size, file_hash,
      chunk_count, total_chars, status, indexing_error, created_at, updated_at, metadata
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    src.id, targetPid, src.name, src.filePath || src.file_path,
    src.fileType || src.file_type, src.fileSize || src.file_size, src.fileHash || src.file_hash,
    src.chunkCount || src.chunk_count || 0, src.totalChars || src.total_chars || 0,
    src.status || 'indexed', src.indexingError || src.indexing_error || null,
    src.createdAt || src.created_at || new Date().toISOString(),
    src.updatedAt || src.updated_at || new Date().toISOString(),
    typeof src.metadata === 'object' ? JSON.stringify(src.metadata) : (src.metadata || '{}')
  );
}

function getKnowledgeSource(id, profileId) {
  const db = getDb();
  if (!id) return null;
  if (profileId) {
    return db.prepare('SELECT * FROM knowledge_sources WHERE id = ? AND profile_id = ?').get(id, profileId) || null;
  }
  return db.prepare('SELECT * FROM knowledge_sources WHERE id = ?').get(id) || null;
}

function getKnowledgeSourceByHash(profileId, fileHash) {
  const db = getDb();
  return db.prepare("SELECT * FROM knowledge_sources WHERE profile_id = ? AND file_hash = ? AND status = 'indexed'").get(profileId, fileHash);
}

function listKnowledgeSources(profileId = 'prof_default') {
  const db = getDb();
  return db.prepare("SELECT * FROM knowledge_sources WHERE profile_id = ? AND status != 'deleted' ORDER BY created_at DESC").all(profileId);
}

function updateKnowledgeSource(id, updates = {}, profileId) {
  const db = getDb();
  const existing = getKnowledgeSource(id, profileId);
  if (!existing) return null;

  const resolvedProfileId = profileId || existing.profile_id;
  const status = updates.status || existing.status;
  const chunkCount = updates.chunkCount !== undefined ? updates.chunkCount : existing.chunk_count;
  const totalChars = updates.totalChars !== undefined ? updates.totalChars : existing.total_chars;
  const indexingError = updates.indexingError !== undefined ? updates.indexingError : existing.indexing_error;
  const fileHash = updates.fileHash || existing.file_hash;
  const fileSize = updates.fileSize !== undefined ? updates.fileSize : existing.file_size;
  const updatedAt = new Date().toISOString();

  db.prepare(`
    UPDATE knowledge_sources
    SET status = ?, chunk_count = ?, total_chars = ?, indexing_error = ?, file_hash = ?, file_size = ?, updated_at = ?
    WHERE id = ? AND profile_id = ?
  `).run(status, chunkCount, totalChars, indexingError, fileHash, fileSize, updatedAt, id, resolvedProfileId);

  return getKnowledgeSource(id, resolvedProfileId);
}

function deleteKnowledgeSource(id, profileId) {
  const db = getDb();
  const source = getKnowledgeSource(id, profileId);
  if (!source) return { changes: 0 };
  const resolvedProfileId = profileId || source.profile_id;
  db.exec('BEGIN TRANSACTION');
  try {
    try {
      db.prepare('DELETE FROM knowledge_chunks_fts WHERE source_id = ?').run(id);
    } catch (_) {}
    const result = db.prepare('DELETE FROM knowledge_sources WHERE id = ? AND profile_id = ?').run(id, resolvedProfileId);
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function replaceKnowledgeSource(oldId, newId, profileId) {
  const db = getDb();
  if (!profileId || !getKnowledgeSource(oldId, profileId) || !getKnowledgeSource(newId, profileId)) {
    throw new Error('Both knowledge sources must exist in the same profile before replacement.');
  }
  db.exec('BEGIN TRANSACTION');
  try {
    db.prepare('UPDATE studybook_sources SET source_id = ? WHERE source_id = ? AND profile_id = ?')
      .run(newId, oldId, profileId);
    db.prepare('DELETE FROM knowledge_sources WHERE id = ? AND profile_id = ?').run(oldId, profileId);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function insertKnowledgeChunk(chunk, sourceName = '') {
  const db = getDb();
  db.exec('SAVEPOINT knowledge_chunk_insert');
  try {
    db.prepare(`
    INSERT INTO knowledge_chunks (
      id, source_id, profile_id, chunk_index, content, section_title,
      page_number, char_count, embedding_json, metadata, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
    chunk.id, chunk.sourceId || chunk.source_id, chunk.profileId || chunk.profile_id || 'prof_default',
    chunk.chunkIndex !== undefined ? chunk.chunkIndex : (chunk.chunk_index || 0),
    chunk.content, chunk.sectionTitle || chunk.section_title || null,
    chunk.pageNumber !== undefined ? chunk.pageNumber : (chunk.page_number || null),
    chunk.charCount || chunk.char_count || chunk.content.length,
    chunk.embeddingJson || (chunk.embedding ? JSON.stringify(chunk.embedding) : null),
    typeof chunk.metadata === 'object' ? JSON.stringify(chunk.metadata) : (chunk.metadata || '{}'),
    chunk.createdAt || chunk.created_at || new Date().toISOString()
  );

    db.prepare(`
      INSERT INTO knowledge_chunks_fts (chunk_id, source_id, profile_id, source_name, section_title, content)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      chunk.id, chunk.sourceId || chunk.source_id, chunk.profileId || chunk.profile_id || 'prof_default',
      sourceName || '', chunk.sectionTitle || chunk.section_title || '', chunk.content
    );
    db.exec('RELEASE knowledge_chunk_insert');
  } catch (error) {
    db.exec('ROLLBACK TO knowledge_chunk_insert');
    db.exec('RELEASE knowledge_chunk_insert');
    throw error;
  }
}

function getKnowledgeChunksBySource(sourceId, profileId) {
  const db = getDb();
  if (!sourceId) return [];
  if (profileId) {
    return db.prepare('SELECT * FROM knowledge_chunks WHERE source_id = ? AND profile_id = ? ORDER BY chunk_index ASC').all(sourceId, profileId);
  }
  return db.prepare('SELECT * FROM knowledge_chunks WHERE source_id = ? ORDER BY chunk_index ASC').all(sourceId);
}

function getAllKnowledgeChunks(profileId = 'prof_default') {
  const db = getDb();
  return db.prepare('SELECT * FROM knowledge_chunks WHERE profile_id = ?').all(profileId);
}

function searchKnowledgeFTS(query, profileId = 'prof_default', limit = 10) {
  const db = getDb();
  if (!query || typeof query !== 'string' || !query.trim()) return [];

  // Sanitize query for FTS5 syntax (wrap tokens in quotes to prevent syntax errors on punctuation)
  const tokens = query.trim().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];

  const ftsQuery = tokens.map(t => `"${t}"`).join(' OR ');

  try {
    return db.prepare(`
      SELECT
        fts.chunk_id,
        fts.source_id,
        fts.profile_id,
        fts.source_name,
        fts.section_title,
        fts.content,
        kc.page_number,
        kc.chunk_index,
        kc.embedding_json,
        bm25(knowledge_chunks_fts) as bm25_score
      FROM knowledge_chunks_fts fts
      JOIN knowledge_chunks kc ON kc.id = fts.chunk_id
      WHERE knowledge_chunks_fts MATCH ? AND fts.profile_id = ?
      ORDER BY bm25_score ASC
      LIMIT ?
    `).all(ftsQuery, profileId, limit);
  } catch (e) {
    // Fallback if FTS match fails
    return [];
  }
}

// ====================================================
// PHASE 14: ABYXSTUDY / NOTEBOOKLM DATABASE METHODS
// ====================================================

function createStudybook({ id, profileId = 'prof_default', title, description = '', emoji = '📘', metadata = {} }) {
  const db = getDb();
  const sbId = id || ('sb_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex'));
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO studybooks (id, profile_id, title, description, emoji, created_at, updated_at, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    sbId,
    profileId,
    title || 'Untitled Studybook',
    description || '',
    emoji || '📘',
    now,
    now,
    typeof metadata === 'object' ? JSON.stringify(metadata) : (metadata || '{}')
  );
  return getStudybook(sbId, profileId);
}

function getStudybook(id, profileId = 'prof_default') {
  const db = getDb();
  const row = db.prepare('SELECT * FROM studybooks WHERE id = ? AND profile_id = ?').get(id, profileId);
  if (!row) return null;
  return {
    ...row,
    metadata: row.metadata ? JSON.parse(row.metadata) : {}
  };
}

function listStudybooks(profileId = 'prof_default') {
  const db = getDb();
  const rows = db.prepare(`
    SELECT sb.*,
      (SELECT COUNT(*) FROM studybook_sources ss WHERE ss.studybook_id = sb.id) AS source_count,
      (SELECT COUNT(*) FROM studybook_materials sm WHERE sm.studybook_id = sb.id) AS material_count
    FROM studybooks sb
    WHERE sb.profile_id = ?
    ORDER BY sb.updated_at DESC
  `).all(profileId);
  return rows.map(r => ({
    ...r,
    metadata: r.metadata ? JSON.parse(r.metadata) : {}
  }));
}

function updateStudybook(id, profileId = 'prof_default', updates = {}) {
  const db = getDb();
  const fields = [];
  const values = [];

  if (updates.title !== undefined) {
    fields.push('title = ?');
    values.push(updates.title);
  }
  if (updates.description !== undefined) {
    fields.push('description = ?');
    values.push(updates.description);
  }
  if (updates.emoji !== undefined) {
    fields.push('emoji = ?');
    values.push(updates.emoji);
  }
  if (updates.metadata !== undefined) {
    fields.push('metadata = ?');
    values.push(typeof updates.metadata === 'object' ? JSON.stringify(updates.metadata) : updates.metadata);
  }

  fields.push('updated_at = ?');
  values.push(new Date().toISOString());

  values.push(id, profileId);

  db.prepare(`UPDATE studybooks SET ${fields.join(', ')} WHERE id = ? AND profile_id = ?`).run(...values);
  return getStudybook(id, profileId);
}

function deleteStudybook(id, profileId = 'prof_default') {
  const db = getDb();
  return db.prepare('DELETE FROM studybooks WHERE id = ? AND profile_id = ?').run(id, profileId);
}

function addSourceToStudybook(studybookId, sourceId, profileId = 'prof_default') {
  const db = getDb();
  const existing = db.prepare(`
    SELECT id FROM studybook_sources WHERE studybook_id = ? AND source_id = ? AND profile_id = ?
  `).get(studybookId, sourceId, profileId);
  if (existing) return existing;

  const linkId = 'sbs_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex');
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO studybook_sources (id, studybook_id, source_id, profile_id, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(linkId, studybookId, sourceId, profileId, now);

  db.prepare('UPDATE studybooks SET updated_at = ? WHERE id = ? AND profile_id = ?').run(now, studybookId, profileId);
  return { id: linkId, studybookId, sourceId, profileId, created_at: now };
}

function removeSourceFromStudybook(studybookId, sourceId, profileId = 'prof_default') {
  const db = getDb();
  const res = db.prepare(`
    DELETE FROM studybook_sources WHERE studybook_id = ? AND source_id = ? AND profile_id = ?
  `).run(studybookId, sourceId, profileId);
  const now = new Date().toISOString();
  db.prepare('UPDATE studybooks SET updated_at = ? WHERE id = ? AND profile_id = ?').run(now, studybookId, profileId);
  return res;
}

function listStudybookSources(studybookId, profileId = 'prof_default') {
  const db = getDb();
  return db.prepare(`
    SELECT ks.*, sbs.created_at AS linked_at
    FROM studybook_sources sbs
    JOIN knowledge_sources ks ON ks.id = sbs.source_id
    WHERE sbs.studybook_id = ? AND sbs.profile_id = ? AND ks.status != 'deleted'
    ORDER BY sbs.created_at DESC
  `).all(studybookId, profileId);
}

function createStudyMaterial({ id, studybookId, profileId = 'prof_default', type, title, content, score = null, totalItems = 0, metadata = {} }) {
  const db = getDb();
  const matId = id || ('mat_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex'));
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO studybook_materials (
      id, studybook_id, profile_id, type, title, content, score, total_items, created_at, updated_at, metadata
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    matId, studybookId, profileId, type, title,
    typeof content === 'object' ? JSON.stringify(content) : (content || ''),
    score, totalItems, now, now,
    typeof metadata === 'object' ? JSON.stringify(metadata) : (metadata || '{}')
  );
  db.prepare('UPDATE studybooks SET updated_at = ? WHERE id = ? AND profile_id = ?').run(now, studybookId, profileId);
  return getStudyMaterial(matId, profileId);
}

function listStudyMaterials(studybookId, profileId = 'prof_default', type = null) {
  const db = getDb();
  let query = 'SELECT * FROM studybook_materials WHERE studybook_id = ? AND profile_id = ?';
  const params = [studybookId, profileId];
  if (type) {
    query += ' AND type = ?';
    params.push(type);
  }
  query += ' ORDER BY updated_at DESC';
  const rows = db.prepare(query).all(...params);
  return rows.map(r => {
    let parsedContent = r.content;
    try { parsedContent = JSON.parse(r.content); } catch (e) {}
    let parsedMetadata = {};
    try { parsedMetadata = JSON.parse(r.metadata); } catch (e) {}
    return {
      ...r,
      content: parsedContent,
      metadata: parsedMetadata
    };
  });
}

function getStudyMaterial(materialId, profileId = 'prof_default') {
  const db = getDb();
  const row = db.prepare('SELECT * FROM studybook_materials WHERE id = ? AND profile_id = ?').get(materialId, profileId);
  if (!row) return null;
  let parsedContent = row.content;
  try { parsedContent = JSON.parse(row.content); } catch (e) {}
  let parsedMetadata = {};
  try { parsedMetadata = JSON.parse(row.metadata); } catch (e) {}
  return {
    ...row,
    content: parsedContent,
    metadata: parsedMetadata
  };
}

function updateStudyMaterial(materialId, profileId = 'prof_default', updates = {}) {
  const db = getDb();
  const fields = [];
  const values = [];

  if (updates.title !== undefined) {
    fields.push('title = ?');
    values.push(updates.title);
  }
  if (updates.content !== undefined) {
    fields.push('content = ?');
    values.push(typeof updates.content === 'object' ? JSON.stringify(updates.content) : updates.content);
  }
  if (updates.score !== undefined) {
    fields.push('score = ?');
    values.push(updates.score);
  }
  if (updates.totalItems !== undefined || updates.total_items !== undefined) {
    fields.push('total_items = ?');
    values.push(updates.totalItems ?? updates.total_items);
  }
  if (updates.metadata !== undefined) {
    fields.push('metadata = ?');
    values.push(typeof updates.metadata === 'object' ? JSON.stringify(updates.metadata) : updates.metadata);
  }

  const now = new Date().toISOString();
  fields.push('updated_at = ?');
  values.push(now);

  values.push(materialId, profileId);

  db.prepare(`UPDATE studybook_materials SET ${fields.join(', ')} WHERE id = ? AND profile_id = ?`).run(...values);
  return getStudyMaterial(materialId, profileId);
}

function deleteStudyMaterial(materialId, profileId = 'prof_default') {
  const db = getDb();
  return db.prepare('DELETE FROM studybook_materials WHERE id = ? AND profile_id = ?').run(materialId, profileId);
}

function addStudybookMessage(studybookId, profileId = 'prof_default', role, content, citations = []) {
  const db = getDb();
  const msgId = 'sbm_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex');
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO studybook_messages (id, studybook_id, profile_id, role, content, citations_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    msgId,
    studybookId,
    profileId,
    role,
    content,
    typeof citations === 'object' ? JSON.stringify(citations) : (citations || '[]'),
    now
  );
  return { id: msgId, studybookId, profileId, role, content, citations, created_at: now };
}

function listStudybookMessages(studybookId, profileId = 'prof_default', limit = 100) {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM studybook_messages WHERE studybook_id = ? AND profile_id = ? ORDER BY created_at ASC LIMIT ?
  `).all(studybookId, profileId, limit);
  return rows.map(r => ({
    ...r,
    citations: r.citations_json ? JSON.parse(r.citations_json) : []
  }));
}

function clearStudybookMessages(studybookId, profileId = 'prof_default') {
  const db = getDb();
  return db.prepare('DELETE FROM studybook_messages WHERE studybook_id = ? AND profile_id = ?').run(studybookId, profileId);
}

module.exports = {
  initDatabase,
  getDb,
  getDatabasePath,
  logChatMessage,
  getSessionTranscript,
  getAllProfileMemory,
  getProfileSnapshot,
  formatProfileContext,
  applyMemoryActions,
  getSessionMetadata,
  getAllSessions,
  deleteChatSession,
  clearChatLogs,
  recordTokenUsage,
  getTokenUsageStats,
  recordAiUsageEvent,
  getAiUsageAnalytics,
  listAiUsageBudgets,
  saveAiUsageBudget,
  saveProviderQuotaSnapshot,
  listProviderQuotaSnapshots,
  getDashboardStats,
  saveProviderCredentialMetadata,
  getProviderCredentialMetadata,
  listProviderCredentialMetadata,
  removeProviderCredentialMetadata,
  getProfileSetting,
  setProfileSetting,
  listBackups,
  createBackup,
  restoreBackup,
  insertKnowledgeSource,
  getKnowledgeSource,
  getKnowledgeSourceByHash,
  listKnowledgeSources,
  updateKnowledgeSource,
  deleteKnowledgeSource,
  replaceKnowledgeSource,
  insertKnowledgeChunk,
  getKnowledgeChunksBySource,
  getAllKnowledgeChunks,
  searchKnowledgeFTS,
  createStudybook,
  getStudybook,
  listStudybooks,
  updateStudybook,
  deleteStudybook,
  addSourceToStudybook,
  removeSourceFromStudybook,
  listStudybookSources,
  createStudyMaterial,
  listStudyMaterials,
  getStudyMaterial,
  updateStudyMaterial,
  deleteStudyMaterial,
  addStudybookMessage,
  listStudybookMessages,
  clearStudybookMessages,
  DEFAULT_DB_PATH
};
