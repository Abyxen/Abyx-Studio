/**
 * AXOM Model Context Protocol (MCP) Client & Autonomous Tool Registry
 * Connects AXOM to local system capabilities, Python calculation engine,
 * living memory, and standard MCP protocol servers.
 */

const os = require('os');
const fs = require('fs');
const path = require('path');
const { runSilentProcess } = require('./silent_process');
const McpStdioManager = require('./mcp_stdio_manager');
const { validateSchemaDefinition } = require('../agent/tool_registry');
const credentialStore = require('../security/credential_store');

let db = null;
let obsidianVault = null;
try { db = require('../db'); } catch (e) {}
try { obsidianVault = require('./obsidian_vault'); } catch (e) {}

const CONFIG_PATH = path.join(__dirname, '..', 'mcp_config.json');
const transportManager = new McpStdioManager();
const transportBindings = new Map();
process.once('exit', () => transportManager.terminateAll());

function transportKey(profileId, serverId) {
  return `${String(profileId || 'prof_default').replace(/[^a-zA-Z0-9_-]/g, '_')}_${serverId}`;
}

function qualifiedToolId(serverId, toolName) {
  return `mcp.${serverId}.${Buffer.from(toolName, 'utf8').toString('hex')}`;
}

// Default MCP Configuration
function defaultConfig() {
  return {
    version: '1.0',
    mcpServers: { local_tools: { enabled: true, description: 'Native high-performance local tools for ABYX' } }
  };
}

function loadConfig(profileId = 'prof_default') {
  if (profileId && db?.getProfileSetting) {
    const saved = db.getProfileSetting(profileId, 'mcp_config', null);
    if (saved && typeof saved === 'object') return saved;
  }
  if (profileId === 'prof_default' && fs.existsSync(CONFIG_PATH)) {
    try {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch (e) {
      console.warn('[MCP] Warning parsing mcp_config.json:', e.message);
    }
  }
  return defaultConfig();
}

// Tool Definitions for Ollama / LLM Tool Calling
const MCP_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'system_info',
      description: 'Inspect real-time machine hardware specifications including OS, CPU, RAM, and NVIDIA GPU telemetry.',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_living_memory',
      description: 'Search long-term memory records and Obsidian Second Brain notes for user preferences, facts, past conversations, and project files.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Keywords or search topic to look up in the user memory base.'
          }
        },
        required: ['query']
      }
    }
  }
];

// Cached GPU info to avoid synchronous subprocess spawning on repeated telemetry
let cachedGpuInfo = null;
let lastGpuCheck = 0;

/**
 * Execute search_living_memory
 */
async function executeSearchLivingMemory(query, profileId = 'prof_default') {
  if (!query || typeof query !== 'string') {
    return { error: 'Missing query parameter' };
  }

  const results = [];
  const qLower = query.toLowerCase();

  // Search SQLite Living Memories
  if (db && typeof db.getAllProfileMemory === 'function') {
    try {
      const memories = db.getAllProfileMemory(profileId) || [];
      for (const m of memories) {
        const text = `${m.key || ''} ${m.value || ''}`.toLowerCase();
        if (text.includes(qLower)) {
          results.push({
            type: 'memory_record',
            key: m.key,
            value: m.value,
            confidence: m.confidence || 1.0,
            source: 'db'
          });
        }
      }
    } catch (e) {}
  }

  // Search Obsidian Second Brain Vault
  if (profileId === 'prof_default' && obsidianVault && typeof obsidianVault.getRelevantKnowledge === 'function') {
    try {
      const vaultNotes = obsidianVault.getRelevantKnowledge(query);
      if (vaultNotes) {
        results.push({
          type: 'vault_knowledge',
          content: vaultNotes,
          source: 'obsidian_vault'
        });
      }
    } catch (e) {}
  }

  return {
    query,
    count: results.length,
    results: results.slice(0, 10)
  };
}

/**
 * Dispatch tool execution
 */
async function executeTool(name, args = {}, profileId = 'prof_default') {
  if (name === 'calculate_or_eval') return { success: false, denied: true, error: 'Arbitrary code execution is disabled; it is not an MCP capability.' };
  switch (name) {
    case 'system_info':
      return await executeSystemInfo();
    case 'search_living_memory':
      return await executeSearchLivingMemory(args.query, profileId);
    default:
      return { error: `Tool "${name}" is not handled by mcp_client` };
  }
}

