'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const { ToolRegistry } = require('../../agent/tool_registry');
const { ToolGateway } = require('../../agent/tool_gateway');
const ManifestValidator = require('../../extensions/manifest_validator');
const McpStdioManager = require('../../services/mcp_stdio_manager');
const { indexSkills, getSkill } = require('../../services/abyx_skills');
const PackageManager = require('../../extensions/package_manager');
const PluginRunner = require('../../extensions/plugin_runner');

function definition(id, execute = async args => args) {
  return { id, version: '1.0.0', description: 'fixture tool', inputSchema: { type: 'object', properties: { value: { type: 'string', maxLength: 20 } }, required: ['value'], additionalProperties: false }, riskCategory: 'read_only', permissions: [], timeoutMs: 500, maxOutputBytes: 1024, provenance: { source: 'abyx-core' }, execute };
}

function tempDir(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }

 test('registry rejects duplicate IDs and unsupported or malformed schemas', () => {
  const registry = new ToolRegistry();
  registry.register(definition('fixture.echo'));
  assert.throws(() => registry.register(definition('fixture.echo')), /already registered/);
  assert.throws(() => registry.register({ ...definition('fixture.bad'), inputSchema: { type: 'object', properties: {}, oneOf: [] } }), /unsupported JSON Schema keyword/);
  assert.throws(() => registry.register({ ...definition('fixture.no-schema-type'), inputSchema: {} }), /input schema must describe an object/);
  assert.throws(() => registry.register({ ...definition('fixture.bad'), riskCategory: 'unknown' }), /invalid risk category/);
  registry.registerBundle({ id: 'fixture-bundle', name: 'Fixture bundle', toolIds: ['fixture.echo'] });
  assert.equal(registry.listBundles()[0].enabled, true);
  registry.setEnabled('fixture.echo', false);
  assert.equal(registry.listBundles()[0].enabled, false);
});

test('gateway denies invalid, unauthorized, unknown, and stale-approved calls', async () => {
  const registry = new ToolRegistry();
  let executions = 0;
  registry.register({ ...definition('external.write', async () => { executions++; return { ok: true }; }), provenance: { source: 'plugin:test' }, permissions: ['filesystem:write'], grantedPermissions: [] });
  registry.register({ ...definition('fixture.counter', async () => { executions++; return { ok: true }; }), riskCategory: 'external' });
  const approvals = new Map();
  const policy = {
    evaluateToolCall: id => id === 'fixture.counter' ? { riskLevel: 'REQUIRES_APPROVAL', reason: 'approval required' } : { riskLevel: 'SAFE', reason: 'read only' },
    matchesApprovedCall: id => approvals.has(id),
    validateApprovedCall: id => approvals.delete(id)
  };
  const gateway = new ToolGateway({ registry, policyEngine: policy });
  assert.equal((await gateway.execute({ toolId: 'missing.tool' })).denied, true);
  assert.equal((await gateway.execute({ toolId: 'external.write', args: { value: 'x' } })).denied, true);
  assert.equal((await gateway.execute({ toolId: 'fixture.counter', args: { value: 'x' } })).requiresApproval, true);
  approvals.set('approval-1', true);
  assert.equal((await gateway.execute({ toolId: 'fixture.counter', args: { value: 'x' }, context: { approvalId: 'approval-1' } })).success, true);
  assert.equal((await gateway.execute({ toolId: 'fixture.echo', args: { value: 'x', extra: true } })).denied, true);
  assert.equal(executions, 1);
});

test('gateway bounds output and propagates cancellation', async () => {
  const registry = new ToolRegistry();
  registry.register({ ...definition('fixture.large', async () => 'x'.repeat(4000)), maxOutputBytes: 256 });
  registry.register({ ...definition('fixture.secret', async () => ({ apiKey: 'very-secret-value' })) });
  registry.register({ ...definition('fixture.wait', async (_args, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))) });
  const gateway = new ToolGateway({ registry, policyEngine: { evaluateToolCall: () => ({ riskLevel: 'SAFE' }) } });
  const large = await gateway.execute({ toolId: 'fixture.large', args: { value: 'a' } });
  assert.equal(large.output.truncated, true);
  assert.equal((await gateway.execute({ toolId: 'fixture.secret', args: { value: 'a' } })).output.apiKey, '[REDACTED_SECRET]');
  const controller = new AbortController();
  const pending = gateway.execute({ toolId: 'fixture.wait', args: { value: 'a' }, signal: controller.signal });
  controller.abort();
  assert.equal((await pending).cancelled, true);
});

