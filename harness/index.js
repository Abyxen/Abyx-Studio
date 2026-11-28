/**
 * AXOM DeepSeek Harness (DSH) Entrypoint & Microkernel Bootstrap
 * Architecture:
 * - Microkernel: Cordis-style composable plugin context
 * - Capability Seams: 3-Role Pattern (Definition, Provider, Consumer)
 * - Providers: Filesystem, Sandbox, Memory, Browser, Subagents, Model
 * - Consumers: ConsumerTools (OpenAI/Ollama tool calling schema generator & dispatcher)
 */

const { HarnessContext } = require('./kernel');
const { CapabilitySeam, SEAMS } = require('./seams');

// Providers
const FilesystemPlugin = require('./plugins/provider_fs');
const SandboxPlugin = require('./plugins/provider_sandbox');
const MemoryPlugin = require('./plugins/provider_memory');
const BrowserPlugin = require('./plugins/provider_browser');
const SubagentsPlugin = require('./plugins/provider_subagents');
const ModelPlugin = require('./plugins/provider_model');
const TerminalPlugin = require('./plugins/provider_terminal');

// Consumers
const ConsumerToolsPlugin = require('./plugins/consumer_tools');

// Agent Seam & Durable Sessions
const { HarnessSessionStore, HarnessAgentLoop } = require('./agent_seam');

// Instantiate root harness context
const harness = new HarnessContext('axom-root');

// Mount foundational capability providers
harness.use(FilesystemPlugin);
harness.use(SandboxPlugin);
harness.use(MemoryPlugin);
harness.use(BrowserPlugin);
harness.use(SubagentsPlugin);
harness.use(ModelPlugin);
harness.use(TerminalPlugin);

// Mount tool-calling consumer
harness.use(ConsumerToolsPlugin);

/**
 * Returns harness system telemetry, active seams, and installed plugins
 */
function getHarnessStatus() {
  const inspection = harness.inspect();
  const seamsList = Object.entries(SEAMS).map(([key, seam]) => ({
    key,
    serviceName: seam.serviceName,
    description: seam.description,
    requiredMethods: seam.requiredMethods,
    isProvided: harness.has(seam.serviceName)
  }));

  return {
    status: 'online',
    architecture: 'DeepSeek Harness (Cordis microkernel)',
    version: '1.2.0',
    contextName: inspection.contextName,
    active: inspection.active,
    servicesCount: inspection.services.length,
    services: inspection.services,
    pluginsCount: inspection.plugins.length,
    plugins: inspection.plugins,
    seams: seamsList
  };
}

const { AbyxAgentHarness } = require('./openhands_orchestrator');
const { AgentState, ActionType } = require('./state');
const { PythonDocRunner } = require('./tools/python_doc_runner');
const { PlaywrightBrowserTool } = require('./tools/playwright_browser');
const { ProcessManager } = require('../services/process_manager');
const { GoalOrchestrator } = require('../agent/goal_orchestrator');
const { MultiSubagentOrchestrator } = require('../agent/subagent_orchestrator');
const { InternetResearchTool } = require('./tools/internet_research');
const { SmartFileEditor } = require('./tools/file_editor');
const { TerminalTool } = require('./tools/terminal');
const { PlannerTool } = require('./tools/planner');
const { PermissionMatrix } = require('./control_flow');
const { CheckpointManager, TrajectoryTracer } = require('./trajectory_state');

module.exports = {
  harness,
  HarnessContext,
  CapabilitySeam,
  SEAMS,
  getHarnessStatus,
  HarnessSessionStore,
  HarnessAgentLoop,
  AbyxAgentHarness,
  AgentState,
  ActionType,
  TerminalTool,
  PlannerTool,
  PermissionMatrix,
  PythonDocRunner,
  PlaywrightBrowserTool,
  ProcessManager,
  GoalOrchestrator,
  MultiSubagentOrchestrator,
  InternetResearchTool,
  SmartFileEditor,
  CheckpointManager,
  TrajectoryTracer
};
