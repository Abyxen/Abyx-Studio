/**
 * Tool Registry with JSON-Schema argument validation.
 */

class ToolValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ToolValidationError';
  }
}

class ToolRegistry {
  constructor() {
    this.tools = new Map();
  }

  register(name, description, schema, handler) {
    this.tools.set(name, { name, description, schema, handler });
  }

  async dispatch(name, args = {}) {
    return this.validateAndInvoke(name, args);
  }

  validateAndInvoke(name, args = {}) {
    if (!this.tools.has(name)) {
      throw new ToolValidationError(`Unknown tool: '${name}'`);
    }

    const { schema, handler } = this.tools.get(name);
    const required = schema.required || [];

    for (const req of required) {
      if (!(req in args)) {
        throw new ToolValidationError(`Schema validation failed for tool "${name}": missing required property "${req}"`);
      }
    }

    const properties = schema.properties || {};
    for (const [key, val] of Object.entries(args)) {
      if (key in properties) {
        const expected = properties[key].type;
        if (expected === 'string' && typeof val !== 'string') {
          throw new ToolValidationError(`Argument '${key}' expected string, got ${typeof val}`);
        } else if (expected === 'integer' && !Number.isInteger(val)) {
          throw new ToolValidationError(`Argument '${key}' expected integer, got ${typeof val}`);
        } else if (expected === 'boolean' && typeof val !== 'boolean') {
          throw new ToolValidationError(`Argument '${key}' expected boolean, got ${typeof val}`);
        }
      }
    }

    return handler(args);
  }

  exportSchemas() {
    return Array.from(this.tools.values()).map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.schema
    }));
  }
}

module.exports = { ToolRegistry, ToolValidationError };
