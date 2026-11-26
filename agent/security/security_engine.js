'use strict';

const { EventEmitter } = require('node:events');
const path = require('node:path');
const fs = require('node:fs');

/**
 * SecurityEngine - Central Security, Permission, and Audit Engine
 * 
 * References: OpenHands + OpenClaw + OpenCode
 * 
 * Features:
 * - Multi-dimensional permission evaluation: Tool, Resource, Path, Operation, Agent, Task
 * - Support for Allow, Ask, Deny decisions with risk levels (low, medium, high, critical)
 * - Credential and sensitive file protection (.env, id_rsa, keys, secrets)
 * - Dangerous command detection (destructive, package install, git push, network egress, system modification)
 * - Persistent approval cache (session / task scoped)
 * - Structured audit trail with file persistence
 * - Per-agent and per-task custom policy scopes
 */
class SecurityEngine extends EventEmitter {
  constructor(options = {}) {
    super();
    this.workspaceRoot = options.workspaceRoot ? path.resolve(options.workspaceRoot) : process.cwd();
    this.mode = options.mode || 'build'; // 'plan' | 'build'
    this.permissionMode = options.permissionMode || 'ask'; // 'ask' | 'approve for me' | 'turbo'
    this.auditLogDir = options.auditLogDir || path.join(this.workspaceRoot, 'app', 'data', 'audit');
    this.approvalTimeoutMs = options.approvalTimeoutMs || 180000;
    this.approvalPersistencePath = options.approvalPersistencePath || path.join(this.auditLogDir, 'approvals.json');
    this.auditFilePath = options.auditFilePath || path.join(this.auditLogDir, 'security_audit.jsonl');

    // Sensitive path patterns that require explicit approval or are restricted
    this.sensitivePathPatterns = [
      /(^|[/\\])\.env(\.[a-z0-9_-]+)?$/i,
      /(^|[/\\])\.git[/\\]config$/i,
      /(^|[/\\])id_[a-z0-9_]+(\.pub)?$/i,
      /\.(pem|key|pkcs12|pfx|p12|kdbx)$/i,
      /(^|[/\\])(secrets|credentials|service-account|vault)[^/\\]*\.(json|yaml|yml|xml)$/i,
      /(^|[/\\])\.ssh[/\\]/i,
      /(^|[/\\])\.aws[/\\]/i
    ];

    // Dangerous command definitions with risk classifications
    this.dangerousCommands = [
      {
        pattern: /\brm\s+-[rf]{1,2}\s+[\/\\]/i,
        reason: 'Recursive root or system directory deletion',
        risk: 'critical',
        action: 'deny'
      },
      {
        pattern: /\bdel\s+\/[sfq]\s+[a-z]:\\/i,
        reason: 'Drive-wide destructive file deletion',
        risk: 'critical',
        action: 'deny'
      },
      {
        pattern: /\bformat\s+[a-z]:/i,
        reason: 'Drive formatting command',
        risk: 'critical',
        action: 'deny'
      },
      {
        pattern: /\bdiskpart\b/i,
        reason: 'Disk partition manipulation tool',
        risk: 'critical',
        action: 'deny'
      },
      {
        pattern: /\b(shutdown|reboot)\b/i,
        reason: 'Host power management command',
        risk: 'critical',
        action: 'deny'
      },
      {
        pattern: /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,
        reason: 'Fork bomb attack pattern',
        risk: 'critical',
        action: 'deny'
      },
      // High Risk operations requiring explicit user approval
      {
        pattern: /\b(npm|pnpm|yarn|pip|pip3|cargo|gem|composer)\s+(install|add|i)\b/i,
        reason: 'Package manager installation execution (may run arbitrary install scripts)',
        risk: 'high',
        action: 'ask'
      },
      {
        pattern: /\bgit\s+push\b/i,
        reason: 'Remote repository push operation',
        risk: 'high',
        action: 'ask'
      },
      {
        pattern: /\b(curl|wget|Invoke-WebRequest|iwr)\b.*\|\s*(bash|sh|powershell|cmd|node)\b/i,
        reason: 'Remote network script piped directly into execution shell',
        risk: 'critical',
        action: 'deny'
      },
      {
        pattern: /\b(reg|regedit|sc|netsh|bcdedit|vssadmin)\b/i,
        reason: 'System-level registry or service modification',
        risk: 'high',
        action: 'ask'
      }
    ];

    // Default per-tool policies
    this.toolPolicies = {
      read_file: 'allow',
      list_directory: 'allow',
      glob_files: 'allow',
      search_files: 'allow',
      search_content: 'allow',
      file_metadata: 'allow',
      diagnostics: 'allow',
      symbols: 'allow',
      find_definition: 'allow',
      find_references: 'allow',
      format_document: 'allow',
      git_status: 'allow',
      git_diff: 'allow',
      git_log: 'allow',
      git_branch: 'allow',
      git_worktree: 'allow',
      lint_code: 'allow',
      type_check: 'allow',
      navigate_browser: 'allow',
      inspect_dom: 'allow',
      extract_browser_content: 'allow',
      capture_screenshot: 'allow',
      create_browser_session: 'allow',
      close_browser_session: 'allow',
      write_file: 'ask',
      edit_file: 'ask',
      apply_patch: 'ask',
      create_directory: 'ask',
      run_command: 'ask',
      run_powershell: 'ask',
      run_wsl: 'ask',
      run_tests: 'ask',
      run_build: 'ask',
      interact_browser: 'ask',
      execute_browser_task: 'ask',
      delete_file: 'deny',
      ...(options.toolPolicies || {})
    };

    // Agent role overrides
    this.agentRolePolicies = {
      architect: { write_file: 'deny', edit_file: 'deny', apply_patch: 'deny', run_command: 'deny', run_powershell: 'deny' },
      reviewer: { write_file: 'deny', edit_file: 'deny', apply_patch: 'deny', run_command: 'deny' },
      researcher: { write_file: 'deny', edit_file: 'deny', run_command: 'deny' },
      security: { write_file: 'ask', delete_file: 'deny' }
    };

    // In-memory approvals & pending requests
    this.pendingApprovals = new Map();
    this.approvedCache = new Map(); // key: hash -> record

    this._ensureAuditDir();
    this._loadPersistedApprovals();
  }

