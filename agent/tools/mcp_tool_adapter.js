'use strict';

/**
 * McpToolAdapter - Bridge for Model Context Protocol (MCP) Tools & External Extensions
 * 
 * Supports:
 * - Registering external MCP server tools (stdio / SSE)
 * - Extension-based plugin tools
 * - Dynamic parameter mapping and execution forwarding
 */
class McpToolAdapter {
  constructor(options = {}) {
    this.mcpClient = options.mcpClient || null;
    this.externalTools = new Map();
  }

  registerExternalTool({ name, description, parameters, handler, category = 'mcp' }) {
    if (!name || typeof handler !== 'function') {
      throw new Error('External tool must provide a name and execution handler function');
    }
    const def = {
      name,
      description: description || `External MCP tool: ${name}`,
      parameters: parameters || { type: 'object', properties: {} },
      category,
      isExternal: true,
      handler
    };
    this.externalTools.set(name, def);
    return def;
  }

  unregisterExternalTool(name) {
    return this.externalTools.delete(name);
  }

  getExternalTools() {
    return Array.from(this.externalTools.values());
  }

  async executeExternalTool(name, args, context = {}) {
    const tool = this.externalTools.get(name);
    if (!tool) {
      return { ok: false, error: `External tool '${name}' is not registered` };
    }
    try {
      const res = await tool.handler(args, context);
      return typeof res === 'object' && res !== null ? res : { ok: true, result: res };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }
}

module.exports = McpToolAdapter;
