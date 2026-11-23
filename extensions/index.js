/**
 * ABYX Extension Subsystem — Master Entrypoint
 */

const ManifestValidator = require('./manifest_validator');
const PackageManager = require('./package_manager');
const PluginRunner = require('./plugin_runner');
const types = require('./types');

function createExtensionManager(options = {}) {
  const packageManager = new PackageManager(options.pathGuard, { extensionsDir: options.extensionsDir });
  const pluginRunner = new PluginRunner(packageManager, options.policyEngine);

  return {
    packageManager,
    pluginRunner,
    validator: ManifestValidator
  };
}

module.exports = {
  createExtensionManager,
  ManifestValidator,
  PackageManager,
  PluginRunner,
  ...types
};
