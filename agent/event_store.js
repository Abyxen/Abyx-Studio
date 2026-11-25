'use strict';

/**
 * ABYX Persistent Event Store
 * Append-only structured log of all multi-agent runtime events, DAG transitions,
 * tool invocations, and findings with disk persistence and querying.
 */

const fs = require('node:fs');
const path = require('node:path');
const { dataDir } = require('../data_paths');

const EVENTS_FILE = path.join(dataDir, 'orchestration_events.jsonl');

class EventStore {
  constructor(options = {}) {
    this.eventsFile = options.eventsFile || EVENTS_FILE;
    this.memoryBuffer = []; // In-memory ring buffer for low-latency queries
    this.maxMemoryBuffer = options.maxMemoryBuffer || 2000;

    this._ensureFile();
  }

  _ensureFile() {
    try {
      const dir = path.dirname(this.eventsFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      if (!fs.existsSync(this.eventsFile)) {
        fs.writeFileSync(this.eventsFile, '', 'utf8');
      }
    } catch (err) {
      console.warn('[EVENT_STORE] File init warning:', err.message);
    }
  }

  /**
   * Append a typed runtime event
   * @param {string} type - Event type (e.g. 'task:started', 'tool:executed')
   * @param {object} payload - Event payload
   */
  append(type, payload = {}) {
    const event = {
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type,
      timestamp: new Date().toISOString(),
      ...payload
    };

    // 1. In-memory buffer
    this.memoryBuffer.push(event);
    if (this.memoryBuffer.length > this.maxMemoryBuffer) {
      this.memoryBuffer.shift();
    }

    // 2. Append to disk asynchronously
    try {
      const line = JSON.stringify(event) + '\n';
      fs.appendFile(this.eventsFile, line, 'utf8', (err) => {
        if (err) console.warn('[EVENT_STORE] Write error:', err.message);
      });
    } catch (err) {
      console.warn('[EVENT_STORE] Append error:', err.message);
    }

    return event;
  }

  /**
   * Query events by filter
   */
  query({ runId = null, taskId = null, type = null, limit = 100 } = {}) {
    let results = this.memoryBuffer;

    if (runId) {
      results = results.filter(e => e.runId === runId);
    }
    if (taskId) {
      results = results.filter(e => e.taskId === taskId);
    }
    if (type) {
      results = results.filter(e => e.type === type);
    }

    return results.slice(-limit);
  }

  /**
   * Clear in-memory buffer (for testing)
   */
  clear() {
    this.memoryBuffer = [];
  }
}

module.exports = EventStore;