  _ensureAuditDir() {
    try {
      if (!fs.existsSync(this.auditLogDir)) {
        fs.mkdirSync(this.auditLogDir, { recursive: true });
      }
    } catch (_) {}
  }

  _loadPersistedApprovals() {
    try {
      if (fs.existsSync(this.approvalPersistencePath)) {
        const raw = fs.readFileSync(this.approvalPersistencePath, 'utf8');
        const data = JSON.parse(raw);
        for (const [key, record] of Object.entries(data)) {
          this.approvedCache.set(key, record);
        }
      }
    } catch (_) {}
  }

  _persistApprovals() {
    try {
      this._ensureAuditDir();
      const obj = Object.fromEntries(this.approvedCache.entries());
      fs.writeFileSync(this.approvalPersistencePath, JSON.stringify(obj, null, 2), 'utf8');
    } catch (_) {}
  }

  /**
   * Log security decision to append-only audit trail
   */
  logAudit(record) {
    const entry = {
      id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
      ...record
    };

    try {
      this._ensureAuditDir();
      fs.appendFileSync(this.auditFilePath, JSON.stringify(entry) + '\n', 'utf8');
    } catch (_) {}

    this.emit('security:audit', entry);
    return entry;
  }

  setPermissionMode(mode) {
    const normalized = String(mode || 'ask').toLowerCase().trim().replace(/_/g, ' ');
    if (['ask', 'approve for me', 'turbo'].includes(normalized)) {
      this.permissionMode = normalized;
      this.emit('permission_mode_changed', { permissionMode: this.permissionMode });
      return true;
    }
    return false;
  }

  isSensitivePath(targetPath) {
    if (!targetPath || typeof targetPath !== 'string') return false;
    const normalized = targetPath.replace(/\\/g, '/');
    return this.sensitivePathPatterns.some(pattern => pattern.test(normalized));
  }

  isDangerousCommand(command) {
    if (!command || typeof command !== 'string') return null;
    for (const item of this.dangerousCommands) {
      if (item.pattern.test(command)) {
        return item;
      }
    }
    return null;
  }

  getApprovalKey(toolName, args, agentId = 'default', taskId = 'default') {
    const relevant = {
      tool: toolName,
      path: args.path || args.cwd || null,
      command: args.command ? args.command.trim().slice(0, 100) : null,
      agentId,
      taskId
    };
    return `${toolName}:${relevant.path || ''}:${relevant.command || ''}:${agentId}`;
  }

