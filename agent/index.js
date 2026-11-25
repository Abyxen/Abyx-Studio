/**
 * ABYX Agentic Engine & Secure Tool Execution Subsystem
 * Phase 5 Master Entrypoint
 */

const PathGuard = require('./path_guard');
const PolicyEngine = require('./policy_engine');
const WorkspaceFsTool = require('./tools/fs_tool');
const ControlledTerminalTool = require('./tools/terminal_tool');
const ControlledBrowserTool = require('./tools/browser_tool');
const LspTool = require('./tools/lsp_tool');
const AgentExecutionEngine = require('./execution_loop');
const AgentOrchestrator = require('./orchestrator');
const TaskScheduler = require('./scheduler');
const { AgentRegistry, SPECIALIZED_AGENTS } = require('./agent_registry');
const AgentMessageBus = require('./message_bus');
const WorkspaceIsolationManager = require('./workspace_isolation');
const TaskVerifier = require('./verifier');
const AgentSharedMemory = require('./shared_memory');
const EventStore = require('./event_store');
const TaskStore = require('./task_store');
const ModelRouter = require('./model_router');
const ExecutionLogger = require('./execution_logger');
const types = require('./types');
const { ToolRegistry } = require('./tool_registry');
const { ToolGateway } = require('./tool_gateway');
const universalFileGenerator = require('../services/universal_file_generator');
const browserService = require('../services/browser_service');
const abyxSkills = require('../services/abyx_skills');
const researchSkills = require('../services/research_skills');
const mcpClient = require('../services/mcp_client');
const RepositoryContext = require('../services/repository_context');
const GitAdapter = require('./git_adapter');

