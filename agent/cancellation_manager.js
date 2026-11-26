'use strict';

/**
 * CancellationManager - Coordinated Task & Session Cancellation
 * Manages AbortController instances, linked parent/child cancellation signals,
 * and graceful teardown of in-flight HTTP requests and child processes.
 */
class CancellationManager {
  constructor() {
    this.controllers = new Map();
  }

  createToken(sessionId, timeoutMs = null) {
    const controller = new AbortController();
    let timeoutTimer = null;

    if (typeof timeoutMs === 'number' && timeoutMs > 0) {
      timeoutTimer = setTimeout(() => {
        this.cancel(sessionId, `Execution timed out after ${timeoutMs}ms`);
      }, timeoutMs);
    }

    const token = {
      sessionId,
      controller,
      signal: controller.signal,
      timeoutTimer,
      createdAt: Date.now()
    };

    this.controllers.set(sessionId, token);
    return token;
  }

  getToken(sessionId) {
    return this.controllers.get(sessionId) || null;
  }

  getSignal(sessionId) {
    const token = this.controllers.get(sessionId);
    return token ? token.signal : null;
  }

  cancel(sessionId, reason = 'Operation cancelled by user') {
    const token = this.controllers.get(sessionId);
    if (!token) return false;

    if (token.timeoutTimer) clearTimeout(token.timeoutTimer);
    if (!token.controller.signal.aborted) {
      token.controller.abort(new Error(reason));
    }

    this.controllers.delete(sessionId);
    return true;
  }

  isCancelled(sessionId) {
    const token = this.controllers.get(sessionId);
    return token ? token.controller.signal.aborted : false;
  }

  dispose(sessionId) {
    const token = this.controllers.get(sessionId);
    if (token) {
      if (token.timeoutTimer) clearTimeout(token.timeoutTimer);
      this.controllers.delete(sessionId);
    }
  }

  disposeAll() {
    for (const [id] of this.controllers.entries()) {
      this.dispose(id);
    }
  }
}

module.exports = CancellationManager;
