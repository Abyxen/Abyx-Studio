/**
 * DSH Plugin: Workspace Terminal Execution Provider (Stage 3)
 * Provides workspace-constrained command execution with security sandboxing,
 * watchdog timeouts, and audit logging.
 */

const { exec } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const { CapabilitySeam } = require('../seams');

const TERMINAL_SEAM = new CapabilitySeam('terminal', 'Workspace-constrained terminal command execution', ['executeCommand']);

const BLOCKED_COMMAND_PATTERNS = [
  /\bformat\b/i,
  /\bdel\s+.*[cC]:\\windows/i,
  /\brmdir\s+\/s\s+\/q\s+[cC]:\\/i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bdrop\s+database\b/i
];

const PathGuard = require('../../agent/path_guard');
const ControlledTerminalTool = require('../../agent/tools/terminal_tool');
const { workspaceDir } = require('../../data_paths');

const TerminalPlugin = {
  name: 'dsh-provider-terminal',
  version: '2.0.0',
  category: 'System',
  description: 'Workspace-constrained shell command execution with security boundaries, sanitization, and timeout watchdog.',

  apply(ctx) {
    const terminalService = {
      async executeCommand({ command, cwd = null, timeoutMs = 15000, workspacePath = workspaceDir }) {
        if (!command || typeof command !== 'string' || !command.trim()) {
          return { success: false, error: 'Command string is empty or invalid.' };
        }

        const trimmed = command.trim();
        for (const pattern of BLOCKED_COMMAND_PATTERNS) {
          if (pattern.test(trimmed)) {
            return {
              success: false,
              blocked: true,
              error: `Command blocked by safety policy: contains prohibited pattern.`
            };
          }
        }

        const pathGuard = new PathGuard(workspacePath);
        const controlledTerminal = new ControlledTerminalTool(pathGuard);
        return await controlledTerminal.execute({
          command: trimmed,
          cwd: cwd || '.',
          timeoutMs
        });
      }
    };

    TERMINAL_SEAM.validateProvider(terminalService);
    ctx.provide('terminal', terminalService);
  }
};

module.exports = TerminalPlugin;
