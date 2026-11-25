const { CapabilitySeam } = require('../seams');
const PathGuard = require('../../agent/path_guard');
const PolicyEngine = require('../../agent/policy_engine');
const ControlledTerminalTool = require('../../agent/tools/terminal_tool');
const { workspaceDir } = require('../../data_paths');

const TERMINAL_SEAM = new CapabilitySeam('terminal', 'Structured workspace process execution', ['executeCommand']);

const TerminalPlugin = {
  name: 'dsh-provider-terminal',
  version: '2.0.0',
  category: 'System',
  description: 'Runs only structured allowlisted commands; state-changing commands require a canonical approved request.',
  apply(ctx) {
    const terminalService = {
      async executeCommand({ command, cwd = null, timeoutMs = 15000, workspacePath = workspaceDir }) {
        const pathGuard = new PathGuard(workspacePath);
        const policyEngine = new PolicyEngine({ allowTerminal: true });
        const tool = new ControlledTerminalTool(pathGuard, { policyEngine });
        return tool.execute({ command, cwd: cwd || '.', timeoutMs });
      }
    };
    TERMINAL_SEAM.validateProvider(terminalService);
    ctx.provide('terminal', terminalService);
  }
};

module.exports = TerminalPlugin;
