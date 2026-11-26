'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * EventStore - Append-Only Audit & Trajectory Replay Store
 * Persists correlated JSONL event streams for multi-agent debugging and replay.
 */
class EventStore {
  constructor(options = {}) {
    this.logFile = options.logFile || path.join(process.cwd(), 'app', 'data', 'orchestration_events.jsonl');
    this.events = [];
    this._init();
  }

  _init() {
    try {
      const dir = path.dirname(this.logFile);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    } catch (_) {}
  }

  append(event) {
    const entry = {
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
      ...event
    };
    this.events.push(entry);
    try {
      fs.appendFileSync(this.logFile, JSON.stringify(entry) + '\n', 'utf8');
    } catch (_) {}
    return entry;
  }

  list(limit = 100) {
    return this.events.slice(-limit);
  }

  query({ runId } = {}) {
    if (!runId) return this.events;
    return this.events.filter(e => e.runId === runId || e.data?.runId === runId);
  }

  clear() {
    this.events = [];
    try {
      if (fs.existsSync(this.logFile)) fs.writeFileSync(this.logFile, '', 'utf8');
    } catch (_) {}
  }
}

module.exports = EventStore;
