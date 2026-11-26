'use strict';

const { EventEmitter } = require('node:events');

/**
 * PolicyEngine - OpenCode-style Granular Permission Engine
 * Supports Plan Mode (read-only exploratory) vs Build Mode (full execution),
 * fine-grained tool policies (allow, ask, deny), and human-in-the-loop approval.
 */
class PolicyEngine extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = {
      allowTerminal: options.allowTerminal !== false,
      allowBrowser: options.allowBrowser !== false,
      ...options
    };
    this.mode = options.mode || 'build'; // 'plan' | 'build'
    this.approvalTimeoutMs = options.approvalTimeoutMs || 180000;
    this.defaultPolicy = options.defaultPolicy || options.defaultAction || null;

    this.readOnlyTools = new Set([
      'read_file', 'list_directory', 'glob_files', 'search_files', 'search_content',
      'file_metadata', 'get_file_tree', 'diagnostics', 'symbols', 'find_definition',
      'find_references', 'format_document', 'validate_syntax', 'git_status', 'git_diff',
      'git_log', 'git_branch', 'git_worktree', 'lint_code', 'type_check',
      'navigate_browser', 'inspect_dom', 'extract_browser_content', 'capture_screenshot',
      'create_browser_session', 'close_browser_session', 'extract_web_content'
    ]);

    // Default tool policies
    const def = this.defaultPolicy;
    this.policies = {
      read_file: def || 'allow',
      list_directory: def || 'allow',
      glob_files: def || 'allow',
      search_files: def || 'allow',
      search_content: def || 'allow',
      file_metadata: def || 'allow',
      get_file_tree: def || 'allow',
      diagnostics: def || 'allow',
      symbols: def || 'allow',
      find_definition: def || 'allow',
      find_references: def || 'allow',
      format_document: def || 'allow',
      validate_syntax: def || 'allow',
      git_status: def || 'allow',
      git_diff: def || 'allow',
      git_log: def || 'allow',
      git_branch: def || 'allow',
      git_worktree: def || 'allow',
      lint_code: def || 'allow',
      type_check: def || 'allow',
      write_file: def || 'ask',
      edit_file: def || 'ask',
      apply_patch: def || 'ask',
      create_directory: def || 'ask',
      delete_file: def === 'allow' ? 'allow' : 'deny',
      run_command: def || 'ask',
      run_powershell: def || 'ask',
      run_wsl: def || 'ask',
      run_tests: def || 'ask',
      run_build: def || 'ask',
      navigate_browser: def || 'allow',
      inspect_dom: def || 'allow',
      extract_browser_content: def || 'allow',
      create_browser_session: def || 'allow',
      close_browser_session: def || 'allow',
      capture_screenshot: def || 'allow',
      interact_browser: def || 'ask',
      execute_browser_task: def || 'ask',
      extract_web_content: def || 'allow',
      ...(options.policies || {})
    };

    // Pending approval requests
    this.pendingApprovals = new Map();
  }

  setMode(mode) {
    if (mode !== 'plan' && mode !== 'build') {
      throw new Error(`Invalid policy mode: ${mode}. Expected 'plan' or 'build'.`);
    }
    const prev = this.mode;
    this.mode = mode;
    this.emit('mode:change', { previous: prev, current: mode });
  }

  setPolicy(toolName, policy) {
    if (!['allow', 'ask', 'deny'].includes(policy)) {
      throw new Error(`Invalid policy '${policy}' for tool ${toolName}. Must be 'allow', 'ask', or 'deny'.`);
    }
    this.policies[toolName] = policy;
  }

  getPolicy(toolName) {
    // In PLAN mode, all destructive write or terminal tools are restricted
    if (this.mode === 'plan') {
      if (!this.readOnlyTools.has(toolName)) {
        return 'deny';
      }
      return 'allow';
    }

    if (this.policies[toolName]) {
      return this.policies[toolName];
    }
    if (this.defaultPolicy) {
      return this.defaultPolicy;
    }
    if (this.readOnlyTools.has(toolName)) {
      return 'allow';
    }
    return 'ask';
  }

  async evaluate(toolName, args = {}) {
    const policy = this.getPolicy(toolName);

    if (policy === 'deny') {
      return {
        allowed: false,
        reason: this.mode === 'plan' 
          ? `Tool '${toolName}' is prohibited in PLAN MODE. Plan mode only permits read-only exploration.`
          : `Tool '${toolName}' is disabled by security policy.`
      };
    }

    if (policy === 'allow') {
      return { allowed: true };
    }

    // policy === 'ask': require explicit approval
    return this.requestApproval(toolName, args);
  }

  async requestApproval(toolName, args, reason = 'Action requires user permission') {
    const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this.pendingApprovals.has(requestId)) {
          this.pendingApprovals.delete(requestId);
          resolve({
            allowed: false,
            reason: `Approval request timed out after ${this.approvalTimeoutMs / 1000}s`
          });
        }
      }, this.approvalTimeoutMs);

      const requestRecord = {
        requestId,
        toolName,
        args,
        reason,
        timestamp: new Date().toISOString(),
        resolve: (allowed, userNote) => {
          clearTimeout(timer);
          this.pendingApprovals.delete(requestId);
          resolve({
            allowed: Boolean(allowed),
            reason: userNote || (allowed ? 'Approved by user' : 'Denied by user')
          });
        }
      };

      this.pendingApprovals.set(requestId, requestRecord);
      this.emit('approval:requested', {
        requestId,
        toolName,
        args,
        reason
      });
    });
  }

  resolveApproval(requestId, allowed, userNote = '') {
    const record = this.pendingApprovals.get(requestId);
    if (!record) {
      return false;
    }
    record.resolve(allowed, userNote);
    this.emit('approval:resolved', { requestId, allowed, userNote });
    return true;
  }

  listPendingApprovals() {
    return Array.from(this.pendingApprovals.values()).map(r => ({
      requestId: r.requestId,
      toolName: r.toolName,
      args: r.args,
      reason: r.reason,
      timestamp: r.timestamp
    }));
  }

  getPendingApprovals() {
    return this.listPendingApprovals();
  }
}

module.exports = PolicyEngine;
