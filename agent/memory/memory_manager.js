'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

/**
 * SessionMemory - Ephemeral Active Working State
 * Tracks current conversation turns, active task goals, agent states,
 * and a bounded circular buffer of recent tool observations.
 * Prevents context bloat by discarding unbounded raw observations.
 */
class SessionMemory {
  constructor(options = {}) {
    this.maxObservations = options.maxObservations || 10;
    this.maxTurns = options.maxTurns || 30;
    this.conversationTurns = [];
    this.currentTask = null;
    this.agentStates = new Map();
    this.recentObservations = [];
  }

  recordTurn(role, content) {
    if (!content) return;
    this.conversationTurns.push({
      role,
      content: typeof content === 'string' ? content : JSON.stringify(content),
      timestamp: new Date().toISOString()
    });
    if (this.conversationTurns.length > this.maxTurns) {
      this.conversationTurns.shift();
    }
  }

  setTask(task) {
    this.currentTask = {
      id: task.id || `task_${Date.now()}`,
      goal: task.goal || task.description || '',
      activeStep: task.activeStep || 0,
      status: task.status || 'in_progress',
      updatedAt: new Date().toISOString()
    };
  }

  updateAgentState(agentId, stateUpdates) {
    const existing = this.agentStates.get(agentId) || {};
    this.agentStates.set(agentId, {
      ...existing,
      ...stateUpdates,
      updatedAt: new Date().toISOString()
    });
  }

  getAgentState(agentId) {
    return this.agentStates.get(agentId) || null;
  }

