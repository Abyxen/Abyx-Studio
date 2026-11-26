'use strict';

/**
 * AgentSharedMemory - Inter-Agent Blackboard & Knowledge Store
 * Mem0-inspired shared blackboard providing shared findings, facts,
 * search retrieval, and cross-agent context propagation.
 */
class AgentSharedMemory {
  constructor(options = {}) {
    this.store = new Map();
    this.findings = [];
  }

  set(key, value, agentId = 'system') {
    this.store.set(key, {
      value,
      agentId,
      updatedAt: new Date().toISOString()
    });
  }

  get(key) {
    const item = this.store.get(key);
    return item ? item.value : null;
  }

  has(key) {
    return this.store.has(key);
  }

  recordFinding(finding) {
    const record = {
      id: `find_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
      agentId: finding.agentId || 'agent',
      category: finding.category || 'general',
      text: typeof finding === 'string' ? finding : finding.text || JSON.stringify(finding)
    };
    this.findings.push(record);
    return record;
  }

  getAllFindings() {
    return [...this.findings];
  }

  search(query) {
    const q = (query || '').toLowerCase();
    const words = q.split(/\W+/).filter(w => w.length > 3);
    const matchedFindings = this.findings.filter(f => {
      const lower = f.text.toLowerCase();
      if (lower.includes(q)) return true;
      return words.length > 0 && words.some(w => lower.includes(w));
    });
    const matchedKV = [];
    for (const [key, item] of this.store.entries()) {
      const valStr = typeof item.value === 'string' ? item.value : JSON.stringify(item.value);
      const combined = (key + ' ' + valStr).toLowerCase();
      if (combined.includes(q) || (words.length > 0 && words.some(w => combined.includes(w)))) {
        matchedKV.push({ key, value: item.value, agentId: item.agentId });
      }
    }
    return { findings: matchedFindings, keyValues: matchedKV };
  }

  snapshot() {
    const kv = {};
    for (const [k, v] of this.store.entries()) kv[k] = v;
    return {
      keyValues: kv,
      findings: [...this.findings]
    };
  }

  clear() {
    this.store.clear();
    this.findings = [];
  }
}

module.exports = AgentSharedMemory;
