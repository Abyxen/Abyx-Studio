'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');

/**
 * SessionManager - Pi-style Persistent Session Lifecycle & Branching Manager
 * 
 * Invariants:
 * - Creates, lists, pauses, resumes, restores, and disposes of genuine agent sessions
 * - Durable persistence in app/data/sessions/<sessionId>.json
 * - Session Branching: Forking from a specific turn index with parent/child lineage
 * - Immutable transcript: Compaction never erases the persistent transcript!
 * - Context Checkpoints: Records turn checkpoints for audit and recovery
 */
class SessionManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.sessionsDir = options.sessionsDir || path.join(process.cwd(), 'app', 'data', 'sessions');
    this.activeSessions = new Map();
    this._ensureDir();
  }

  _ensureDir() {
    try {
      if (!fs.existsSync(this.sessionsDir)) {
        fs.mkdirSync(this.sessionsDir, { recursive: true });
      }
    } catch (_) {}
  }

  _getSessionFilePath(sessionId) {
    const safeId = String(sessionId).replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.sessionsDir, `${safeId}.json`);
  }

  createSession({
    id = null,
    goal = 'Untitled Session',
    model = 'AbyxV2 9B.gguf',
    provider = 'local_llama_server',
    systemPrompt = 'You are an autonomous AI engineering agent.',
    mode = 'build',
    profileId = 'prof_default',
    parentId = null,
    forkPointTurn = null,
    metadata = {}
  }) {
    const sessionId = id || `sess_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    
    const session = {
      id: sessionId,
      goal,
      model,
      provider,
      systemPrompt,
      mode, // 'plan' | 'build'
      profileId,
      status: 'idle', // 'idle' | 'running' | 'paused' | 'completed' | 'cancelled' | 'failed'
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      parentId: parentId || null,
      forkPointTurn: forkPointTurn || null,
      branches: [],
      turnsCount: 0,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: goal }
      ],
      // Immutable persistent transcript - NEVER compacted or pruned
      transcript: [
        {
          type: 'init',
          goal,
          systemPrompt,
          timestamp: new Date().toISOString()
        }
      ],
      turns: [],
      checkpoints: [],
      metadata
    };

    this.activeSessions.set(sessionId, session);
    this.saveSession(session);
    this.emit('session:created', session);
    return session;
  }

  getSession(sessionId) {
    if (this.activeSessions.has(sessionId)) {
      return this.activeSessions.get(sessionId);
    }
    return this.restoreSession(sessionId);
  }

  saveSession(session) {
    if (!session || !session.id) return false;
    session.updatedAt = new Date().toISOString();
    this.activeSessions.set(session.id, session);

    try {
      const file = this._getSessionFilePath(session.id);
      fs.writeFileSync(file, JSON.stringify(session, null, 2), 'utf8');
      return true;
    } catch (err) {
      console.warn(`[SessionManager] Failed to persist session ${session.id}:`, err.message);
      return false;
    }
  }

  restoreSession(sessionId) {
    const file = this._getSessionFilePath(sessionId);
    if (!fs.existsSync(file)) return null;

    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      // Ensure transcript and checkpoints arrays exist
      if (!Array.isArray(data.transcript)) data.transcript = [...(data.turns || [])];
      if (!Array.isArray(data.checkpoints)) data.checkpoints = [];
      if (!Array.isArray(data.branches)) data.branches = [];

      this.activeSessions.set(sessionId, data);
      this.emit('session:restored', data);
      return data;
    } catch (err) {
      console.warn(`[SessionManager] Failed to restore session ${sessionId}:`, err.message);
      return null;
    }
  }

  listSessions() {
    const memoryList = Array.from(this.activeSessions.values());
    const onDisk = [];

    try {
      const files = fs.readdirSync(this.sessionsDir);
      for (const f of files) {
        if (f.endsWith('.json')) {
          const id = f.replace('.json', '');
          if (!this.activeSessions.has(id)) {
            const restored = this.restoreSession(id);
            if (restored) onDisk.push(restored);
          }
        }
      }
    } catch (_) {}

    const all = [...memoryList, ...onDisk];
    all.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
    return all;
  }

  /**
   * Session Branching (Pi & OpenCode session forking pattern)
   * Creates an independent child session branching from a specific turn.
   */
  branchSession(parentSessionId, { fromTurnIndex = null, newSessionId = null, goal = null } = {}) {
    const parent = this.getSession(parentSessionId);
    if (!parent) {
      throw new Error(`Cannot branch from non-existent session: ${parentSessionId}`);
    }

    const forkIndex = fromTurnIndex !== null ? Math.min(fromTurnIndex, parent.turnsCount) : parent.turnsCount;
    const branchId = newSessionId || `${parent.id}_fork_${Date.now()}`;

    // Slice messages up to the fork point
    const slicedMessages = [];
    let turnCounter = 0;
    for (const msg of parent.messages) {
      if (msg.role === 'system' || msg.role === 'user') {
        slicedMessages.push({ ...msg });
      } else {
        turnCounter++;
        if (turnCounter <= forkIndex) {
          slicedMessages.push({ ...msg });
        }
      }
    }

    const slicedTurns = (parent.turns || []).slice(0, forkIndex);
    const slicedTranscript = (parent.transcript || []).slice(0, forkIndex + 1);

    const childSession = {
      id: branchId,
      goal: goal || `Branch from ${parent.id} (turn ${forkIndex})`,
      model: parent.model,
      provider: parent.provider,
      systemPrompt: parent.systemPrompt,
      mode: parent.mode,
      profileId: parent.profileId,
      status: 'idle',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      parentId: parent.id,
      forkPointTurn: forkIndex,
      branches: [],
      turnsCount: forkIndex,
      messages: slicedMessages,
      transcript: [
        ...slicedTranscript,
        {
          type: 'fork',
          parentId: parent.id,
          forkPointTurn: forkIndex,
          timestamp: new Date().toISOString()
        }
      ],
      turns: [...slicedTurns],
      checkpoints: [...(parent.checkpoints || [])],
      metadata: {
        ...(parent.metadata || {}),
        parentSessionId: parent.id,
        forkPoint: forkIndex
      }
    };

    // Update parent's branches list
    if (!Array.isArray(parent.branches)) parent.branches = [];
    parent.branches.push(branchId);
    this.saveSession(parent);

    this.activeSessions.set(branchId, childSession);
    this.saveSession(childSession);
    this.emit('session:branched', { parentId: parent.id, branchId, forkIndex });
    return childSession;
  }

  /**
   * Appends an immutable turn to both ephemeral turns and permanent transcript
   */
  recordTurn(sessionId, turnData) {
    const session = this.getSession(sessionId);
    if (!session) return false;

    if (turnData.step !== undefined) {
      session.turnsCount = Math.max(session.turnsCount || 0, turnData.step);
    } else {
      session.turnsCount = (session.turnsCount || 0) + 1;
    }
    const turnRecord = {
      step: session.turnsCount,
      timestamp: new Date().toISOString(),
      ...turnData
    };

    if (!Array.isArray(session.turns)) session.turns = [];
    if (!Array.isArray(session.transcript)) session.transcript = [];

    session.turns.push(turnRecord);
    session.transcript.push(turnRecord);

    this.saveSession(session);
    return turnRecord;
  }

  /**
   * Records a context checkpoint
   */
  addCheckpoint(sessionId, checkpoint) {
    const session = this.getSession(sessionId);
    if (!session) return false;

    if (!Array.isArray(session.checkpoints)) session.checkpoints = [];
    const entry = {
      checkpointId: `chk_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      turnIndex: session.turnsCount || 0,
      timestamp: new Date().toISOString(),
      ...checkpoint
    };
    session.checkpoints.push(entry);
    this.saveSession(session);
    this.emit('session:checkpoint', { sessionId, checkpoint: entry });
    return entry;
  }

  getCheckpoints(sessionId) {
    const session = this.getSession(sessionId);
    return session ? (session.checkpoints || []) : [];
  }

  pauseSession(sessionId) {
    const session = this.getSession(sessionId);
    if (!session) return false;
    session.status = 'paused';
    this.saveSession(session);
    this.emit('session:paused', { sessionId });
    return true;
  }

  resumeSession(sessionId) {
    const session = this.getSession(sessionId);
    if (!session) return false;
    session.status = 'idle';
    this.saveSession(session);
    this.emit('session:resumed', { sessionId });
    return true;
  }

  cancelSession(sessionId, reason = 'Cancelled by user') {
    const session = this.getSession(sessionId);
    if (!session) return false;
    session.status = 'cancelled';
    session.cancellationReason = reason;
    this.saveSession(session);
    this.emit('session:cancelled', { sessionId, reason });
    return true;
  }

  disposeSession(sessionId) {
    const session = this.getSession(sessionId);
    this.activeSessions.delete(sessionId);
    
    try {
      const file = this._getSessionFilePath(sessionId);
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
      this.emit('session:disposed', { sessionId });
      return true;
    } catch (_) {
      return false;
    }
  }
}

module.exports = SessionManager;
