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

// Blocked shell command patterns (Hard Deny)
const PROHIBITED_SHELL_PATTERNS = [
  /\bformat\b/i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bdel(ete)?\b.*[cC]:[\\\/]/i,
  /\brm\s+-[rf]{1,2}\s+([\/]|[cC]:)/i,
  /\brmdir\b.*[cC]:[\\\/]/i,
  /\b(curl|wget)\b.*\|\s*(bash|sh|cmd|powershell)/i,
  /\bpowershell\b.*-enc(odedcommand)?\b/i,
  /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, // Fork bomb
  /\breg\s+(add|delete)\b/i,
  /\bdiskpart\b/i
];

// Risky shell commands requiring explicit human approval
const RISKY_SHELL_PATTERNS = [
  /\b(npm|pnpm|yarn|pip|cargo|go)\s+install\b/i,
  /\b(del|rm|erase)\b/i,
  /\b(move|mv|ren|rename)\b/i,
  /\bgit\s+(commit|push|rebase|reset|merge|checkout\s+-b)\b/i,
  /\b(taskkill|kill|pkill)\b/i,
  /\bnetsh\b/i,
  />\s*[^&]/ // Shell file redirections
];

// Whitelisted read-only terminal commands
const SAFE_READONLY_COMMANDS = [
  /^git\s+(status|log|diff|branch|show|rev-parse)/i,
  /^(dir|ls|pwd)(\s+.*)?$/i,
  /^(node|python|cargo|go|git|npm)\s+(--version|-v)/i,
  /^(type|cat|head|tail)\s+[^\s>|&;]+/i,
  /^echo\s+[^>|&;]+$/i
];

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
      ...options
    };

    // In-memory approval registry: approvalId -> ApprovalRequest
    this.pendingApprovals = new Map();
  }

  /**
   * Evaluates the risk and permission level for a proposed tool action.
   * Model output claims are ignored; policy is determined solely by backend rules.
   * 
   * @param {string} toolName 
   * @param {Object} args 
   * @param {Object} context - { fsExists: boolean, isOverwrite: boolean, profilePermissions: Object }
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
    return {
      ...result,
      allowed: result.riskLevel === RiskLevel.SAFE
    };
  }

  isCommandAllowed(command) {
    const res = this.evaluateToolCall('execute_terminal_command', { command });
    return res.allowed === true;
  }

  _evaluateToolCallInternal(toolName, args = {}, context = {}) {
    const permissions = {
      ...this.options,
      ...(context.profilePermissions || {})
    };

    // 1. Filesystem Tools Policy
    if (toolName === 'fs_list' || toolName === 'list_files' || toolName === 'fs_read' || toolName === 'read_file' || toolName === 'fs_search' || toolName === 'search_files') {
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

    if (toolName === 'fs_move' || toolName === 'move_file' || toolName === 'rename_file') {
      return {
        riskLevel: RiskLevel.REQUIRES_APPROVAL,
        reason: `Moving or renaming "${args.sourcePath || args.source || args.from}" to "${args.destinationPath || args.destination || args.to}"`,
        preview: `${args.sourcePath || args.from} -> ${args.destinationPath || args.to}`
      };
    }

    if (toolName === 'generate_pdf' || toolName === 'generate_document') {
      return {
        riskLevel: RiskLevel.SAFE,
        reason: 'Generating document within approved workspace'
      };
    }

    if (toolName === 'fs_write' || toolName === 'write_file' || toolName === 'generate_file') {
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
          preview: `Target: ${targetPath}`
        };
      }

      return {
        riskLevel: RiskLevel.SAFE,
        reason: 'Creating new text file within approved workspace'
      };
    }

    if (toolName === 'fs_edit') {
      return {
        riskLevel: RiskLevel.REQUIRES_APPROVAL,
        reason: `Modifying contents of existing file "${args.filePath || args.path}"`,
        preview: `Find: "${(args.target || '').slice(0, 80)}..."`
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

      const cmd = (args.command || '').trim();
      if (!cmd) {
        return { riskLevel: RiskLevel.DENIED, reason: 'Command string is empty' };
      }

      // Check Prohibited Patterns (Hard Block)
      for (const pattern of PROHIBITED_SHELL_PATTERNS) {
        if (pattern.test(cmd)) {
          return {
            riskLevel: RiskLevel.DENIED,
            reason: `Prohibited command pattern detected: "${cmd.slice(0, 40)}..."`
          };
        }
      }

      // Check Safe Whitelist
      const isSafe = SAFE_READONLY_COMMANDS.some(pattern => pattern.test(cmd));
      if (isSafe) {
        return {
          riskLevel: RiskLevel.SAFE,
          reason: 'Read-only informational terminal command'
        };
      }

      // Check Risky Patterns
      const isRisky = RISKY_SHELL_PATTERNS.some(pattern => pattern.test(cmd));
      return {
        riskLevel: RiskLevel.REQUIRES_APPROVAL,
        reason: isRisky
          ? `High-impact terminal command requires user confirmation: "${cmd}"`
          : `State-altering shell command execution requires user confirmation: "${cmd}"`,
        preview: cmd
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
  requestApproval({ runId, stepNumber, toolCallId, toolName, args, riskLevel, reason, preview }) {
    const request = createApprovalRequest({
      runId,
      stepNumber,
      toolCallId,
      toolName,
      args,
      riskLevel,
      reason,
      preview
    });

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

    request.decision = decision === 'approve' ? 'approve' : 'deny';
    request.status = decision === 'approve' ? ApprovalStatus.APPROVED : ApprovalStatus.DENIED;
    request.resolvedAt = new Date().toISOString();

    return request;
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

module.exports = PolicyEngine;
