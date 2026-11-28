'use strict';

const { EventEmitter } = require('node:events');
const ToolRegistry = require('./tool_registry');
const FsTool = require('./tools/fs_tool');
const TerminalTool = require('./tools/terminal_tool');
const DeveloperTool = require('./tools/developer_tool');
const LspTool = require('./tools/lsp_tool');
const BrowserTool = require('./tools/browser_tool');
const McpToolAdapter = require('./tools/mcp_tool_adapter');
const PythonDocTool = require('./tools/python_doc_tool');
const PlaywrightBrowserTool = require('./tools/playwright_browser_tool');
const InternetResearchTool = require('./tools/research_tool');
const { ProcessManager } = require('../services/process_manager');
const ExecutionLogger = require('./execution_logger');

const DEFAULT_OUTPUT_LIMIT = 64 * 1024;
const MAX_INPUT_BYTES = 1024 * 1024;
const MAX_SANITIZE_BYTES = 10 * 1024 * 1024;

function validateValue(value, schema, location = 'arguments', depth = 0) {
  if (depth > 32) return `${location} exceeds the validation depth limit`;
  if (!schema || typeof schema !== 'object') return `${location} has no schema`;
  const type = schema.type;
  const validType = type === 'object' ? value !== null && typeof value === 'object' && !Array.isArray(value)
    : type === 'array' ? Array.isArray(value)
    : type === 'integer' ? Number.isInteger(value)
    : type === 'number' ? typeof value === 'number' && Number.isFinite(value)
    : type === 'null' ? value === null
    : type ? typeof value === type : true;
  if (!validType) return `${location} must be ${type}`;
  if (schema.enum && !schema.enum.some(candidate => Object.is(candidate, value) || (candidate && value && typeof candidate === 'object' && typeof value === 'object' && JSON.stringify(candidate) === JSON.stringify(value)))) {
    return `${location} is not an allowed value`;
  }
  if (type === 'object') {
    const properties = schema.properties || {};
    for (const key of schema.required || []) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) return `${location}.${key} is required`;
    }
    for (const [key, child] of Object.entries(value)) {
      if (!Object.prototype.hasOwnProperty.call(properties, key)) {
        if (schema.additionalProperties === false) return `${location}.${key} is not allowed`;
        if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
          const error = validateValue(child, schema.additionalProperties, `${location}.${key}`, depth + 1);
          if (error) return error;
        }
        continue;
      }
      const error = validateValue(child, properties[key], `${location}.${key}`, depth + 1);
      if (error) return error;
    }
  }
  if (type === 'array') {
    if (value.length > (schema.maxItems ?? 1000)) return `${location} exceeds the item limit`;
    if (schema.items) {
      for (let index = 0; index < value.length; index++) {
        const error = validateValue(value[index], schema.items, `${location}[${index}]`, depth + 1);
        if (error) return error;
      }
    }
  }
  if (type === 'string' && schema.maxLength !== undefined && value.length > schema.maxLength) return `${location} exceeds the length limit`;
  if ((type === 'number' || type === 'integer') && schema.minimum !== undefined && value < schema.minimum) return `${location} is below the minimum`;
  if ((type === 'number' || type === 'integer') && schema.maximum !== undefined && value > schema.maximum) return `${location} exceeds the maximum`;
  return null;
}

function boundOutput(result, limit) {
  let serialized;
  try { serialized = JSON.stringify(result); }
  catch { throw new Error('Tool returned a non-serializable result'); }
  if (serialized === undefined) throw new Error('Tool returned an empty result');
  const rawBytes = Buffer.byteLength(serialized);
  if (rawBytes > MAX_SANITIZE_BYTES) return { success: false, truncated: true, error: 'Tool output exceeded the safe serialization limit' };
  let safeResult;
  try { safeResult = ExecutionLogger.scrub(JSON.parse(serialized)); }
  catch { throw new Error('Tool returned invalid JSON data'); }
  serialized = JSON.stringify(safeResult);
  const bytes = Buffer.byteLength(serialized);
  if (bytes <= limit) {
    return safeResult;
  }
  const previewBytes = Math.max(64, limit - 160);
  const preview = Buffer.from(serialized).subarray(0, previewBytes).toString('utf8').replace(/\uFFFD+$/g, '');
  return { success: false, truncated: true, error: `Tool output exceeded ${limit} bytes`, preview };
}