  /**
   * Evaluate security and permissions across Tool, Resource, Path, Operation, Agent, Task
   */
  async evaluate({ tool, args = {}, agentId = 'default', taskId = 'default', operation = null }) {
    const op = operation || this._inferOperation(tool);
    const targetPath = args.path || args.cwd || null;
    const command = args.command || null;

    // 1. Plan Mode check: Deny all mutations in Plan Mode
    if (this.mode === 'plan') {
      const readOnly = [
        'read_file', 'list_directory', 'glob_files', 'search_files', 'search_content',
        'file_metadata', 'diagnostics', 'symbols', 'find_definition', 'find_references',
        'git_status', 'git_diff', 'git_log', 'git_branch', 'navigate_browser', 'inspect_dom',
        'extract_browser_content', 'capture_screenshot', 'create_browser_session', 'close_browser_session'
      ];
      if (!readOnly.includes(tool)) {
        const decision = {
          allowed: false,
          action: 'deny',
          risk: 'medium',
          reason: `Tool '${tool}' is prohibited in PLAN MODE. Plan mode permits read-only exploration only.`,
          tool,
          agentId,
          taskId
        };
        this.logAudit({ ...decision, status: 'denied_plan_mode' });
        return decision;
      }
    }

    // 2. Sensitive Path & Credential Protection
    if (targetPath && this.isSensitivePath(targetPath)) {
      // Writing or modifying credentials is strictly high-risk
      if (['write', 'edit', 'delete', 'patch'].includes(op)) {
        const decision = {
          allowed: false,
          action: 'ask',
          risk: 'critical',
          reason: `Attempted modification of sensitive credential file: ${targetPath}`,
          tool,
          path: targetPath,
          agentId,
          taskId
        };
        this.logAudit({ ...decision, status: 'credential_modification_intercepted' });
        return this.requestApproval(decision);
      }
      // Reading credentials requires explicit approval
      const decision = {
        allowed: false,
        action: 'ask',
        risk: 'high',
        reason: `Access to credential file '${targetPath}' requires explicit user authorization`,
        tool,
        path: targetPath,
        agentId,
        taskId
      };
      this.logAudit({ ...decision, status: 'credential_access_intercepted' });
      return this.requestApproval(decision);
    }

    // 3. Command Security & Dangerous Command Detection
    if (command) {
      const danger = this.isDangerousCommand(command);
      if (danger) {
        if (danger.action === 'deny') {
          const decision = {
            allowed: false,
            action: 'deny',
            risk: danger.risk,
            reason: `Blocked dangerous command: ${danger.reason}`,
            tool,
            command,
            agentId,
            taskId
          };
          this.logAudit({ ...decision, status: 'dangerous_command_blocked' });
          return decision;
        }

        if (danger.action === 'ask') {
          const decision = {
            allowed: false,
            action: 'ask',
            risk: danger.risk,
            reason: `High-risk operation requires user consent: ${danger.reason}`,
            tool,
            command,
            agentId,
            taskId
          };
          this.logAudit({ ...decision, status: 'high_risk_command_intercepted' });
          return this.requestApproval(decision);
        }
      }
    }

    // 4. Per-Agent Role Overrides
    if (this.agentRolePolicies[agentId] && this.agentRolePolicies[agentId][tool]) {
      const agentPol = this.agentRolePolicies[agentId][tool];
      if (agentPol === 'deny') {
        const decision = {
          allowed: false,
          action: 'deny',
          risk: 'medium',
          reason: `Agent '${agentId}' is not authorized to execute tool '${tool}' by role policy`,
          tool,
          agentId,
          taskId
        };
        this.logAudit({ ...decision, status: 'agent_role_denied' });
        return decision;
      }
      if (agentPol === 'ask') {
        const decision = {
          allowed: false,
          action: 'ask',
          risk: 'medium',
          reason: `Tool '${tool}' requires explicit approval for agent '${agentId}'`,
          tool,
          agentId,
          taskId
        };
        return this.requestApproval(decision);
      }
    }

    // 5. Check persistent approvals cache
    const approvalKey = this.getApprovalKey(tool, args, agentId, taskId);
    if (this.approvedCache.has(approvalKey)) {
      const cached = this.approvedCache.get(approvalKey);
      if (cached.allowed && (!cached.expiresAt || new Date(cached.expiresAt) > new Date())) {
        this.logAudit({
          allowed: true,
          action: 'allow',
          risk: 'low',
          reason: `Approved via persistent cache: ${cached.reason}`,
          tool,
          agentId,
          taskId,
          status: 'cached_approval'
        });
        return { allowed: true, action: 'allow', risk: 'low', cached: true };
      }
    }

    // 6. Sandbox Permission Mode Evaluation (ask | approve for me | turbo)
    if (this.permissionMode === 'turbo') {
      const decision = { allowed: true, action: 'allow', risk: 'low', turbo: true, tool, agentId, taskId };
      this.logAudit({ ...decision, status: 'allowed_turbo_mode' });
      return decision;
    }

    if (this.permissionMode === 'approve for me') {
      const autoApprovedTools = [
        'write_file', 'edit_file', 'apply_patch', 'create_directory',
        'run_tests', 'run_build', 'lint_code', 'type_check',
        'run_command', 'run_powershell'
      ];
      if (autoApprovedTools.includes(tool)) {
        const decision = { allowed: true, action: 'allow', risk: 'low', autoApproved: true, tool, agentId, taskId };
        this.logAudit({ ...decision, status: 'allowed_auto_approved' });
        return decision;
      }
    }

    // 7. Default tool policy evaluation
    const policy = this.toolPolicies[tool] || 'ask';

    if (policy === 'allow') {
      const decision = { allowed: true, action: 'allow', risk: 'low', tool, agentId, taskId };
      this.logAudit({ ...decision, status: 'allowed_by_policy' });
      return decision;
    }

    if (policy === 'deny') {
      const decision = {
        allowed: false,
        action: 'deny',
        risk: 'medium',
        reason: `Tool '${tool}' is disabled by security configuration`,
        tool,
        agentId,
        taskId
      };
      this.logAudit({ ...decision, status: 'denied_by_policy' });
      return decision;
    }

    // policy === 'ask': require explicit user approval
    const decision = {
      allowed: false,
      action: 'ask',
      risk: 'medium',
      reason: `Tool '${tool}' requires human-in-the-loop approval`,
      tool,
      args,
      agentId,
      taskId
    };
    return this.requestApproval(decision);
  }

