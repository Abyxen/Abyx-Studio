'use strict';

const TOOL_ID = /^[a-z0-9][a-z0-9._/-]{1,254}$/;
const SEMVER = /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/;
const RISK_CATEGORIES = new Set(['read_only', 'workspace_write', 'destructive', 'host_execution', 'network', 'external']);
const SUPPORTED_SCHEMA_KEYS = new Set(['$schema', 'type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'description', 'title', 'maxLength', 'maxItems', 'minimum', 'maximum']);

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function validateSchemaDefinition(schema, label = 'schema', depth = 0) {
  if (depth > 16 || !schema || typeof schema !== 'object' || Array.isArray(schema)) throw new Error(`${label} must be a JSON Schema object`);
  for (const key of Object.keys(schema)) if (!SUPPORTED_SCHEMA_KEYS.has(key)) throw new Error(`${label} uses unsupported JSON Schema keyword "${key}"`);
  const allowedTypes = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);
  if (!schema.type || !allowedTypes.has(schema.type)) throw new Error(`${label} has an unsupported or missing type`);
  if (schema.type === 'object') {
    const properties = schema.properties || {};
    if (!properties || typeof properties !== 'object' || Array.isArray(properties)) throw new Error(`${label}.properties must be an object`);
    for (const [key, value] of Object.entries(properties)) {
      if (!key || key.length > 128) throw new Error(`${label} has an invalid property name`);
      validateSchemaDefinition(value, `${label}.properties.${key}`, depth + 1);
    }
    if (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== 'boolean') validateSchemaDefinition(schema.additionalProperties, `${label}.additionalProperties`, depth + 1);
    if (schema.required && (!Array.isArray(schema.required) || schema.required.some(key => typeof key !== 'string' || !Object.prototype.hasOwnProperty.call(properties, key)))) {
      throw new Error(`${label}.required must refer to declared properties`);
    }
  }
  if (schema.type === 'array' && schema.items) validateSchemaDefinition(schema.items, `${label}.items`, depth + 1);
  if (schema.enum && (!Array.isArray(schema.enum) || schema.enum.length > 256)) throw new Error(`${label}.enum must be a bounded array`);
  if (schema.maxLength !== undefined && (!Number.isInteger(schema.maxLength) || schema.maxLength < 0 || schema.maxLength > 1_000_000)) throw new Error(`${label}.maxLength is invalid`);
  if (schema.maxItems !== undefined && (!Number.isInteger(schema.maxItems) || schema.maxItems < 0 || schema.maxItems > 100_000)) throw new Error(`${label}.maxItems is invalid`);
  for (const bound of ['minimum', 'maximum']) if (schema[bound] !== undefined && (typeof schema[bound] !== 'number' || !Number.isFinite(schema[bound]))) throw new Error(`${label}.${bound} is invalid`);
  if (schema.minimum !== undefined && schema.maximum !== undefined && schema.minimum > schema.maximum) throw new Error(`${label} has an inverted numeric range`);
}

class ToolRegistry {
  constructor() { this.tools = new Map(); this.disabled = new Set(); this.bundles = new Map(); }

  register(definition) {
    if (!definition || typeof definition !== 'object') throw new Error('Tool definition must be an object');
    const { id, version, inputSchema, execute } = definition;
    if (typeof id !== 'string' || !TOOL_ID.test(id)) throw new Error('Tool id must be a stable lowercase identifier');
    if (this.tools.has(id)) throw new Error(`Tool "${id}" is already registered`);
    if (typeof version !== 'string' || !SEMVER.test(version)) throw new Error(`Tool "${id}" must declare a semantic version`);
    if (typeof definition.description !== 'string' || !definition.description.trim() || definition.description.length > 2000) throw new Error(`Tool "${id}" must have a bounded description`);
    if (!RISK_CATEGORIES.has(definition.riskCategory)) throw new Error(`Tool "${id}" has an invalid risk category`);
    if (!Array.isArray(definition.permissions) || definition.permissions.some(permission => typeof permission !== 'string' || !/^[a-z][a-z0-9:_-]{1,80}$/.test(permission))) throw new Error(`Tool "${id}" must declare valid permissions`);
    if (definition.grantedPermissions !== undefined && (!Array.isArray(definition.grantedPermissions) || definition.grantedPermissions.some(permission => typeof permission !== 'string' || !/^[a-z][a-z0-9:_-]{1,80}$/.test(permission)))) throw new Error(`Tool "${id}" has invalid granted permissions`);
    if (!Number.isInteger(definition.timeoutMs) || definition.timeoutMs < 1 || definition.timeoutMs > 600_000) throw new Error(`Tool "${id}" has an invalid timeout`);
    if (!Number.isInteger(definition.maxOutputBytes) || definition.maxOutputBytes < 128 || definition.maxOutputBytes > 10_000_000) throw new Error(`Tool "${id}" has an invalid output limit`);
    if (!definition.provenance || typeof definition.provenance.source !== 'string' || !definition.provenance.source.trim()) throw new Error(`Tool "${id}" must declare provenance`);
    if (typeof execute !== 'function') throw new Error(`Tool "${id}" must provide an executor`);
    if (inputSchema?.type !== 'object') throw new Error(`Tool "${id}" input schema must describe an object`);
    validateSchemaDefinition(inputSchema, `${id}.inputSchema`);
    if (definition.outputSchema) validateSchemaDefinition(definition.outputSchema, `${id}.outputSchema`);
    const normalized = Object.freeze({
      ...definition,
      inputSchema: deepFreeze(structuredClone(inputSchema)),
      outputSchema: definition.outputSchema ? deepFreeze(structuredClone(definition.outputSchema)) : null,
      permissions: Object.freeze([...definition.permissions]),
      grantedPermissions: definition.grantedPermissions ? Object.freeze([...definition.grantedPermissions]) : Object.freeze([]),
      provenance: deepFreeze(structuredClone(definition.provenance))
    });
    this.tools.set(id, normalized);
    if (definition.enabled === false) this.disabled.add(id);
    return normalized;
  }

  get(id) {
    const tool = this.tools.get(id);
    return tool ? { ...tool, enabled: !this.disabled.has(id) } : null;
  }
  setEnabled(id, enabled) {
    if (!this.tools.has(id)) throw new Error(`Tool "${id}" is not registered`);
    if (enabled) this.disabled.delete(id);
    else this.disabled.add(id);
    return { id, enabled: !this.disabled.has(id) };
  }
  unregister(id) {
    const removed = this.tools.delete(id);
    this.disabled.delete(id);
    return removed;
  }
  registerBundle({ id, name, description = '', toolIds } = {}) {
    if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9_-]{1,63}$/.test(id) || this.bundles.has(id)) throw new Error('Bundle id must be unique and stable');
    if (typeof name !== 'string' || !name.trim() || name.length > 100 || typeof description !== 'string' || description.length > 500) throw new Error(`Bundle "${id}" has invalid metadata`);
    if (!Array.isArray(toolIds) || !toolIds.length || toolIds.length > 256 || new Set(toolIds).size !== toolIds.length || toolIds.some(toolId => !this.tools.has(toolId))) throw new Error(`Bundle "${id}" must reference unique registered tools`);
    const bundle = Object.freeze({ id, name: name.trim(), description, toolIds: Object.freeze([...toolIds]) });
    this.bundles.set(id, bundle);
    return bundle;
  }
  getBundle(id) { return this.bundles.get(id) || null; }
  listBundles() {
    return Array.from(this.bundles.values(), bundle => ({ ...bundle, toolIds: [...bundle.toolIds], enabled: bundle.toolIds.every(id => !this.disabled.has(id)) }));
  }
  list() {
    return Array.from(this.tools, ([id, definition]) => {
      const { execute, ...tool } = definition;
      return { ...tool, enabled: !this.disabled.has(id), inputSchema: structuredClone(tool.inputSchema) };
    });
  }
}

module.exports = { ToolRegistry, validateSchemaDefinition, RISK_CATEGORIES };