test('plugin manifests reject invalid schemas and plugin code never loads in-process', () => {
  assert.throws(() => ManifestValidator.validate({ id: 'bad-plugin', version: '1.0.0', kind: 'plugin', description: 'bad', entryPoint: 'index.js', tools: [{ name: 'run', parameters: { type: 'object', badKeyword: true } }] }), /unsupported JSON Schema keyword/);
  const root = tempDir('abyx-plugin-test-');
  try {
    const runner = new PluginRunner({ getExtension: () => ({ id: 'fixture-plugin', kind: 'plugin', status: 'enabled', installPath: root, entryPoint: 'index.js' }) }, {});
    fs.writeFileSync(path.join(root, 'index.js'), 'process.env.ABYX_PLUGIN_RAN="yes"');
    delete process.env.ABYX_PLUGIN_RAN;
    assert.throws(() => runner.loadPlugin('fixture-plugin'), /isolated extension host/);
    assert.equal(process.env.ABYX_PLUGIN_RAN, undefined);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('MCP stdio validates connection, supports calls and cancellation, and disconnects', async () => {
  assert.equal(require('../../services/mcp_client').qualifiedToolId('test-server', 'Read File'), 'mcp.test-server.526561642046696c65');
  const children = [];
  const manager = new McpStdioManager({ spawnProcess: () => {
    const child = new (require('node:events').EventEmitter)();
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.killed = false; child.exitCode = null;
    child.kill = () => { child.killed = true; child.exitCode = 0; child.emit('exit', 0); };
    child.stdin.on('data', bytes => {
      for (const line of bytes.toString().trim().split('\n')) {
        if (!line) continue;
        const request = JSON.parse(line);
        if (request.id === undefined) continue;
        let result = {};
        if (request.method === 'tools/list') result = { tools: [{ name: 'echo', description: 'echo', inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false } }] };
        if (request.method === 'tools/call') result = { content: [{ type: 'text', text: request.params.arguments.value }] };
        child.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, result })}\n`);
      }
    });
    children.push(child); return child;
  } });
  await assert.rejects(manager.connect('fixture-server', { transport: 'stdio', command: 'node' }), /Explicit approval/);
  const connection = await manager.connect('fixture-server', { transport: 'stdio', command: 'node', executionApproved: true });
  assert.equal(connection.status, 'connected');
  assert.equal((await manager.callTool('fixture-server', 'echo', { value: 'safe' })).content[0].text, 'safe');
  const controller = new AbortController();
  controller.abort(new Error('cancelled'));
  await assert.rejects(manager.callTool('fixture-server', 'echo', { value: 'safe' }, { signal: controller.signal }), /cancelled/);
  await manager.disconnect('fixture-server');
  assert.equal(manager.status('fixture-server').status, 'disconnected');
  assert.equal(children[0].killed, true);
});

test('skill project scope overrides builtins and permissions remain empty', () => {
  const workspace = tempDir('abyx-skills-test-');
  try {
    const skillDir = path.join(workspace, '.abyx', 'skills', 'efficient-coding');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: Project Coding\ndependencies: other-skill\n---\nproject scoped instructions');
    const skills = indexSkills(true, `test-${path.basename(workspace)}`, { workspaceRoot: workspace });
    const skill = skills.find(item => item.id === 'efficient-coding');
    assert.equal(skill.source, 'project');
    assert.deepEqual(skill.permissions, []);
    assert.deepEqual(skill.dependencies, ['other-skill']);
    assert.match(getSkill('efficient-coding', `test-${path.basename(workspace)}`, { workspaceRoot: workspace }).content, /project scoped/);
  } finally { fs.rmSync(workspace, { recursive: true, force: true }); }
});

test('package install requires exact inspected hash and keeps executable extensions disabled', () => {
  const root = tempDir('abyx-package-test-');
  try {
    const source = path.join(root, 'source'); const target = path.join(root, 'store');
    fs.mkdirSync(source); fs.writeFileSync(path.join(source, 'manifest.json'), JSON.stringify({ id: 'fixture-plugin', name: 'Fixture', version: '1.0.0', kind: 'plugin', description: 'fixture plugin', entryPoint: 'index.js', permissions: [] }));
    fs.writeFileSync(path.join(source, 'index.js'), 'module.exports = {}');
    const manager = new PackageManager(null, { extensionsDir: target });
    const inspection = manager.inspectPackage(source);
    assert.throws(() => manager.install(source, { installationApproved: true, grantedPermissions: [] }), /changed after inspection|contents changed/);
    const installed = manager.install(source, { installationApproved: true, grantedPermissions: [], expectedContentHash: inspection.contentHash });
    assert.equal(installed.extension.status, 'disabled');
    assert.equal(installed.extension.trustLevel, 'untrusted-disabled');
    assert.throws(() => manager.enable('fixture-plugin'), /remain disabled/);
    const updateSource = path.join(root, 'source-v2'); fs.mkdirSync(updateSource);
    fs.writeFileSync(path.join(updateSource, 'manifest.json'), JSON.stringify({ id: 'fixture-plugin', name: 'Fixture', version: '2.0.0', kind: 'plugin', description: 'fixture plugin v2', entryPoint: 'index.js', permissions: [] }));
    fs.writeFileSync(path.join(updateSource, 'index.js'), 'module.exports = { version: 2 }');
    const updateInspection = manager.inspectPackage(updateSource);
    assert.throws(() => manager.update('fixture-plugin', updateSource, { grantedPermissions: [], expectedContentHash: updateInspection.contentHash }), /Explicit update approval/);
    const updated = manager.update('fixture-plugin', updateSource, { installationApproved: true, grantedPermissions: [], expectedContentHash: updateInspection.contentHash });
    assert.equal(updated.extension.version, '2.0.0');
    assert.equal(updated.extension.status, 'disabled');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('local API rejects hostile origins and redacts credential-bearing errors', () => {
  const { validateLocalRequest, redactError } = require('../../security/local_server_guard');
  const base = { headers: { host: '127.0.0.1:4317' } };
  assert.equal(validateLocalRequest(base, 4317).ok, true);
  assert.equal(validateLocalRequest({ headers: { host: '127.0.0.1:4317', origin: 'https://attacker.example' } }, 4317).ok, false);
  assert.equal(validateLocalRequest({ headers: { host: '192.168.1.10:4317' } }, 4317).ok, false);
  assert.equal(redactError(new Error('token=very-secret-value')).includes('very-secret-value'), false);
  const ExecutionLogger = require('../../agent/execution_logger');
  assert.deepEqual(ExecutionLogger.scrub({ apiKey: 'secret-key', message: 'Bearer abcdefghijklmnop' }), { apiKey: '[REDACTED_SECRET]', message: '[REDACTED_SECRET]' });
});


test('project skills refuse symlinked instruction files', () => {
  const workspace = tempDir('abyx-skill-link-test-');
  try {
    const skillRoot = path.join(workspace, '.abyx', 'skills', 'linked-skill');
    fs.mkdirSync(skillRoot, { recursive: true });
    const outside = path.join(workspace, 'outside.md'); fs.writeFileSync(outside, 'outside instructions');
    try { fs.symlinkSync(outside, path.join(skillRoot, 'SKILL.md')); }
    catch (error) { if (error.code === 'EPERM' || error.code === 'EACCES') return; throw error; }
    const skills = indexSkills(true, `symlink-${path.basename(workspace)}`, { workspaceRoot: workspace });
    assert.equal(skills.some(skill => skill.id === 'linked-skill'), false);
  } finally { fs.rmSync(workspace, { recursive: true, force: true }); }
});

test('MCP request timeout rejects instead of leaving a pending call', async () => {
  const manager = new McpStdioManager({ requestTimeoutMs: 100 });
  const child = { killed: false, exitCode: null, stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), once() {}, kill() { this.killed = true; } };
  const state = { status: 'connected', child, nextId: 1, pending: new Map() };
  await assert.rejects(manager.request(state, 'slow/method', {}, { timeoutMs: 100 }), /timed out/);
  assert.equal(state.pending.size, 0);
});

