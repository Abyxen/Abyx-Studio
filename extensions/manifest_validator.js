/**
 * ABYX Extension Subsystem — Strict Manifest Validator
 * 
 * Enforces:
 * - Clear distinction between instruction-only skills and executable plugins
 * - Semver syntax validation
 * - Whitelisted permissions (no wildcards or self-escalation)
 * - Path traversal prevention on entryPoint files
 */

const { ExtensionKind, VALID_PERMISSIONS } = require('./types');
const { validateSchemaDefinition } = require('../agent/tool_registry');

const ID_REGEX = /^[a-z0-9_-]{2,64}$/;
const SEMVER_REGEX = /^\d+\.\d+\.\d+(-[a-zA-Z0-9._]+)?$/;

class ManifestValidator {
  /**
   * Validates an extension manifest object.
   * Throws Error if validation fails, or returns cleaned normalized manifest.
   * 
   * @param {Object} rawManifest 
   * @returns {Object} Normalized manifest
   */
  static validate(rawManifest) {
    if (!rawManifest || typeof rawManifest !== 'object') {
      throw new Error('Manifest must be a valid JSON object');
    }

    // 1. ID Validation
    const rawId = (rawManifest.id || rawManifest.name || '').toLowerCase().trim();
    if (!rawId || !ID_REGEX.test(rawId)) {
      throw new Error(`Invalid manifest ID "${rawId}": must be 2-64 characters matching [a-z0-9_-]`);
    }

    // 2. Name & Description
    const name = typeof rawManifest.name === 'string' && rawManifest.name.trim()
      ? rawManifest.name.trim().slice(0, 100)
      : rawId;

    if (!rawManifest.description || typeof rawManifest.description !== 'string' || !rawManifest.description.trim()) {
      throw new Error('Manifest requires a non-empty description string');
    }
    const description = rawManifest.description.trim().slice(0, 500);

    // 3. Version Validation
    const version = (rawManifest.version || '').trim();
    if (!version || !SEMVER_REGEX.test(version)) {
      throw new Error(`Invalid semver version "${version}": must match standard semver (e.g. "1.0.0")`);
    }

    // 4. Kind Validation: 'skill' vs 'plugin' vs 'mcp'
    const kind = (rawManifest.kind || '').toLowerCase().trim();
    if (kind !== ExtensionKind.SKILL && kind !== ExtensionKind.PLUGIN && kind !== ExtensionKind.MCP) {
      throw new Error(`Invalid extension kind "${kind}": must be "${ExtensionKind.SKILL}", "${ExtensionKind.PLUGIN}", or "${ExtensionKind.MCP}"`);
    }

    // 5. Author
    let author = 'Community';
    if (typeof rawManifest.author === 'string' && rawManifest.author.trim()) {
      author = rawManifest.author.trim().slice(0, 100);
    } else if (typeof rawManifest.author === 'object' && rawManifest.author?.name) {
      author = String(rawManifest.author.name).trim().slice(0, 100);
    }

    // 6. Permissions Validation
    let requestedPermissions = [];
    if (Array.isArray(rawManifest.permissions)) {
      for (const p of rawManifest.permissions) {
        const cleanP = String(p).trim();
        if (cleanP === '*' || cleanP === 'all') {
          throw new Error('Security Violation: Wildcard permissions ("*") are strictly prohibited');
        }
        if (!VALID_PERMISSIONS.includes(cleanP)) {
          throw new Error(`Security Violation: Unrecognized permission requested: "${cleanP}"`);
        }
        if (!requestedPermissions.includes(cleanP)) {
          requestedPermissions.push(cleanP);
        }
      }
    }

    // Instruction skills cannot request executable permissions
    if (kind === ExtensionKind.SKILL) {
      const forbiddenForSkills = ['terminal:execute', 'filesystem:write'];
      for (const p of requestedPermissions) {
        if (forbiddenForSkills.includes(p)) {
          throw new Error(`Security Violation: Instruction-only skill cannot request execution permission "${p}"`);
        }
      }
    }

    const dependencies = Array.isArray(rawManifest.dependencies) ? [...new Set(rawManifest.dependencies.map(value => String(value).trim().toLowerCase()))] : [];
    if (dependencies.length > 32 || dependencies.some(value => !ID_REGEX.test(value))) throw new Error('Skill dependencies must be a bounded list of valid skill IDs');
    if (kind !== ExtensionKind.SKILL && dependencies.length) throw new Error('Only instruction skills may declare skill dependencies');

    // 7. Entry Point Validation
    let entryPoint = null;
    if (kind === ExtensionKind.PLUGIN) {
      if (!rawManifest.entryPoint || typeof rawManifest.entryPoint !== 'string' || !rawManifest.entryPoint.trim()) {
        throw new Error('Executable plugins must specify a valid "entryPoint" filename (e.g. "index.js")');
      }

      const cleanEntry = rawManifest.entryPoint.trim();
      // Detect traversal attempts or absolute paths
      if (cleanEntry.includes('..') || cleanEntry.startsWith('/') || cleanEntry.startsWith('\\') || /^[a-zA-Z]:/.test(cleanEntry)) {
        throw new Error(`Security Violation: Entry point "${cleanEntry}" cannot contain path traversal or absolute paths`);
      }
      if (cleanEntry.includes('\0')) {
        throw new Error('Security Violation: Null byte detected in entry point');
      }
      entryPoint = cleanEntry;
    } else if (kind === ExtensionKind.MCP) {
      if (rawManifest.entryPoint && typeof rawManifest.entryPoint === 'string') {
        const cleanEntry = rawManifest.entryPoint.trim();
        if (cleanEntry.includes('..') || cleanEntry.startsWith('/') || cleanEntry.startsWith('\\') || /^[a-zA-Z]:/.test(cleanEntry)) {
          throw new Error(`Security Violation: Entry point "${cleanEntry}" cannot contain path traversal or absolute paths`);
        }
        entryPoint = cleanEntry;
      }
    } else {
      // Skills must not specify an executable entry point
      if (rawManifest.entryPoint) {
        throw new Error('Instruction-only skills cannot declare an executable entry point');
      }
    }

    // 8. Tool definitions for plugins
    let tools = [];
    if (Array.isArray(rawManifest.tools)) {
      if (kind !== ExtensionKind.PLUGIN || rawManifest.tools.length > 128) throw new Error('Tool definitions are only supported for bounded plugin manifests');
      const names = new Set();
      tools = rawManifest.tools.map(tool => {
        if (!tool || typeof tool !== 'object' || Array.isArray(tool)) throw new Error('Plugin tool definition must be an object');
        const toolName = typeof tool.name === 'string' ? tool.name.trim() : '';
        if (!/^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/.test(toolName) || names.has(toolName)) throw new Error('Plugin tool names must be valid and unique');
        names.add(toolName);
        const parameters = tool.parameters || { type: 'object', properties: {} };
        validateSchemaDefinition(parameters, `plugin tool ${toolName} parameters`);
        return { name: toolName, description: String(tool.description || '').slice(0, 200), parameters };
      });
    }

    return {
      id: rawId,
      name,
      version,
      kind,
      description,
      author,
      entryPoint,
      permissions: requestedPermissions,
      dependencies,
      tools,
      category: rawManifest.category || 'General'
    };
  }

  /**
   * Compares two semver strings (returns > 0 if v1 > v2, < 0 if v1 < v2, 0 if equal)
   */
  static compareVersions(v1, v2) {
    const parse = (v) => v.split('-')[0].split('.').map(Number);
    const [maj1, min1, pat1] = parse(v1);
    const [maj2, min2, pat2] = parse(v2);

    if (maj1 !== maj2) return maj1 - maj2;
    if (min1 !== min2) return min1 - min2;
    return pat1 - pat2;
  }
}

module.exports = ManifestValidator;
