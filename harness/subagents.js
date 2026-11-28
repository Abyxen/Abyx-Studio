/**
 * Subagent Spawning, Delegation, and Multi-Agent Orchestration.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

class SubAgentOrchestrator {
  constructor(parentConversationId = 'parent_root', baseWorkspaceRoot = process.cwd()) {
    this.parentConversationId = parentConversationId;
    this.baseWorkspaceRoot = path.resolve(baseWorkspaceRoot);
    this.activeSubagents = new Map();
  }

  get activeAgents() {
    return this.activeSubagents;
  }

  spawnSubAgent(role, taskPrompt, profileName = 'default') {
    const desc = this.spawnSubagent(role, taskPrompt, profileName, true);
    return {
      id: desc.conversationId,
      ...desc
    };
  }

  async delegateTask(childId, taskPrompt) {
    if (!this.activeSubagents.has(childId)) {
      return { error: `Subagent ${childId} not found` };
    }
    const res = this.completeSubagent(childId, `Completed: ${taskPrompt}`);
    return {
      status: 'delegated_completed',
      childId,
      result: res.result
    };
  }

  spawnSubagent(role, taskPrompt, profileName = 'default', isolateWorkspace = true) {
    const childId = `sub_${crypto.randomBytes(5).toString('hex')}`;
    let wsPath = null;
    if (isolateWorkspace) {
      wsPath = path.join(this.baseWorkspaceRoot, '.subagents', childId);
      fs.mkdirSync(wsPath, { recursive: true });
    }

    const desc = {
      conversationId: childId,
      parentId: this.parentConversationId,
      role,
      taskPrompt,
      profileName,
      isolatedWorkspace: wsPath,
      status: 'running',
      result: null
    };

    this.activeSubagents.set(childId, desc);
    return desc;
  }

  completeSubagent(childId, resultContent) {
    if (this.activeSubagents.has(childId)) {
      const desc = this.activeSubagents.get(childId);
      desc.status = 'completed';
      desc.result = resultContent;
      return desc;
    }
    return null;
  }

  listChildren() {
    return Array.from(this.activeSubagents.values()).map(s => ({
      conversationId: s.conversationId,
      role: s.role,
      status: s.status,
      hasResult: s.result !== null
    }));
  }
}

module.exports = { SubAgentOrchestrator };
