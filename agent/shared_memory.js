'use strict';

/**
 * ABYX Shared Agent Memory & Context Repository
 * Provides shared task context, artifact tracking, key findings, and dependency context
 * retrieval without bloating model context windows.
 */

const crypto = require('crypto');

class AgentSharedMemory {
  /**
   * @param {object} params
   * @param {number} [params.maxTokensPerContext=2048] - Max token allocation for predecessor context injection
   */
  constructor({ maxTokensPerContext = 2048 } = {}) {
    this.maxTokensPerContext = maxTokensPerContext;
    this.artifacts = new Map(); // artifactId -> Artifact
    this.findings = [];         // Array of structured findings
    this.taskOutputs = new Map(); // taskId -> { agentRole, title, summary, output, files, timestamp }
    this.variables = new Map();   // key -> value
  }

  /**
   * Records a task's final output for downstream dependency retrieval
   */
  recordTaskOutput(taskId, { agentRole, title, summary, output = '', files = [] }) {
    if (!taskId) return;
    const record = {
      taskId,
      agentRole,
      title: title || taskId,
      summary: summary || (output.length > 280 ? output.slice(0, 280) + '...' : output),
      output,
      files: Array.isArray(files) ? files : [],
      timestamp: new Date().toISOString()
    };
    this.taskOutputs.set(taskId, record);
    return record;
  }

  /**
   * Retrieves concise, token-bounded context from predecessor tasks
   * @param {string[]} dependencyTaskIds - Array of task IDs this task depends on
   * @returns {string} Formatted predecessor context string for model prompting
   */
  getDependencyContext(dependencyTaskIds = []) {
    if (!Array.isArray(dependencyTaskIds) || dependencyTaskIds.length === 0) {
      return '';
    }

    const sections = [];
    for (const depId of dependencyTaskIds) {
      const output = this.taskOutputs.get(depId);
      if (output) {
        let block = `### Prerequisite [${depId}] (${output.agentRole}): ${output.title}\nSummary: ${output.summary}`;
        if (output.files.length > 0) {
          block += `\nFiles Produced: ${output.files.join(', ')}`;
        }
        sections.push(block);
      }
    }

    if (sections.length === 0) return '';

    const fullText = `## Prerequisite Task Outputs:\n${sections.join('\n\n')}\n`;
    // Approximate token check (4 chars per token)
    if (fullText.length > this.maxTokensPerContext * 4) {
      return fullText.slice(0, this.maxTokensPerContext * 4) + '\n[Context truncated for token limits]';
    }
    return fullText;
  }

  /**
   * Registers a formal deliverable artifact
   */
  registerArtifact({ name, type = 'file', agentId, taskId, summary = '', relativePath = null, content = null }) {
    const id = `art_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const hash = content ? crypto.createHash('sha256').update(content).digest('hex').slice(0, 12) : null;
    const artifact = {
      id,
      name,
      type,
      agentId,
      taskId,
      summary,
      relativePath,
      contentHash: hash,
      createdAt: new Date().toISOString()
    };
    this.artifacts.set(id, artifact);
    return artifact;
  }

  /**
   * Records a technical finding or decision
   */
  recordFinding({ topic, conclusion, evidence = '', agentId = 'system', taskId = null }) {
    const finding = {
      id: `fnd_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      topic,
      conclusion,
      evidence,
      agentId,
      taskId,
      timestamp: new Date().toISOString()
    };
    this.findings.push(finding);
    return finding;
  }

  /**
   * Lists all artifacts, optionally filtered by task or type
   */
  listArtifacts({ taskId = null, type = null } = {}) {
    let list = Array.from(this.artifacts.values());
    if (taskId) list = list.filter(a => a.taskId === taskId);
    if (type) list = list.filter(a => a.type === type);
    return list;
  }

  /**
   * Lists all findings, optionally filtered by topic
   */
  listFindings({ topic = null } = {}) {
    if (!topic) return [...this.findings];
    const q = topic.toLowerCase();
    return this.findings.filter(f => f.topic.toLowerCase().includes(q) || f.conclusion.toLowerCase().includes(q));
  }

  /**
   * Alias for listFindings
   */
  getAllFindings() {
    return [...this.findings];
  }

  /**
   * Get/set shared variables
   */
  setVariable(key, value) {
    this.variables.set(key, value);
  }

  getVariable(key, fallback = null) {
    return this.variables.has(key) ? this.variables.get(key) : fallback;
  }

  /**
   * Clears memory state (for fresh runs)
   */
  clear() {
    this.artifacts.clear();
    this.findings = [];
    this.taskOutputs.clear();
    this.variables.clear();
  }
}

module.exports = AgentSharedMemory;