  recordToolResult(tool, args, result) {
    // Avoid blindly storing massive raw payloads; summarize if excessively large
    let outputDigest = result;
    if (result && typeof result === 'object') {
      const serialized = JSON.stringify(result);
      if (serialized.length > 2000) {
        outputDigest = {
          truncated: true,
          preview: serialized.slice(0, 1000) + '... [TRUNCATED FOR MEMORY EFFICIENCY]',
          success: result.success ?? result.ok ?? true
        };
      }
    } else if (typeof result === 'string' && result.length > 2000) {
      outputDigest = result.slice(0, 1000) + '... [TRUNCATED FOR MEMORY EFFICIENCY]';
    }

    this.recentObservations.push({
      id: `obs_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      tool,
      args: typeof args === 'object' ? { ...args } : args,
      result: outputDigest,
      timestamp: new Date().toISOString()
    });

    if (this.recentObservations.length > this.maxObservations) {
      this.recentObservations.shift();
    }
  }

  getRecentObservations(limit = 5) {
    return this.recentObservations.slice(-limit);
  }

  getSnapshot() {
    return {
      turnsCount: this.conversationTurns.length,
      currentTask: this.currentTask ? { ...this.currentTask } : null,
      agentStates: Object.fromEntries(this.agentStates.entries()),
      recentObservationsCount: this.recentObservations.length
    };
  }

  clear() {
    this.conversationTurns = [];
    this.currentTask = null;
    this.agentStates.clear();
    this.recentObservations = [];
  }
}

/**
 * MemoryManager - Master 3-Tier Native Memory Subsystem
 * Tier 1: Session Memory (In-Memory, Active Task & Bounded Observations)
 * Tier 2: Project Memory (SQLite Scoped to Workspace/ProjectId)
 * Tier 3: Persistent Memory (Durable Cross-Project, FTS-Indexed, User-Approved Facts)
 */
class MemoryManager {
  constructor(options = {}) {
    this.workspaceRoot = options.workspaceRoot || process.cwd();
    this.dbPath = options.dbPath || path.join(this.workspaceRoot, 'app', 'data', 'abyx_memory.db');
    this.session = new SessionMemory(options.sessionOptions || {});
    this.ftsEnabled = false;
    this._initDatabase();
  }

  _initDatabase() {
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new DatabaseSync(this.dbPath);
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA busy_timeout = 5000;');

    // 1. Project Memory Table (Scoped strictly to projectId)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS project_memories (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        category TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        tags TEXT DEFAULT '[]',
        agent_id TEXT DEFAULT 'system',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        expires_at TEXT,
        status TEXT DEFAULT 'active'
      );
      CREATE INDEX IF NOT EXISTS idx_proj_mem_lookup ON project_memories(project_id, category, status);
      CREATE INDEX IF NOT EXISTS idx_proj_mem_fingerprint ON project_memories(project_id, fingerprint);
    `);

    // 2. Persistent Memory Table (Cross-project, durable facts, preferences)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS persistent_memories (
        id TEXT PRIMARY KEY,
        category TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        fingerprint TEXT UNIQUE NOT NULL,
        tags TEXT DEFAULT '[]',
        agent_id TEXT DEFAULT 'system',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        access_count INTEGER DEFAULT 1,
        last_accessed_at TEXT NOT NULL,
        approved INTEGER DEFAULT 0,
        approval_status TEXT DEFAULT 'pending_review',
        approved_by TEXT,
        status TEXT DEFAULT 'active'
      );
      CREATE INDEX IF NOT EXISTS idx_pers_mem_cat ON persistent_memories(category, approval_status);
      CREATE INDEX IF NOT EXISTS idx_pers_mem_status ON persistent_memories(status);
    `);

    // 3. Full-Text Search (FTS5 with resilient indexed-table fallback)
    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS persistent_memories_fts USING fts5(
          title,
          content,
          tags,
          content=persistent_memories,
          content_rowid=rowid
        );
      `);
      this.ftsEnabled = true;
    } catch (_) {
      // Fallback for Node.js SQLite builds without fts5 compiled in
      this.ftsEnabled = false;
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS persistent_memories_text_idx (
          memory_id TEXT PRIMARY KEY,
          search_tokens TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mem_tokens ON persistent_memories_text_idx(search_tokens);
      `);
    }
  }

  /**
   * Generates a deterministic hash fingerprint for content deduplication
   */
  _computeFingerprint(content, title = '') {
    const normalized = (title.trim().toLowerCase() + '::' + content.trim().toLowerCase())
      .replace(/\s+/g, ' ');
    return crypto.createHash('sha256').update(normalized).digest('hex');
  }

  /**
   * Filter check to guarantee we do NOT blindly store every message or raw tool result
   */
  _shouldPersist(content, category) {
    if (!content || typeof content !== 'string') return false;
    const trimmed = content.trim();
    if (trimmed.length < 10) return false;

    // Filter trivial chit-chat or greetings
    const trivialPatterns = [
      /^(hi|hello|hey|thanks|thank you|ok|okay|sure|understood|got it|sounds good)[\.!]?$/i,
      /^run_command exited with code 0$/i,
      /^file created successfully$/i
    ];
    if (trivialPatterns.some(p => p.test(trimmed))) return false;

    return true;
  }

  /**
   * Creates a memory entry at Project or Persistent level with deduplication
   */
  createMemory({
    level = 'project',
    category = 'technical_knowledge',
    title,
    content,
    tags = [],
    projectId = 'default_project',
    agentId = 'system',
    approved = false,
    ttlSeconds = null
  }) {
    if (!this._shouldPersist(content, category)) {
      return { ok: false, ignored: true, reason: 'Content filtered out as transient or trivial' };
    }

    const safeTitle = (title || content.slice(0, 60)).trim();
    const fingerprint = this._computeFingerprint(content, safeTitle);
    const now = new Date().toISOString();
    const expiresAt = ttlSeconds ? new Date(Date.now() + ttlSeconds * 1000).toISOString() : null;
    const tagsJson = JSON.stringify(Array.isArray(tags) ? tags : [tags]);

    if (level === 'session') {
      this.session.recordTurn('assistant', `${safeTitle}: ${content}`);
      return { ok: true, id: `session_${Date.now()}`, level: 'session' };
    }

    if (level === 'project') {
      // Check existing project memory deduplication
      const existing = this.db.prepare(
        'SELECT id, tags FROM project_memories WHERE project_id = ? AND fingerprint = ? AND status = ?'
      ).get(projectId, fingerprint, 'active');

      if (existing) {
        // Update timestamp and merge tags
        let existingTags = [];
        try { existingTags = JSON.parse(existing.tags); } catch (_) {}
        const merged = Array.from(new Set([...existingTags, ...(Array.isArray(tags) ? tags : [tags])]));
        this.db.prepare(
          'UPDATE project_memories SET updated_at = ?, tags = ? WHERE id = ?'
        ).run(now, JSON.stringify(merged), existing.id);
        return { ok: true, id: existing.id, deduplicated: true, level: 'project' };
      }

      const id = `pm_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
      this.db.prepare(`
        INSERT INTO project_memories (
          id, project_id, category, title, content, fingerprint, tags, agent_id, created_at, updated_at, expires_at, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
      `).run(id, projectId, category, safeTitle, content, fingerprint, tagsJson, agentId, now, now, expiresAt);

      return { ok: true, id, deduplicated: false, level: 'project' };
    }

    if (level === 'persistent') {
      // Check existing persistent memory deduplication
      const existing = this.db.prepare(
        'SELECT id, access_count, tags, approved FROM persistent_memories WHERE fingerprint = ? AND status = ?'
      ).get(fingerprint, 'active');

      if (existing) {
        let existingTags = [];
        try { existingTags = JSON.parse(existing.tags); } catch (_) {}
        const merged = Array.from(new Set([...existingTags, ...(Array.isArray(tags) ? tags : [tags])]));
        this.db.prepare(`
          UPDATE persistent_memories
          SET access_count = access_count + 1, last_accessed_at = ?, updated_at = ?, tags = ?
          WHERE id = ?
        `).run(now, now, JSON.stringify(merged), existing.id);
        return { ok: true, id: existing.id, deduplicated: true, level: 'persistent' };
      }

      const id = `perm_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
      const approvalStatus = approved ? 'approved' : 'pending_review';
      const isApprovedInt = approved ? 1 : 0;

      this.db.prepare(`
        INSERT INTO persistent_memories (
          id, category, title, content, fingerprint, tags, agent_id, created_at, updated_at,
          access_count, last_accessed_at, approved, approval_status, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 'active')
      `).run(id, category, safeTitle, content, fingerprint, tagsJson, agentId, now, now, now, isApprovedInt, approvalStatus);

      // FTS indexing
      if (this.ftsEnabled) {
        try {
          this.db.prepare(
            'INSERT INTO persistent_memories_fts (title, content, tags) VALUES (?, ?, ?)'
          ).run(safeTitle, content, tagsJson);
        } catch (_) {}
      } else {
        const tokens = `${safeTitle} ${content} ${tags.join(' ')}`.toLowerCase();
        this.db.prepare(
          'INSERT OR REPLACE INTO persistent_memories_text_idx (memory_id, search_tokens) VALUES (?, ?)'
        ).run(id, tokens);
      }

      return { ok: true, id, deduplicated: false, level: 'persistent', approved };
    }

    throw new Error(`Unsupported memory level: ${level}`);
  }

  /**
   * Reviews a persistent memory entry (Human-in-the-Loop approval)
   */
  reviewMemory(id, { approved = true, reviewedBy = 'user' } = {}) {
    const now = new Date().toISOString();
    const status = approved ? 'approved' : 'rejected';
    const approvedInt = approved ? 1 : 0;

    const res = this.db.prepare(`
      UPDATE persistent_memories
      SET approved = ?, approval_status = ?, approved_by = ?, updated_at = ?
      WHERE id = ?
    `).run(approvedInt, status, reviewedBy, now, id);

    return { ok: res.changes > 0, id, approved, status };
  }

  /**
   * Updates an existing memory item
   */
  updateMemory(id, { title, content, tags, category, level = 'project' }) {
    const now = new Date().toISOString();
    const table = level === 'persistent' ? 'persistent_memories' : 'project_memories';

    const current = this.db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
    if (!current) return { ok: false, error: 'Memory item not found' };

    const newTitle = title !== undefined ? title : current.title;
    const newContent = content !== undefined ? content : current.content;
    const newCategory = category !== undefined ? category : current.category;
    const newTags = tags !== undefined ? JSON.stringify(tags) : current.tags;
    const newFingerprint = this._computeFingerprint(newContent, newTitle);

    this.db.prepare(`
      UPDATE ${table}
      SET title = ?, content = ?, category = ?, tags = ?, fingerprint = ?, updated_at = ?
      WHERE id = ?
    `).run(newTitle, newContent, newCategory, newTags, newFingerprint, now, id);

    return { ok: true, id, updated: true };
  }

  /**
   * Deletes a memory item (soft-delete by default, hard-delete optional)
   */
  deleteMemory(id, { hard = false, level = 'project' } = {}) {
    const table = level === 'persistent' ? 'persistent_memories' : 'project_memories';
    if (hard) {
      this.db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
      if (level === 'persistent' && !this.ftsEnabled) {
        this.db.prepare('DELETE FROM persistent_memories_text_idx WHERE memory_id = ?').run(id);
      }
    } else {
      this.db.prepare(`UPDATE ${table} SET status = 'deleted', updated_at = ? WHERE id = ?`).run(new Date().toISOString(), id);
    }
    return { ok: true, id, deleted: true, hard };
  }

  /**
   * Search and relevance scoring across Project and Persistent tiers
   */
  searchMemory({
    query = '',
    projectId = null,
    agentId = null,
    category = null,
    level = 'all', // 'project' | 'persistent' | 'all'
    limit = 10,
    minScore = 0.05,
    approvedOnly = false
  }) {
    const results = [];
    const q = (query || '').trim().toLowerCase();
    const qTokens = q.split(/\W+/).filter(t => t.length > 2);
    const nowMs = Date.now();

    // 1. Project Memory Query (Strict project separation)
    if (level === 'all' || level === 'project') {
      let sql = "SELECT * FROM project_memories WHERE status = 'active'";
      const params = [];
      if (projectId) {
        sql += ' AND project_id = ?';
        params.push(projectId);
      }
      if (category) {
        sql += ' AND category = ?';
        params.push(category);
      }

      const rows = this.db.prepare(sql).all(...params);
      for (const row of rows) {
        // Expiration check
        if (row.expires_at && new Date(row.expires_at).getTime() < nowMs) continue;

        // Agent-specific permission check if row has restricted agent scope
        if (agentId && row.agent_id !== 'system' && row.agent_id !== agentId && !row.agent_id.includes('*')) {
          // Allow read if general knowledge or matches
          if (row.category === 'decisions' || row.category === 'instructions') {
            // Read-only shared project context
          } else {
            continue;
          }
        }

        const score = this._calculateRelevance(row, q, qTokens, nowMs);
        if (score >= minScore) {
          let parsedTags = [];
          try { parsedTags = JSON.parse(row.tags); } catch (_) {}
          results.push({
            id: row.id,
            level: 'project',
            projectId: row.project_id,
            category: row.category,
            title: row.title,
            content: row.content,
            tags: parsedTags,
            agentId: row.agent_id,
            score,
            createdAt: row.created_at,
            updatedAt: row.updated_at
          });
        }
      }
    }

    // 2. Persistent Memory Query
    if (level === 'all' || level === 'persistent') {
      let sql = "SELECT * FROM persistent_memories WHERE status = 'active'";
      const params = [];
      if (approvedOnly) {
        sql += ' AND approved = 1';
      }
      if (category) {
        sql += ' AND category = ?';
        params.push(category);
      }

      const rows = this.db.prepare(sql).all(...params);
      for (const row of rows) {
        const score = this._calculateRelevance(row, q, qTokens, nowMs) * (row.approved === 1 ? 1.0 : 0.6);
        if (score >= minScore) {
          let parsedTags = [];
          try { parsedTags = JSON.parse(row.tags); } catch (_) {}
          results.push({
            id: row.id,
            level: 'persistent',
            category: row.category,
            title: row.title,
            content: row.content,
            tags: parsedTags,
            agentId: row.agent_id,
            approved: row.approved === 1,
            approvalStatus: row.approval_status,
            accessCount: row.access_count,
            score,
            createdAt: row.created_at,
            updatedAt: row.updated_at
          });
        }
      }
    }

    // Sort by descending relevance score
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  /**
   * Multi-signal relevance scoring algorithm
   */
  _calculateRelevance(row, query, tokens, nowMs) {
    if (!query) return 0.5; // Baseline if no query filter

    let textScore = 0;
    const combined = `${row.title} ${row.content} ${row.tags}`.toLowerCase();

    // Exact phrase match gives heavy boost
    if (combined.includes(query)) {
      textScore += 0.6;
    }

    // Token frequency match
    let matchedTokens = 0;
    for (const token of tokens) {
      if (combined.includes(token)) matchedTokens++;
    }
    if (tokens.length > 0) {
      textScore += (matchedTokens / tokens.length) * 0.4;
    }

    if (textScore === 0) return 0;

    // Recency decay factor (half-life of 14 days)
    const ageDays = (nowMs - new Date(row.updated_at || row.created_at).getTime()) / (1000 * 60 * 60 * 24);
    const recencyMultiplier = 1 / (1 + ageDays / 14);

    return Math.min(1.0, textScore * (0.8 + 0.2 * recencyMultiplier));
  }

  /**
   * Prunes expired memories whose TTL has elapsed
   */
  pruneExpired() {
    const now = new Date().toISOString();
    const res = this.db.prepare(
      "UPDATE project_memories SET status = 'expired' WHERE expires_at IS NOT NULL AND expires_at < ? AND status = 'active'"
    ).run(now);
    return { ok: true, prunedCount: res.changes };
  }

  /**
   * Retrieves summary statistics
   */
  getStats(projectId = null) {
    const projectCount = projectId
      ? this.db.prepare("SELECT count(*) as count FROM project_memories WHERE project_id = ? AND status = 'active'").get(projectId).count
      : this.db.prepare("SELECT count(*) as count FROM project_memories WHERE status = 'active'").get().count;

    const persistentCount = this.db.prepare("SELECT count(*) as count FROM persistent_memories WHERE status = 'active'").get().count;
    const approvedCount = this.db.prepare("SELECT count(*) as count FROM persistent_memories WHERE approved = 1 AND status = 'active'").get().count;

    return {
      session: this.session.getSnapshot(),
      projectMemoriesCount: projectCount,
      persistentMemoriesCount: persistentCount,
      approvedMemoriesCount: approvedCount,
      ftsEnabled: this.ftsEnabled
    };
  }

  close() {
    if (this.db) {
      try { this.db.close(); } catch (_) {}
    }
  }
}

module.exports = {
  SessionMemory,
  MemoryManager
};