function saveConfig(config, profileId = 'prof_default') {
  try {
    if (!profileId || !db?.setProfileSetting) throw new Error('Profile configuration storage is unavailable');
    db.setProfileSetting(profileId, 'mcp_config', config);
    return true;
  } catch (e) {
    console.error('[MCP] Error saving mcp_config.json:', e.message);
    return false;
  }
}

function getAllTools(profileId = 'prof_default') {
  const tools = [...MCP_TOOLS];
  const cfg = loadConfig(profileId);
  if (cfg && cfg.mcpServers) {
    for (const [srvName, srv] of Object.entries(cfg.mcpServers)) {
      if (srvName === 'local_tools' || srv.disabled || srv.enabled === false) continue;
      const binding = transportBindings.get(transportKey(profileId, srvName));
      if (binding?.tools) {
        for (const tool of binding.tools) tools.push({
          type: 'function',
          function: {
            name: qualifiedToolId(srvName, tool.name),
            description: `[MCP ${srvName}] ${tool.description}`.slice(0, 2000),
            parameters: tool.inputSchema
          }
        });
      }
    }
  }
  return tools;
}

function addServer(name, serverConfig, profileId = 'prof_default') {
  if (!/^[a-z0-9_-]{2,64}$/.test(name)) throw new Error('Invalid MCP server id');
  if (!serverConfig || typeof serverConfig !== 'object' || Array.isArray(serverConfig)) throw new Error('MCP server configuration must be an object');
  if (serverConfig.env && Object.keys(serverConfig.env).length) throw new Error('Plaintext environment variables are not stored in MCP configuration');
  if (serverConfig.envSecretRefs && (!serverConfig.envSecretRefs || typeof serverConfig.envSecretRefs !== 'object' || Array.isArray(serverConfig.envSecretRefs) || Object.entries(serverConfig.envSecretRefs).some(([key, ref]) => !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(key) || typeof ref !== 'string' || !/^[a-zA-Z0-9._-]{1,128}$/.test(ref)))) throw new Error('MCP environment secret references are invalid');
  if (serverConfig.transport && serverConfig.transport !== 'stdio') throw new Error('Only MCP stdio transport is currently supported');
  if (typeof serverConfig.command !== 'string' || !serverConfig.command.trim() || serverConfig.command.length > 1024) throw new Error('MCP stdio server command is required and must be bounded');
  if (serverConfig.args !== undefined && (!Array.isArray(serverConfig.args) || serverConfig.args.length > 128 || serverConfig.args.some(arg => typeof arg !== 'string' || arg.length > 4096 || /[\0\r\n]/.test(arg)))) throw new Error('MCP server args must be a bounded string array');
  if (serverConfig.grantedPermissions !== undefined && (!Array.isArray(serverConfig.grantedPermissions) || serverConfig.grantedPermissions.some(permission => typeof permission !== 'string'))) throw new Error('MCP permissions must be an explicit string array');
  const cfg = loadConfig(profileId);
  cfg.mcpServers = cfg.mcpServers || {};
  if (cfg.mcpServers[name]) throw new Error(`MCP server "${name}" is already configured`);
  cfg.mcpServers[name] = {
    enabled: true,
    transport: 'stdio',
    executionApproved: false,
    ...serverConfig,
    env: undefined,
    tools: []
  };
  saveConfig(cfg, profileId);
  return { ok: true, server: cfg.mcpServers[name] };
}

function toggleServer(name, enabled, profileId = 'prof_default') {
  const cfg = loadConfig(profileId);
  if (!cfg.mcpServers || !cfg.mcpServers[name]) {
    throw new Error(`MCP server "${name}" not found`);
  }
  cfg.mcpServers[name].enabled = enabled;
  if (!enabled) cfg.mcpServers[name].disabled = true;
  else delete cfg.mcpServers[name].disabled;
  saveConfig(cfg, profileId);
  if (!enabled) transportManager.disconnect(transportKey(profileId, name)).catch(() => {});
  return { ok: true, server: cfg.mcpServers[name] };
}

