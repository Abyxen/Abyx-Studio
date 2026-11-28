'use strict';

const TOOL_ID = /^[a-z0-9][a-z0-9._/-]{1,254}$/;
const SEMVER = /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/;
const RISK_CATEGORIES = new Set(['read_only', 'workspace_write', 'destructive', 'host_execution', 'network', 'external', 'general', 'filesystem', 'terminal', 'lsp', 'browser', 'developer', 'mcp']);
const SUPPORTED_SCHEMA_KEYS = new Set(['$schema', 'type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'description', 'title', 'maxLength', 'maxItems', 'minimum', 'maximum']);

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function validateSchemaDefinition(schema, label = 'schema', depth = 0) {
  if (depth > 16 || !schema || typeof schema !== 'object' || Array.isArray(schema)) {
    throw new Error(`${label} must be a JSON Schema object`);
  }
  for (const key of Object.keys(schema)) {
    if (!SUPPORTED_SCHEMA_KEYS.has(key)) {
      throw new Error(`${label} uses unsupported JSON Schema keyword "${key}"`);
    }
  }
  const allowedTypes = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);
  if (!schema.type || !allowedTypes.has(schema.type)) {
    throw new Error(`${label} has an unsupported or missing type`);
  }
  if (schema.type === 'object') {
    const properties = schema.properties || {};
    if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
      throw new Error(`${label}.properties must be an object`);
    }
    for (const [key, value] of Object.entries(properties)) {
      if (!key || key.length > 128) throw new Error(`${label} has an invalid property name`);
      validateSchemaDefinition(value, `${label}.properties.${key}`, depth + 1);
    }
    if (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== 'boolean') {
      validateSchemaDefinition(schema.additionalProperties, `${label}.additionalProperties`, depth + 1);
    }
    if (schema.required && (!Array.isArray(schema.required) || schema.required.some(key => typeof key !== 'string' || !Object.prototype.hasOwnProperty.call(properties, key)))) {
      throw new Error(`${label}.required must refer to declared properties`);
    }
  }
  if (schema.type === 'array' && schema.items) validateSchemaDefinition(schema.items, `${label}.items`, depth + 1);
  if (schema.enum && (!Array.isArray(schema.enum) || schema.enum.length > 256)) throw new Error(`${label}.enum must be a bounded array`);
  if (schema.maxLength !== undefined && (!Number.isInteger(schema.maxLength) || schema.maxLength < 0 || schema.maxLength > 1_000_000)) throw new Error(`${label}.maxLength is invalid`);
  if (schema.maxItems !== undefined && (!Number.isInteger(schema.maxItems) || schema.maxItems < 0 || schema.maxItems > 100_000)) throw new Error(`${label}.maxItems is invalid`);
  for (const bound of ['minimum', 'maximum']) {
    if (schema[bound] !== undefined && (typeof schema[bound] !== 'number' || !Number.isFinite(schema[bound]))) throw new Error(`${label}.${bound} is invalid`);
  }
  if (schema.minimum !== undefined && schema.maximum !== undefined && schema.minimum > schema.maximum) throw new Error(`${label} has an inverted numeric range`);
}

class ToolRegistry {
  constructor() {
    this.tools = new Map();
    this.disabled = new Set();
    this.bundles = new Map();

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
    if (!definition || typeof definition !== 'object') {
      throw new Error('Tool definition must be an object');
    }

    const id = (definition.id || definition.name || '').trim();
    if (!id || !TOOL_ID.test(id)) {
      throw new Error('Tool id must be a stable lowercase identifier');
    }
    if (this.tools.has(id)) {
      throw new Error(`Tool "${id}" is already registered`);
    }

    const version = definition.version || '1.0.0';
    if (!SEMVER.test(version)) {
      throw new Error(`Tool "${id}" must declare a semantic version`);
    }

    const description = definition.description || '';
    if (typeof description !== 'string' || !description.trim() || description.length > 2000) {
      throw new Error(`Tool "${id}" must have a bounded description`);
    }

    const riskCategory = definition.riskCategory || definition.category || 'general';
    if (!RISK_CATEGORIES.has(riskCategory)) {
      throw new Error(`Tool "${id}" has an invalid risk category`);
    }

    const inputSchema = definition.inputSchema || definition.parameters;
    if (inputSchema) {
      if (inputSchema.type !== 'object') {
        throw new Error(`Tool "${id}" input schema must describe an object`);
      }
      validateSchemaDefinition(inputSchema, `${id}.inputSchema`);
    }

    const normalized = {
      ...definition,
      id,
      name: id,
      version,
      description,
      riskCategory,
      category: riskCategory,
      inputSchema: inputSchema ? deepFreeze(structuredClone(inputSchema)) : { type: 'object', properties: {} },
      parameters: inputSchema ? structuredClone(inputSchema) : { type: 'object', properties: {} },
      permissions: Array.isArray(definition.permissions) ? Object.freeze([...definition.permissions]) : Object.freeze([]),
      execute: definition.execute || definition.handler || null,
      handler: definition.handler || definition.execute || null
    };

    this.tools.set(id, normalized);
    if (definition.enabled === false) {
      this.disabled.add(id);
    }
    return normalized;
  }

  get(idOrName) {
    if (!idOrName) return null;
    const tool = this.tools.get(idOrName);
    return tool ? { ...tool, enabled: !this.disabled.has(idOrName) } : null;
  }

  has(idOrName) {
    return this.tools.has(idOrName);
  }

  isEnabled(idOrName) {
    return this.tools.has(idOrName) && !this.disabled.has(idOrName);
  }

