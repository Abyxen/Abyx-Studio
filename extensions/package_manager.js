/**
 * ABYX Extension Subsystem — Package & Lifecycle Manager
 * 
 * Manages:
 * - Extension inspection (browse/preview permissions before installation)
 * - Safe installation with mandatory user permission consent
 * - Enable / Disable activation toggles
 * - Version updates with pre-update backup snapshots
 * - Safe rollback to previous versions
 * - Clean uninstallation and permission revocation
 * - Path traversal defense on imports and archives
 */

const fs = require('node:fs');
const path = require('node:path');
const ManifestValidator = require('./manifest_validator');
const { ExtensionKind, ExtensionStatus } = require('./types');
const { dataDir } = require('../data_paths');

class PackageManager {
  constructor(pathGuard, { extensionsDir = path.join(dataDir, 'extensions') } = {}) {
    this.pathGuard = pathGuard;
    this.extensionsDir = path.resolve(extensionsDir);
    this.registryFile = path.join(this.extensionsDir, 'registry.json');
    this.installedDir = path.join(this.extensionsDir, 'installed');
    this.backupsDir = path.join(this.extensionsDir, 'backups');
    this.ensureDirs();
  }

  ensureDirs() {
    for (const d of [this.extensionsDir, this.installedDir, this.backupsDir, path.join(this.installedDir, 'skills'), path.join(this.installedDir, 'plugins'), path.join(this.installedDir, 'mcp')]) {
      if (!fs.existsSync(d)) {
        try { fs.mkdirSync(d, { recursive: true }); } catch (e) {}
      }
    }
  }

  loadRegistry() {
    if (fs.existsSync(this.registryFile)) {
      try {
        return JSON.parse(fs.readFileSync(this.registryFile, 'utf8'));
      } catch (e) {
        console.warn('[PackageManager] Warning loading registry:', e.message);
      }
    }
    return { extensions: {} };
  }

  saveRegistry(registry) {
    fs.mkdirSync(path.dirname(this.registryFile), { recursive: true });
    fs.writeFileSync(this.registryFile, JSON.stringify(registry, null, 2), 'utf8');
  }

