/**
 * Doom Loop Detection, Permissions Matrix, and Resource Caps.
 */

const crypto = require('node:crypto');

class DoomLoopDetector {
  constructor(historySize = 8, repetitionThreshold = 3) {
    this.historySize = historySize;
    this.repetitionThreshold = repetitionThreshold;
    this.actionHashes = [];
    this.consecutiveFailures = 0;
  }

  recordAction(type, payload = {}) {
    const res = this.recordAndCheck(type, payload);
    return {
      detected: res.isLoop,
      reason: res.reason
    };
  }

  recordAndCheck(actionName, args = {}, exitCode = 0) {
    const raw = JSON.stringify({ actionName, args });
    const h = crypto.createHash('sha256').update(raw).digest('hex');
    this.actionHashes.push(h);
    if (this.actionHashes.length > this.historySize) {
      this.actionHashes.shift();
    }

    if (exitCode !== 0) {
      this.consecutiveFailures += 1;
    } else {
      this.consecutiveFailures = 0;
    }

    if (this.consecutiveFailures >= 4) {
      return {
        isLoop: true,
        reason: `Doom loop: Detected ${this.consecutiveFailures} consecutive failing tool actions.`
      };
    }

    const matches = this.actionHashes.filter(item => item === h).length;
    if (matches >= this.repetitionThreshold) {
      return {
        isLoop: true,
        reason: `Doom loop: Action '${actionName}' repeated ${matches} times without progress.`
      };
    }

    return { isLoop: false };
  }
}

class PermissionMatrix {
  static READ = 'READ';
  static WRITE = 'WRITE';
  static EXECUTE = 'EXECUTE';
  static NETWORK = 'NETWORK';
  static ADMIN = 'ADMIN';

  constructor(granted = new Set([PermissionMatrix.READ, PermissionMatrix.WRITE, PermissionMatrix.EXECUTE])) {
    this.granted = granted instanceof Set ? granted : new Set(granted);
    this.requiresHumanConfirmation = new Set([PermissionMatrix.ADMIN]);
  }

  checkPermission(permissionOrTool, args = {}) {
    // If called with (toolName, args)
    if (typeof permissionOrTool === 'string' && (args && typeof args === 'object')) {
      const tool = permissionOrTool.toLowerCase();
      if (tool === 'terminal' || tool === 'execute_command') {
        const cmd = (args.command || '').toLowerCase();
        if (cmd.includes('rm -rf /') || cmd.includes('format') || cmd.includes('drop table')) {
          return { allowed: false, requiresConfirmation: true, reason: 'High risk destructive command requires human confirmation.' };
        }
        return { allowed: true, requiresConfirmation: false };
      }
      return { allowed: true, requiresConfirmation: false };
    }

    // Direct permission enum check
    const permission = permissionOrTool;
    if (!this.granted.has(permission)) {
      return { allowed: false, requiresApproval: false, reason: `Permission '${permission}' not granted.` };
    }
    if (this.requiresHumanConfirmation.has(permission)) {
      return { allowed: true, requiresApproval: true, reason: `Permission '${permission}' requires human confirmation.` };
    }
    return { allowed: true, requiresApproval: false };
  }
}

class ExecutionCaps {
  constructor(maxTurns = 50, maxTimeSeconds = 300, maxCostUsd = 5.0) {
    this.maxTurns = maxTurns;
    this.maxTimeSeconds = maxTimeSeconds;
    this.maxCostUsd = maxCostUsd;
    this.startTime = Date.now();
    this.turnCount = 0;
  }

  checkCaps(currentTurns, currentTokens = 0, currentCost = 0.0) {
    const elapsedSec = (Date.now() - this.startTime) / 1000.0;
    if (currentTurns > this.maxTurns) {
      return { allowed: false, reason: `Exceeded maximum turn limit: ${currentTurns} > ${this.maxTurns}` };
    }
    if (elapsedSec > this.maxTimeSeconds) {
      return { allowed: false, reason: `Exceeded time limit: ${elapsedSec.toFixed(1)}s > ${this.maxTimeSeconds}s` };
    }
    if (currentCost > this.maxCostUsd) {
      return { allowed: false, reason: `Exceeded cost limit: $${currentCost} > $${this.maxCostUsd}` };
    }
    return { allowed: true };
  }

  tick(currentCost = 0.0) {
    this.turnCount += 1;
    const elapsedSec = (Date.now() - this.startTime) / 1000.0;

    if (this.turnCount > this.maxTurns) {
      return { ok: false, error: `Turn cap exceeded: ${this.turnCount} > ${this.maxTurns}` };
    }
    if (elapsedSec > this.maxTimeSeconds) {
      return { ok: false, error: `Time cap exceeded: ${elapsedSec.toFixed(1)}s > ${this.maxTimeSeconds}s` };
    }
    if (currentCost > this.maxCostUsd) {
      return { ok: false, error: `Cost cap exceeded: $${currentCost.toFixed(4)} > $${this.maxCostUsd.toFixed(4)}` };
    }
    return { ok: true };
  }
}

module.exports = {
  DoomLoopDetector,
  PermissionMatrix,
  ExecutionCaps
};
