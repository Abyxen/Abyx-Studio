'use strict';

const { EventEmitter } = require('node:events');
const crypto = require('node:crypto');
const path = require('node:path');

const RiskLevel = Object.freeze({
  SAFE: 'SAFE',
  REQUIRES_APPROVAL: 'REQUIRES_APPROVAL',
  DENIED: 'DENIED'
});

const ApprovalStatus = Object.freeze({
  PENDING: 'pending',
  APPROVED: 'approved',
  DENIED: 'denied',
  TIMED_OUT: 'timed_out'
});

const SAFE_EXECUTABLES = new Set(['git', 'dir', 'ls', 'pwd', 'node', 'python', 'python3', 'cargo', 'go', 'npm', 'pnpm', 'yarn']);
const SHELL_METACHARACTERS = /[;&|<>`$()\r\n\0^!]/;

function parseCommand(command) {
  if (typeof command !== 'string' || !command.trim() || command.length > 4096) return null;
  const trimmed = command.trim();
  const tokens = [];
  let token = '';
  let inDouble = false;
  let inSingle = false;
  let active = false;

  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i];
    if (char === '"' && !inSingle) { inDouble = !inDouble; active = true; continue; }
    if (char === "'" && !inDouble) { inSingle = !inSingle; active = true; continue; }
    if (!inDouble && !inSingle && SHELL_METACHARACTERS.test(char)) return null;
    if (/\s/.test(char) && !inDouble && !inSingle) {
      if (active) { tokens.push(token); token = ''; active = false; }
      continue;
    }
    if (char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) return null;
    token += char;
    active = true;
  }
  if (inDouble || inSingle) return null;
  if (active) tokens.push(token);
  if (!tokens.length || tokens.some(value => value.length > 1024)) return null;
  const executable = tokens.shift();
  if (/[\\/:]/.test(executable) || !/^[a-zA-Z][a-zA-Z0-9._-]*$/.test(executable)) return null;
  return { executable: executable.toLowerCase().replace(/\.exe$/i, ''), args: tokens };
}

function pathLikeOutsideWorkspace(value) {
  return path.isAbsolute(value) || /^[a-zA-Z]:/.test(value) || value.split(/[\\/]/).includes('..');
}

function commandRisk(command) {
  const parsed = parseCommand(command);
  if (!parsed || !SAFE_EXECUTABLES.has(parsed.executable)) {
    return { category: 'DENIED', parsed: null, reason: 'Command syntax or executable is not on the structured execution allowlist' };
  }
  const { executable, args } = parsed;
  const versionOnly = ['git', 'node', 'python', 'python3', 'cargo', 'go', 'npm', 'pnpm', 'yarn'].includes(executable) &&
    args.length === 1 && ['--version', '-v', '-V'].includes(args[0]);
  const gitReadOnly = executable === 'git' && args.length > 0 &&
    ['status', 'log', 'diff', 'branch', 'show', 'rev-parse'].includes(args[0]) &&
    !args.some(arg => /^(-c|--config|--exec-path|--pager|--paginate|--ext-diff|--textconv|--output|-o)(=|$)/i.test(arg));
  if (executable === 'git' && args.some(arg => /^--output(?:=|$)/i.test(arg) || arg === '-o')) {
    return { category: 'DENIED', parsed, reason: 'Git output redirection is not permitted' };
  }
  const simpleReadOnly = (executable === 'pwd' && args.length === 0) ||
    (['dir', 'ls'].includes(executable) && args.length <= 4 &&
     args.every(arg => !pathLikeOutsideWorkspace(arg) && !/^(-R|--recursive|\/s)$/i.test(arg)));

  if (versionOnly || gitReadOnly || simpleReadOnly) {
    return { category: 'READ_ONLY', parsed, reason: 'Structured read-only command' };
  }
  return { category: 'APPROVAL_REQUIRED', parsed, reason: 'Command may modify state or invoke unisolated execution' };
}

const PROHIBITED_NETWORK_TARGETS = [
  /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?/i,
  /^https?:\/\/10\.\d+\.\d+\.\d+/i,
  /^https?:\/\/192\.168\.\d+\.\d+/i,
  /^https?:\/\/172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+/i,
  /^https?:\/\/169\.254\.\d+\.\d+/i,
  /^file:\/\//i
];

class PolicyEngine extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = {
      allowTerminal: options.allowTerminal !== false,
      allowBrowser: options.allowBrowser !== false,
      ...options
    };
    this.mode = options.mode || 'build'; // 'plan' | 'build'
    this.approvalTimeoutMs = options.approvalTimeoutMs !== undefined ? options.approvalTimeoutMs : 180000;
    this.defaultPolicy = options.defaultPolicy || options.defaultAction || null;

    this.readOnlyTools = new Set([
      'read_file', 'list_directory', 'glob_files', 'search_files', 'search_content',
      'file_metadata', 'get_file_tree', 'diagnostics', 'symbols', 'find_definition',
      'find_references', 'format_document', 'validate_syntax', 'git_status', 'git_diff',
      'git_log', 'git_branch', 'git_worktree', 'lint_code', 'type_check',
      'navigate_browser', 'inspect_dom', 'extract_browser_content', 'capture_screenshot',
      'create_browser_session', 'close_browser_session', 'extract_web_content',
      'fs_read', 'fs_list', 'fs_search', 'inspect_repository', 'search_repository', 'consult_skill', 'system_info'
    ]);

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

    this.pendingApprovals = new Map();
    this.sessionPermissions = new Map();
    this.permissionMode = options.permissionMode || 'ask';
  }

  setPermissionMode(mode) {
    let normalized = String(mode || 'ask').toLowerCase().trim().replace(/_/g, ' ');
    if (normalized === 'default') normalized = 'ask';
    if (normalized === 'auto') normalized = 'approve for me';
    if (normalized === 'request review' || normalized === 'review') {
      this.permissionMode = 'request review';
      for (const k of Object.keys(this.policies)) this.policies[k] = 'ask';
      this.emit('permission_mode:change', { permissionMode: 'request review' });
      return true;
    }
    if (normalized === 'turbo') {
      this.permissionMode = 'turbo';
      for (const k of Object.keys(this.policies)) this.policies[k] = 'allow';
      this.emit('permission_mode:change', { permissionMode: 'turbo' });
      return true;
    }
    if (normalized === 'approve for me') {
      this.permissionMode = 'approve for me';
      for (const k of ['write_file', 'edit_file', 'apply_patch', 'create_directory', 'run_tests', 'run_build', 'run_command', 'run_powershell']) {
        this.policies[k] = 'allow';
      }
      this.emit('permission_mode:change', { permissionMode: 'approve for me' });
      return true;
    }
    if (normalized === 'ask') {
      this.permissionMode = 'ask';
      for (const k of ['write_file', 'edit_file', 'apply_patch', 'create_directory', 'run_command', 'run_powershell', 'run_wsl', 'run_tests', 'run_build']) {
        this.policies[k] = 'ask';
      }
      this.emit('permission_mode:change', { permissionMode: 'ask' });
      return true;
    }
    return false;
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
    if (this.permissionMode === 'request review') {
      return 'ask';
    }
    if (this.permissionMode === 'turbo') {
      return 'allow';
    }
    if (this.mode === 'plan') {
      if (!this.readOnlyTools.has(toolName)) {
        return 'deny';
      }
      return 'allow';
    }
    if (this.policies[toolName]) return this.policies[toolName];
    if (this.defaultPolicy) return this.defaultPolicy;
    if (this.readOnlyTools.has(toolName)) return 'allow';
    return 'ask';
  }

  evaluateToolCall(toolName, args = {}, context = {}) {
    if (typeof toolName === 'object' && toolName !== null) {
      const obj = toolName;
      toolName = obj.name || obj.toolName;
      args = obj.args || {};
      context = obj.context || {};
    }

    const isReadOnly = this.readOnlyTools.has(toolName) ||
      ['fs_list', 'list_files', 'fs_read', 'read_file', 'fs_search', 'search_files', 'git_status', 'git_diff', 'git_log', 'git_branch', 'system_info', 'consult_skill', 'diagnostics', 'symbols'].includes(toolName);

    if (this.mode === 'plan') {
      if (isReadOnly) {
        return { riskLevel: RiskLevel.SAFE, reason: 'Read-only inspection allowed in PLAN MODE', allowed: true };
      }
      return {
        riskLevel: RiskLevel.DENIED,
        reason: `Tool "${toolName}" is not permitted in PLAN MODE. Plan mode is strictly read-only.`,
        allowed: false
      };
    }

    if (this.policies[toolName] === 'deny') {
      return { riskLevel: RiskLevel.DENIED, reason: `Tool "${toolName}" is denied by explicit user policy`, allowed: false };
    }
    if (this.policies[toolName] === 'allow') {
      return { riskLevel: RiskLevel.SAFE, reason: `Tool "${toolName}" is explicitly allowed by user policy`, allowed: true };
    }

    if (isReadOnly) {
      return { riskLevel: RiskLevel.SAFE, reason: 'Read-only inspection', allowed: true };
    }

    if (toolName === 'fs_mkdir' || toolName === 'mkdir' || toolName === 'create_directory') {
      return { riskLevel: RiskLevel.SAFE, reason: 'Creating directory within approved workspace', allowed: true };
    }

    if (['fs_write', 'write_file', 'generate_file', 'generate_pdf', 'generate_document'].includes(toolName)) {
      const targetPath = args.filePath || args.file_path || args.path || '';
      const isOverwrite = context.isOverwrite || false;
      const ext = (targetPath.split('.').pop() || '').toLowerCase();
      const isExecutableExt = ['exe', 'bat', 'cmd', 'ps1', 'vbs', 'sh'].includes(ext);

      if (isExecutableExt) {
        return {
          riskLevel: RiskLevel.REQUIRES_APPROVAL,
          reason: `Creating or modifying executable script file (.${ext}) requires explicit user confirmation`,
          preview: `File: ${targetPath}`,
          allowed: false
        };
      }

      if (isOverwrite) {
        return {
          riskLevel: RiskLevel.REQUIRES_APPROVAL,
          reason: `File "${targetPath}" already exists. Overwrite requires confirmation to prevent accidental data loss`,
          preview: context.changePreview || `Target: ${targetPath}`,
          allowed: false
        };
      }

      return {
        riskLevel: RiskLevel.SAFE,
        reason: 'Creating a new file within the approved workspace',
        allowed: true
      };
    }

    if (toolName === 'execute_terminal_command' || toolName === 'run_terminal' || toolName === 'run_command') {
      if (this.options.allowTerminal === false) {
        return { riskLevel: RiskLevel.DENIED, reason: 'Terminal execution is disabled by current user policy', allowed: false };
      }
      const cmd = args.command || '';
      const analysis = commandRisk(cmd);
      if (analysis.category === 'DENIED') {
        return { riskLevel: RiskLevel.DENIED, reason: analysis.reason, category: analysis.category, allowed: false };
      }
      if (analysis.category === 'READ_ONLY') {
        return { riskLevel: RiskLevel.SAFE, reason: analysis.reason, category: analysis.category, allowed: true };
      }
      return {
        riskLevel: RiskLevel.REQUIRES_APPROVAL,
        reason: analysis.reason,
        category: analysis.category,
        allowed: false,
        preview: { executable: analysis.parsed?.executable, args: analysis.parsed?.args, cwd: args.cwd || '.' }
      };
    }

    if (['fetch_web_page', 'browse_url', 'open_browser'].includes(toolName)) {
      if (this.options.allowBrowser === false) {
        return { riskLevel: RiskLevel.DENIED, reason: 'Web browsing is disabled by policy', allowed: false };
      }
      const targetUrl = args.url || '';
      for (const pattern of PROHIBITED_NETWORK_TARGETS) {
        if (pattern.test(targetUrl)) {
          return { riskLevel: RiskLevel.DENIED, reason: `SSRF Violation: Target prohibited: "${targetUrl}"`, allowed: false };
        }
      }
      return { riskLevel: RiskLevel.SAFE, reason: 'Public web page inspection', allowed: true };
    }

    const pol = this.getPolicy(toolName);
    if (pol === 'allow') {
      return { riskLevel: RiskLevel.SAFE, reason: 'Policy allows tool', allowed: true };
    }
    if (pol === 'deny') {
      return { riskLevel: RiskLevel.DENIED, reason: 'Policy denies tool', allowed: false };
    }
    return {
      riskLevel: RiskLevel.REQUIRES_APPROVAL,
      reason: `Tool "${toolName}" requires user approval`,
      allowed: false,
      preview: JSON.stringify(args)
    };
  }

  authorizeTerminalApiRequest({ command, cwd = '.', approvalId = null, approved = false } = {}) {
    const args = { command, cwd };
    const decision = this.evaluateToolCall('execute_terminal_command', args);
    if (decision.riskLevel === RiskLevel.DENIED) {
      return { allowed: false, status: 403, error: 'Command blocked by security policy' };
    }
    if (decision.riskLevel === RiskLevel.SAFE) {
      return { allowed: true, approvalId: null };
    }
    if (!approvalId) {
      const approval = this.requestApproval({
        toolName: 'execute_terminal_command',
        args,
        riskLevel: decision.riskLevel,
        reason: decision.reason,
        preview: JSON.stringify(decision.preview),
        source: 'terminal-api'
      });
      return { allowed: false, requiresApproval: true, approvalId: approval.id, preview: approval.preview };
    }
    const approval = this.pendingApprovals.get(approvalId);
    if (!approval || approval.source !== 'terminal-api' || approval.status !== ApprovalStatus.PENDING ||
        approval.toolName !== 'execute_terminal_command' || approval.args?.command !== command || (approval.args?.cwd || '.') !== cwd) {
      return { allowed: false, status: 403, error: 'Approval does not match this command and working directory' };
    }
    try {
      this.resolveApproval(approvalId, approved ? 'approve' : 'deny');
    } catch (_) {
      return { allowed: false, status: 403, error: 'Approval is unavailable or expired' };
    }
    if (!approved) return { allowed: false, status: 403, error: 'Command approval denied' };
    return { allowed: true, approvalId };
  }

  requestApproval(toolNameOrObj, args = {}, reason = 'Action requires user permission') {
    if (typeof toolNameOrObj === 'object' && toolNameOrObj !== null) {
      const opts = toolNameOrObj;
      const id = `appr_${crypto.randomUUID()}`;
      const expiresAt = new Date(Date.now() + this.approvalTimeoutMs).toISOString();
      const request = {
        id,
        runId: opts.runId || null,
        stepNumber: opts.stepNumber || 1,
        toolCallId: opts.toolCallId || null,
        toolName: opts.toolName,
        args: opts.args || {},
        riskLevel: opts.riskLevel || RiskLevel.REQUIRES_APPROVAL,
        reason: opts.reason || reason,
        preview: opts.preview || null,
        source: opts.source || 'agent',
        status: ApprovalStatus.PENDING,
        createdAt: new Date().toISOString(),
        expiresAt
      };
      this.pendingApprovals.set(id, request);
      this.emit('approval:requested', request);
      return request;
    }

    const toolName = toolNameOrObj;
    const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this.pendingApprovals.has(requestId)) {
          const req = this.pendingApprovals.get(requestId);
          req.status = ApprovalStatus.TIMED_OUT;
          this.pendingApprovals.delete(requestId);
          resolve({
            allowed: false,
            reason: `Approval request timed out after ${this.approvalTimeoutMs / 1000}s`
          });
        }
      }, this.approvalTimeoutMs);

      const requestRecord = {
        id: requestId,
        requestId,
        toolName,
        args,
        reason,
        status: ApprovalStatus.PENDING,
        expiresAt: new Date(Date.now() + this.approvalTimeoutMs).toISOString(),
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
      this.emit('approval:requested', requestRecord);
    });
  }

  resolveApproval(approvalId, decisionOrAllowed, userNote = '') {
    const request = this.pendingApprovals.get(approvalId);
    if (!request) {
      throw new Error(`Approval request "${approvalId}" not found or already resolved`);
    }

    if (Date.now() > Date.parse(request.expiresAt)) {
      request.status = ApprovalStatus.TIMED_OUT;
      throw new Error('Approval request expired');
    }

    if (request.status !== ApprovalStatus.PENDING) {
      throw new Error(`Approval request "${approvalId}" has already been ${request.status}`);
    }

    const isApprove = decisionOrAllowed === 'approve' || decisionOrAllowed === true;
    request.decision = isApprove ? 'approve' : 'deny';
    request.status = isApprove ? ApprovalStatus.APPROVED : ApprovalStatus.DENIED;
    request.resolvedAt = new Date().toISOString();

    if (typeof request.resolve === 'function') {
      request.resolve(isApprove, userNote);
    }

    this.emit('approval:resolved', { requestId: approvalId, allowed: isApprove, userNote });
    return request;
  }

  validateApprovedCall(approvalId, toolName, args) {
    return this.matchesApprovedCall(approvalId, toolName, args, { consume: true });
  }

  matchesApprovedCall(approvalId, toolName, args, { consume = false } = {}) {
    const approval = this.pendingApprovals.get(approvalId);
    if (!approval || approval.status !== ApprovalStatus.APPROVED || approval.consumedAt || approval.toolName !== toolName) {
      return false;
    }
    if (Date.now() > Date.parse(approval.expiresAt)) {
      approval.status = ApprovalStatus.TIMED_OUT;
      return false;
    }
    let matches;
    if (toolName === 'execute_terminal_command' || toolName === 'run_command') {
      matches = approval.args?.command === args.command && (approval.args?.cwd || '.') === (args.cwd || '.');
    } else {
      matches = JSON.stringify(approval.args) === JSON.stringify(args);
    }
    if (matches && consume) {
      approval.consumedAt = new Date().toISOString();
    }
    return Boolean(matches);
  }

  async evaluate(toolName, args = {}) {
    const dec = this.evaluateToolCall(toolName, args);
    if (dec.riskLevel === RiskLevel.DENIED) {
      return { allowed: false, reason: dec.reason };
    }
    if (dec.riskLevel === RiskLevel.SAFE) {
      return { allowed: true };
    }
    return this.requestApproval(toolName, args);
  }

  listPendingApprovals() {
    return Array.from(this.pendingApprovals.values())
      .filter(r => r.status === ApprovalStatus.PENDING);
  }

  getPendingApprovals() {
    return this.listPendingApprovals();
  }
}

PolicyEngine.parseCommand = parseCommand;
PolicyEngine.commandRisk = commandRisk;
PolicyEngine.RiskLevel = RiskLevel;
PolicyEngine.ApprovalStatus = ApprovalStatus;

module.exports = PolicyEngine;