  setEnabled(idOrName, enabled) {
    if (!this.tools.has(idOrName)) {
      throw new Error(`Tool "${idOrName}" is not registered`);
    }
    if (enabled) {
      this.disabled.delete(idOrName);
    } else {
      this.disabled.add(idOrName);
    }
    return { id: idOrName, enabled: !this.disabled.has(idOrName) };
  }

  unregister(idOrName) {
    const removed = this.tools.delete(idOrName);
    this.disabled.delete(idOrName);
    return removed;
  }

  registerBundle({ id, name, description = '', toolIds } = {}) {
    if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9_-]{1,63}$/.test(id) || this.bundles.has(id)) {
      throw new Error('Bundle id must be unique and stable');
    }
    if (typeof name !== 'string' || !name.trim() || name.length > 100 || typeof description !== 'string' || description.length > 500) {
      throw new Error(`Bundle "${id}" has invalid metadata`);
    }
    if (!Array.isArray(toolIds) || !toolIds.length || toolIds.length > 256 || new Set(toolIds).size !== toolIds.length || toolIds.some(toolId => !this.tools.has(toolId))) {
      throw new Error(`Bundle "${id}" must reference unique registered tools`);
    }
    const bundle = Object.freeze({ id, name: name.trim(), description, toolIds: Object.freeze([...toolIds]) });
    this.bundles.set(id, bundle);
    return bundle;
  }

  getBundle(id) {
    return this.bundles.get(id) || null;
  }

  listBundles() {
    if (this.bundles.size === 0) {
      const cats = ['filesystem', 'developer', 'browser', 'terminal', 'lsp'];
      for (const cat of cats) {
        const matchingTools = Array.from(this.tools.values())
          .filter(t => (t.category === cat || t.riskCategory === cat))
          .map(t => t.name || t.id);
        if (matchingTools.length > 0) {
          this.bundles.set(cat, {
            id: cat,
            name: `${cat.charAt(0).toUpperCase() + cat.slice(1)} Bundle`,
            description: `Core ${cat} operations bundle`,
            toolIds: matchingTools
          });
        }
      }
    }
    return Array.from(this.bundles.values(), bundle => ({
      ...bundle,
      toolIds: [...bundle.toolIds],
      enabled: bundle.toolIds.every(id => !this.disabled.has(id))
    }));
  }

  list() {
    return Array.from(this.tools.values()).map(tool => ({
      ...tool,
      enabled: !this.disabled.has(tool.id)
    }));
  }

  validateArguments(toolName, args) {
    const tool = this.get(toolName);
    if (!tool) {
      return { valid: false, error: `Tool not found: ${toolName}` };
    }
    const schema = tool.inputSchema || tool.parameters;
    if (!schema || !schema.properties) {
      return { valid: true };
    }
    if (schema.required && Array.isArray(schema.required)) {
      for (const field of schema.required) {
        if (args[field] === undefined || args[field] === null) {
          return { valid: false, error: `Missing required argument '${field}'` };
        }
      }
    }
    for (const [key, prop] of Object.entries(schema.properties)) {
      if (args[key] !== undefined && args[key] !== null) {
        if (prop.type === 'string' && typeof args[key] !== 'string') {
          return { valid: false, error: `Argument '${key}' must be a string` };
        }
        if (prop.type === 'number' && typeof args[key] !== 'number') {
          return { valid: false, error: `Argument '${key}' must be a number` };
        }
        if (prop.type === 'boolean' && typeof args[key] !== 'boolean') {
          return { valid: false, error: `Argument '${key}' must be a boolean` };
        }
      }
    }
    return { valid: true };
  }

  getToolsForAgent(agentId = 'coder', mode = 'build') {
    const allowedCategories = this.agentRoleScopes[agentId] || ['filesystem', 'terminal', 'developer', 'lsp'];

    return Array.from(this.tools.values()).filter(tool => {
      const name = tool.name || tool.id;
      if (!this.isEnabled(name)) return false;

      // Plan Mode restricts all destructive file/terminal tools
      if (mode === 'plan') {
        const planAllowed = [
          'read_file', 'list_directory', 'glob_files', 'search_files', 'search_content',
          'file_metadata', 'diagnostics', 'symbols', 'find_definition', 'find_references',
          'git_status', 'git_diff', 'git_log', 'git_branch', 'navigate_browser', 'inspect_dom',
          'extract_browser_content', 'capture_screenshot', 'create_browser_session', 'close_browser_session'
        ];
        return planAllowed.includes(name);
      }

      const cat = tool.category || tool.riskCategory || 'general';
      if (cat === 'filesystem') {
        if (allowedCategories.includes('filesystem')) return true;
        if (allowedCategories.includes('filesystem_read')) {
          return ['read_file', 'list_directory', 'glob_files', 'search_files', 'search_content', 'file_metadata'].includes(name);
        }
        return false;
      }
      if (cat === 'developer') {
        if (allowedCategories.includes('developer')) return true;
        if (allowedCategories.includes('git_read')) {
          return ['git_status', 'git_diff', 'git_log', 'git_branch'].includes(name);
        }
        return false;
      }
      if (allowedCategories.includes(cat)) return true;
      return false;
    });
  }

  getFunctionSchemas(agentId = null, mode = 'build') {
    const tools = agentId ? this.getToolsForAgent(agentId, mode) : this.list().filter(t => t.enabled);
    return tools.map(tool => ({
      type: 'function',
      function: {
        name: tool.id || tool.name,
        description: tool.description,
        parameters: tool.inputSchema || tool.parameters || { type: 'object', properties: {} }
      }
    }));
  }
}

module.exports = ToolRegistry;
module.exports.ToolRegistry = ToolRegistry;
module.exports.validateSchemaDefinition = validateSchemaDefinition;
module.exports.RISK_CATEGORIES = RISK_CATEGORIES;
