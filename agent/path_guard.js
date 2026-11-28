'use strict';

const path = require('node:path');
const fs = require('node:fs');

// Patterns and file names strictly blocked from read/write/list operations
const RESTRICTED_PATH_PATTERNS = [
  /\.env(\..+)?$/i,
  /secure_vault/i,
  /\.enc$/i,
  /\.git([\\\/]|$)/i,
  /id_rsa/i,
  /id_ed25519/i,
  /credentials\.json/i,
  /ai_keys\.json/i,
  /abyx_memory\.db/i,
  /axom_memory\.db/i,
  /system32/i,
  /windows[\\\/]/i,
  /appdata/i
];

/**
 * PathGuard - Robust Filesystem Boundary Enforcer
 * Enforces strict directory containment, prevents traversal (../),
 * resolves canonical paths, protects Windows system paths, and blocks symlink escapes.
 */
class PathGuard {
  constructor(options = null) {
    let rawRoots = [];
    if (typeof options === 'string') {
      rawRoots = [options];
    } else if (Array.isArray(options)) {
      rawRoots = options;
    } else if (options && typeof options === 'object') {
      if (Array.isArray(options.approvedRoots)) {
        rawRoots = options.approvedRoots;
      } else if (typeof options.workspaceRoot === 'string') {
        rawRoots = [options.workspaceRoot];
      }
    }

    if (!rawRoots.length) {
      rawRoots = [process.cwd()];
    }

    this.approvedRoots = rawRoots
      .map(r => this.canonicalizeRoot(r))
      .filter(Boolean);

    // Windows protected system paths
    this.systemBlacklist = [
      'C:\\Windows',
      'C:\\Program Files',
      'C:\\Program Files (x86)',
      'C:\\ProgramData'
    ].map(p => p.toLowerCase());
  }

  get defaultRoot() {
    return this.approvedRoots[0] || process.cwd();
  }

  canonicalizeRoot(root) {
    if (!root || typeof root !== 'string') return '';
    try {
      const absolute = path.resolve(root);
      return fs.existsSync(absolute) ? fs.realpathSync.native(absolute) : absolute;
    } catch (_) {
      return path.resolve(root);
    }
  }

  _normalize(p) {
    if (!p || typeof p !== 'string') return '';
    try {
      return path.normalize(path.resolve(p));
    } catch (_) {
      return '';
    }
  }

  isContained(candidate, root) {
    const normCand = this._normalize(candidate).toLowerCase();
    const normRoot = this._normalize(root).toLowerCase();
    if (!normCand || !normRoot) return false;
    return normCand === normRoot || normCand.startsWith(normRoot.endsWith(path.sep) ? normRoot : normRoot + path.sep);
  }

  isPathWithin(targetPath, rootDir) {
    return this.isContained(targetPath, rootDir);
  }

  isSystemBlacklisted(targetPath) {
    const norm = this._normalize(targetPath).toLowerCase();
    return this.systemBlacklist.some(sys => norm === sys || norm.startsWith(sys + path.sep));
  }

  resolveSafePath(targetPath, optionsOrBase = {}) {
    if (!targetPath || typeof targetPath !== 'string') {
      throw new Error('PathGuard: Path must be a non-empty string');
    }

    if (targetPath.includes('\0') || targetPath.includes('%00')) {
      throw new Error('Security Violation: Null byte detected in path');
    }

    const strippedDrive = targetPath.trim().replace(/^['"]|['"]$/g, '').replace(/^[a-zA-Z]:/, '');
    if (strippedDrive.includes(':')) {
      throw new Error('Security Violation: Stream syntax detected in path');
    }

    let clean = targetPath.trim().replace(/^['"]|['"]$/g, '');

    const baseName = path.basename(clean);
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(baseName)) {
      throw new Error(`Security Violation: Reserved device name not permitted: "${baseName}"`);
    }

    const options = typeof optionsOrBase === 'string' ? { baseDir: optionsOrBase } : (optionsOrBase || {});
    const baseRoot = options.baseDir ? this.canonicalizeRoot(options.baseDir) : this.defaultRoot;

    let candidate;
    if (path.isAbsolute(clean)) {
      candidate = path.normalize(clean);
    } else {
      candidate = path.normalize(path.join(baseRoot, clean));
    }

    if (this.isSystemBlacklisted(candidate)) {
      throw new Error(`Security Violation: Access to protected system path denied: ${candidate}`);
    }

    const root = this.approvedRoots.find(item => this.isContained(candidate, item));
    if (!root) {
      throw new Error(`Security Violation: Path "${targetPath}" traverses outside approved workspace boundaries and roots (denied)`);
    }

    // Secret patterns inspection
    for (const pattern of RESTRICTED_PATH_PATTERNS) {
      if (pattern.source.includes('appdata') && this.approvedRoots.some(r => /appdata/i.test(r))) {
        continue;
      }
      if (pattern.test(candidate)) {
        throw new Error(`Security Violation: Access to sensitive file or directory is blocked: "${path.basename(candidate)}"`);
      }
    }

    // Symlink escape inspection
    let existing = candidate;
    const missing = [];
    while (true) {
      try {
        if (fs.lstatSync(existing).isSymbolicLink()) {
          throw new Error('Security Violation: Symbolic link or junction in path');
        }
        break;
      } catch (error) {
        if (error.message && error.message.startsWith('Security Violation:')) throw error;
        if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
        missing.unshift(path.basename(existing));
        const parent = path.dirname(existing);
        if (parent === existing) throw new Error('Security Violation: No existing path ancestor');
        existing = parent;
      }
    }

    const canonicalAncestor = fs.existsSync(existing) ? fs.realpathSync.native(existing) : existing;
    if (!this.isContained(canonicalAncestor, root)) {
      throw new Error('Security Violation: Existing ancestor escapes approved workspace');
    }

    let walk = root;
    const relativeExisting = path.relative(root, existing);
    for (const part of relativeExisting.split(path.sep).filter(Boolean)) {
      walk = path.join(walk, part);
      if (fs.existsSync(walk) && fs.lstatSync(walk).isSymbolicLink()) {
        throw new Error(`Security Violation: Symbolic link or junction in path: "${path.basename(walk)}"`);
      }
    }

    const resolved = fs.existsSync(candidate)
      ? fs.realpathSync.native(candidate)
      : path.join(canonicalAncestor, ...missing);

    if (!this.isContained(resolved, root)) {
      throw new Error('Security Violation: Resolved path escapes approved workspace');
    }

    return resolved;
  }

  assertSafePath(targetPath, options = {}) {
    return this.resolveSafePath(targetPath, options);
  }

  isPathSafe(targetPath, options = {}) {
    try {
      this.resolveSafePath(targetPath, options);
      return true;
    } catch (_) {
      return false;
    }
  }

  isSafePath(targetPath, options = {}) {
    return this.isPathSafe(targetPath, options);
  }

  getRelativeAlias(fullPath) {
    if (!fullPath) return '';
    for (const root of this.approvedRoots) {
      const normRoot = path.normalize(root).toLowerCase();
      const normPath = path.normalize(fullPath).toLowerCase();
      if (normPath.startsWith(normRoot)) {
        const rel = path.relative(root, fullPath);
        return rel.replace(/\\/g, '/') || '.';
      }
    }
    return path.basename(fullPath);
  }

  addApprovedRoot(newRoot) {
    const norm = this.canonicalizeRoot(newRoot);
    if (norm && !this.approvedRoots.includes(norm)) {
      this.approvedRoots.push(norm);
    }
  }
}

module.exports = PathGuard;
