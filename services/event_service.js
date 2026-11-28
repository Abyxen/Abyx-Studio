'use strict';

const EventEmitter = require('node:events');

/**
 * EventService - Central In-Memory Ordered Event Broker
 * Supports event publishing, subscriber dispatch, and event log replay for WebSockets and SSE.
 */
class EventService extends EventEmitter {
  constructor() {
    super();
    this.eventLog = [];
    this.maxBufferSize = 1000;
  }

  publish(evt) {
    const enriched = {
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
      ...evt
    };
    this.eventLog.push(enriched);
    if (this.eventLog.length > this.maxBufferSize) {
      this.eventLog.shift();
    }
    this.emit('event', enriched);
    return enriched;
  }

  subscribe(listener) {
    this.on('event', listener);
    return () => this.off('event', listener);
  }

  getEvents(fromOffset = 0) {
    return this.eventLog.slice(fromOffset);
  }
}

module.exports = { EventService };
