/**
 * ABYX Extension Subsystem — Types & Permission Definitions
 * 
 * Defines formal data contracts for:
 * - ExtensionManifest (Skills vs Plugins)
 * - ExtensionRecord & Version Snapshots
 * - Granular Extension Permissions
 */

const ExtensionKind = {
  SKILL: 'skill',     // Instruction-only prompt-grounding markdown (no executable code)
  PLUGIN: 'plugin',   // Executable JavaScript code providing tools or capability seams
  MCP: 'mcp'          // Model Context Protocol tool server
};

const ExtensionStatus = {
  INSTALLED: 'installed',
  ENABLED: 'enabled',
  DISABLED: 'disabled',
  FAILED: 'failed'
};

const ExtensionPermissions = {
  FS_READ: 'filesystem:read',
  FS_WRITE: 'filesystem:write',
  TERMINAL_EXEC: 'terminal:execute',
  BROWSER_SEARCH: 'browser:search',
  BROWSER_FETCH: 'browser:fetch',
  MEMORY_READ: 'memory:read',
  MEMORY_WRITE: 'memory:write'
};

const VALID_PERMISSIONS = Object.values(ExtensionPermissions);

module.exports = {
  ExtensionKind,
  ExtensionStatus,
  ExtensionPermissions,
  VALID_PERMISSIONS
};
