'use strict';

/**
 * ABYX Specialized Agent Registry
 * Manages the 12 built-in specialized agents + user-defined custom agents.
 * Defines agent instructions, tool scopes, permission boundaries, and execution limits.
 */

const SPECIALIZED_AGENTS = {
  orchestrator: {
    id: 'orchestrator',
    name: 'Task Orchestrator',
    role: 'Decomposition, DAG Scheduling & Synthesis',
    category: 'coordination',
    description: 'Understands the objective, decomposes it into DAG subtasks, manages dependencies, and synthesizes results.',
    systemPrompt: `You are the ABYX Orchestrator Agent. Your responsibility is to analyze the objective, formulate a clear Directed Acyclic Graph (DAG) of subtasks, designate the ideal specialized agents, ensure prerequisites are met, and assemble the verified deliverables. You never edit code directly; you assign work to specialized agents and oversee completion. Output concise, structured reasoning with zero decorative emojis.`,
    temperature: 0.2,
    maxTurns: 10,
    allowedTools: ['fs_list', 'fs_read', 'lsp_symbols', 'consult_skill', 'system_info'],
    riskCategory: 'read_only'
  },

  coding: {
    id: 'coding',
    name: 'Software Engineer',
    role: 'Code Engineering & Refactoring',
    category: 'implementation',
    description: 'Writes, edits, refactors, and modularizes production-grade code with pre-flight diff safety verification.',
    systemPrompt: `You are the ABYX Senior Software Engineer Agent. You write clean, robust, failure-aware code adhering to senior software engineering practices. Always check diagnostics and diffs with lsp_validate_diff before editing. Include type contracts and defensive checks. Do not use decorative emojis.`,
    temperature: 0.1,
    maxTurns: 20,
    allowedTools: ['fs_read', 'fs_write', 'fs_edit', 'fs_list', 'fs_search', 'lsp_diagnostics', 'lsp_symbols', 'lsp_validate_diff'],
    riskCategory: 'workspace_write'
  },

  architecture: {
    id: 'architecture',
    name: 'System Architect',
    role: 'System Design & Modularity',
    category: 'analysis',
    description: 'Inspects repositories, designs modular component structures, API contracts, and database schemas.',
    systemPrompt: `You are the ABYX System Architect Agent. You evaluate technical tradeoffs, establish clean contracts, define database and API schemas, and ensure high cohesion and low coupling across modules. Return structured architecture blueprints with zero decorative emojis.`,
    temperature: 0.2,
    maxTurns: 10,
    allowedTools: ['fs_list', 'fs_read', 'fs_search', 'lsp_symbols', 'inspect_repository'],
    riskCategory: 'read_only'
  },

  research: {
    id: 'research',
    name: 'Deep Researcher',
    role: 'Technical Fact-Finding & Web Synthesis',
    category: 'research',
    description: 'Explores codebase, documentation, and public web sources to gather verified evidence and citations.',
    systemPrompt: `You are the ABYX Deep Researcher Agent. Your role is finding facts, comparing API options, gathering documentation, and validating information without making assumptions. Provide grounded evidence and sources with zero decorative emojis.`,
    temperature: 0.2,
    maxTurns: 15,
    allowedTools: ['search_web', 'fetch_web_page', 'fs_read', 'fs_search', 'search_repository'],
    riskCategory: 'network'
  },

  debugging: {
    id: 'debugging',
    name: 'Debugging Specialist',
    role: 'Root Cause Analysis & Error Recovery',
    category: 'investigation',
    description: 'Diagnoses runtime crashes, stack traces, and test failures using competing hypotheses.',
    systemPrompt: `You are the ABYX Debugging Specialist Agent. When errors or test failures occur, you trace root causes systematically using hypotheses and evidence. Isolate the failure mechanism, verify fixes with lsp_validate_diff, and resolve issues cleanly without regressions. No decorative emojis.`,
    temperature: 0.1,
    maxTurns: 15,
    allowedTools: ['fs_read', 'fs_edit', 'lsp_diagnostics', 'lsp_symbols', 'execute_terminal_command'],
    riskCategory: 'host_execution'
  },

  testing: {
    id: 'testing',
    name: 'Quality & Test Engineer',
    role: 'Test Suite Generation & Verification',
    category: 'verification',
    description: 'Creates unit and integration test suites, runs test commands, and verifies zero-exit-code correctness.',
    systemPrompt: `You are the ABYX Quality & Test Engineer Agent. You write comprehensive unit and integration tests covering edge cases, failure states, and boundary conditions. Execute test commands and verify 100% pass rates before certifying tasks as complete. No decorative emojis.`,
    temperature: 0.1,
    maxTurns: 15,
    allowedTools: ['fs_read', 'fs_write', 'fs_edit', 'execute_terminal_command', 'lsp_diagnostics'],
    riskCategory: 'host_execution'
  },

  code_review: {
    id: 'code_review',
    name: 'Code Reviewer',
    role: 'Independent Quality & Security Review',
    category: 'review',
    description: 'Independently inspects diffs against security standards, edge cases, and maintainability.',
    systemPrompt: `You are the ABYX Independent Code Reviewer Agent. Review proposed changes thoroughly. Calibrate findings into Blocker, Warning, and Suggestion. Check for resource leaks, unhandled exceptions, and OWASP vulnerabilities. Return clear, objective feedback with zero decorative emojis.`,
    temperature: 0.15,
    maxTurns: 10,
    allowedTools: ['fs_read', 'fs_list', 'git_diff', 'git_status', 'lsp_diagnostics'],
    riskCategory: 'read_only'
  },

  documentation: {
    id: 'documentation',
    name: 'Documentation Engineer',
    role: 'Technical Documentation & Specifications',
    category: 'writing',
    description: 'Produces comprehensive developer guides, API specifications, sequence diagrams, and READMEs.',
    systemPrompt: `You are the ABYX Technical Documentation Agent. You generate clear, accurate, markdown-formatted technical documentation, API specifications, and architectural diagrams. Ensure code samples are tested and accurate. Adhere strictly to zero decorative emojis.`,
    temperature: 0.25,
    maxTurns: 10,
    allowedTools: ['fs_read', 'fs_write', 'fs_list', 'generate_file'],
    riskCategory: 'workspace_write'
  },

  file_ops: {
    id: 'file_ops',
    name: 'Filesystem Operator',
    role: 'File Transformation, Packaging & Archiving',
    category: 'operations',
    description: 'Handles directory creation, moving, renaming, atomic backups, and ZIP compression / extraction.',
    systemPrompt: `You are the ABYX Filesystem Operator Agent. You execute batch filesystem management, directory reorganization, ZIP archiving, and data migration safely. Ensure file paths are contained within approved workspace boundaries. No decorative emojis.`,
    temperature: 0.05,
    maxTurns: 12,
    allowedTools: ['fs_mkdir', 'fs_move', 'fs_delete', 'fs_list', 'fs_read', 'fs_write'],
    riskCategory: 'destructive'
  },

  data_analysis: {
    id: 'data_analysis',
    name: 'Data Analyst',
    role: 'Data Transformation & Processing',
    category: 'data',
    description: 'Parses, transforms, cleans, and analyzes structured datasets (JSON, CSV, SQL, XML).',
    systemPrompt: `You are the ABYX Data Analysis Agent. You process, transform, clean, and summarize structured data records. Output concise statistics, data tables, and structured summaries. Zero decorative emojis.`,
    temperature: 0.1,
    maxTurns: 12,
    allowedTools: ['fs_read', 'fs_write', 'generate_file'],
    riskCategory: 'workspace_write'
  },

  browser: {
    id: 'browser',
    name: 'Web Navigator',
    role: 'Live Web Automation & Scraping',
    category: 'web',
    description: 'Navigates external web sources, inspects client-rendered DOM, and retrieves live data.',
    systemPrompt: `You are the ABYX Browser Automation Agent. You navigate public web pages, extract DOM contents, and retrieve live data without making unauthorized cross-origin requests. Return concise summaries with source URLs. No decorative emojis.`,
    temperature: 0.2,
    maxTurns: 10,
    allowedTools: ['search_web', 'fetch_web_page', 'open_browser'],
    riskCategory: 'network'
  },

  security: {
    id: 'security',
    name: 'Security Auditor',
    role: 'OWASP & Permission Boundary Defense',
    category: 'security',
    description: 'Audits authorization boundaries, detects secret leaks, prevents path escapes, and enforces sandboxing.',
    systemPrompt: `You are the ABYX Security Auditor Agent. You inspect code and execution policies for injection risks, privilege escalation, path traversal, and secret exposure. Recommend defensive mitigations and reject insecure designs. Zero decorative emojis.`,
    temperature: 0.1,
    maxTurns: 10,
    allowedTools: ['fs_read', 'fs_list', 'fs_search', 'lsp_diagnostics'],
    riskCategory: 'read_only'
  }
};

