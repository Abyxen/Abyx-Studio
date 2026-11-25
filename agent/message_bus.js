'use strict';

/**
 * ABYX Inter-Agent Message Bus
 * Structured, traceable event-driven communication backbone for multi-agent workflows.
 * Enables tasks, status updates, findings, tool telemetry, and completion signals.
 */

const { EventEmitter } = require('events');

class AgentMessageBus extends EventEmitter {
  constructor({ maxHistory = 1000 } = {}) {
    super();
    this.maxHistory = maxHistory;
    this.history = [];
    this.subscriptions = new Map(); // topic -> Set<callback>
  }

  /**
   * Publishes an event to the message bus
   * @param {string} type - Event type (e.g. 'task:assigned', 'finding:published')
   * @param {object} payload - Event payload
   * @param {string} [sender='system'] - Sending agent ID
   * @param {string} [recipient='*'] - Target agent ID or '*' for broadcast
   */
  publish(type, payload = {}, sender = 'system', recipient = '*') {
    const event = {
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type,
      sender,
      recipient,
      payload,
      timestamp: new Date().toISOString()
    };

    // Keep bounded history
    this.history.push(event);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }

    // Emit typed event and wildcard event
    this.emit(type, event);
    this.emit('*', event);

    // Deliver to targeted recipient if specific listener exists
    if (recipient !== '*' && this.subscriptions.has(recipient)) {
      for (const handler of this.subscriptions.get(recipient)) {
        try { handler(event); } catch (err) { console.warn(`[BUS] Handler error for ${recipient}:`, err.message); }
      }
    }

    return event;
  }

  /**
   * Subscribe an agent or handler to messages directed to it or broadcast
   */
  subscribe(type, handler) {
    this.on(type, handler);
    return () => this.off(type, handler);
  }

  subscribeAgent(agentId, handler) {
    if (!this.subscriptions.has(agentId)) {
      this.subscriptions.set(agentId, new Set());
    }
    this.subscriptions.get(agentId).add(handler);

    return () => {
      const set = this.subscriptions.get(agentId);
      if (set) set.delete(handler);
    };
  }

  /**
   * Query filtered history
   */
  getHistory({ type, sender, recipient, limit = 50 } = {}) {
    return this.history
      .filter(e => {
        if (type && e.type !== type) return false;
        if (sender && e.sender !== sender) return false;
        if (recipient && e.recipient !== recipient && e.recipient !== '*') return false;
        return true;
      })
      .slice(-limit);
  }

  clear() {
    this.history = [];
    this.subscriptions.clear();
  }
}

module.exports = AgentMessageBus;