class ToolGateway extends EventEmitter {
  constructor({ pathGuard = null, policyEngine = null, gitAdapter = null, logger = null, securityEngine = null, workspaceIsolation = null, sandboxManager = null, registry = null, maxOutputBytes = DEFAULT_OUTPUT_LIMIT, audit = () => {}, options = {} } = {}) {
    super();
    this.pathGuard = pathGuard;
    this.policyEngine = policyEngine;
    this.gitAdapter = gitAdapter;
    this.logger = logger;
    this.securityEngine = securityEngine;
    this.workspaceIsolation = workspaceIsolation;
    this.sandboxManager = sandboxManager;
    this.maxOutputBytes = maxOutputBytes;
    this.audit = audit;
    this.options = options;

    this.registry = registry || new ToolRegistry();
    this.mcpAdapter = new McpToolAdapter(options);

    if (this.pathGuard) {
      this.fsTool = new FsTool(this.pathGuard, this.gitAdapter);
      this.terminalTool = new TerminalTool(this.pathGuard, { policyEngine: this.policyEngine });
      this.developerTool = new DeveloperTool(this.gitAdapter, this.terminalTool, this.pathGuard);
      this.lspTool = new LspTool(this.pathGuard);
      this.browserTool = new BrowserTool();
      this.pythonDocTool = new PythonDocTool(this.pathGuard?.workspaceRoot || process.cwd());
      this.playwrightBrowserTool = new PlaywrightBrowserTool(this.pathGuard?.workspaceRoot || process.cwd());
      this.researchTool = new InternetResearchTool(this.pathGuard?.workspaceRoot || process.cwd());
      this.processManager = new ProcessManager(this.pathGuard?.workspaceRoot || process.cwd());
      this._registerAllNativeTools();
    }
  }