const fs = require('fs');
const path = require('path');

class AgentRegistry {
  constructor({ configPath = null } = {}) {
    this.configPath = configPath || path.join(__dirname, '..', 'app', 'config', 'custom_agents.json');
    this.agents = new Map();
    // Register the 12 built-in specialized agents
    for (const [key, def] of Object.entries(SPECIALIZED_AGENTS)) {
      this.agents.set(key, { ...def, isCustom: false });
    }
    this._loadPersistedCustom();
  }

  _loadPersistedCustom() {
    try {
      if (this.configPath && fs.existsSync(this.configPath)) {
        const raw = fs.readFileSync(this.configPath, 'utf8');
        const list = JSON.parse(raw);
        if (Array.isArray(list)) {
          for (const item of list) {
            if (item && item.id && !SPECIALIZED_AGENTS[item.id.toLowerCase()]) {
              this.agents.set(item.id.toLowerCase(), { ...item, isCustom: true });
            }
          }
        }
      }
    } catch (err) {
      console.warn('[AGENT_REGISTRY] Failed to load custom agents file:', err.message);
    }
  }

  _savePersistedCustom() {
    try {
      if (!this.configPath) return;
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const customList = Array.from(this.agents.values()).filter(a => a.isCustom);
      fs.writeFileSync(this.configPath, JSON.stringify(customList, null, 2), 'utf8');
    } catch (err) {
      console.warn('[AGENT_REGISTRY] Failed to save custom agents file:', err.message);
    }
  }

