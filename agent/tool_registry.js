'use strict';

/**
 * ToolRegistry - Typed Tool Catalog, Schema Validator, and Agent Role Scoper
 * 
 * Invariants:
 * - Validates tool parameter schemas against JSON Schema definitions
 * - Filters tools strictly relevant to the active specialized agent
 * - Supports Plan Mode (read-only) vs Build Mode (full execution) filtering
 * - Lazy-loads heavy tool implementations on demand
 */
class ToolRegistry {
  constructor() {
    this.tools = new Map();
    this.enabledStates = new Map();

    // Role-to-tool category scoping matrix
    this.agentRoleScopes = {
      planner: ['filesystem_read', 'git_read', 'lsp', 'browser'],
      developer: ['filesystem', 'terminal', 'developer', 'lsp'],
      tester: ['filesystem', 'terminal', 'developer', 'lsp'],
      debugger: ['filesystem', 'terminal', 'lsp', 'developer'],
      reviewer: ['filesystem_read', 'git_read', 'lsp'],
      researcher: ['filesystem_read', 'browser'],
      architect: ['filesystem_read', 'git_read', 'lsp', 'browser'],
      coder: ['filesystem', 'terminal', 'developer', 'lsp'],
      security: ['filesystem_read', 'terminal', 'lsp', 'audit'],
      test_commander: ['filesystem', 'terminal', 'developer', 'lsp'],
      rag_specialist: ['filesystem_read', 'browser'],
      browser_navigator: ['browser', 'filesystem_read'],
      data_engineer: ['filesystem', 'terminal', 'developer'],
      ui_designer: ['filesystem', 'browser', 'lsp'],
      performance_profiler: ['terminal', 'developer', 'lsp']
    };
  }

  register(definition) {
    if (!definition || !definition.name) {
      throw new Error('Tool definition must contain a name');
    }
    this.tools.set(definition.name, definition);
    if (!this.enabledStates.has(definition.name)) {
      this.enabledStates.set(definition.name, definition.enabled !== false);
    }
  }

  get(name) {
    return this.tools.get(name);
  }

  has(name) {
    return this.tools.has(name);
  }

  setEnabled(name, enabled) {
    if (this.tools.has(name)) {
      this.enabledStates.set(name, Boolean(enabled));
    }
  }

  isEnabled(name) {
    return this.enabledStates.get(name) !== false;
  }

  list() {
    return Array.from(this.tools.values()).map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      category: tool.category || 'general',
      enabled: this.isEnabled(tool.name)
    }));
  }

  listBundles() {
    const categories = new Map();
    for (const tool of this.tools.values()) {
      const cat = tool.category || 'general';
      if (!categories.has(cat)) categories.set(cat, []);
      categories.get(cat).push(tool.name);
    }
    return Array.from(categories.entries()).map(([id, toolNames]) => ({
      id,
      name: `${id.toUpperCase()} Tools`,
      tools: toolNames
    }));
  }

  /**
   * Validates tool input arguments against its JSON schema definition
   */
  validateArguments(toolName, args = {}) {
    const tool = this.get(toolName);
    if (!tool) {
      return { valid: false, error: `Tool '${toolName}' not found in registry` };
    }

    const schema = tool.parameters || { type: 'object', properties: {} };
    const required = Array.isArray(schema.required) ? schema.required : [];

    // Check required fields
    for (const reqKey of required) {
      if (args[reqKey] === undefined || args[reqKey] === null) {
        return {
          valid: false,
          error: `Missing required argument '${reqKey}' for tool '${toolName}'`
        };
      }
    }

    // Basic type validation
    const properties = schema.properties || {};
    for (const [key, value] of Object.entries(args)) {
      const propDef = properties[key];
      if (propDef && propDef.type && value !== undefined && value !== null) {
        if (propDef.type === 'string' && typeof value !== 'string') {
          return { valid: false, error: `Argument '${key}' must be a string` };
        }
        if (propDef.type === 'number' && typeof value !== 'number') {
          return { valid: false, error: `Argument '${key}' must be a number` };
        }
        if (propDef.type === 'boolean' && typeof value !== 'boolean') {
          return { valid: false, error: `Argument '${key}' must be a boolean` };
        }
        if (propDef.type === 'array' && !Array.isArray(value)) {
          return { valid: false, error: `Argument '${key}' must be an array` };
        }
      }
    }

    return { valid: true };
  }

  /**
   * Filters and scopes tools strictly relevant to the active agent persona and mode
   */
  getToolsForAgent(agentId = 'coder', mode = 'build') {
    const allowedCategories = this.agentRoleScopes[agentId] || ['filesystem', 'terminal', 'developer', 'lsp'];

    return Array.from(this.tools.values()).filter(tool => {
      if (!this.isEnabled(tool.name)) return false;

      // Plan Mode restricts all destructive file/terminal tools
      if (mode === 'plan') {
        const planAllowed = [
          'read_file', 'list_directory', 'glob_files', 'search_files', 'search_content',
          'file_metadata', 'diagnostics', 'symbols', 'find_definition', 'find_references',
          'git_status', 'git_diff', 'git_log', 'git_branch', 'navigate_browser', 'inspect_dom',
          'extract_browser_content', 'capture_screenshot', 'create_browser_session', 'close_browser_session'
        ];
        return planAllowed.includes(tool.name);
      }

      // Check agent role category match
      const cat = tool.category || 'general';
      if (allowedCategories.includes(cat)) return true;
      if (allowedCategories.includes('filesystem_read') && ['read_file', 'list_directory', 'glob_files', 'search_files', 'search_content', 'file_metadata'].includes(tool.name)) return true;
      if (allowedCategories.includes('git_read') && ['git_status', 'git_diff', 'git_log', 'git_branch'].includes(tool.name)) return true;

      return false;
    });
  }

  /**
   * Generates standard OpenAI / Ollama compatible function calling schemas
   */
  getFunctionSchemas(agentId = null, mode = 'build') {
    const tools = agentId ? this.getToolsForAgent(agentId, mode) : Array.from(this.tools.values()).filter(t => this.isEnabled(t.name));

    return tools.map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters || { type: 'object', properties: {} }
      }
    }));
  }
}

module.exports = ToolRegistry;
