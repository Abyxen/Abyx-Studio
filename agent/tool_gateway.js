'use strict';

const ToolRegistry = require('./tool_registry');
const FsTool = require('./tools/fs_tool');
const TerminalTool = require('./tools/terminal_tool');
const DeveloperTool = require('./tools/developer_tool');
const LspTool = require('./tools/lsp_tool');
const BrowserTool = require('./tools/browser_tool');
const McpToolAdapter = require('./tools/mcp_tool_adapter');

/**
 * ToolGateway - Audited, Typed Tool Execution Gateway
 * 
 * References: OpenCode + Pi + Playwright + Microsoft LSP
 * 
 * Features:
 * - Schema validation before tool dispatch
 * - PolicyEngine permission enforcement (ask, allow, deny, plan mode)
 * - Pre-execution git snapshots on destructive writes
 * - Execution metrics & audit logging via ExecutionLogger
 * - MCP and external tool extension integration
 */
class ToolGateway {
  constructor({ pathGuard, policyEngine, gitAdapter = null, logger = null, securityEngine = null, workspaceIsolation = null, sandboxManager = null, options = {} }) {
    this.pathGuard = pathGuard;
    this.policyEngine = policyEngine;
    this.gitAdapter = gitAdapter;
    this.logger = logger;
    this.securityEngine = securityEngine;
    this.workspaceIsolation = workspaceIsolation;
    this.sandboxManager = sandboxManager;
    this.options = options;

    this.registry = new ToolRegistry();
    this.mcpAdapter = new McpToolAdapter(options);

    // Instantiate core native tool subsystems
    this.fsTool = new FsTool(pathGuard, gitAdapter);
    this.terminalTool = new TerminalTool(pathGuard);
    this.developerTool = new DeveloperTool(gitAdapter, this.terminalTool, pathGuard);
    this.lspTool = new LspTool(pathGuard);
    this.browserTool = new BrowserTool();

    this._registerAllNativeTools();
  }