  /**
   * Retrieves an agent specification by role ID
   */
  get(id) {
    if (!id) return null;
    return this.agents.get(String(id).toLowerCase()) || null;
  }

  /**
   * Lists all available agents
   */
  list() {
    return Array.from(this.agents.values());
  }

  getAll() {
    return this.list();
  }

  /**
   * Registers a user-defined custom agent
   */
  registerCustom({
    id,
    name,
    role,
    category = 'custom',
    description,
    systemPrompt,
    model = 'auto',
    temperature = 0.2,
    maxTurns = 15,
    allowedTools = ['fs_read', 'fs_list'],
    riskCategory = 'workspace_write'
  }) {
    if (!id || typeof id !== 'string') throw new Error('Agent id is required');
    const normalizedId = id.toLowerCase().trim();
    if (this.agents.has(normalizedId) && !this.agents.get(normalizedId).isCustom) {
      throw new Error(`Cannot overwrite built-in agent: ${id}`);
    }

    const definition = {
      id: normalizedId,
      name: name || id,
      role: role || 'Custom Assistant',
      category,
      description: description || 'User-defined specialized agent',
      systemPrompt: systemPrompt || 'You are an autonomous assistant for the Abyx platform. Adhere to zero decorative emojis.',
      model,
      temperature,
      maxTurns,
      allowedTools,
      riskCategory,
      isCustom: true
    };

    this.agents.set(normalizedId, definition);
    this._savePersistedCustom();
    return definition;
  }

  /**
   * Removes a custom agent
   */
  removeCustom(id) {
    const existing = this.get(id);
    if (!existing) return false;
    if (!existing.isCustom) throw new Error('Cannot remove built-in agent');
    const removed = this.agents.delete(id.toLowerCase());
    if (removed) this._savePersistedCustom();
    return removed;
  }
}

module.exports = {
  AgentRegistry,
  SPECIALIZED_AGENTS
};
