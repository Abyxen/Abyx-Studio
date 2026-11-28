/**
 * Environment Provisioning, Isolation, Secrets Management, and Boundary Allowlisting.
 */

const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

class EnvironmentProvisioner {
  constructor(baseDir) {
    this.baseDir = path.resolve(baseDir);
    fs.mkdirSync(this.baseDir, { recursive: true });
    this.activeWorkspaces = new Map();
  }

  provision() {
    fs.mkdirSync(this.baseDir, { recursive: true });
    return { created: true, path: this.baseDir };
  }

  healthCheck() {
    return { healthy: fs.existsSync(this.baseDir) };
  }

  provisionIsolatedWorkspace(workspaceId, mode = 'worktree') {
    const wsPath = path.join(this.baseDir, 'workspaces', workspaceId);
    fs.mkdirSync(wsPath, { recursive: true });
    this.activeWorkspaces.set(workspaceId, wsPath);
    return wsPath;
  }

  teardownWorkspace(workspaceId) {
    if (this.activeWorkspaces.has(workspaceId)) {
      const p = this.activeWorkspaces.get(workspaceId);
      this.activeWorkspaces.delete(workspaceId);
      if (fs.existsSync(p)) {
        fs.rmSync(p, { recursive: true, force: true });
      }
    }
  }
}

class SecretInjector {
  constructor() {
    this.vault = new Map();
    this.maskedValues = new Set();
  }

  registerSecret(key, value) {
    this.vault.set(key, value);
    if (value && value.length >= 4) {
      this.maskedValues.add(value);
    }
  }

  resolveLookupSecret(key) {
    return this.vault.get(key) || null;
  }

  injectEnvironment(baseEnv = process.env) {
    const env = { ...baseEnv };
    for (const [k, v] of this.vault.entries()) {
      env[k] = v;
    }
    return env;
  }

  maskText(text) {
    if (typeof text !== 'string') return text;
    let masked = text;
    for (const [k, v] of this.vault.entries()) {
      if (v && v.length >= 4) {
        masked = masked.split(v).join(`[REDACTED:${k}]`);
      }
    }
    for (const secret of this.maskedValues) {
      masked = masked.split(secret).join('********');
    }
    return masked;
  }

  redactText(text) {
    return this.maskText(text);
  }
}

class RepositoryHydrator {
  constructor(workspacePath) {
    this.workspacePath = path.resolve(workspacePath);
  }

  hydrateFromMap(fileMap, branch = 'main') {
    return this.hydrateState(fileMap, branch);
  }

  summarizeRepository() {
    const manifest = this.readHydratedManifest();
    if (manifest) return manifest;
    let count = 0;
    const scan = (dir) => {
      if (!fs.existsSync(dir)) return;
      for (const f of fs.readdirSync(dir)) {
        if (f.startsWith('.')) continue;
        const full = path.join(dir, f);
        if (fs.statSync(full).isDirectory()) scan(full);
        else count++;
      }
    };
    scan(this.workspacePath);
    return { fileCount: count };
  }

  hydrateState(initialFiles = {}, branchName = 'main') {
    for (const [relPath, content] of Object.entries(initialFiles)) {
      const target = path.join(this.workspacePath, relPath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content, 'utf-8');
    }

    const markerFile = path.join(this.workspacePath, '.state_hydrated.json');
    const stateData = {
      branch: branchName,
      fileCount: Object.keys(initialFiles).length,
      files: Object.keys(initialFiles)
    };
    fs.writeFileSync(markerFile, JSON.stringify(stateData, null, 2), 'utf-8');
  }

  readHydratedManifest() {
    const markerFile = path.join(this.workspacePath, '.state_hydrated.json');
    if (!fs.existsSync(markerFile)) return null;
    return JSON.parse(fs.readFileSync(markerFile, 'utf-8'));
  }
}

class BoundaryAllowlist {
  constructor(workspaceRoot, allowedDomains = ['localhost', '127.0.0.1', 'github.com'], blockedPaths = []) {
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.allowedDomains = new Set(allowedDomains.map(d => d.toLowerCase()));
    this.blockedPaths = new Set(blockedPaths.map(p => path.resolve(p).toLowerCase()));
  }

  isPathAllowed(targetPath) {
    try {
      const resolved = path.resolve(this.workspaceRoot, targetPath);
      if (!resolved.startsWith(this.workspaceRoot)) {
        return { allowed: false, error: `Path traversal denied: ${targetPath}` };
      }
      for (const blocked of this.blockedPaths) {
        if (resolved.toLowerCase().startsWith(blocked)) {
          return { allowed: false, error: `Access to blocked path denied: ${targetPath}` };
        }
      }
      return { allowed: true, resolvedPath: resolved };
    } catch (e) {
      return { allowed: false, error: e.message };
    }
  }

  isUrlAllowed(urlString) {
    try {
      const u = new URL(urlString);
      const host = u.hostname.toLowerCase();
      if (this.allowedDomains.has(host)) {
        return { allowed: true };
      }
      return { allowed: false, error: `Domain '${host}' is not in network allowlist` };
    } catch (e) {
      return { allowed: false, error: e.message };
    }
  }
}

module.exports = {
  EnvironmentProvisioner,
  SecretInjector,
  RepositoryHydrator,
  BoundaryAllowlist
};
