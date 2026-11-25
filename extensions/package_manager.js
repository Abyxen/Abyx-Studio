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
const crypto = require('node:crypto');
const ManifestValidator = require('./manifest_validator');
const { ExtensionKind, ExtensionStatus } = require('./types');
const { dataDir } = require('../data_paths');

function sanitizeSource(source) {
  const value = String(source || 'local-import');
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}${url.pathname}`.slice(0, 300);
  } catch {
    return /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(value) ? value : 'local-import';
  }
}

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

      if (entry.isSymbolicLink()) throw new Error(`Extension packages cannot contain symbolic links: ${srcPath}`);
      if (entry.isDirectory()) {
        this.copyDir(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  hashPackageTree(packageDir) {
    const root = fs.realpathSync(packageDir);
    const files = [];
    let totalBytes = 0;
    const walk = directory => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const filename = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) throw new Error(`Extension packages cannot contain symbolic links: ${filename}`);
        if (entry.isDirectory()) walk(filename);
        else if (entry.isFile()) {
          const bytes = fs.statSync(filename).size;
          totalBytes += bytes;
          if (totalBytes > 50 * 1024 * 1024) throw new Error('Extension package exceeds the 50 MB size limit');
          files.push(`${path.relative(root, filename).replace(/\\/g, '/')}:${crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex')}`);
        } else {
          throw new Error(`Extension packages may contain only regular files and directories: ${filename}`);
        }
      }
    };
    walk(root);
    files.sort();
    return crypto.createHash('sha256').update(files.join('\n')).digest('hex');
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
        permissions: [],
        dependencies: String(meta.dependencies || '').split(',').map(value => value.trim()).filter(Boolean)
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
      contentHash: this.hashPackageTree(packageDir),
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
  install(packageDir, { grantedPermissions, enabled = true, installationApproved = false, expectedContentHash, provenance = 'local-import' } = {}) {
    if (installationApproved !== true) throw new Error('Explicit extension installation approval is required');
    if (!Array.isArray(grantedPermissions)) throw new Error('Granted permissions must be explicitly reviewed as a list');
    const inspected = this.inspectPackage(packageDir);
    const { manifest } = inspected;
    const contentHash = this.hashPackageTree(packageDir);
    if (typeof expectedContentHash !== 'string' || expectedContentHash !== contentHash) throw new Error('Package contents changed after inspection; inspect the package again before installing');

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

    const backupTarget = path.join(this.backupsDir, manifest.id, manifest.version);
    if (fs.existsSync(installTarget) || fs.existsSync(backupTarget)) throw new Error('An installation or backup directory already exists; refusing to replace untracked files');
    const suffix = crypto.randomUUID();
    const installStage = `${installTarget}.${suffix}.tmp`;
    const backupStage = `${backupTarget}.${suffix}.tmp`;
    try {
      this.copyDir(packageDir, installStage);
      this.copyDir(packageDir, backupStage);
      if (this.hashPackageTree(installStage) !== contentHash || this.hashPackageTree(backupStage) !== contentHash) throw new Error('Package contents changed during installation');
      fs.mkdirSync(path.dirname(backupTarget), { recursive: true });
      fs.renameSync(backupStage, backupTarget);
      fs.mkdirSync(path.dirname(installTarget), { recursive: true });
      fs.renameSync(installStage, installTarget);
    } catch (error) {
      for (const stage of [installStage, backupStage]) {
        try { fs.rmSync(stage, { recursive: true, force: true }); } catch {}
      }
      throw error;
    }

    // 4. Update Registry
    const executableKind = manifest.kind !== ExtensionKind.SKILL;
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
      dependencies: manifest.dependencies || [],
      grantedPermissions: [...grantedPermissions],
      tools: manifest.tools || [],
      status: enabled && !executableKind ? ExtensionStatus.ENABLED : ExtensionStatus.DISABLED,
      trustLevel: manifest.kind === ExtensionKind.SKILL ? 'instruction-only' : 'untrusted-disabled',
      provenance: { source: sanitizeSource(provenance), contentHash },
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
    if (ext.kind !== ExtensionKind.SKILL) throw new Error('Executable plugins and MCP packages remain disabled until an isolated extension host is available');

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
  update(id, newPackageDir, { grantedPermissions, installationApproved = false, expectedContentHash, provenance = 'local-import' } = {}) {
    if (installationApproved !== true || !Array.isArray(grantedPermissions)) throw new Error('Explicit update approval and reviewed permissions are required');
    const registry = this.loadRegistry();
    const existing = registry.extensions[id];
    if (!existing) throw new Error(`Extension "${id}" is not installed`);

    const inspected = this.inspectPackage(newPackageDir);
    const { manifest } = inspected;
    if (expectedContentHash !== inspected.contentHash) throw new Error('Package contents changed after inspection; inspect again before approving update');

    if (manifest.id !== id) {
      throw new Error(`Package ID "${manifest.id}" does not match target extension "${id}"`);
    }
    if (manifest.kind !== existing.kind) throw new Error('An extension update cannot change its package kind');

    if (ManifestValidator.compareVersions(manifest.version, existing.version) <= 0) {
      throw new Error(`Update version (${manifest.version}) must be higher than current version (${existing.version})`);
    }

    // Permission check for any newly added permissions
    const effectiveGranted = grantedPermissions;
    const unapproved = manifest.permissions.filter(p => !effectiveGranted.includes(p));
    if (unapproved.length > 0) {
      throw new Error(`Update Denied: Explicit user consent required for new permissions: [${unapproved.join(', ')}]`);
    }

    const executableKind = manifest.kind !== ExtensionKind.SKILL;
    const subDir = existing.kind === ExtensionKind.PLUGIN ? 'plugins' : (existing.kind === ExtensionKind.MCP ? 'mcp' : 'skills');
    const expectedInstallPath = path.resolve(this.installedDir, subDir, id);
    if (path.resolve(existing.installPath) !== expectedInstallPath) throw new Error('Installed package path is invalid; refusing to update outside the extension store');
    const backupTarget = path.join(this.backupsDir, id, existing.version);
    const backupExists = fs.existsSync(backupTarget);
    if (backupExists && this.hashPackageTree(backupTarget) !== this.hashPackageTree(existing.installPath)) throw new Error('The stored version backup differs from the installed package; refusing to update');
    const suffix = crypto.randomUUID();
    const installStage = `${existing.installPath}.${suffix}.tmp`;
    const backupStage = `${backupTarget}.${suffix}.tmp`;
    const incomingBackup = path.join(this.backupsDir, id, manifest.version);
    if (fs.existsSync(incomingBackup)) throw new Error('A backup for the incoming version already exists; refusing to overwrite it');
    let movedCurrent = false;
    try {
      this.copyDir(newPackageDir, installStage);
      if (!backupExists) this.copyDir(existing.installPath, backupStage);
      if (this.hashPackageTree(installStage) !== inspected.contentHash) throw new Error('Package contents changed during update');
      fs.mkdirSync(path.dirname(backupTarget), { recursive: true });
      if (!backupExists) fs.renameSync(backupStage, backupTarget);
      fs.renameSync(existing.installPath, `${existing.installPath}.${suffix}.old`);
      movedCurrent = true;
      fs.renameSync(installStage, existing.installPath);
      const oldStage = `${existing.installPath}.${suffix}.old`;
      try { fs.rmSync(oldStage, { recursive: true, force: true }); } catch {}
    } catch (error) {
      try { if (movedCurrent && !fs.existsSync(existing.installPath)) fs.renameSync(`${existing.installPath}.${suffix}.old`, existing.installPath); } catch {}
      for (const stage of [installStage, backupStage]) {
        try { fs.rmSync(stage, { recursive: true, force: true }); } catch {}
      }
      throw error;
    }

    // Snapshot current installed version before replacing

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
    existing.status = executableKind ? ExtensionStatus.DISABLED : existing.status;
    existing.trustLevel = manifest.kind === ExtensionKind.SKILL ? 'instruction-only' : 'untrusted-disabled';
    existing.provenance = { source: sanitizeSource(provenance), contentHash: inspected.contentHash };
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
