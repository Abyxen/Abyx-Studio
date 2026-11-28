/**
 * Trajectory Tracing, Checkpointing, Rollback, Session Handoff, and Offline Evals.
 */

const fs = require('node:fs');
const path = require('node:path');

class TrajectoryTracer {
  constructor(traceFileOrSessionId, workspaceDir = null) {
    if (workspaceDir) {
      this.sessionId = traceFileOrSessionId;
      this.traceFile = path.resolve(workspaceDir, '.agents_tmp', 'trajectory.jsonl');
    } else {
      this.traceFile = path.resolve(traceFileOrSessionId);
    }
    this.trajectoryFile = this.traceFile;
    fs.mkdirSync(path.dirname(this.traceFile), { recursive: true });
    this.events = [];
  }

  logEvent(event) {
    this.recordEvent(event);
  }

  recordEvent(event) {
    this.events.push(event);
    fs.appendFileSync(this.traceFile, JSON.stringify(event) + '\n', 'utf-8');
  }

  exportTrajectory() {
    return this.events.map(e => ({
      eventId: e.eventId,
      timestamp: e.timestamp,
      kind: e.kind,
      source: e.source,
      payload: e.payload
    }));
  }
}

class CheckpointManager {
  constructor(workspaceRoot, checkpointDir = null) {
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.checkpointDir = path.resolve(checkpointDir || path.join(this.workspaceRoot, '.agents_tmp', 'checkpoints'));
    fs.mkdirSync(this.checkpointDir, { recursive: true });
    this.checkpoints = new Map();
  }

  rollback(checkpointId) {
    this.rollbackToCheckpoint(checkpointId);
    return { success: true, restored: checkpointId };
  }

  createCheckpoint(checkpointId) {
    const cpPath = path.join(this.checkpointDir, checkpointId);
    if (fs.existsSync(cpPath)) {
      fs.rmSync(cpPath, { recursive: true, force: true });
    }
    fs.mkdirSync(cpPath, { recursive: true });

    for (const item of fs.readdirSync(this.workspaceRoot)) {
      if (item.startsWith('.') || item === path.basename(this.checkpointDir)) continue;
      const src = path.join(this.workspaceRoot, item);
      const dest = path.join(cpPath, item);
      fs.cpSync(src, dest, { recursive: true });
    }

    this.checkpoints.set(checkpointId, cpPath);
    return cpPath;
  }

  rollbackToCheckpoint(checkpointId) {
    if (!this.checkpoints.has(checkpointId)) {
      throw new Error(`Checkpoint '${checkpointId}' does not exist.`);
    }
    const cpPath = this.checkpoints.get(checkpointId);

    // Clean workspace files
    for (const item of fs.readdirSync(this.workspaceRoot)) {
      if (item.startsWith('.') || item === path.basename(this.checkpointDir)) continue;
      fs.rmSync(path.join(this.workspaceRoot, item), { recursive: true, force: true });
    }

    // Restore files
    for (const item of fs.readdirSync(cpPath)) {
      fs.cpSync(path.join(cpPath, item), path.join(this.workspaceRoot, item), { recursive: true });
    }
  }
}

class SessionHandoff {
  createHandoff(sessionId, summary = '', artifacts = [], metadata = {}) {
    return SessionHandoff.createHandoffEnvelope(
      sessionId,
      'completed',
      [],
      artifacts.reduce((acc, a) => { acc[path.basename(a)] = a; return acc; }, {}),
      summary
    );
  }

  static createHandoffEnvelope(sessionId, conversationStatus, trajectory, artifacts = {}, summary = '') {
    return {
      handoffVersion: '1.0.0',
      timestamp: new Date().toISOString(),
      sessionId,
      status: conversationStatus,
      summary,
      artifacts,
      artifactManifest: Object.keys(artifacts),
      eventCount: trajectory.length
    };
  }
}

class OfflineEvalDataset {
  constructor(workspaceRoot = process.cwd()) {
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.testCases = [];
  }

  recordExample(example) {
    this.testCases.push(example);
  }

  getDataset() {
    return this.testCases;
  }

  addCase(caseId, prompt, expectedOutcomes = []) {
    this.testCases.push({ id: caseId, prompt, expectedOutcomes });
  }

  runEval(runnerFn) {
    let passed = 0;
    const results = [];
    for (const tc of this.testCases) {
      const output = runnerFn(tc.prompt);
      const isPass = tc.expectedOutcomes.every(exp => output.includes(exp));
      if (isPass) passed += 1;
      results.push({ id: tc.id, passed: isPass, expected: tc.expectedOutcomes });
    }
    const total = this.testCases.length;
    const passRate = total > 0 ? Number(((passed / total) * 100).toFixed(2)) : 0;
    return { totalCases: total, passed, passRatePct: passRate, results };
  }
}

module.exports = {
  TrajectoryTracer,
  CheckpointManager,
  SessionHandoff,
  OfflineEvalDataset
};
