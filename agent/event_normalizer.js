'use strict';

/**
 * EventNormalizer - Pi-style Event Stream Normalizer
 * Normalizes asynchronous execution events into typed, monotonically sequenced audit records.
 */
class EventNormalizer {
  constructor(sessionId = 'default') {
    this.sessionId = sessionId;
    this.sequence = 0;
  }

  normalize(type, data = {}) {
    this.sequence++;
    return {
      eventId: `evt_${Date.now()}_${this.sequence}`,
      sessionId: this.sessionId,
      sequence: this.sequence,
      type,
      timestamp: new Date().toISOString(),
      data
    };
  }

  // Pre-typed event constructors
  sessionCreated(session) {
    return this.normalize('session:created', { session });
  }

  sessionRestored(session) {
    return this.normalize('session:restored', { sessionId: session.id, turnsCount: session.turns?.length || 0 });
  }

  turnStart(step, maxSteps) {
    return this.normalize('turn:start', { step, maxSteps });
  }

  turnDelta(delta) {
    return this.normalize('turn:delta', { delta });
  }

  reasoningDelta(reasoning) {
    return this.normalize('reasoning:delta', { reasoning });
  }

  toolCallRequested(tool, args, callId) {
    return this.normalize('tool:call:requested', { tool, args, callId });
  }

  toolCallExecuting(tool, args, callId) {
    return this.normalize('tool:call:executing', { tool, args, callId });
  }

  toolCallResult(tool, result, callId, durationMs) {
    return this.normalize('tool:call:result', { tool, result, callId, durationMs });
  }

  toolCallError(tool, error, callId) {
    return this.normalize('tool:call:error', { tool, error, callId });
  }

  turnEnd(step, answer = null) {
    return this.normalize('turn:end', { step, answer });
  }

  sessionCompleted(result, totalTurns) {
    return this.normalize('session:completed', { result, totalTurns });
  }

  sessionCancelled(reason) {
    return this.normalize('session:cancelled', { reason });
  }

  sessionError(error) {
    return this.normalize('session:error', { error });
  }
}

module.exports = EventNormalizer;