  _registerAllNativeTools() {
    // ==========================================
    // 1. FILESYSTEM TOOLS (OpenCode reference)
    // ==========================================
    this.registry.register({
      name: 'read_file',
      description: 'Read complete text content of a file within the workspace.',
      category: 'filesystem',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative or absolute file path to read' },
          encoding: { type: 'string', description: 'File encoding (defaults to utf8)' }
        },
        required: ['path']
      },
      handler: (args) => this.fsTool.readFile(args)
    });

    this.registry.register({
      name: 'write_file',
      description: 'Create or overwrite a file with content. Automatically takes a git snapshot before write.',
      category: 'filesystem',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Target file path' },
          content: { type: 'string', description: 'Full text content to write' },
          createDirs: { type: 'boolean', description: 'Create parent directories if missing' }
        },
        required: ['path', 'content']
      },
      handler: (args) => this.fsTool.writeFile(args)
    });

    this.registry.register({
      name: 'edit_file',
      description: 'Replace exact target substring with replacement content in an existing file.',
      category: 'filesystem',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path to edit' },
          target: { type: 'string', description: 'Exact string to be replaced' },
          replacement: { type: 'string', description: 'Replacement string' }
        },
        required: ['path', 'target', 'replacement']
      },
      handler: (args) => this.fsTool.editFile(args)
    });

    this.registry.register({
      name: 'apply_patch',
      description: 'Apply search/replace hunks or unified diff patch to a file with git snapshot protection.',
      category: 'filesystem',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Target file path' },
          patch: { type: 'string', description: 'Patch content (unified diff or search/replace hunks)' }
        },
        required: ['path', 'patch']
      },
      handler: (args) => this.fsTool.applyPatch(args)
    });

    this.registry.register({
      name: 'create_directory',
      description: 'Create a new directory recursively within workspace.',
      category: 'filesystem',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path to create' }
        },
        required: ['path']
      },
      handler: (args) => this.fsTool.createDirectory(args)
    });

    this.registry.register({
      name: 'list_directory',
      description: 'List contents of a directory in the workspace.',
      category: 'filesystem',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path (defaults to root)' },
          recursive: { type: 'boolean', description: 'Whether to list recursively' },
          maxDepth: { type: 'number', description: 'Maximum depth when listing recursively' }
        }
      },
      handler: (args) => this.fsTool.listDirectory(args)
    });

    this.registry.register({
      name: 'glob_files',
      description: 'Find files matching a glob pattern (e.g. "**/*.js", "src/**/*.jsx").',
      category: 'filesystem',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Glob pattern to search for' },
          path: { type: 'string', description: 'Base directory path' }
        },
        required: ['pattern']
      },
      handler: (args) => this.fsTool.globFiles(args)
    });

    this.registry.register({
      name: 'search_files',
      description: 'Search for filename or text query inside workspace files.',
      category: 'filesystem',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search term or substring' },
          path: { type: 'string', description: 'Directory path to search in' },
          maxResults: { type: 'number', description: 'Maximum results to return' }
        },
        required: ['query']
      },
      handler: (args) => this.fsTool.searchFiles(args)
    });

    this.registry.register({
      name: 'search_content',
      description: 'Grep-style text or regex search across workspace files returning line numbers and snippets.',
      category: 'filesystem',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search string or regex' },
          path: { type: 'string', description: 'Directory path to search in' },
          regex: { type: 'boolean', description: 'Whether query is a regular expression' }
        },
        required: ['query']
      },
      handler: (args) => this.fsTool.searchContent(args)
    });

    this.registry.register({
      name: 'file_metadata',
      description: 'Get file statistics: size, creation/modification time, permissions, and file type.',
      category: 'filesystem',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Target file path' }
        },
        required: ['path']
      },
      handler: (args) => this.fsTool.fileMetadata(args)
    });

    // ==========================================
    // 2. TERMINAL TOOLS (Hardened & Audited)
    // ==========================================
    this.registry.register({
      name: 'run_command',
      description: 'Execute shell command in approved workspace directory with command blacklist and timeout.',
      category: 'terminal',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command line to execute' },
          cwd: { type: 'string', description: 'Working directory path' },
          timeout: { type: 'number', description: 'Timeout in milliseconds' }
        },
        required: ['command']
      },
      handler: (args) => this.terminalTool.runCommand(args)
    });

    this.registry.register({
      name: 'run_powershell',
      description: 'Execute command in isolated PowerShell with ExecutionPolicy Bypass.',
      category: 'terminal',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'PowerShell script or command' },
          cwd: { type: 'string', description: 'Working directory path' },
          timeout: { type: 'number', description: 'Timeout in milliseconds' }
        },
        required: ['command']
      },
      handler: (args) => this.terminalTool.runPowerShell(args)
    });

    this.registry.register({
      name: 'run_wsl',
      description: 'Execute command within Windows Subsystem for Linux (WSL) if available.',
      category: 'terminal',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Linux command to execute in WSL' },
          cwd: { type: 'string', description: 'Working directory' },
          timeout: { type: 'number', description: 'Timeout in milliseconds' }
        },
        required: ['command']
      },
      handler: (args) => this.terminalTool.runWsl(args)
    });

    // ==========================================
    // 3. DEVELOPER TOOLS (Git, Tests, Build)
    // ==========================================
    this.registry.register({
      name: 'git_status',
      description: 'Get porcelain Git status and current branch of the repository.',
      category: 'developer',
      parameters: {
        type: 'object',
        properties: {
          cwd: { type: 'string', description: 'Repository directory' }
        }
      },
      handler: (args) => this.developerTool.gitStatus(args)
    });

    this.registry.register({
      name: 'git_diff',
      description: 'Inspect uncommitted git diff in the workspace.',
      category: 'developer',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Target file or directory' },
          cwd: { type: 'string', description: 'Repository directory' }
        }
      },
      handler: (args) => this.developerTool.gitDiff(args)
    });

    this.registry.register({
      name: 'git_log',
      description: 'View recent Git commit history.',
      category: 'developer',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Number of commits to return' },
          cwd: { type: 'string', description: 'Repository directory' }
        }
      },
      handler: (args) => this.developerTool.gitLog(args)
    });

    this.registry.register({
      name: 'git_branch',
      description: 'List repository branches and inspect active branch.',
      category: 'developer',
      parameters: {
        type: 'object',
        properties: {
          cwd: { type: 'string', description: 'Repository directory' }
        }
      },
      handler: (args) => this.developerTool.gitBranch(args)
    });

    this.registry.register({
      name: 'git_worktree',
      description: 'Manage Git worktrees: list, add, or remove isolated working copies.',
      category: 'developer',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['list', 'add', 'remove'], description: 'Worktree action' },
          path: { type: 'string', description: 'Target worktree directory' },
          branch: { type: 'string', description: 'Branch name for action "add"' }
        },
        required: ['action']
      },
      handler: (args) => this.developerTool.gitWorktree(args)
    });

    this.registry.register({
      name: 'run_tests',
      description: 'Execute test suite (npm test / node --test / pytest) with exit-code reporting.',
      category: 'developer',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Custom test command (defaults to npm test)' },
          cwd: { type: 'string', description: 'Working directory' },
          timeout: { type: 'number', description: 'Timeout in milliseconds' }
        }
      },
      handler: (args) => this.developerTool.runTests(args)
    });

    this.registry.register({
      name: 'run_build',
      description: 'Execute build command (npm run build / vite build / tsc) and report exit code.',
      category: 'developer',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Custom build command (defaults to npm run build)' },
          cwd: { type: 'string', description: 'Working directory' },
          timeout: { type: 'number', description: 'Timeout in milliseconds' }
        }
      },
      handler: (args) => this.developerTool.runBuild(args)
    });

    this.registry.register({
      name: 'lint_code',
      description: 'Run code linter (eslint / standard / flake8) to verify syntax & style standards.',
      category: 'developer',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Lint command to execute' },
          cwd: { type: 'string', description: 'Working directory' }
        }
      },
      handler: (args) => this.developerTool.lintCode(args)
    });

    this.registry.register({
      name: 'type_check',
      description: 'Perform static type checking (tsc --noEmit / mypy).',
      category: 'developer',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Typecheck command (defaults to npx tsc --noEmit)' },
          cwd: { type: 'string', description: 'Working directory' }
        }
      },
      handler: (args) => this.developerTool.typeCheck(args)
    });

    // ==========================================
    // 4. LSP & CODE ANALYSIS (Microsoft LSP)
    // ==========================================
    this.registry.register({
      name: 'diagnostics',
      description: 'Perform syntax and diagnostic parse check on a code file or raw content.',
      category: 'lsp',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path to validate' },
          content: { type: 'string', description: 'Optional raw code content' }
        }
      },
      handler: (args) => this.lspTool.diagnostics(args)
    });

    this.registry.register({
      name: 'symbols',
      description: 'Extract classes, functions, and methods from a code file.',
      category: 'lsp',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path to extract symbols from' }
        },
        required: ['path']
      },
      handler: (args) => this.lspTool.symbols(args)
    });

    this.registry.register({
      name: 'find_definition',
      description: 'Locate the declaration site (class/function/variable) of an identifier across the workspace.',
      category: 'lsp',
      parameters: {
        type: 'object',
        properties: {
          identifier: { type: 'string', description: 'Symbol name to find definition for' },
          path: { type: 'string', description: 'Directory to search in' }
        },
        required: ['identifier']
      },
      handler: (args) => this.lspTool.findDefinition(args)
    });

    this.registry.register({
      name: 'find_references',
      description: 'Find all reference occurrences of an identifier across workspace code files.',
      category: 'lsp',
      parameters: {
        type: 'object',
        properties: {
          identifier: { type: 'string', description: 'Symbol or function name to search references for' },
          path: { type: 'string', description: 'Base directory to search in' }
        },
        required: ['identifier']
      },
      handler: (args) => this.lspTool.findReferences(args)
    });

    this.registry.register({
      name: 'format_document',
      description: 'Normalize document formatting: clean trailing whitespace and line endings.',
      category: 'lsp',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path to format' }
        },
        required: ['path']
      },
      handler: (args) => this.lspTool.formatDocument(args)
    });

    // ==========================================
    // 5. BROWSER AUTOMATION (Playwright reference)
    // ==========================================
    this.registry.register({
      name: 'navigate_browser',
      description: 'Fetch web page content and convert to token-efficient markdown.',
      category: 'browser',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'HTTP or HTTPS URL to load' }
        },
        required: ['url']
      },
      handler: (args) => this.browserTool.navigate(args)
    });

    this.registry.register({
      name: 'inspect_dom',
      description: 'Extract text preview matching a CSS selector on a web page.',
      category: 'browser',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Target URL' },
          selector: { type: 'string', description: 'CSS selector (defaults to body)' }
        },
        required: ['url']
      },
      handler: (args) => this.browserTool.inspectDom(args)
    });

    this.registry.register({
      name: 'capture_screenshot',
      description: 'Capture screenshot of a web page using Playwright CLI.',
      category: 'browser',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Target URL' },
          filename: { type: 'string', description: 'Optional screenshot filename' }
        },
        required: ['url']
      },
      handler: (args) => this.browserTool.captureScreenshot(args)
    });

    this.registry.register({
      name: 'create_browser_session',
      description: 'Create an isolated browser session for multi-step web workflows.',
      category: 'browser',
      parameters: {
        type: 'object',
        properties: {
          sessionId: { type: 'string', description: 'Optional custom session ID' },
          startUrl: { type: 'string', description: 'Initial URL to load' }
        }
      },
      handler: (args) => this.browserTool.createSession(args)
    });

    this.registry.register({
      name: 'close_browser_session',
      description: 'Close an active browser session.',
      category: 'browser',
      parameters: {
        type: 'object',
        properties: {
          sessionId: { type: 'string', description: 'ID of session to close' }
        },
        required: ['sessionId']
      },
      handler: (args) => this.browserTool.closeSession(args)
    });

    this.registry.register({
      name: 'extract_browser_content',
      description: 'Extract targeted text or section from web page matching a selector.',
      category: 'browser',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Target URL' },
          selector: { type: 'string', description: 'CSS selector or heading section name' }
        },
        required: ['url']
      },
      handler: (args) => this.browserTool.extractContent(args)
    });

    this.registry.register({
      name: 'interact_browser',
      description: 'Perform web actions such as click, fill, scroll, or evaluate in a browser session.',
      category: 'browser',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', description: 'Action to perform: click, fill, scroll, evaluate' },
          selector: { type: 'string', description: 'Target element CSS selector' },
          value: { type: 'string', description: 'Input value for fill action' },
          url: { type: 'string', description: 'Page URL if not using active session' },
          sessionId: { type: 'string', description: 'Target browser session ID' }
        },
        required: ['action']
      },
      handler: (args) => this.browserTool.interact(args)
    });

    this.registry.register({
      name: 'execute_browser_task',
      description: 'Execute high-level autonomous browser task against a web page.',
      category: 'browser',
      parameters: {
        type: 'object',
        properties: {
          task: { type: 'string', description: 'Description of the browser task to complete' },
          url: { type: 'string', description: 'Starting URL' },
          sessionId: { type: 'string', description: 'Optional session ID' }
        },
        required: ['task', 'url']
      },
      handler: (args) => this.browserTool.executeTask(args)
    });
  }

  registerExternalTool(def) {
    const ext = this.mcpAdapter.registerExternalTool(def);
    this.registry.register({
      name: ext.name,
      description: ext.description,
      parameters: ext.parameters,
      category: ext.category || 'mcp',
      handler: (args) => this.mcpAdapter.executeExternalTool(ext.name, args)
    });
    return ext;
  }

  async execute(toolName, args = {}, context = {}) {
    const startTime = Date.now();
    const tool = this.registry.get(toolName);

    if (!tool) {
      return {
        ok: false,
        error: `Unknown tool: ${toolName}`,
        availableTools: this.registry.list().map(t => t.name)
      };
    }

    if (!this.registry.isEnabled(toolName)) {
      return {
        ok: false,
        error: `Tool '${toolName}' is disabled in current tool profile`
      };
    }

    // 1. Schema Validation
    const validation = this.registry.validateArguments(toolName, args);
    if (!validation.valid) {
      return {
        ok: false,
        validationError: validation.error,
        error: `Schema validation failed: ${validation.error}`
      };
    }

    // 2. Evaluate through SecurityEngine if present (multi-dimensional security & credentials)
    if (this.securityEngine) {
      const secEval = await this.securityEngine.evaluate({
        tool: toolName,
        args,
        agentId: context.agentId || 'default',
        taskId: context.taskId || 'default'
      });
      if (!secEval.allowed) {
        if (this.logger) {
          this.logger.recordEvent({
            type: 'tool:security_denied',
            tool: toolName,
            args,
            reason: secEval.reason,
            risk: secEval.risk,
            context
          });
        }
        return {
          ok: false,
          denied: true,
          risk: secEval.risk,
          error: secEval.reason || `SecurityEngine: Permission denied for tool '${toolName}'`
        };
      }
    } else if (this.policyEngine) {
      // Fallback to basic PolicyEngine evaluation
      const evaluation = await this.policyEngine.evaluate(toolName, args);
      if (!evaluation.allowed) {
        if (this.logger) {
          this.logger.recordEvent({
            type: 'tool:denied',
            tool: toolName,
            args,
            reason: evaluation.reason,
            context
          });
        }
        return {
          ok: false,
          denied: true,
          error: `Permission denied: ${evaluation.reason}`
        };
      }
    }

    // 2b. Write-Conflict Detection via WorkspaceIsolation
    if (this.workspaceIsolation && ['write_file', 'edit_file', 'apply_patch'].includes(toolName) && args.path) {
      const conflict = this.workspaceIsolation.detectWriteConflict(args.path, context.agentId || 'default', context.taskId || 'default');
      if (conflict.conflict) {
        return {
          ok: false,
          conflict: true,
          error: conflict.reason
        };
      }
    }

    // 3. Execution & Timing
    try {
      const result = await tool.handler(args);
      const durationMs = Date.now() - startTime;

      if (this.logger) {
        this.logger.recordEvent({
          type: 'tool:success',
          tool: toolName,
          args,
          result: typeof result === 'object' ? { ok: result.ok } : null,
          durationMs,
          context
        });
      }

      return {
        ...result,
        _meta: { toolName, durationMs }
      };
    } catch (err) {
      const durationMs = Date.now() - startTime;
      if (this.logger) {
        this.logger.recordEvent({
          type: 'tool:error',
          tool: toolName,
          args,
          error: err.message,
          durationMs,
          context
        });
      }
      return {
        ok: false,
        error: err.message,
        _meta: { toolName, durationMs }
      };
    }
  }
}

module.exports = ToolGateway;