  async requestApproval(details) {
    const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const approvalKey = this.getApprovalKey(details.tool, details.args || {}, details.agentId, details.taskId);

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this.pendingApprovals.has(requestId)) {
          this.pendingApprovals.delete(requestId);
          const decision = {
            allowed: false,
            action: 'deny',
            reason: `Approval request timed out after ${this.approvalTimeoutMs / 1000}s`,
            timedOut: true,
            requestId
          };
          this.logAudit({ ...details, ...decision, status: 'approval_timeout' });
          resolve(decision);
        }
      }, this.approvalTimeoutMs);

      const requestRecord = {
        requestId,
        approvalKey,
        details,
        createdAt: new Date().toISOString(),
        resolve: (allowed, userNote = '', persist = false) => {
          clearTimeout(timer);
          this.pendingApprovals.delete(requestId);

          if (allowed && persist) {
            this.approvedCache.set(approvalKey, {
              allowed: true,
              reason: userNote || 'Persisted user approval',
              approvedAt: new Date().toISOString(),
              expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString()
            });
            this._persistApprovals();
          }

          const decision = {
            allowed: Boolean(allowed),
            action: allowed ? 'allow' : 'deny',
            reason: userNote || (allowed ? 'Approved by user' : 'Denied by user'),
            requestId
          };

          this.logAudit({ ...details, ...decision, status: allowed ? 'approval_granted' : 'approval_rejected' });
          resolve(decision);
        }
      };

      this.pendingApprovals.set(requestId, requestRecord);
      this.emit('security:approval_requested', { requestId, details });
    });
  }

  resolveApproval(requestId, allowed, userNote = '', persist = false) {
    const record = this.pendingApprovals.get(requestId);
    if (!record) return false;
    record.resolve(allowed, userNote, persist);
    return true;
  }

  listPendingApprovals() {
    return Array.from(this.pendingApprovals.values()).map(r => ({
      requestId: r.requestId,
      details: r.details,
      createdAt: r.createdAt
    }));
  }

  clearPersistentApprovals() {
    this.approvedCache.clear();
    try {
      if (fs.existsSync(this.approvalPersistencePath)) {
        fs.unlinkSync(this.approvalPersistencePath);
      }
    } catch (_) {}
  }

  _inferOperation(tool) {
    if (['read_file', 'list_directory', 'glob_files', 'search_files', 'search_content', 'file_metadata'].includes(tool)) return 'read';
    if (['write_file', 'edit_file', 'apply_patch', 'create_directory'].includes(tool)) return 'write';
    if (['run_command', 'run_powershell', 'run_wsl', 'run_tests', 'run_build'].includes(tool)) return 'execute';
    if (['navigate_browser', 'inspect_dom', 'extract_browser_content'].includes(tool)) return 'network';
    return 'general';
  }
}

module.exports = SecurityEngine;
