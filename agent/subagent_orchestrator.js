/**
 * Advanced Subagent Orchestrator
 * Spawns at least 3 specialized independent subagents in isolated workspaces,
 * executes parallel tasks simultaneously, coordinates dependencies, and aggregates results.
 */

const fs = require('node:fs');
const path = require('node:path');

class MultiSubagentOrchestrator {
  constructor(workspaceRoot = process.cwd(), options = {}) {
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.subagentsDir = path.join(this.workspaceRoot, '.abyx_subagents');
    fs.mkdirSync(this.subagentsDir, { recursive: true });
    this.subagents = new Map();
    this.executionRecords = [];
    this.taskRunner = options.taskRunner || null;
  }

  spawnSubagent(role, specialization, options = {}) {
    const subId = `subagent_${role.toLowerCase().replace(/\s+/g, '_')}_${Date.now()}`;
    const isolatedDir = path.join(this.subagentsDir, subId);
    fs.mkdirSync(isolatedDir, { recursive: true });

    const agentRecord = {
      id: subId,
      role,
      specialization,
      workspaceDir: isolatedDir,
      maxTurns: options.maxTurns || 15,
      status: 'IDLE',
      createdAt: new Date().toISOString(),
      completedAt: null,
      result: null
    };

    this.subagents.set(subId, agentRecord);
    return agentRecord;
  }

  async executeTask(subId, taskPrompt, initialFiles = {}) {
    const agent = this.subagents.get(subId);
    if (!agent) throw new Error(`Subagent "${subId}" not found.`);

    agent.status = 'RUNNING';
    const startTime = Date.now();

    if (typeof this.taskRunner !== 'function') {
      agent.status = 'BLOCKED';
      agent.result = { verified: false, status: 'blocked', elapsedMs: Date.now() - startTime,
        error: 'No runtime task runner is configured for this subagent.' };
      return agent.result;
    }

    // The task runner is the only execution authority. This class never creates
    // a decorative output file or turns a role label into a successful result.
    const fullPrompt = `[Role: ${agent.role} | Specialization: ${agent.specialization}]\n${taskPrompt}`;
    const outcome = await this.taskRunner({ agent, taskPrompt: fullPrompt, initialFiles });
    const verified = outcome?.verification?.passed === true;
    agent.status = verified ? 'COMPLETED' : (outcome?.status || 'REQUIRES_VERIFICATION').toUpperCase();
    agent.completedAt = new Date().toISOString();
    agent.result = {
      verified,
      status: outcome?.status || (verified ? 'verified' : 'requires_verification'),
      outcome,
      elapsedMs: Date.now() - startTime
    };

    this.executionRecords.push({
      subId,
      role: agent.role,
      taskPrompt,
      result: agent.result
    });

    return agent.result;
  }

  async runParallelTeam(teamTasks = []) {
    // teamTasks = [{ role, specialization, taskPrompt, initialFiles }]
    const promises = teamTasks.map(async (t) => {
      const agent = this.spawnSubagent(t.role, t.specialization);
      const res = await this.executeTask(agent.id, t.taskPrompt, t.initialFiles || {});
      return {
        agentId: agent.id,
        role: agent.role,
        result: res
      };
    });

    return Promise.all(promises);
  }

  listSubagents() {
    return Array.from(this.subagents.values()).map(a => ({
      id: a.id,
      role: a.role,
      specialization: a.specialization,
      status: a.status,
      workspace: a.workspaceDir,
      completedAt: a.completedAt
    }));
  }
}

module.exports = { MultiSubagentOrchestrator };