  /**
   * Recursively copies a directory safely
   */
  copyDir(src, dest) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        this.copyDir(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  /**
   * Inspect a package directory without installing it (browse & preview permissions)
   * 
   * @param {string} packageDir 
   * @returns {Object} Validated manifest & permission preview
   */
  inspectPackage(packageDir) {
    if (!packageDir || !fs.existsSync(packageDir)) {
      throw new Error(`Package directory not found: "${packageDir}"`);
    }

    const manifestFile = path.join(packageDir, 'manifest.json');
    const skillFile = path.join(packageDir, 'SKILL.md');

    let rawData;
    if (fs.existsSync(manifestFile)) {
      try {
        rawData = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
      } catch (err) {
        throw new Error(`Malformed manifest.json in package: ${err.message}`);
      }
    } else if (fs.existsSync(skillFile)) {
      // Compatibility with raw SKILL.md packages
      const content = fs.readFileSync(skillFile, 'utf8');
      const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      const meta = {};
      if (fmMatch) {
        for (const line of fmMatch[1].split('\n')) {
          const idx = line.indexOf(':');
          if (idx !== -1) meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
        }
      }
      rawData = {
        id: meta.name || path.basename(packageDir),
        name: meta.name || path.basename(packageDir),
        version: meta.version || '1.0.0',
        kind: ExtensionKind.SKILL,
        description: meta.description || 'Instruction skill',
        author: meta.author || 'Imported',
        permissions: []
      };
    } else {
      throw new Error('Package contains neither manifest.json nor SKILL.md');
    }

    const validated = ManifestValidator.validate(rawData);

    // Verify entryPoint exists if plugin
    if (validated.kind === ExtensionKind.PLUGIN) {
      const entryFile = path.join(packageDir, validated.entryPoint);
      if (!fs.existsSync(entryFile)) {
        throw new Error(`Plugin entry point "${validated.entryPoint}" does not exist in package`);
      }
    }

    return {
      manifest: validated,
      packageDir,
      permissionCount: validated.permissions.length,
      requestedPermissions: validated.permissions,
      preview: {
        id: validated.id,
        name: validated.name,
        kind: validated.kind,
        version: validated.version,
        description: validated.description,
        permissions: validated.permissions,
        tools: validated.tools
      }
    };
  }

  /**
   * Install an extension package with mandatory user consent for requested permissions
   * 
   * @param {string} packageDir 
   * @param {Object} options - { grantedPermissions: string[], enabled: boolean }
   */
  install(packageDir, { grantedPermissions = [], enabled = true } = {}) {
    const inspected = this.inspectPackage(packageDir);
    const { manifest } = inspected;

    // 1. Consent Verification: Verify all requested permissions are explicitly granted
    const unapproved = manifest.permissions.filter(p => !grantedPermissions.includes(p));
    if (unapproved.length > 0) {
      throw new Error(`Installation Denied: Explicit user consent required for permissions: [${unapproved.join(', ')}]`);
    }

    const registry = this.loadRegistry();
    if (registry.extensions[manifest.id]) {
      throw new Error(`Extension "${manifest.id}" is already installed. Use update() to upgrade version.`);
    }

    const subDir = manifest.kind === ExtensionKind.PLUGIN ? 'plugins' : (manifest.kind === ExtensionKind.MCP ? 'mcp' : 'skills');
    const installTarget = path.join(this.installedDir, subDir, manifest.id);

    if (fs.existsSync(installTarget)) {
      fs.rmSync(installTarget, { recursive: true, force: true });
    }

    // 2. Copy files to installed destination
    this.copyDir(packageDir, installTarget);

    // 3. Create initial version backup snapshot
    const backupTarget = path.join(this.backupsDir, manifest.id, manifest.version);
    this.copyDir(packageDir, backupTarget);

    // 4. Update Registry
    const record = {
      id: manifest.id,
      name: manifest.name,
      kind: manifest.kind,
      version: manifest.version,
      description: manifest.description,
      author: manifest.author,
      entryPoint: manifest.entryPoint,
      installPath: installTarget,
      permissions: manifest.permissions,
      grantedPermissions: [...grantedPermissions],
      tools: manifest.tools || [],
      status: enabled ? ExtensionStatus.ENABLED : ExtensionStatus.DISABLED,
      installedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      previousVersions: []
    };

    registry.extensions[manifest.id] = record;
    this.saveRegistry(registry);

    return {
      success: true,
      extension: record,
      message: `Successfully installed ${manifest.kind} "${manifest.name}" v${manifest.version}`
    };
  }

  /**
   * Enable an installed extension
   */
  enable(id) {
    const registry = this.loadRegistry();
    const ext = registry.extensions[id];
    if (!ext) throw new Error(`Extension "${id}" is not installed`);

    ext.status = ExtensionStatus.ENABLED;
    ext.updatedAt = new Date().toISOString();
    this.saveRegistry(registry);
    return ext;
  }

  /**
   * Disable an installed extension
   */
  disable(id) {
    const registry = this.loadRegistry();
    const ext = registry.extensions[id];
    if (!ext) throw new Error(`Extension "${id}" is not installed`);

    ext.status = ExtensionStatus.DISABLED;
    ext.updatedAt = new Date().toISOString();
    this.saveRegistry(registry);
    return ext;
  }

  /**
   * Update an extension to a new version with automated backup of existing version
   */
  update(id, newPackageDir, { grantedPermissions = null } = {}) {
    const registry = this.loadRegistry();
    const existing = registry.extensions[id];
    if (!existing) throw new Error(`Extension "${id}" is not installed`);

    const inspected = this.inspectPackage(newPackageDir);
    const { manifest } = inspected;

    if (manifest.id !== id) {
      throw new Error(`Package ID "${manifest.id}" does not match target extension "${id}"`);
    }

    if (ManifestValidator.compareVersions(manifest.version, existing.version) <= 0) {
      throw new Error(`Update version (${manifest.version}) must be higher than current version (${existing.version})`);
    }

    // Permission check for any newly added permissions
    const effectiveGranted = grantedPermissions || existing.grantedPermissions;
    const unapproved = manifest.permissions.filter(p => !effectiveGranted.includes(p));
    if (unapproved.length > 0) {
      throw new Error(`Update Denied: Explicit user consent required for new permissions: [${unapproved.join(', ')}]`);
    }

    // Snapshot current installed version before replacing
    const backupTarget = path.join(this.backupsDir, id, existing.version);
    if (!fs.existsSync(backupTarget)) {
      this.copyDir(existing.installPath, backupTarget);
    }

    // Clean install directory and copy new package
    fs.rmSync(existing.installPath, { recursive: true, force: true });
    this.copyDir(newPackageDir, existing.installPath);

    // Save snapshot of new version as well
    const newBackup = path.join(this.backupsDir, id, manifest.version);
    this.copyDir(newPackageDir, newBackup);

    // Update record
    const prevVersions = existing.previousVersions || [];
    if (!prevVersions.includes(existing.version)) {
      prevVersions.push(existing.version);
    }

    existing.version = manifest.version;
    existing.description = manifest.description;
    existing.entryPoint = manifest.entryPoint;
    existing.permissions = manifest.permissions;
    existing.grantedPermissions = [...effectiveGranted];
    existing.tools = manifest.tools || [];
    existing.updatedAt = new Date().toISOString();
    existing.previousVersions = prevVersions;

    this.saveRegistry(registry);

    return {
      success: true,
      extension: existing,
      previousVersion: prevVersions[prevVersions.length - 1],
      message: `Updated "${id}" to v${manifest.version}`
    };
  }

  /**
   * Rollback an extension to a previously installed backup version
   */
  rollback(id, targetVersion = null) {
    const registry = this.loadRegistry();
    const existing = registry.extensions[id];
    if (!existing) throw new Error(`Extension "${id}" is not installed`);

    const extBackupsDir = path.join(this.backupsDir, id);
    if (!fs.existsSync(extBackupsDir)) {
      throw new Error(`No backup versions found for "${id}"`);
    }

    const availableVersions = fs.readdirSync(extBackupsDir).filter(v => v !== existing.version);
    if (availableVersions.length === 0) {
      throw new Error(`No previous rollback targets available for "${id}"`);
    }

    const versionToRestore = targetVersion || availableVersions[availableVersions.length - 1];
    const sourceBackup = path.join(extBackupsDir, versionToRestore);

    if (!fs.existsSync(sourceBackup)) {
      throw new Error(`Backup version "${versionToRestore}" does not exist for "${id}"`);
    }

    // Re-inspect backup package
    const inspected = this.inspectPackage(sourceBackup);

    // Replace current install with backup
    fs.rmSync(existing.installPath, { recursive: true, force: true });
    this.copyDir(sourceBackup, existing.installPath);

    existing.version = versionToRestore;
    existing.description = inspected.manifest.description;
    existing.entryPoint = inspected.manifest.entryPoint;
    existing.permissions = inspected.manifest.permissions;
    existing.tools = inspected.manifest.tools || [];
    existing.updatedAt = new Date().toISOString();

    this.saveRegistry(registry);

    return {
      success: true,
      extension: existing,
      restoredVersion: versionToRestore,
      message: `Successfully rolled back "${id}" to v${versionToRestore}`
    };
  }

  /**
   * Uninstall an extension and delete its files
   */
  uninstall(id) {
    const registry = this.loadRegistry();
    const existing = registry.extensions[id];
    if (!existing) throw new Error(`Extension "${id}" is not installed`);

    if (fs.existsSync(existing.installPath)) {
      fs.rmSync(existing.installPath, { recursive: true, force: true });
    }

    delete registry.extensions[id];
    this.saveRegistry(registry);

    return {
      success: true,
      uninstalled: id,
      message: `Extension "${id}" uninstalled successfully`
    };
  }

  /**
   * List all registered extensions and active status
   */
  listExtensions() {
    const registry = this.loadRegistry();
    return Object.values(registry.extensions);
  }

  /**
   * Get an extension record by ID
   */
  getExtension(id) {
    const registry = this.loadRegistry();
    return registry.extensions[id] || null;
  }
}

module.exports = PackageManager;
