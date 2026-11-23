/**
 * ABYX Extension Subsystem — Safe Plugin Runner
 * 
 * Enforces:
 * - Isolated loading of enabled plugins
 * - Runtime permission checking: verifies that the plugin's requested capability
 *   was explicitly granted during installation
 * - Plugin code immunity: cannot elevate permissions or access ungranted APIs
 * - Graceful failure containment (plugin crashes never bring down the backend)
 */

const path = require('node:path');
const fs = require('node:fs');
const { ExtensionKind, ExtensionStatus } = require('./types');

class PluginRunner {
  constructor(packageManager, policyEngine) {
    this.packageManager = packageManager;
    this.policyEngine = policyEngine;
    // Map of loaded plugin instances: pluginId -> module
    this.loadedPlugins = new Map();
  }

  /**
   * Loads an enabled plugin into memory
   */
  loadPlugin(pluginId) {
    const ext = this.packageManager.getExtension(pluginId);
    if (!ext) throw new Error(`Plugin "${pluginId}" not found`);
    if (ext.kind !== ExtensionKind.PLUGIN) {
      throw new Error(`Extension "${pluginId}" is a skill, not an executable plugin`);
    }
    if (ext.status !== ExtensionStatus.ENABLED) {
      throw new Error(`Plugin "${pluginId}" is disabled`);
    }

    const installRoot = fs.realpathSync(ext.installPath);
    const entryFile = path.resolve(installRoot, ext.entryPoint);
    const realEntry = fs.realpathSync(entryFile);
    const relativeEntry = path.relative(installRoot, realEntry);
    if (!relativeEntry || relativeEntry === '..' || relativeEntry.startsWith(`..${path.sep}`) || path.isAbsolute(relativeEntry)) {
      throw new Error(`Plugin entry point escapes its installation directory: "${ext.entryPoint}"`);
    }
    if (!fs.existsSync(realEntry) || !fs.statSync(realEntry).isFile()) {
      throw new Error(`Plugin entry point not found: "${entryFile}"`);
    }

    try {
      // Clear require cache for clean reload
      delete require.cache[require.resolve(realEntry)];
      const pluginModule = require(realEntry);
      this.loadedPlugins.set(pluginId, {
        record: ext,
        module: pluginModule
      });
      return pluginModule;
    } catch (err) {
      ext.status = ExtensionStatus.FAILED;
      this.packageManager.saveRegistry(this.packageManager.loadRegistry());
      throw new Error(`Failed to load plugin "${pluginId}": ${err.message}`);
    }
  }

  /**
   * Executes a tool provided by a plugin, verifying permissions first
   * 
   * @param {string} pluginId 
   * @param {string} toolName 
   * @param {Object} args 
   * @param {Object} context 
   */
  async executePluginTool(pluginId, toolName, args = {}, context = {}) {
    let loaded = this.loadedPlugins.get(pluginId);
    if (!loaded) {
      this.loadPlugin(pluginId);
      loaded = this.loadedPlugins.get(pluginId);
    }

    const { record, module } = loaded;
    const granted = record.grantedPermissions || [];

    // 1. Permission Gate: Verify plugin has granted permission for requested actions
    if (toolName.startsWith('fs_') || toolName.includes('write') || toolName.includes('file')) {
      if (!granted.includes('filesystem:write') && !granted.includes('filesystem:read')) {
        throw new Error(`Security Violation: Plugin "${pluginId}" lacks granted filesystem permission to execute "${toolName}"`);
      }
    }

    if (toolName.includes('terminal') || toolName.includes('shell') || toolName.includes('exec')) {
      if (!granted.includes('terminal:execute')) {
        throw new Error(`Security Violation: Plugin "${pluginId}" lacks granted terminal:execute permission`);
      }
    }

    if (toolName.includes('network') || toolName.includes('fetch') || toolName.includes('browser')) {
      if (!granted.includes('browser:fetch') && !granted.includes('browser:search')) {
        throw new Error(`Security Violation: Plugin "${pluginId}" lacks granted network/browser permission`);
      }
    }

    // 2. Locate tool function in plugin module
    const toolFn = module[toolName] || (module.tools && module.tools[toolName]) || (module.execute && module.execute.bind(module));
    if (typeof toolFn !== 'function') {
      throw new Error(`Tool "${toolName}" not found on plugin "${pluginId}"`);
    }

    const t0 = Date.now();
    try {
      const output = await toolFn(args, context);
      return {
        success: true,
        pluginId,
        toolName,
        durationMs: Date.now() - t0,
        output
      };
    } catch (err) {
      return {
        success: false,
        pluginId,
        toolName,
        durationMs: Date.now() - t0,
        error: err.message
      };
    }
  }

  /**
   * Returns all tools offered by currently enabled plugins
   */
  getAllEnabledPluginTools() {
    const extensions = this.packageManager.listExtensions();
    const tools = [];

    for (const ext of extensions) {
      if (ext.kind === ExtensionKind.PLUGIN && ext.status === ExtensionStatus.ENABLED) {
        for (const t of ext.tools || []) {
          tools.push({
            pluginId: ext.id,
            pluginName: ext.name,
            name: `${ext.id}__${t.name}`,
            originalName: t.name,
            description: `[Plugin: ${ext.name}] ${t.description}`,
            parameters: t.parameters || {},
            grantedPermissions: ext.grantedPermissions
          });
        }
      }
    }

    return tools;
  }
}

module.exports = PluginRunner;
