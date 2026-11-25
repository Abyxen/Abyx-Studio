/**
 * ABYX Agentic Engine — Central Policy & Permission Engine
 * 
 * Enforces backend-governed security boundaries:
 * - Model output is UNTRUSTED: model cannot grant itself permissions or bypass policy
 * - Classifies all tool invocations into: SAFE, REQUIRES_APPROVAL, or DENIED
 * - Manages human-in-the-loop approval workflows with persistent tracking & timeouts
 * - Prevents command injection, SSRF, destructive data loss, and unauthorized execution
 */

const { RiskLevel, ApprovalStatus, createApprovalRequest } = require('./types');
const crypto = require('node:crypto');

const SAFE_EXECUTABLES = new Set(['git', 'dir', 'ls', 'pwd', 'node', 'python', 'python3', 'cargo', 'go', 'npm', 'pnpm', 'yarn']);
const SHELL_METACHARACTERS = /[;&|<>`$()\r\n\0^!]/;

function parseCommand(command) {
  if (typeof command !== 'string' || !command.trim() || command.length > 4096) return null;
  const tokens = [];
  let token = '';
  let inDouble = false;
  let inSingle = false;
  let active = false;

  for (let i = 0; i < command.trim().length; i++) {
    const char = command.trim()[i];
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

function commandRisk(command) {
  const parsed = parseCommand(command);
  if (!parsed || !SAFE_EXECUTABLES.has(parsed.executable)) return { category: 'DENIED', parsed: null, reason: 'Command syntax or executable is not on the structured execution allowlist' };
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
  if (versionOnly || gitReadOnly || simpleReadOnly) return { category: 'READ_ONLY', parsed, reason: 'Structured read-only command' };
  return { category: 'APPROVAL_REQUIRED', parsed, reason: 'Trusted host command can change files, run code, or invoke external tools; it is not OS-isolated' };
}

function pathLikeOutsideWorkspace(value) {
  return path.isAbsolute(value) || /^[a-zA-Z]:/.test(value) || value.split(/[\\/]/).includes('..');
}

const path = require('node:path');

// SSRF Protection: Blocked IP addresses / domains for web fetching
const PROHIBITED_NETWORK_TARGETS = [
  /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?/i,
  /^https?:\/\/10\.\d+\.\d+\.\d+/i,
  /^https?:\/\/192\.168\.\d+\.\d+/i,
  /^https?:\/\/172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+/i,
  /^https?:\/\/169\.254\.\d+\.\d+/i, // AWS/Cloud metadata service
  /^file:\/\//i
];

class PolicyEngine {
  constructor(options = {}) {
    this.options = {
      allowTerminal: options.allowTerminal !== undefined ? options.allowTerminal : false,
      allowBrowser: options.allowBrowser !== undefined ? options.allowBrowser : true,
      approvalTimeoutMs: options.approvalTimeoutMs || 300000, // 5 minutes
      policyMode: options.policyMode || 'balanced', // 'strict' | 'balanced' | 'autonomous'
      ...options
    };

    // In-memory approval registry: approvalId -> ApprovalRequest
    this.pendingApprovals = new Map();
    // Session permissions: sessionId -> Set of granted rule strings
    this.sessionPermissions = new Map();
  }

  grantSessionPermission(sessionId, ruleKey, subKey = null) {
    if (!sessionId) return;
    if (!this.sessionPermissions.has(sessionId)) {
      this.sessionPermissions.set(sessionId, new Set());
    }
    const set = this.sessionPermissions.get(sessionId);
    set.add(ruleKey);
    if (subKey) {
      set.add(`${ruleKey}:${subKey}`);
    }
  }

  hasSessionPermission(sessionId, ruleKey, subKey = null) {
    if (!sessionId || !this.sessionPermissions.has(sessionId)) return false;
    const set = this.sessionPermissions.get(sessionId);
    if (set.has('*') || set.has('all_tools') || set.has(ruleKey)) return true;
    if (subKey && set.has(`${ruleKey}:${subKey}`)) return true;
    if (subKey && set.has(`${ruleKey}:*`)) return true;
    return false;
  }

  revokeSessionPermissions(sessionId) {
    if (sessionId) {
      this.sessionPermissions.delete(sessionId);
    }
  }

  /**
   * Evaluates the risk and permission level for a proposed tool action.
   * Model output claims are ignored; policy is determined solely by backend rules.
   * 
   * @param {string} toolName 
   * @param {Object} args 
   * @param {Object} context - { fsExists: boolean, isOverwrite: boolean, profilePermissions: Object, sessionId: string }
   * @returns {{ riskLevel: string, reason: string, preview?: string }}
   */
  evaluateToolCall(toolName, args = {}, context = {}) {
    if (typeof toolName === 'object' && toolName !== null) {
      const obj = toolName;
      toolName = obj.name || obj.toolName;
      args = obj.args || {};
      context = obj.context || {};
    }
    const result = this._evaluateToolCallInternal(toolName, args, context);

    if (result.riskLevel === RiskLevel.REQUIRES_APPROVAL && context.sessionId) {
      const cmdExecutable = (toolName === 'execute_terminal_command' && args.command)
        ? args.command.trim().split(/\s+/)[0].toLowerCase()
        : null;

      if (this.hasSessionPermission(context.sessionId, toolName) ||
          this.hasSessionPermission(context.sessionId, 'all_tools') ||
          (cmdExecutable && this.hasSessionPermission(context.sessionId, 'terminal_exec', cmdExecutable)) ||
          this.hasSessionPermission(context.sessionId, '*')) {
        return {
          riskLevel: RiskLevel.SAFE,
          reason: 'Auto-approved by active session permission rule',
          allowed: true
        };
      }
    }

    return {
      ...result,
      allowed: result.riskLevel === RiskLevel.SAFE
    };
  }

  isCommandAllowed(command) {
    const res = this.evaluateToolCall('execute_terminal_command', { command });
    return res.allowed === true;
  }

  checkCommand(command) {
    const res = this.evaluateToolCall('execute_terminal_command', { command });
    return {
      allowed: res.allowed,
      requiresApproval: res.riskLevel === RiskLevel.REQUIRES_APPROVAL || res.riskLevel === RiskLevel.DENIED,
      riskLevel: res.riskLevel,
      reason: res.reason
    };
  }

  authorizeTerminalApiRequest({ command, cwd = '.', approvalId = null, approved = false } = {}) {
    const args = { command, cwd };
    const decision = this.evaluateToolCall('execute_terminal_command', args);
    if (decision.riskLevel === RiskLevel.DENIED) return { allowed: false, status: 403, error: 'Command blocked by security policy' };
    if (decision.riskLevel === RiskLevel.SAFE) return { allowed: true, approvalId: null };
    if (!approvalId) {
      const approval = this.requestApproval({
        toolName: 'execute_terminal_command', args, riskLevel: decision.riskLevel,
        reason: decision.reason, preview: JSON.stringify(decision.preview), source: 'terminal-api'
      });
      return { allowed: false, requiresApproval: true, approvalId: approval.id, preview: approval.preview };
    }
    const approval = this.pendingApprovals.get(approvalId);
    if (!approval || approval.source !== 'terminal-api' || approval.status !== ApprovalStatus.PENDING ||
        approval.toolName !== 'execute_terminal_command' || approval.args?.command !== command || approval.args?.cwd !== cwd) {
      return { allowed: false, status: 403, error: 'Approval does not match this command and working directory' };
    }
    try { this.resolveApproval(approvalId, approved ? 'approve' : 'deny'); }
    catch (_) { return { allowed: false, status: 403, error: 'Approval is unavailable or expired' }; }
    if (!approved) return { allowed: false, status: 403, error: 'Command approval denied' };
    return { allowed: true, approvalId };
  }

  _evaluateToolCallInternal(toolName, args = {}, context = {}) {
    const permissions = {
      ...this.options,
      ...(context.profilePermissions || {})
    };

    // 1. Filesystem Tools Policy
    if (toolName === 'fs_list' || toolName === 'list_files' || toolName === 'fs_read' || toolName === 'read_file' || toolName === 'fs_search' || toolName === 'search_files' || toolName === 'inspect_repository' || toolName === 'search_repository' || toolName === 'git_status' || toolName === 'git_diff' || toolName === 'git_log' || toolName === 'git_branch') {
      return {
        riskLevel: RiskLevel.SAFE,
        reason: 'Read-only workspace inspection'
      };
    }

    if (toolName === 'fs_mkdir' || toolName === 'mkdir' || toolName === 'create_directory') {
      return {
        riskLevel: RiskLevel.SAFE,
        reason: 'Creating directory within approved workspace'
      };
    }

    if (toolName === 'consult_skill') {
      return { riskLevel: RiskLevel.SAFE, reason: 'Read-only instruction skill lookup; skills grant no tool permissions' };
    }
    if (toolName === 'system_info' || toolName === 'search_living_memory') {
      return { riskLevel: RiskLevel.SAFE, reason: 'Read-only local profile information' };
    }

    if (toolName === 'fs_move' || toolName === 'move_file' || toolName === 'rename_file') {
      return {
        riskLevel: RiskLevel.REQUIRES_APPROVAL,
        reason: `Moving or renaming "${args.sourcePath || args.source || args.from}" to "${args.destinationPath || args.destination || args.to}"`,
        preview: `${args.sourcePath || args.from} -> ${args.destinationPath || args.to}`
      };
    }

    if (toolName === 'fs_write' || toolName === 'write_file' || toolName === 'generate_file' || toolName === 'generate_pdf' || toolName === 'generate_document') {
      const targetPath = args.filePath || args.file_path || args.path || '';
      const isOverwrite = context.isOverwrite || false;
      const ext = (targetPath.split('.').pop() || '').toLowerCase();
      const isExecutableExt = ['exe', 'bat', 'cmd', 'ps1', 'vbs', 'sh'].includes(ext);

      if (isExecutableExt) {
        return {
          riskLevel: RiskLevel.REQUIRES_APPROVAL,
          reason: `Creating or modifying executable script file (.${ext}) requires explicit user confirmation`,
          preview: `File: ${targetPath}`
        };
      }

      if (isOverwrite) {
        return {
          riskLevel: RiskLevel.REQUIRES_APPROVAL,
          reason: `File "${targetPath}" already exists. Overwrite requires confirmation to prevent accidental data loss`,
          preview: context.changePreview || `Target: ${targetPath}`
        };
      }

      if (toolName === 'fs_write') {
        return { riskLevel: RiskLevel.REQUIRES_APPROVAL, reason: `Create reviewed workspace file "${targetPath}"`, preview: context.changePreview || `Create: ${targetPath}` };
      }

      return {
        riskLevel: RiskLevel.SAFE,
        reason: 'Creating a new file within the approved workspace'
      };
    }

    if (toolName === 'fs_edit') {
      return {
        riskLevel: RiskLevel.REQUIRES_APPROVAL,
        reason: `Modifying contents of existing file "${args.filePath || args.path}"`,
        preview: context.changePreview || `Find: "${(args.target || '').slice(0, 80)}..."`
      };
    }

    if (toolName === 'fs_delete' || toolName === 'delete_file') {
      return {
        riskLevel: RiskLevel.REQUIRES_APPROVAL,
        reason: `Destructive file deletion requested for "${args.filePath || args.path}"`,
        preview: `Delete: ${args.filePath || args.path}`
      };
    }

    // 2. Terminal Execution Policy
    if (toolName === 'execute_terminal_command' || toolName === 'run_terminal') {
      if (!permissions.allowTerminal) {
        return {
          riskLevel: RiskLevel.DENIED,
          reason: 'Terminal execution is disabled by current user policy'
        };
      }

      const cmd = args.command;
      const analysis = commandRisk(cmd);
      if (analysis.category === 'DENIED') return { riskLevel: RiskLevel.DENIED, reason: analysis.reason, category: analysis.category };
      if (analysis.category === 'READ_ONLY') return { riskLevel: RiskLevel.SAFE, reason: analysis.reason, category: analysis.category };
      return {
        riskLevel: RiskLevel.REQUIRES_APPROVAL,
        reason: analysis.reason,
        category: analysis.category,
        preview: JSON.stringify({ executable: analysis.parsed.executable, args: analysis.parsed.args, cwd: args.cwd || '.' }, null, 2)
      };
    }

    // 3. Browser & Network Policy
    if (toolName === 'fetch_web_page' || toolName === 'browse_url' || toolName === 'browse_page' || toolName === 'open_browser') {
      if (!permissions.allowBrowser) {
        return {
          riskLevel: RiskLevel.DENIED,
          reason: 'Web browsing is disabled by policy'
        };
      }

      const targetUrl = args.url || '';
      for (const pattern of PROHIBITED_NETWORK_TARGETS) {
        if (pattern.test(targetUrl)) {
          return {
            riskLevel: RiskLevel.DENIED,
            reason: `SSRF Violation: Access to loopback or private network targets is prohibited: "${targetUrl}"`
          };
        }
      }

      return {
        riskLevel: RiskLevel.SAFE,
        reason: 'Public web page inspection'
      };
    }

    if (toolName === 'search_web') {
      return {
        riskLevel: RiskLevel.SAFE,
        reason: 'Real-time search index query'
      };
    }

    // 4. Default: Require approval for unclassified or custom tools
    return {
      riskLevel: RiskLevel.REQUIRES_APPROVAL,
      reason: `Unclassified tool "${toolName}" requires user approval`,
      preview: JSON.stringify(args)
    };
  }

  /**
   * Enqueues a human-in-the-loop approval request
   */
  requestApproval({ runId, stepNumber, toolCallId, toolName, args, riskLevel, reason, preview, source = 'agent' }) {
    const request = createApprovalRequest({
      id: `appr_${crypto.randomUUID()}`,
      runId,
      stepNumber,
      toolCallId,
      toolName,
      args,
      riskLevel,
      reason,
      preview
    });
    request.expiresAt = new Date(Date.now() + this.options.approvalTimeoutMs).toISOString();
    request.source = source;

    this.pendingApprovals.set(request.id, request);
    return request;
  }

  /**
   * Resolves a pending approval with 'approve' or 'deny'
   */
  resolveApproval(approvalId, decision = 'approve') {
    const request = this.pendingApprovals.get(approvalId);
    if (!request) {
      throw new Error(`Approval request "${approvalId}" not found or already resolved`);
    }

    if (request.status !== ApprovalStatus.PENDING) {
      throw new Error(`Approval request "${approvalId}" has already been ${request.status}`);
    }

    if (Date.now() > Date.parse(request.expiresAt)) {
      request.status = ApprovalStatus.TIMED_OUT;
      throw new Error('Approval request expired');
    }

    request.decision = decision === 'approve' ? 'approve' : 'deny';
    request.status = decision === 'approve' ? ApprovalStatus.APPROVED : ApprovalStatus.DENIED;
    request.resolvedAt = new Date().toISOString();

    return request;
  }

  validateApprovedCall(approvalId, toolName, args) {
    return this.matchesApprovedCall(approvalId, toolName, args, { consume: true });
  }

  matchesApprovedCall(approvalId, toolName, args, { consume = false } = {}) {
    const approval = this.pendingApprovals.get(approvalId);
    if (!approval || approval.status !== ApprovalStatus.APPROVED || approval.consumedAt || approval.toolName !== toolName) return false;
    if (Date.now() > Date.parse(approval.expiresAt)) {
      approval.status = ApprovalStatus.TIMED_OUT;
      return false;
    }
    let matches;
    if (toolName === 'execute_terminal_command') {
      matches = approval.args?.command === args.command && (approval.args?.cwd || '.') === (args.cwd || '.');
    } else {
      matches = JSON.stringify(approval.args) === JSON.stringify(args);
    }
    if (matches && consume) approval.consumedAt = new Date().toISOString();
    return matches;
  }

  /**
   * Retrieves pending approvals for a specific run or all
   */
  getPendingApprovals(runId = null) {
    const all = Array.from(this.pendingApprovals.values());
    if (runId) {
      return all.filter(a => a.runId === runId && a.status === ApprovalStatus.PENDING);
    }
    return all.filter(a => a.status === ApprovalStatus.PENDING);
  }
}

PolicyEngine.parseCommand = parseCommand;
PolicyEngine.commandRisk = commandRisk;
module.exports = PolicyEngine;
