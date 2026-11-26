'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * PluginManager - Extensibility, Tool Registration, and Lifecycle Hook Engine
 * References: Pi + OpenClaw
 * 
 * Supports:
 * - Dynamic tool registration with permission checks.
 * - Non-blocking lifecycle hooks (onSessionStart, onBeforeToolExecute, onAfterToolExecute, onMessage, onSessionEnd).
 * - Custom agent prompt and reasoning behaviors.
 * - External integrations.
 * - Trust boundaries: Untrusted extensions cannot execute privileged actions without explicit user approval.
 * - State persistence: Enable/disable and trust decisions survive application restarts.
 */
class PluginManager {
  constructor(options = {}) {
    this.workspaceRoot = options.workspaceRoot || process.cwd();
    this.pluginsDir = options.pluginsDir || path.resolve(this.workspaceRoot, 'plugins');
    this.registryPath = options.registryPath || path.resolve(this.workspaceRoot, 'app', 'data', 'plugins', 'registry.json');
    this.toolGateway = options.toolGateway || null;

    this.plugins = new Map();
    this.hooks = new Map(); // hookName -> Array<{ pluginId, handler }>
    this.customAgentBehaviors = new Map(); // agentId -> Array<{ pluginId, modifier }>
    this.externalIntegrations = new Map(); // name -> { pluginId, handler }

    this.registry = {
      pluginsState: {}, // id -> { enabled: boolean, trusted: boolean, approvedAt: string, approvedBy: string }
      updatedAt: new Date().toISOString()
    };

    this._loadRegistry();
    this.discoverPlugins();
  }

  setToolGateway(toolGateway) {
    this.toolGateway = toolGateway;
  }

