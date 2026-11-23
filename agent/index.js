/**
 * ABYX Agentic Engine & Secure Tool Execution Subsystem
 * Phase 5 Master Entrypoint
 */

const PathGuard = require('./path_guard');
const PolicyEngine = require('./policy_engine');
const WorkspaceFsTool = require('./tools/fs_tool');
const ControlledTerminalTool = require('./tools/terminal_tool');
const ControlledBrowserTool = require('./tools/browser_tool');
const AgentExecutionEngine = require('./execution_loop');
const ExecutionLogger = require('./execution_logger');
const types = require('./types');

/**
 * Creates and initializes a fully configured Agent Execution Engine
 */
function createAgentEngine(options = {}) {
  const pathGuard = options.pathGuard || new PathGuard(options.approvedRoots);
  const policyEngine = options.policyEngine || new PolicyEngine({
    allowTerminal: options.allowTerminal !== undefined ? options.allowTerminal : false,
    allowBrowser: options.allowBrowser !== undefined ? options.allowBrowser : true,
    approvalTimeoutMs: options.approvalTimeoutMs || 300000
  });

  const fsTool = new WorkspaceFsTool(pathGuard);
  const terminalTool = new ControlledTerminalTool(pathGuard, {
    defaultTimeoutMs: options.terminalTimeoutMs || 15000,
    maxTimeoutMs: options.terminalMaxTimeoutMs || 30000,
    maxOutputBytes: options.terminalMaxOutputBytes || 50000
  });
  const browserTool = new ControlledBrowserTool({
    defaultTimeoutMs: options.browserTimeoutMs || 8000,
    maxPageBytes: options.browserMaxPageBytes || 50000
  });

  const engine = new AgentExecutionEngine({
    pathGuard,
    policyEngine,
    fsTool,
    terminalTool,
    browserTool,
    providerRegistry: options.providerRegistry || null
  });

  return {
    engine,
    pathGuard,
    policyEngine,
    fsTool,
    terminalTool,
    browserTool,
    logger: ExecutionLogger
  };
}

module.exports = {
  createAgentEngine,
  PathGuard,
  PolicyEngine,
  WorkspaceFsTool,
  ControlledTerminalTool,
  ControlledBrowserTool,
  AgentExecutionEngine,
  ExecutionLogger,
  ...types
};