  _registerAllNativeTools() {
    const reg = (name, desc, cat, params, handler) => {
      if (!this.registry.has(name)) {
        this.registry.register({
          name,
          id: name,
          description: desc,
          riskCategory: cat,
          category: cat,
          parameters: params,
          inputSchema: params,
          handler,
          execute: handler,
          provenance: { source: 'abyx-core', trustLevel: 'builtin' }
        });
      }
    };

    // 1. Filesystem
    reg('read_file', 'Read complete text content of a file.', 'filesystem', { type: 'object', properties: { path: { type: 'string' }, filePath: { type: 'string' } }, required: ['path'] }, args => this.fsTool.readFile(args));
    reg('fs_read', 'Read complete text content of a file.', 'filesystem', { type: 'object', properties: { path: { type: 'string' }, filePath: { type: 'string' } } }, args => this.fsTool.read(args));
    reg('write_file', 'Create or overwrite a file.', 'filesystem', { type: 'object', properties: { path: { type: 'string' }, filePath: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] }, args => this.fsTool.writeFile(args));
    reg('fs_write', 'Create or overwrite a file.', 'filesystem', { type: 'object', properties: { path: { type: 'string' }, filePath: { type: 'string' }, content: { type: 'string' } } }, args => this.fsTool.write(args));
    reg('edit_file', 'Replace target substring in file.', 'filesystem', { type: 'object', properties: { path: { type: 'string' }, filePath: { type: 'string' }, target: { type: 'string' }, replacement: { type: 'string' } }, required: ['path', 'target', 'replacement'] }, args => this.fsTool.editFile(args));
    reg('fs_edit', 'Replace target substring in file.', 'filesystem', { type: 'object', properties: { path: { type: 'string' }, filePath: { type: 'string' }, target: { type: 'string' }, replacement: { type: 'string' } } }, args => this.fsTool.edit(args));
    reg('apply_patch', 'Apply patch hunks to file.', 'filesystem', { type: 'object', properties: { path: { type: 'string' }, patch: { type: 'string' } }, required: ['path', 'patch'] }, args => this.fsTool.applyPatch(args));
    reg('create_directory', 'Create directory.', 'filesystem', { type: 'object', properties: { path: { type: 'string' }, dirPath: { type: 'string' } }, required: ['path'] }, args => this.fsTool.createDirectory(args));
    reg('fs_mkdir', 'Create directory.', 'filesystem', { type: 'object', properties: { path: { type: 'string' }, dirPath: { type: 'string' } } }, args => this.fsTool.mkdir(args));
    reg('list_directory', 'List directory.', 'filesystem', { type: 'object', properties: { path: { type: 'string' }, dirPath: { type: 'string' } }, required: ['path'] }, args => this.fsTool.listDirectory(args));
    reg('fs_list', 'List directory.', 'filesystem', { type: 'object', properties: { path: { type: 'string' }, dirPath: { type: 'string' } } }, args => this.fsTool.list(args));
    reg('glob_files', 'Glob files matching pattern.', 'filesystem', { type: 'object', properties: { pattern: { type: 'string' }, path: { type: 'string' } }, required: ['pattern'] }, args => this.fsTool.globFiles(args));
    reg('search_content', 'Grep search content in files.', 'filesystem', { type: 'object', properties: { query: { type: 'string' }, path: { type: 'string' } }, required: ['query'] }, args => this.fsTool.searchContent(args));
    reg('file_metadata', 'Get file metadata.', 'filesystem', { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }, args => this.fsTool.fileMetadata(args));
    reg('delete_file', 'Delete file.', 'destructive', { type: 'object', properties: { path: { type: 'string' }, filePath: { type: 'string' } }, required: ['path'] }, args => this.fsTool.deleteFile(args));
    reg('fs_delete', 'Delete file.', 'destructive', { type: 'object', properties: { path: { type: 'string' }, filePath: { type: 'string' } } }, args => this.fsTool.delete(args));
    reg('move_file', 'Move file.', 'destructive', { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' }, sourcePath: { type: 'string' }, destinationPath: { type: 'string' } } }, args => this.fsTool.moveFile(args));
    reg('fs_move', 'Move file.', 'destructive', { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' }, sourcePath: { type: 'string' }, destinationPath: { type: 'string' } } }, args => this.fsTool.move(args));
    reg('search_files', 'Search files.', 'filesystem', { type: 'object', properties: { query: { type: 'string' }, baseDir: { type: 'string' } } }, args => this.fsTool.searchFiles(args));
    reg('fs_search', 'Search files.', 'filesystem', { type: 'object', properties: { query: { type: 'string' }, baseDir: { type: 'string' } } }, args => this.fsTool.search(args));

    // 2. Terminal
    reg('run_command', 'Run shell command.', 'terminal', { type: 'object', properties: { command: { type: 'string' }, cwd: { type: 'string' }, timeoutMs: { type: 'number' } }, required: ['command'] }, args => this.terminalTool.runCommand(args));
    reg('execute_terminal_command', 'Run shell command.', 'terminal', { type: 'object', properties: { command: { type: 'string' }, cwd: { type: 'string' } } }, args => this.terminalTool.runCommand(args));
    reg('run_powershell', 'Run PowerShell command.', 'terminal', { type: 'object', properties: { script: { type: 'string' }, command: { type: 'string' } } }, args => this.terminalTool.runPowershell(args));
    reg('run_wsl', 'Run WSL command.', 'terminal', { type: 'object', properties: { command: { type: 'string' } } }, args => this.terminalTool.runWsl(args));

    // 3. Developer Tools
    if (this.developerTool) {
      reg('git_status', 'Get git working tree status.', 'developer', { type: 'object', properties: {} }, args => this.developerTool.gitStatus(args));
      reg('git_branch', 'Get or manage git branches.', 'developer', { type: 'object', properties: { name: { type: 'string' }, action: { type: 'string' } } }, args => this.developerTool.gitBranch(args));
      reg('git_log', 'Get git commit history.', 'developer', { type: 'object', properties: { limit: { type: 'number' } } }, args => this.developerTool.gitLog(args));
      reg('git_diff', 'Get git unstaged or staged diff.', 'developer', { type: 'object', properties: { staged: { type: 'boolean' } } }, args => this.developerTool.gitDiff(args));
      reg('git_worktree', 'Manage git worktrees.', 'developer', { type: 'object', properties: { action: { type: 'string' }, path: { type: 'string' }, branch: { type: 'string' } } }, args => this.developerTool.gitWorktree(args));
      reg('run_tests', 'Execute project test suite.', 'developer', { type: 'object', properties: { runner: { type: 'string' }, pattern: { type: 'string' } } }, args => this.developerTool.runTests(args));
      reg('run_build', 'Execute project build step.', 'developer', { type: 'object', properties: { target: { type: 'string' } } }, args => this.developerTool.runBuild(args));
      reg('lint_code', 'Run linter on project or path.', 'developer', { type: 'object', properties: { path: { type: 'string' } } }, args => this.developerTool.lintCode(args));
      reg('type_check', 'Run type checker on project.', 'developer', { type: 'object', properties: { tsconfigPath: { type: 'string' } } }, args => this.developerTool.typeCheck(args));
    }

    // 4. LSP
    if (this.lspTool) {
      reg('diagnostics', 'Get syntax and semantic diagnostics.', 'lsp', { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } } }, args => this.lspTool.diagnostics(args));
      reg('symbols', 'Extract symbols from document.', 'lsp', { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } } }, args => this.lspTool.symbols(args));
      reg('find_definition', 'Find symbol definition.', 'lsp', { type: 'object', properties: { path: { type: 'string' }, symbol: { type: 'string' } } }, args => this.lspTool.findDefinition(args));
      reg('find_references', 'Find symbol references.', 'lsp', { type: 'object', properties: { path: { type: 'string' }, symbol: { type: 'string' } } }, args => this.lspTool.findReferences(args));
      reg('format_document', 'Format source code document.', 'lsp', { type: 'object', properties: { path: { type: 'string' } } }, args => this.lspTool.formatDocument(args));
    }

    // 5. Browser
    if (this.browserTool) {
      reg('create_browser_session', 'Create browser session.', 'browser', { type: 'object', properties: { sessionId: { type: 'string' }, viewport: { type: 'object' } } }, args => this.browserTool.createSession(args));
      reg('navigate_browser', 'Navigate browser to URL.', 'browser', { type: 'object', properties: { url: { type: 'string' }, sessionId: { type: 'string' } } }, args => this.browserTool.navigate(args));
      reg('inspect_dom', 'Inspect DOM structure of page.', 'browser', { type: 'object', properties: { url: { type: 'string' }, selector: { type: 'string' }, sessionId: { type: 'string' } } }, args => this.browserTool.inspectDom(args));
      reg('extract_browser_content', 'Extract text content from page.', 'browser', { type: 'object', properties: { url: { type: 'string' }, sessionId: { type: 'string' } } }, args => this.browserTool.extractContent(args));
      reg('interact_browser', 'Perform action on page.', 'browser', { type: 'object', properties: { action: { type: 'string' }, selector: { type: 'string' }, value: { type: 'string' }, url: { type: 'string' }, sessionId: { type: 'string' } } }, args => this.browserTool.interact(args));
      reg('execute_browser_task', 'Execute autonomous browser task.', 'browser', { type: 'object', properties: { task: { type: 'string' }, url: { type: 'string' }, sessionId: { type: 'string' } } }, args => this.browserTool.executeTask(args));
      reg('close_browser_session', 'Close browser session.', 'browser', { type: 'object', properties: { sessionId: { type: 'string' } } }, args => this.browserTool.closeSession(args));
    }

    // 6. Advanced Document & Media Suite (PDF, DOCX, XLSX with formulas, PPTX, Images, ZIP)
    if (this.pythonDocTool) {
      reg('advanced_doc_generator', 'Generate binary PDF, DOCX, XLSX with formulas, PPTX, Images, and ZIP archives.', 'developer', {
        type: 'object',
        properties: {
          tool: { type: 'string', enum: ['pdf', 'docx', 'xlsx', 'pptx', 'image', 'zip'] },
          outputPath: { type: 'string' },
          title: { type: 'string' },
          paragraphs: { type: 'array', items: { type: 'string' } },
          sections: { type: 'array', items: { type: 'object' } },
          sheetName: { type: 'string' },
          headers: { type: 'array', items: { type: 'string' } },
          rows: { type: 'array', items: { type: 'array' } },
          formulaCell: { type: 'string' },
          formula: { type: 'string' },
          slides: { type: 'array', items: { type: 'object' } },
          action: { type: 'string', enum: ['create', 'extract', 'verify'] },
          zipPath: { type: 'string' },
          files: { type: 'object' },
          extractTo: { type: 'string' }
        },
        required: ['tool']
      }, args => this.pythonDocTool.execute(args));

      reg('generate_document', 'Generate binary PDF, DOCX, XLSX with formulas, PPTX, Images, and ZIP archives.', 'developer', {
        type: 'object',
        properties: {
          tool: { type: 'string', enum: ['pdf', 'docx', 'xlsx', 'pptx', 'image', 'zip'] },
          outputPath: { type: 'string' }
        },
        required: ['tool']
      }, args => this.pythonDocTool.execute(args));
    }

    // 7. Playwright Headless Browser Automation
    if (this.playwrightBrowserTool) {
      reg('playwright_browser', 'Automate Chromium browser: navigate, click, type, scroll, take screenshot, and inspect live DOM.', 'browser', {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['navigate', 'click', 'type', 'scroll', 'screenshot', 'inspect_dom', 'close'] },
          url: { type: 'string' },
          selector: { type: 'string' },
          text: { type: 'string' },
          outputPath: { type: 'string' },
          direction: { type: 'string', enum: ['up', 'down'] }
        },
        required: ['action']
      }, args => this.playwrightBrowserTool.execute(args));
    }

    // 8. Internet Research & Synthesis
    if (this.researchTool) {
      reg('internet_research', 'Search multi-source web, scrape clean contents, generate citations, and synthesize research findings.', 'browser', {
        type: 'object',
        properties: {
          query: { type: 'string' },
          maxSources: { type: 'number' },
          format: { type: 'string', enum: ['markdown', 'json'] }
        },
        required: ['query']
      }, args => this.researchTool.execute(args));
    }

    // 9. Detached Process Manager (Long-running background tasks & persistence)
    if (this.processManager) {
      reg('process_manager', 'Spawn, inspect, log stream, and cancel long-running detached background processes.', 'terminal', {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['spawn', 'list', 'logs', 'cancel'] },
          taskId: { type: 'string' },
          command: { type: 'string' },
          args: { type: 'array', items: { type: 'string' } },
          tailLines: { type: 'number' }
        },
        required: ['action']
      }, args => {
        const { action, taskId, command, args: cmdArgs, tailLines } = args;
        if (action === 'spawn') {
          return this.processManager.spawnProcess(taskId, command, cmdArgs || []);
        } else if (action === 'list') {
          return { success: true, processes: this.processManager.listProcesses() };
        } else if (action === 'logs') {
          return { success: true, logs: this.processManager.readProcessLogs(taskId, tailLines || 100) };
        } else if (action === 'cancel') {
          return this.processManager.cancelProcess(taskId);
        }
        return { success: false, error: `Unknown action: ${action}` };
      });
    }
  }

  registerExternalTool(def) {
    const ext = this.mcpAdapter.registerExternalTool(def);
    this.registry.register({
      name: ext.name,
      id: ext.name,
      description: ext.description,
      parameters: ext.parameters,
      inputSchema: ext.parameters,
      category: ext.category || 'mcp',
      handler: (args) => this.mcpAdapter.executeExternalTool(ext.name, args),
      execute: (args) => this.mcpAdapter.executeExternalTool(ext.name, args)
    });
    return ext;
  }

  async execute(toolNameOrOpts, args = {}, context = {}) {
    let toolId = toolNameOrOpts;
    let signal = null;
    if (typeof toolNameOrOpts === 'object' && toolNameOrOpts !== null) {
      toolId = toolNameOrOpts.toolId || toolNameOrOpts.toolName || toolNameOrOpts.name;
      args = toolNameOrOpts.args || {};
      signal = toolNameOrOpts.signal || null;
      context = toolNameOrOpts.context || {};
    }

    const auditBase = {
      toolId,
      callId: context.callId || null,
      runId: context.runId || null
    };

    const aliasMap = {
      fs_mkdir: 'create_directory',
      fs_write: 'write_file',
      fs_read: 'read_file',
      fs_edit: 'edit_file',
      fs_list: 'list_directory',
      fs_delete: 'delete_file',
      fs_move: 'move_file',
      fs_search: 'search_files',
      run_terminal: 'run_command',
      execute_terminal_command: 'run_command'
    };

    let resolvedId = toolId;
    if (!this.registry.has(resolvedId) && aliasMap[resolvedId] && this.registry.has(aliasMap[resolvedId])) {
      resolvedId = aliasMap[resolvedId];
    }

    const tool = this.registry.get(resolvedId);
    auditBase.provenance = tool?.provenance || null;

    if (!tool) {
      return this.finish(auditBase, {
        ok: false,
        success: false,
        denied: true,
        error: `Unknown tool "${String(toolId).slice(0, 128)}"`,
        output: { success: false, error: `Unknown tool "${String(toolId).slice(0, 128)}"` }
      });
    }

    if (!tool.enabled) {
      return this.finish(auditBase, {
        ok: false,
        success: false,
        denied: true,
        error: `Tool "${toolId}" is disabled`,
        output: { success: false, error: `Tool "${toolId}" is disabled` }
      });
    }

    const validation = this.registry.validateArguments(resolvedId, args);
    if (!validation.valid) {
      return this.finish(auditBase, {
        ok: false,
        success: false,
        validationError: validation.error,
        error: `Schema validation failed: ${validation.error}`,
        output: { success: false, error: `Schema validation failed: ${validation.error}` }
      });
    }

    const schema = tool.inputSchema || tool.parameters;
    const argsError = validateValue(args, schema);
    if (argsError) {
      return this.finish(auditBase, {
        ok: false,
        success: false,
        denied: true,
        error: argsError,
        output: { success: false, error: argsError }
      });
    }

    if (this.securityEngine) {
      const secEval = await this.securityEngine.evaluate({
        tool: resolvedId,
        args,
        agentId: context.agentId || 'default',
        taskId: context.taskId || 'default'
      });
      if (!secEval.allowed) {
        return this.finish(auditBase, {
          ok: false,
          success: false,
          denied: true,
          risk: secEval.risk,
          error: secEval.reason || `SecurityEngine: Permission denied for tool '${resolvedId}'`,
          output: { success: false, error: secEval.reason || `SecurityEngine: Permission denied for tool '${resolvedId}'` }
        });
      }
    }

    if (this.workspaceIsolation && ['write_file', 'edit_file', 'apply_patch', 'fs_write', 'fs_edit'].includes(resolvedId) && (args.path || args.filePath)) {
      const conflict = this.workspaceIsolation.detectWriteConflict(args.path || args.filePath, context.agentId || 'default', context.taskId || 'default');
      if (conflict && conflict.conflict) {
        return this.finish(auditBase, {
          ok: false,
          success: false,
          conflict: true,
          error: conflict.reason,
          output: { success: false, conflict: true, error: conflict.reason }
        });
      }
    }

    if (tool.provenance?.source !== 'abyx-core') {
      const granted = new Set(Array.isArray(tool.grantedPermissions) ? tool.grantedPermissions : []);
      const missing = (tool.permissions || []).filter(p => !granted.has(p));
      if (missing.length) {
        return this.finish(auditBase, {
          ok: false,
          success: false,
          denied: true,
          error: `Required capability permissions have not been granted: ${missing.join(', ')}`,
          output: { success: false, error: `Required capability permissions have not been granted: ${missing.join(', ')}` }
        });
      }
    }

    if (this.policyEngine) {
      const riskContext = { ...(context.policyContext || {}) };
      const policy = typeof this.policyEngine.evaluateToolCall === 'function'
        ? this.policyEngine.evaluateToolCall(tool.policyName || tool.id, args, riskContext)
        : null;

      if (policy && policy.riskLevel === 'DENIED') {
        return this.finish(auditBase, {
          ok: false,
          success: false,
          denied: true,
          blocked: true,
          error: policy.reason,
          output: { success: false, blocked: true, error: policy.reason }
        });
      }

      if (policy && policy.riskLevel === 'REQUIRES_APPROVAL') {
        const approvalId = context.approvalId;
        if (!approvalId || (typeof this.policyEngine.matchesApprovedCall === 'function' && !this.policyEngine.matchesApprovedCall(approvalId, tool.policyName || tool.id, args))) {
          return this.finish(auditBase, {
            ok: false,
            success: false,
            denied: true,
            requiresApproval: true,
            error: 'An exact, current approval is required',
            output: { success: false, requiresApproval: true, error: 'An exact, current approval is required' }
          });
        }
        if (tool.policyName !== 'execute_terminal_command' && typeof this.policyEngine.validateApprovedCall === 'function' && !this.policyEngine.validateApprovedCall(approvalId, tool.policyName || tool.id, args)) {
          return this.finish(auditBase, {
            ok: false,
            success: false,
            denied: true,
            requiresApproval: true,
            error: 'Approval was already consumed or expired',
            output: { success: false, requiresApproval: true, error: 'Approval was already consumed or expired' }
          });
        }
      }
    }

    if (signal?.aborted) {
      return this.finish(auditBase, {
        ok: false,
        success: false,
        cancelled: true,
        error: 'Tool call was cancelled before execution',
        output: { success: false, error: 'Tool call was cancelled before execution' }
      });
    }

    const timeoutMs = tool.timeoutMs || 30000;
    const timeout = AbortSignal.timeout(timeoutMs);
    const toolSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const startedAt = Date.now();
    const executor = tool.execute || tool.handler;

    let abortListener;
    try {
      const result = await Promise.race([
        Promise.resolve().then(() => executor(args, { ...context, signal: toolSignal, tool })),
        new Promise((_, reject) => {
          abortListener = () => reject(toolSignal.reason || new Error('Tool call aborted'));
          toolSignal.addEventListener('abort', abortListener, { once: true });
        })
      ]);

      const bounded = boundOutput(result, Math.min(tool.maxOutputBytes || this.maxOutputBytes, this.maxOutputBytes));
      const durationMs = Date.now() - startedAt;

      return this.finish({ ...auditBase, durationMs }, {
        ok: true,
        success: true,
        output: bounded,
        durationMs,
        ...(typeof result === 'object' ? result : {})
      });
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      return this.finish({ ...auditBase, durationMs }, {
        ok: false,
        success: false,
        cancelled: Boolean(signal?.aborted),
        timedOut: Boolean(timeout.aborted && !signal?.aborted),
        durationMs,
        error: signal?.aborted ? 'Tool call was cancelled' : timeout.aborted ? 'Tool call timed out' : String(ExecutionLogger.scrub(error?.message || 'Tool execution failed')).slice(0, 500),
        output: { success: false, error: error.message }
      });
    } finally {
      if (abortListener) {
        toolSignal.removeEventListener('abort', abortListener);
      }
    }
  }

  finish(event, result) {
    const auditEvent = ExecutionLogger.scrub({
      ...event,
      success: result.success,
      denied: Boolean(result.denied),
      error: result.error || null,
      timestamp: new Date().toISOString()
    });
    this.emit('audit', auditEvent);
    try { this.audit(auditEvent); } catch (_) {}
    return result;
  }

  reject({ toolId, context = {}, error = 'Tool request rejected' } = {}) {
    const tool = this.registry.get(toolId);
    return this.finish({
      toolId,
      callId: context.callId || null,
      runId: context.runId || null,
      provenance: tool?.provenance || null
    }, {
      ok: false,
      success: false,
      denied: true,
      error: String(error).slice(0, 500),
      output: { success: false, error: String(error).slice(0, 500) }
    });
  }
}

module.exports = ToolGateway;
module.exports.ToolGateway = ToolGateway;
module.exports.validateValue = validateValue;
module.exports.boundOutput = boundOutput;
