'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * ContextManager - Dynamic Context & Conversation Engine
 * 
 * References: Pi + OpenCode
 * 
 * Invariants:
 * - Dynamic context construction: selectively injects relevant instructions, skills, memories, and tools.
 * - Compaction NEVER silently erases the persistent transcript stored in SessionManager.
 * - Strict context token budgeting with validation before model inference.
 * - Automatic compaction with recent-message retention.
 * - Tool-output filtering: truncates excessive tool observations into compact summaries.
 */
class ContextManager {
  constructor(options = {}) {
    this.workspaceRoot = options.workspaceRoot || process.cwd();
    this.sharedMemory = options.sharedMemory || null;
    this.memoryManager = options.memoryManager || null;
    this.skillsService = options.skillsService || null;
    this.skillEngine = options.skillEngine || null;
    this.defaultContextLimit = options.defaultContextLimit || 8192;
    this.compactionThreshold = options.compactionThreshold || 0.75; // 75%
    this.recentMessagesCount = options.recentMessagesCount || 4;
    this.maxToolOutputChars = options.maxToolOutputChars || 600;

    this.projectInstructionsCache = new Map();
  }

  /**
   * Fast character-based token estimator (~4 chars per token)
   */
  estimateTokens(textOrMessages) {
    if (!textOrMessages) return 0;
    if (typeof textOrMessages === 'string') {
      return Math.ceil(textOrMessages.length / 4);
    }
    if (Array.isArray(textOrMessages)) {
      const totalChars = textOrMessages.reduce((sum, msg) => {
        const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content || '');
        const toolCalls = msg.tool_calls ? JSON.stringify(msg.tool_calls) : '';
        return sum + content.length + toolCalls.length;
      }, 0);
      return Math.ceil(totalChars / 4);
    }
    if (typeof textOrMessages === 'object') {
      return Math.ceil(JSON.stringify(textOrMessages).length / 4);
    }
    return 0;
  }

  /**
   * Calculates context token budget allocation
   */
  calculateBudget({
    modelContextLimit = this.defaultContextLimit,
    responseReserve = 2048,
    systemReserve = 1500,
    toolsReserve = 800
  } = {}) {
    const limit = Math.max(1024, modelContextLimit);
    const usableContext = Math.floor(limit * this.compactionThreshold);
    const historyBudget = Math.max(512, usableContext - systemReserve - toolsReserve);

    return {
      modelContextLimit: limit,
      usableContext,
      responseReserve,
      systemReserve,
      toolsReserve,
      historyBudget
    };
  }

  /**
   * Loads project-specific instructions from workspace files in priority order
   */
  loadProjectInstructions(customRoot = null) {
    const root = customRoot || this.workspaceRoot;
    if (this.projectInstructionsCache.has(root)) {
      return this.projectInstructionsCache.get(root);
    }

    const candidateFiles = [
      path.join(root, '.abyx', 'instructions.md'),
      path.join(root, 'AGENTS.md'),
      path.join(root, 'PROJECT_INSTRUCTIONS.md'),
      path.join(root, 'README.md')
    ];

    let instructions = '';
    for (const file of candidateFiles) {
      if (fs.existsSync(file)) {
        try {
          const content = fs.readFileSync(file, 'utf8').trim();
          if (content) {
            const fileName = path.basename(file);
            // Limit README to first 50 lines / 2000 chars to avoid prompt flooding
            const truncated = fileName === 'README.md'
              ? content.split('\n').slice(0, 50).join('\n').slice(0, 2000)
              : content.slice(0, 4000);
            instructions = `\n[Project Instructions from ${fileName}]:\n${truncated}\n`;
            break;
          }
        } catch (_) {}
      }
    }

    this.projectInstructionsCache.set(root, instructions);
    return instructions;
  }

  /**
   * Retrieves relevant skills matching user query/task keywords instead of dumping all skills
   */
  retrieveRelevantSkills(query, allSkills = [], maxSkills = 2, agentId = null) {
    if (this.skillEngine && typeof this.skillEngine.matchSkills === 'function') {
      const matched = this.skillEngine.matchSkills(query, { agentId, limit: maxSkills });
      if (matched.length > 0) return matched;
    }

    if (!query || !Array.isArray(allSkills) || allSkills.length === 0) return [];
    const queryLower = query.toLowerCase();
    const queryWords = queryLower.split(/\W+/).filter(w => w.length > 3);

    const scored = allSkills.map(skill => {
      let score = 0;
      const name = (skill.name || skill.id || '').toLowerCase();
      const desc = (skill.description || '').toLowerCase();

      if (queryLower.includes(name)) score += 10;
      for (const word of queryWords) {
        if (name.includes(word)) score += 5;
        if (desc.includes(word)) score += 2;
      }
      return { skill, score };
    });

    return scored
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxSkills)
      .map(s => s.skill);
  }

  /**
   * Retrieves relevant memory facts & findings from MemoryManager or SharedMemory
   */
  retrieveRelevantMemories(query, maxMemories = 4, projectId = null, agentId = null) {
    if (this.memoryManager && typeof this.memoryManager.searchMemory === 'function') {
      try {
        const searched = this.memoryManager.searchMemory({
          query,
          projectId,
          agentId,
          limit: maxMemories
        });
        if (searched.length > 0) {
          return searched.map(s => ({
            agentId: s.agentId || 'memory',
            text: `[${s.level.toUpperCase()} / ${s.category}] ${s.title}: ${s.content}`
          }));
        }
      } catch (_) {}
    }

    if (!this.sharedMemory || !query) return [];
    try {
      const searchRes = this.sharedMemory.search(query);
      const findings = searchRes.findings || [];
      return findings.slice(0, maxMemories);
    } catch (_) {
      return [];
    }
  }

  /**
   * Filters and truncates excessive tool outputs to prevent context pollution
   */
  filterToolOutput(output, toolName = 'tool', maxChars = this.maxToolOutputChars) {
    if (!output) return output;

    let outputStr = typeof output === 'string' ? output : JSON.stringify(output);
    if (outputStr.length <= maxChars) {
      return output;
    }

    // Preserve structural fields if JSON object
    if (typeof output === 'object' && output !== null) {
      const filtered = {
        ok: output.ok,
        _filtered: true,
        _originalBytes: outputStr.length
      };

      if (output.path) filtered.path = output.path;
      if (output.error) filtered.error = output.error;
      if (output.count !== undefined) filtered.count = output.count;
      if (output.exitCode !== undefined) filtered.exitCode = output.exitCode;

      if (typeof output.content === 'string') {
        filtered.preview = `${output.content.slice(0, 300)}... [${output.content.length - 300} chars truncated]`;
      } else if (Array.isArray(output.entries)) {
        filtered.entriesPreview = output.entries.slice(0, 10);
        filtered.totalEntries = output.entries.length;
      } else {
        filtered.preview = `${outputStr.slice(0, 300)}... [${outputStr.length - 300} chars truncated]`;
      }

      return filtered;
    }

    return `[Filtered Observation from ${toolName} (${outputStr.length} chars). Preview: "${outputStr.slice(0, 300)}..." (truncated to protect context budget)]`;
  }

  /**
   * Compacts ephemeral message window while preserving recent messages
   */
  compactMessageWindow(messages, historyBudget) {
    if (!Array.isArray(messages) || messages.length <= 4) {
      return messages;
    }

    const systemMessages = messages.filter(m => m.role === 'system');
    const conversationMessages = messages.filter(m => m.role !== 'system');

    if (conversationMessages.length <= this.recentMessagesCount) {
      return messages;
    }

    // Split conversation into older turns and recent turns
    const olderTurns = conversationMessages.slice(0, -this.recentMessagesCount);
    const recentTurns = conversationMessages.slice(-this.recentMessagesCount);

    // Summarize older turns
    let userGoal = '';
    const actionsTaken = [];

    for (const msg of olderTurns) {
      if (msg.role === 'user' && !userGoal) {
        userGoal = msg.content;
      } else if (msg.role === 'assistant' && msg.tool_calls) {
        msg.tool_calls.forEach(tc => {
          actionsTaken.push(`Called ${tc.function?.name || tc.name}`);
        });
      } else if (msg.role === 'assistant' && msg.content) {
        actionsTaken.push(`Assistant: ${msg.content.slice(0, 100)}...`);
      } else if (msg.role === 'tool') {
        actionsTaken.push(`Tool ${msg.name || ''} completed`);
      }
    }

    const summaryContent = `[CONVERSATION CHECKPOINT SUMMARY]:
- Original User Goal: ${userGoal || 'User Task'}
- Historical Progress (${olderTurns.length} turns compacted):
${actionsTaken.slice(-6).map(a => `  * ${a}`).join('\n')}
(End of summary. Recent messages follow verbatim)`;

    const compacted = [
      ...systemMessages,
      { role: 'system', content: summaryContent },
      ...recentTurns
    ];

    return compacted;
  }

  /**
   * Constructs dynamic context window for model inference
   */
  constructDynamicContext({
    session,
    taskQuery = '',
    systemPrompt = 'You are an autonomous AI engineering agent.',
    mode = 'build',
    availableTools = [],
    availableSkills = [],
    maxContextTokens = this.defaultContextLimit
  }) {
    const budget = this.calculateBudget({ modelContextLimit: maxContextTokens });

    // 1. Dynamic System Instructions
    const projectInstructions = this.loadProjectInstructions();
    const relevantSkills = this.retrieveRelevantSkills(taskQuery || session?.goal, availableSkills);
    const relevantMemories = this.retrieveRelevantMemories(taskQuery || session?.goal);

    let compositeSystem = systemPrompt;
    if (projectInstructions) {
      compositeSystem += `\n${projectInstructions}`;
    }

    if (relevantSkills.length > 0) {
      compositeSystem += `\n\n[Active Relevant Skills]:\n${relevantSkills.map(s => `- ${s.name}: ${s.description}`).join('\n')}`;
    }

    if (relevantMemories.length > 0) {
      compositeSystem += `\n\n[Relevant Project Findings]:\n${relevantMemories.map(m => `- [${m.agentId || 'memory'}] ${m.text}`).join('\n')}`;
    }

    if (mode === 'plan') {
      compositeSystem += `\n\n[MODE: PLAN ONLY] You are in exploratory planning mode. Do not modify files or run destructive commands.`;
    }

    // 2. Filter Active Tools by Mode
    const activeTools = availableTools.filter(t => {
      if (mode === 'plan') {
        const allowedInPlan = ['read_file', 'list_directory', 'search_files', 'diagnostics', 'symbols', 'navigate_browser'];
        return allowedInPlan.includes(t.name || t.function?.name);
      }
      return true;
    });

    // 3. Assemble Ephemeral Working Messages (Immutable session transcript preserved!)
    const rawMessages = session ? [...session.messages] : [{ role: 'user', content: taskQuery }];
    
    // Replace system prompt with dynamic composite system
    const workingMessages = [
      { role: 'system', content: compositeSystem },
      ...rawMessages.filter(m => m.role !== 'system')
    ];

    // 4. Compact Working Window if exceeding budget
    let currentTokens = this.estimateTokens(workingMessages);
    let finalMessages = workingMessages;

    if (currentTokens > budget.historyBudget) {
      finalMessages = this.compactMessageWindow(workingMessages, budget.historyBudget);
      currentTokens = this.estimateTokens(finalMessages);
    }

    // 5. Context Window Validation
    const validation = this.validateContextWindow(finalMessages, maxContextTokens);

    return {
      messages: finalMessages,
      tools: activeTools,
      budget,
      estimatedTokens: currentTokens,
      validation,
      metadata: {
        skillsInjected: relevantSkills.map(s => s.name),
        memoriesInjectedCount: relevantMemories.length,
        hasProjectInstructions: Boolean(projectInstructions),
        mode
      }
    };
  }

  /**
   * Validates that constructed context fits within the model's physical window
   */
  validateContextWindow(messages, maxContextLimit = this.defaultContextLimit) {
    const tokens = this.estimateTokens(messages);
    const valid = tokens <= maxContextLimit;
    return {
      valid,
      tokens,
      limit: maxContextLimit,
      usageRatio: Number((tokens / maxContextLimit).toFixed(3)),
      overBudget: !valid ? tokens - maxContextLimit : 0
    };
  }
}

module.exports = ContextManager;