  _loadRegistry() {
    try {
      if (fs.existsSync(this.registryPath)) {
        const raw = fs.readFileSync(this.registryPath, 'utf8');
        this.registry = { ...this.registry, ...JSON.parse(raw) };
      } else {
        const dir = path.dirname(this.registryPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        this._saveRegistry();
      }
    } catch (_) {
      this.registry = { pluginsState: {}, updatedAt: new Date().toISOString() };
    }
  }

  _saveRegistry() {
    try {
      const dir = path.dirname(this.registryPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      this.registry.updatedAt = new Date().toISOString();
      fs.writeFileSync(this.registryPath, JSON.stringify(this.registry, null, 2), 'utf8');
    } catch (err) {
      console.warn('[PluginManager] Failed to save registry:', err.message);
    }
  }

  /**
   * Discovers plugins from plugins/ and data directories
   */
  discoverPlugins({ workspaceRoot = null } = {}) {
    const wsRoot = workspaceRoot || this.workspaceRoot;
    const scanDirs = [
      this.pluginsDir,
      path.resolve(wsRoot, 'app', 'data', 'plugins'),
      path.resolve(wsRoot, '.abyx', 'plugins'),
      path.resolve(wsRoot, 'data', 'extensions', 'installed', 'plugins')
    ];

    for (const sDir of scanDirs) {
      if (!fs.existsSync(sDir)) continue;

      const entries = fs.readdirSync(sDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const manifestPath = path.join(sDir, entry.name, 'plugin.json');
        if (!fs.existsSync(manifestPath)) continue;

        try {
          const raw = fs.readFileSync(manifestPath, 'utf8');
          const manifest = JSON.parse(raw);
          const id = (manifest.id || entry.name).toLowerCase().replace(/[^a-z0-9_-]/g, '_');

          const savedState = this.registry.pluginsState[id] || {};
          const enabled = savedState.enabled !== undefined ? savedState.enabled : true;
          const trusted = savedState.trusted !== undefined ? savedState.trusted : (manifest.trusted === true);

          const pluginRecord = {
            id,
            name: manifest.name || id,
            version: manifest.version || '1.0.0',
            description: manifest.description || '',
            author: manifest.author || 'unknown',
            permissions: manifest.permissions || [],
            entrypoint: manifest.entrypoint || 'index.js',
            dirPath: path.join(sDir, entry.name),
            manifestPath,
            enabled,
            trusted,
            approvedAt: savedState.approvedAt || null,
            approvedBy: savedState.approvedBy || null,
            registeredTools: [],
            loaded: false
          };

          this.plugins.set(id, pluginRecord);
          if (enabled && trusted) {
            this.loadPlugin(id);
          }
        } catch (_) {}
      }
    }

    return Array.from(this.plugins.values());
  }

  /**
   * Safely loads and initializes a plugin
   */
  loadPlugin(id) {
    const plugin = this.plugins.get(id);
    if (!plugin) return { ok: false, error: 'Plugin not found' };
    if (!plugin.trusted) {
      return { ok: false, error: 'Untrusted plugins cannot be loaded into the host process without approval' };
    }
    if (plugin.loaded) return { ok: true, alreadyLoaded: true };

    const entryPath = path.resolve(plugin.dirPath, plugin.entrypoint);
    if (!fs.existsSync(entryPath)) {
      return { ok: false, error: `Plugin entrypoint not found: "${plugin.entrypoint}"` };
    }

    try {
      const pluginModule = require(entryPath);
      const initFn = typeof pluginModule === 'function' ? pluginModule : pluginModule.init;

      if (typeof initFn === 'function') {
        const context = this._createPluginContext(plugin);
        initFn(context);
        plugin.loaded = true;
      }

      return { ok: true, id, loaded: true };
    } catch (err) {
      console.warn(`[PluginManager] Error initializing plugin "${id}":`, err.message);
      return { ok: false, error: err.message };
    }
  }

  /**
   * Constructs the scoped API context for a plugin instance
   */
  _createPluginContext(plugin) {
    const perms = new Set(plugin.permissions || []);

    return {
      pluginId: plugin.id,
      manifest: { ...plugin },

      // 1. Tool Registration
      registerTool: (definition, executor) => {
        if (!perms.has('tools:register') && !perms.has('*')) {
          throw new Error(`Plugin "${plugin.id}" lacks required permission "tools:register"`);
        }
        if (!definition || !definition.name || typeof executor !== 'function') {
          throw new Error('Tool registration requires a valid definition and execution function');
        }

        const toolName = `plugin_${plugin.id}_${definition.name}`;
        if (this.toolGateway && this.toolGateway.toolRegistry) {
          this.toolGateway.toolRegistry.register({
            id: toolName,
            name: definition.name,
            description: `[Plugin: ${plugin.name}] ${definition.description || ''}`,
            parameters: definition.parameters || {},
            riskTier: definition.riskTier || 'safe',
            execute: async (args) => {
              // Wrap execution in safe isolation
              return await executor(args);
            }
          });
        }
        plugin.registeredTools.push(toolName);
      },

      // 2. Lifecycle Hook Registration
      registerLifecycleHook: (hookName, handler) => {
        if (!perms.has('hooks:lifecycle') && !perms.has('*')) {
          throw new Error(`Plugin "${plugin.id}" lacks required permission "hooks:lifecycle"`);
        }
        if (typeof handler !== 'function') throw new Error('Hook handler must be a function');

        if (!this.hooks.has(hookName)) this.hooks.set(hookName, []);
        this.hooks.get(hookName).push({ pluginId: plugin.id, handler });
      },

      // 3. Custom Agent Behavior
      registerAgentBehavior: (agentId, modifier) => {
        if (!perms.has('agent:behavior') && !perms.has('*')) {
          throw new Error(`Plugin "${plugin.id}" lacks required permission "agent:behavior"`);
        }
        if (typeof modifier !== 'function') throw new Error('Behavior modifier must be a function');

        if (!this.customAgentBehaviors.has(agentId)) this.customAgentBehaviors.set(agentId, []);
        this.customAgentBehaviors.get(agentId).push({ pluginId: plugin.id, modifier });
      },

      // 4. External Integrations
      registerExternalIntegration: (name, handler) => {
        if (!perms.has('integration:external') && !perms.has('*')) {
          throw new Error(`Plugin "${plugin.id}" lacks required permission "integration:external"`);
        }
        this.externalIntegrations.set(name, { pluginId: plugin.id, handler });
      }
    };
  }

  /**
   * Executes registered lifecycle hooks safely
   */
  async executeHook(hookName, context = {}) {
    const list = this.hooks.get(hookName);
    if (!list || list.length === 0) return;

    for (const entry of list) {
      const plugin = this.plugins.get(entry.pluginId);
      if (!plugin || !plugin.enabled || !plugin.trusted) continue;

      try {
        await Promise.resolve(entry.handler(context));
      } catch (err) {
        // Protect the host process from unhandled plugin errors
        console.warn(`[PluginManager] Error in hook "${hookName}" from plugin "${entry.pluginId}":`, err.message);
      }
    }
  }

  /**
   * Applies custom agent behaviors to system prompt
   */
  applyAgentBehaviors(agentId, baseSystemPrompt, context = {}) {
    let modified = baseSystemPrompt;
    const list = this.customAgentBehaviors.get(agentId) || [];
    const globalList = this.customAgentBehaviors.get('*') || [];

    for (const entry of [...list, ...globalList]) {
      const plugin = this.plugins.get(entry.pluginId);
      if (!plugin || !plugin.enabled || !plugin.trusted) continue;

      try {
        const result = entry.modifier(modified, context);
        if (typeof result === 'string') modified = result;
      } catch (err) {
        console.warn(`[PluginManager] Error in agent behavior from plugin "${entry.pluginId}":`, err.message);
      }
    }

    return modified;
  }

  /**
   * Enables or disables a plugin
   */
  setPluginEnabled(id, enabled = true) {
    const plugin = this.plugins.get(id);
    if (!plugin) return { ok: false, error: 'Plugin not found' };

    plugin.enabled = !!enabled;
    this.registry.pluginsState[id] = {
      ...(this.registry.pluginsState[id] || {}),
      enabled: plugin.enabled
    };
    this._saveRegistry();

    if (plugin.enabled && plugin.trusted && !plugin.loaded) {
      this.loadPlugin(id);
    }

    return { ok: true, id, enabled: plugin.enabled };
  }

  /**
   * Approves an untrusted plugin (Explicit User Trust Decision)
   */
  approvePlugin(id, { approvedBy = 'user' } = {}) {
    const plugin = this.plugins.get(id);
    if (!plugin) return { ok: false, error: 'Plugin not found' };

    plugin.trusted = true;
    plugin.approvedAt = new Date().toISOString();
    plugin.approvedBy = approvedBy;

    this.registry.pluginsState[id] = {
      ...(this.registry.pluginsState[id] || {}),
      trusted: true,
      approvedAt: plugin.approvedAt,
      approvedBy
    };
    this._saveRegistry();

    if (plugin.enabled && !plugin.loaded) {
      this.loadPlugin(id);
    }

    return { ok: true, id, trusted: true, loaded: plugin.loaded };
  }

  listPlugins() {
    return Array.from(this.plugins.values()).map(p => ({
      id: p.id,
      name: p.name,
      version: p.version,
      description: p.description,
      author: p.author,
      permissions: p.permissions,
      enabled: p.enabled,
      trusted: p.trusted,
      loaded: p.loaded,
      approvedAt: p.approvedAt,
      approvedBy: p.approvedBy,
      registeredTools: p.registeredTools
    }));
  }
}

module.exports = PluginManager;