function createToolRegistry({ pathGuard, fsTool, terminalTool, browserTool, lspTool, policyEngine, options = {} }) {
  const registry = new ToolRegistry();
  const lsp = lspTool || new LspTool(pathGuard);
  const objectSchema = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
  const string = (maxLength = 20000) => ({ type: 'string', maxLength });
  const provenance = { source: 'abyx-core', trustLevel: 'builtin' };
  const repositoryContext = new RepositoryContext(pathGuard);
  const git = new GitAdapter(pathGuard);
  const add = (id, description, riskCategory, permissions, schema, execute, config = {}) => registry.register({
    id, version: '1.0.0', description, riskCategory, permissions, inputSchema: schema,
    timeoutMs: config.timeoutMs || 15000,
    maxOutputBytes: config.maxOutputBytes || 64 * 1024,
    provenance, policyName: config.policyName || id, execute
  });

  add('fs_list', 'List entries within the approved workspace.', 'read_only', ['filesystem:read'], objectSchema({ dirPath: string(2048), maxEntries: { type: 'integer', minimum: 1, maximum: 500 } }), (args) => fsTool.list(args));
  add('fs_read', 'Read a file within the approved workspace.', 'read_only', ['filesystem:read'], objectSchema({ filePath: string(2048), maxBytes: { type: 'integer', minimum: 1, maximum: 1000000 } }, ['filePath']), (args) => fsTool.read(args));
  add('fs_search', 'Search file names and content within the approved workspace.', 'read_only', ['filesystem:read'], objectSchema({ query: string(1000), baseDir: string(2048), maxResults: { type: 'integer', minimum: 1, maximum: 100 } }, ['query']), (args) => fsTool.search(args));
  add('fs_write', 'Create or replace a workspace file after conflict review.', 'workspace_write', ['filesystem:write'], objectSchema({ filePath: string(2048), content: string(1000000), expectedHash: string(64) }, ['filePath']), (args) => fsTool.write({ ...args, requireExpectedHash: true }));
  add('fs_edit', 'Replace a text block in a workspace file after conflict review.', 'workspace_write', ['filesystem:write'], objectSchema({ filePath: string(2048), target: string(100000), replacement: string(100000), expectedHash: string(64) }, ['filePath', 'target', 'replacement']), (args) => fsTool.edit({ ...args, requireExpectedHash: true }));
  add('fs_mkdir', 'Create a directory within the approved workspace.', 'workspace_write', ['filesystem:write'], objectSchema({ dirPath: string(2048) }, ['dirPath']), (args) => fsTool.mkdir(args));
  add('fs_move', 'Move a workspace file.', 'destructive', ['filesystem:write'], objectSchema({ sourcePath: string(2048), destinationPath: string(2048) }, ['sourcePath', 'destinationPath']), (args) => fsTool.move(args));
  add('fs_delete', 'Delete a workspace file.', 'destructive', ['filesystem:write'], objectSchema({ filePath: string(2048) }, ['filePath']), (args) => fsTool.delete(args));
  add('lsp_diagnostics', 'Check syntax, parsing, and delimiter diagnostics for a file or code snippet.', 'read_only', ['filesystem:read'], objectSchema({ filePath: string(2048), content: string(1000000) }), (args) => lsp.checkDiagnostics(args));
  add('lsp_symbols', 'Extract functions, classes, and symbol outline from a workspace file.', 'read_only', ['filesystem:read'], objectSchema({ filePath: string(2048), content: string(1000000) }), (args) => lsp.getSymbols(args));
  add('lsp_references', 'Find references and occurrences of a symbol across workspace files.', 'read_only', ['filesystem:read'], objectSchema({ symbol: string(500), searchDir: string(2048) }, ['symbol']), (args) => lsp.findReferences(args));
  add('lsp_validate_diff', 'Verify that a proposed edit or diff does not introduce fatal syntax errors before modifying a file.', 'read_only', ['filesystem:read'], objectSchema({ filePath: string(2048), target: string(100000), replacement: string(100000) }, ['filePath', 'target', 'replacement']), (args) => lsp.validateDiff(args));
  add('generate_file', 'Generate a supported document inside the workspace.', 'workspace_write', ['filesystem:write'], objectSchema({ filePath: string(2048), fileType: string(24), content: string(1000000), title: string(500), author: string(500) }, ['filePath']), args => universalFileGenerator.generateFile(args));
  add('generate_pdf', 'Generate a PDF inside the workspace.', 'workspace_write', ['filesystem:write'], objectSchema({ filePath: string(2048), title: string(500), author: string(500), content: string(1000000) }, ['filePath']), args => universalFileGenerator.generateFile({ ...args, fileType: 'pdf' }));
  add('execute_terminal_command', 'Run a policy-authorized command on the host. Commands are not OS-isolated.', 'host_execution', ['terminal:execute'], objectSchema({ command: string(4096), cwd: string(2048), timeoutMs: { type: 'integer', minimum: 1, maximum: 30000 } }, ['command']), (args, context) => terminalTool.execute({ ...args, signal: context.signal, approvalId: context.approvalId }), { timeoutMs: 30000 });
  add('search_web', 'Search public web sources.', 'network', ['browser:search'], objectSchema({ query: string(2000), maxResults: { type: 'integer', minimum: 1, maximum: 20 } }, ['query']), args => browserTool.searchWeb(args));
  add('inspect_repository', 'Inspect project structure, ecosystem, configuration and tests.', 'read_only', ['filesystem:read'], objectSchema({ baseDir: string(2048) }), args => repositoryContext.inspect(args));
  add('search_repository', 'Find relevant source files and passages in the workspace.', 'read_only', ['filesystem:read'], objectSchema({ query: string(1000), baseDir: string(2048), maxResults: { type: 'integer', minimum: 1, maximum: 100 } }, ['query']), args => repositoryContext.search(args));
  add('git_status', 'Read Git branch and working-tree status.', 'read_only', ['git:read'], objectSchema({ cwd: string(2048) }), (_args, context) => git.status({ cwd: _args.cwd, signal: context.signal }));
  add('git_diff', 'Read unstaged Git changes.', 'read_only', ['git:read'], objectSchema({ cwd: string(2048) }), (_args, context) => git.diff({ cwd: _args.cwd, signal: context.signal }));
  add('git_log', 'Read recent Git history.', 'read_only', ['git:read'], objectSchema({ cwd: string(2048) }), (_args, context) => git.log({ cwd: _args.cwd, signal: context.signal }));
  add('git_branch', 'Read the current Git branch.', 'read_only', ['git:read'], objectSchema({ cwd: string(2048) }), (_args, context) => git.branch({ cwd: _args.cwd, signal: context.signal }));
  add('fetch_web_page', 'Fetch a public web page.', 'network', ['browser:fetch'], objectSchema({ url: string(4096) }, ['url']), (args, context) => browserTool.fetchPage({ ...args, signal: context.signal }), { timeoutMs: 30000 });
  add('open_browser', 'Open a public URL in the user browser.', 'network', ['browser:open'], objectSchema({ url: string(4096) }, ['url']), args => browserService.openBrowserWindow(args.url));
  add('consult_skill', 'Read guidance from an installed instruction-only skill.', 'read_only', ['skills:read'], objectSchema({ skill_name: string(128) }, ['skill_name']), args => abyxSkills.executeSkillConsultation(args.skill_name, options.profileId, { workspaceRoot: pathGuard.defaultRoot }));
  add('system_info', 'Read non-secret machine and runtime information.', 'read_only', ['system:read'], objectSchema({}), () => mcpClient.executeTool('system_info', {}, options.profileId));
  add('search_living_memory', 'Search the current profile memory for matching records.', 'read_only', ['memory:read'], objectSchema({ query: string(2000) }, ['query']), args => mcpClient.executeTool('search_living_memory', args, options.profileId));
  for (const definition of researchSkills.ACADEMIC_TOOLS || []) {
    const fn = definition.function || definition;
    if (!fn.name || !fn.parameters || !['academic_search', 'generate_bibtex', 'build_literature_matrix', 'evaluate_research_gap', 'create_design_brief', 'conduct_paper_review'].includes(fn.name)) continue;
    const riskCategory = ['academic_search'].includes(fn.name) ? 'network' : 'workspace_write';
    add(fn.name, fn.description || `Academic research tool: ${fn.name}`, riskCategory, [riskCategory === 'network' ? 'browser:search' : 'filesystem:write'], fn.parameters, args => researchSkills.executeResearchTool(fn.name, args, pathGuard.defaultRoot), { timeoutMs: 60000 });
  }
  const registeredIds = registry.list().map(tool => tool.id);
  const registerBundle = (id, name, description, predicate) => {
    const toolIds = registeredIds.filter(predicate);
    if (toolIds.length) registry.registerBundle({ id, name, description, toolIds });
  };
  registerBundle('workspace-files', 'Workspace files', 'Read and manage files and documents in the approved workspace.', id => id.startsWith('fs_') || id.startsWith('generate_'));
  registerBundle('code-intelligence', 'Code intelligence & LSP', 'Syntax diagnostics, symbol navigation, and pre-flight diff safety verification.', id => id.startsWith('lsp_'));
  registerBundle('web-research', 'Web research', 'Search and fetch public web sources.', id => ['search_web', 'fetch_web_page', 'open_browser'].includes(id));
  registerBundle('host-terminal', 'Host terminal', 'Run policy-authorized commands on the host account.', id => id === 'execute_terminal_command');
  registerBundle('research-writing', 'Research writing', 'Run academic search and research document tools.', id => ['academic_search', 'generate_bibtex', 'build_literature_matrix', 'evaluate_research_gap', 'create_design_brief', 'conduct_paper_review'].includes(id));
  registerBundle('skills-memory', 'Skills and memory', 'Consult inert skill instructions and profile memory.', id => ['consult_skill', 'search_living_memory', 'system_info'].includes(id));
  return registry;
}

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
    policyEngine,
    defaultTimeoutMs: options.terminalTimeoutMs || 15000,
    maxTimeoutMs: options.terminalMaxTimeoutMs || 30000,
    maxOutputBytes: options.terminalMaxOutputBytes || 50000
  });
  const browserTool = new ControlledBrowserTool({
    defaultTimeoutMs: options.browserTimeoutMs || 8000,
    maxPageBytes: options.browserMaxPageBytes || 50000
  });
  const lspTool = options.lspTool || new LspTool(pathGuard);

  const toolRegistry = options.toolRegistry || createToolRegistry({ pathGuard, fsTool, terminalTool, browserTool, lspTool, policyEngine, options });
  const toolGateway = options.toolGateway || new ToolGateway({ registry: toolRegistry, policyEngine, maxOutputBytes: options.maxToolOutputBytes || 64 * 1024 });

  const engine = new AgentExecutionEngine({
    pathGuard,
    policyEngine,
    fsTool,
    terminalTool,
    browserTool,
    lspTool,
    providerRegistry: options.providerRegistry || null,
    toolRegistry,
    toolGateway
  });

  const orchestrator = new AgentOrchestrator({
    pathGuard,
    policyEngine,
    fsTool,
    terminalTool,
    lspTool,
    browserTool,
    toolRegistry,
    toolGateway,
    aiProviders: options.aiProviders || null
  });

  return {
    engine,
    orchestrator,
    pathGuard,
    policyEngine,
    fsTool,
    terminalTool,
    browserTool,
    lspTool,
    toolRegistry,
    toolGateway,
    logger: ExecutionLogger
  };
}

module.exports = {
  createAgentEngine,
  AgentOrchestrator,
  TaskScheduler,
  AgentRegistry,
  SPECIALIZED_AGENTS,
  AgentMessageBus,
  WorkspaceIsolationManager,
  TaskVerifier,
  AgentSharedMemory,
  EventStore,
  TaskStore,
  ModelRouter,
  PathGuard,
  PolicyEngine,
  WorkspaceFsTool,
  ControlledTerminalTool,
  ControlledBrowserTool,
  LspTool,
  ToolRegistry,
  ToolGateway,
  createToolRegistry,
  AgentExecutionEngine,
  ExecutionLogger,
  types,
  ...types
};
