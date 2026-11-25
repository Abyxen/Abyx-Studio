'use strict';

const { EventEmitter } = require('node:events');
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
  if (schema.enum && !schema.enum.some(candidate => Object.is(candidate, value) || (candidate && value && typeof candidate === 'object' && typeof value === 'object' && JSON.stringify(candidate) === JSON.stringify(value)))) return `${location} is not an allowed value`;
  if (type === 'object') {
    const properties = schema.properties || {};
    for (const key of schema.required || []) if (!Object.prototype.hasOwnProperty.call(value, key)) return `${location}.${key} is required`;
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
    if (schema.items) for (let index = 0; index < value.length; index++) {
      const error = validateValue(value[index], schema.items, `${location}[${index}]`, depth + 1);
      if (error) return error;
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
  constructor({ registry, policyEngine, maxOutputBytes = DEFAULT_OUTPUT_LIMIT, audit = () => {} } = {}) {
    super();
    if (!registry || typeof registry.get !== 'function') throw new Error('ToolGateway requires a ToolRegistry');
    if (!policyEngine || typeof policyEngine.evaluateToolCall !== 'function') throw new Error('ToolGateway requires a policy engine');
    this.registry = registry;
    this.policyEngine = policyEngine;
    this.maxOutputBytes = maxOutputBytes;
    this.audit = audit;
  }

  async execute({ toolId, args = {}, signal, context = {} } = {}) {
    const tool = this.registry.get(toolId);
    const auditBase = { toolId, callId: context.callId || null, runId: context.runId || null, provenance: tool?.provenance || null };
    if (!tool) return this.finish(auditBase, { success: false, denied: true, error: `Unknown tool "${String(toolId).slice(0, 128)}"` });
    if (!tool.enabled) return this.finish(auditBase, { success: false, denied: true, error: `Tool "${toolId}" is disabled` });
    const argsError = validateValue(args, tool.inputSchema);
    if (argsError) return this.finish(auditBase, { success: false, denied: true, error: argsError });
    if (!args || typeof args !== 'object' || Array.isArray(args)) return this.finish(auditBase, { success: false, denied: true, error: 'Tool arguments must be an object' });
    let inputBytes;
    try { inputBytes = Buffer.byteLength(JSON.stringify(args)); }
    catch { return this.finish(auditBase, { success: false, denied: true, error: 'Tool arguments must be JSON serializable' }); }
    if (inputBytes > MAX_INPUT_BYTES) return this.finish(auditBase, { success: false, denied: true, error: 'Tool arguments exceed the 1 MB limit' });
    if (tool.provenance?.source !== 'abyx-core') {
      const granted = new Set(Array.isArray(tool.grantedPermissions) ? tool.grantedPermissions : []);
      const missing = tool.permissions.filter(permission => !granted.has(permission));
      if (missing.length) return this.finish(auditBase, { success: false, denied: true, error: `Required capability permissions have not been granted: ${missing.join(', ')}` });
    }

    const riskContext = { ...(context.policyContext || {}) };
    const policy = this.policyEngine.evaluateToolCall(tool.policyName || tool.id, args, riskContext);
    if (policy.riskLevel === 'DENIED') return this.finish(auditBase, { success: false, denied: true, error: policy.reason });
    if (policy.riskLevel === 'REQUIRES_APPROVAL') {
      const approvalId = context.approvalId;
      if (!approvalId || !this.policyEngine.matchesApprovedCall(approvalId, tool.policyName || tool.id, args)) {
        return this.finish(auditBase, { success: false, denied: true, requiresApproval: true, error: 'An exact, current approval is required' });
      }
      if (tool.policyName !== 'execute_terminal_command' && !this.policyEngine.validateApprovedCall(approvalId, tool.policyName || tool.id, args)) {
        return this.finish(auditBase, { success: false, denied: true, requiresApproval: true, error: 'Approval was already consumed or expired' });
      }
    }
    if (signal?.aborted) return this.finish(auditBase, { success: false, cancelled: true, error: 'Tool call was cancelled before execution' });

    const timeout = AbortSignal.timeout(tool.timeoutMs);
    const toolSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const startedAt = Date.now();
    const execution = Promise.resolve().then(() => tool.execute(args, { ...context, signal: toolSignal, tool }));
    let abortListener;
    try {
      const result = await Promise.race([
        execution,
        new Promise((_, reject) => {
          abortListener = () => reject(toolSignal.reason || new Error('Tool call aborted'));
          toolSignal.addEventListener('abort', abortListener, { once: true });
        })
      ]);
      if (tool.outputSchema) {
        const outputError = validateValue(result, tool.outputSchema, 'output');
        if (outputError) throw new Error(`Tool returned invalid output: ${outputError}`);
      }
      return this.finish({ ...auditBase, durationMs: Date.now() - startedAt }, { success: true, output: boundOutput(result, Math.min(tool.maxOutputBytes, this.maxOutputBytes)), durationMs: Date.now() - startedAt });
    } catch (error) {
      return this.finish({ ...auditBase, durationMs: Date.now() - startedAt }, {
        success: false,
        cancelled: Boolean(signal?.aborted),
        timedOut: Boolean(timeout.aborted && !signal?.aborted),
        error: signal?.aborted ? 'Tool call was cancelled' : timeout.aborted ? 'Tool call timed out' : String(ExecutionLogger.scrub(error?.message || 'Tool execution failed')).slice(0, 500)
      });
    } finally {
      if (abortListener) toolSignal.removeEventListener('abort', abortListener);
    }
  }

  finish(event, result) {
    const auditEvent = ExecutionLogger.scrub({ ...event, success: result.success, denied: Boolean(result.denied), error: result.error || null, timestamp: new Date().toISOString() });
    this.emit('audit', auditEvent);
    try { this.audit(auditEvent); } catch {}
    return result;
  }

  reject({ toolId, context = {}, error = 'Tool request rejected' } = {}) {
    const tool = this.registry.get(toolId);
    return this.finish({ toolId, callId: context.callId || null, runId: context.runId || null, provenance: tool?.provenance || null }, {
      success: false,
      denied: true,
      error: String(error).slice(0, 500)
    });
  }
}

module.exports = { ToolGateway, validateValue, boundOutput };