function deleteServer(name, profileId = 'prof_default') {
  const cfg = loadConfig(profileId);
  if (cfg.mcpServers && cfg.mcpServers[name]) {
    transportManager.disconnect(transportKey(profileId, name)).catch(() => {});
    transportBindings.delete(transportKey(profileId, name));
    delete cfg.mcpServers[name];
    saveConfig(cfg, profileId);
  }
  return { ok: true };
}

function isMcpTool(name, profileId = 'prof_default') {
  return getAllTools(profileId).some(t => t.function?.name === name);
}

async function connectServer(name, profileId = 'prof_default', { executionApproved = false, signal } = {}) {
  const cfg = loadConfig(profileId);
  const server = cfg.mcpServers?.[name];
  if (!server || server.enabled === false || server.disabled) throw new Error(`MCP server "${name}" is not enabled`);
  if (executionApproved !== true) throw new Error('Confirm that this MCP server process may run with your account permissions');
  server.executionApproved = true;
  saveConfig(cfg, profileId);
  const resolvedSecretEnv = {};
  for (const [key, ref] of Object.entries(server.envSecretRefs || {})) {
    const secret = credentialStore.getSecret(profileId, ref);
    if (!secret) throw new Error(`MCP secret reference "${ref}" is not available in the credential store`);
    resolvedSecretEnv[key] = secret;
  }
  const key = transportKey(profileId, name);
  const result = await transportManager.connect(key, { ...server, executionApproved: true, resolvedSecretEnv }, { signal });
  const binding = { serverId: name, transportKey: key, tools: result.tools };
  transportBindings.set(key, binding);
  return { server: { name, status: result.status }, tools: result.tools.map(tool => ({ id: qualifiedToolId(name, tool.name), name: tool.name, description: tool.description, inputSchema: tool.inputSchema })) };
}

async function disconnectServer(name, profileId = 'prof_default') {
  transportBindings.delete(transportKey(profileId, name));
  return transportManager.disconnect(transportKey(profileId, name));
}

function getServerStatuses(profileId = 'prof_default') {
  const cfg = loadConfig(profileId);
  return Object.fromEntries(Object.entries(cfg.mcpServers || {}).map(([name, server]) => [name, {
    configured: true,
    enabled: server.enabled !== false && !server.disabled,
    status: transportManager.status(transportKey(profileId, name)).status,
    executionApproved: server.executionApproved === true,
    transport: server.transport || 'unconfigured'
  }]));
}

function registerConnectedTools(registry, profileId = 'prof_default') {
  const cfg = loadConfig(profileId);
  const registered = [];
  for (const tool of registry.list()) {
    if (tool.provenance?.source?.startsWith('mcp:')) registry.unregister(tool.id);
  }
  for (const [name, server] of Object.entries(cfg.mcpServers || {})) {
    const key = transportKey(profileId, name);
    const binding = transportBindings.get(key);
    if (!binding || server.enabled === false || server.disabled) continue;
    for (const tool of binding.tools) {
      const id = qualifiedToolId(name, tool.name);
      validateSchemaDefinition(tool.inputSchema, `MCP ${name}.${tool.name}`);
      registry.register({
        id,
        version: '1.0.0',
        description: `[MCP ${name}] ${tool.description || tool.name}`,
        inputSchema: tool.inputSchema,
        riskCategory: 'external',
        permissions: Array.isArray(server.toolPermissions?.[tool.name]) ? server.toolPermissions[tool.name] : ['mcp:call'],
        grantedPermissions: Array.isArray(server.grantedPermissions) ? server.grantedPermissions : [],
        timeoutMs: Math.min(Math.max(Number(server.timeoutMs) || 30000, 1000), 120000),
        maxOutputBytes: Math.min(Math.max(Number(server.maxOutputBytes) || 65536, 1024), 1024 * 1024),
        provenance: { source: `mcp:${name}`, trustLevel: 'explicitly-approved-external', serverId: name },
        execute: (args, context) => transportManager.callTool(key, tool.name, args, { signal: context.signal, timeoutMs: server.timeoutMs })
      });
      registered.push(id);
    }
  }
  return registered;
}

module.exports = {
  MCP_TOOLS,
  getAllTools,
  isMcpTool,
  executeTool,
  loadConfig,
  saveConfig,
  addServer,
  toggleServer,
  deleteServer,
  connectServer,
  disconnectServer,
  getServerStatuses,
  registerConnectedTools,
  qualifiedToolId,
  transportManager
};
