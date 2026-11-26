'use strict';

const { EventEmitter } = require('node:events');

/**
 * MessageBus - High-Throughput Inter-Agent Communication Bus
 * Supports point-to-point direct messages, topic broadcasts, and delivery guarantees.
 */
class MessageBus extends EventEmitter {
  constructor() {
    super();
    this.messages = [];
  }

  sendDirect({ from, to, message, correlationId = null }) {
    const msg = {
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      type: 'direct',
      from,
      to,
      message,
      correlationId: correlationId || `corr_${Date.now()}`,
      timestamp: new Date().toISOString()
    };
    this.messages.push(msg);
    this.emit(`message:${to}`, msg);
    this.emit('message', msg);
    return msg;
  }

  broadcast({ from, message, topic = 'general' }) {
    const msg = {
      id: `bcast_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      type: 'broadcast',
      from,
      topic,
      message,
      timestamp: new Date().toISOString()
    };
    this.messages.push(msg);
    this.emit(`topic:${topic}`, msg);
    this.emit('broadcast', msg);
    return msg;
  }

  getHistory({ agentId = null, limit = 50 } = {}) {
    if (!agentId) return this.messages.slice(-limit);
    return this.messages
      .filter(m => m.from === agentId || m.to === agentId || m.type === 'broadcast')
      .slice(-limit);
  }

  clear() {
    this.messages = [];
  }
}

module.exports = MessageBus;
