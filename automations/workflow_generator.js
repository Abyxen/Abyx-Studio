/**
 * ABYX Automations Subsystem — Natural Language Workflow Generator
 * 
 * Converts natural-language instructions into structured, inspectable automation workflows.
 * All proposed steps, tools, and required permissions are surfaced for explicit user review
 * before saving or enabling.
 */

const { TriggerType, createAutomationRecord } = require('./types');

class WorkflowGenerator {
  /**
   * Parses natural language instructions into a proposed structured workflow
   * 
   * @param {string} prompt - User instruction
   * @returns {Object} Proposed automation record (draft)
   */
  static proposeWorkflow(prompt) {
    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      throw new Error('Instruction prompt must be a non-empty string');
    }

    const clean = prompt.trim();
    const lower = clean.toLowerCase();

    // 1. Extract Interval / Schedule
    let intervalMinutes = 60; // Default 1 hour
    let triggerType = TriggerType.INTERVAL;

    if (/\bevery\s+(\d+)\s*(min|minute)/i.test(lower)) {
      const match = lower.match(/\bevery\s+(\d+)\s*(min|minute)/i);
      intervalMinutes = parseInt(match[1], 10) || 60;
    } else if (/\bevery\s+hour\b|\bhourly\b/i.test(lower)) {
      intervalMinutes = 60;
    } else if (/\bdaily\b|\bevery\s+day\b|\bevery\s+24\s*hours?\b|\bevery\s+morning\b/i.test(lower)) {
      intervalMinutes = 1440;
    } else if (/\bweekly\b|\bevery\s+week\b/i.test(lower)) {
      intervalMinutes = 10080;
    } else if (/\bmanually?\b|\bon\s+demand\b/i.test(lower)) {
      triggerType = TriggerType.MANUAL;
      intervalMinutes = 0;
    }

    // 2. Identify Intent & Synthesize Steps
    const steps = [];
    const permissions = new Set();
    let name = 'Custom Automation';

    // A. Git / Repository Watching
    if (lower.includes('git') || lower.includes('commit') || lower.includes('branch')) {
      name = 'Git Repository Status Watcher';
      steps.push({
        id: 'step_git_check',
        name: 'Query Git Status',
        tool: 'execute_terminal_command',
        args: { command: 'git status -s' },
        description: 'Check for uncommitted workspace modifications'
      });
      permissions.add('terminal:execute');

      if (lower.includes('report') || lower.includes('log') || lower.includes('write') || lower.includes('save')) {
        steps.push({
          id: 'step_git_log',
          name: 'Log Git Summary',
          tool: 'fs_write',
          args: { filePath: 'workspace/git_status.md', content: '# Automated Git Status\nTracked by ABYX Automation.' },
          description: 'Persist git report to workspace'
        });
        permissions.add('filesystem:write');
      }
    }

    // B. Vault & Knowledge Sync
    else if (lower.includes('vault') || lower.includes('obsidian') || lower.includes('second brain')) {
      name = 'Obsidian Second Brain Sync';
      steps.push({
        id: 'step_vault_sync',
        name: 'Synchronize Obsidian Vault',
        tool: 'vault_sync',
        args: {},
        description: 'Sync Markdown memory documents and workspace links'
      });
      permissions.add('filesystem:write');
      permissions.add('memory:write');
    }

    // C. Memory Review & Synthesis
    else if (lower.includes('memory') || lower.includes('synthesis') || lower.includes('profile')) {
      name = 'Daily Memory Reviewer';
      steps.push({
        id: 'step_memory_synth',
        name: 'Synthesize Chat Memory',
        tool: 'memory_synth',
        args: {},
        description: 'Condense transcripts into living profile facts'
      });
      permissions.add('memory:read');
      permissions.add('memory:write');
    }

    // D. Web Research & Intelligence Monitoring
    else if (lower.includes('news') || lower.includes('search') || lower.includes('monitor') || lower.includes('feed')) {
      const queryMatch = lower.match(/(?:for|about|on)\s+["']?([^"'\n,]+)["']?/);
      const query = queryMatch ? queryMatch[1].trim() : 'AI intelligence and engineering updates';

      name = `Web Intelligence: "${query.slice(0, 32)}"`;
      steps.push({
        id: 'step_web_search',
        name: 'Search Web Updates',
        tool: 'search_web',
        args: { query, maxResults: 5 },
        description: `Fetch real-time news and publications for "${query}"`
      });
      permissions.add('browser:search');

      steps.push({
        id: 'step_save_digest',
        name: 'Save Intelligence Digest',
        tool: 'fs_write',
        args: { filePath: 'workspace/intelligence_digest.md', content: `# Intelligence Digest: ${query}\nGenerated automatically by ABYX.` },
        description: 'Save search findings to workspace digest'
      });
      permissions.add('filesystem:write');
    }

    // E. General Custom Task
    else {
      name = clean.split(/\s+/).slice(0, 5).join(' ');
      steps.push({
        id: 'step_custom_exec',
        name: 'Execute Workflow Step',
        tool: 'custom_task',
        args: { prompt: clean },
        description: clean
      });
    }

    const proposed = createAutomationRecord({
      name,
      description: clean,
      triggerType,
      intervalMinutes,
      steps,
      requiredPermissions: Array.from(permissions),
      enabled: false // Drafts are disabled by default until user confirms
    });

    return {
      isDraft: true,
      originalPrompt: clean,
      proposedAutomation: proposed,
      reviewSummary: {
        name: proposed.name,
        trigger: proposed.trigger.summary,
        totalSteps: proposed.steps.length,
        steps: proposed.steps.map(s => ({ step: s.name, tool: s.tool, description: s.description })),
        requiredPermissions: proposed.requiredPermissions
      }
    };
  }
}

module.exports = WorkflowGenerator;
