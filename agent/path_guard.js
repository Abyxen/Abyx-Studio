'use strict';

const path = require('node:path');
const fs = require('node:fs');

/**
 * PathGuard - Robust Filesystem Boundary Enforcer
 * Enforces strict directory containment, prevents traversal (../),
 * resolves canonical paths, and protects Windows system paths.
 */
class PathGuard {
  constructor(options = {}) {
    this.approvedRoots = (options.approvedRoots || [process.cwd()])
      .map(r => this._normalize(r))
      .filter(Boolean);
    
    // Windows protected system paths
    this.systemBlacklist = [
      'C:\\Windows',
      'C:\\Program Files',
      'C:\\Program Files (x86)',
      'C:\\ProgramData'
    ].map(p => p.toLowerCase());
  }

  _normalize(p) {
    if (!p || typeof p !== 'string') return '';
    try {
      const resolved = path.resolve(p);
      return path.normalize(resolved);
    } catch (_) {
      return '';
    }
  }

  isPathWithin(targetPath, rootDir) {
    const normTarget = this._normalize(targetPath).toLowerCase();
    const normRoot = this._normalize(rootDir).toLowerCase();
    if (!normTarget || !normRoot) return false;
    
    // Exact match or prefix with directory separator
    return normTarget === normRoot || normTarget.startsWith(normRoot.endsWith(path.sep) ? normRoot : normRoot + path.sep);
  }

  isSystemBlacklisted(targetPath) {
    const norm = this._normalize(targetPath).toLowerCase();
    return this.systemBlacklist.some(sys => norm === sys || norm.startsWith(sys + path.sep));
  }

  resolveSafePath(targetPath, customBase = null) {
    if (!targetPath || typeof targetPath !== 'string') {
      throw new Error('PathGuard: Path must be a non-empty string');
    }

    // Check for null bytes / injection characters
    if (targetPath.includes('\0')) {
      throw new Error('PathGuard: Null byte injection detected');
    }

    const base = customBase ? this._normalize(customBase) : this.approvedRoots[0] || process.cwd();
    const resolved = path.isAbsolute(targetPath) ? this._normalize(targetPath) : this._normalize(path.join(base, targetPath));

    if (this.isSystemBlacklisted(resolved)) {
      throw new Error(`PathGuard: Access to protected system path denied: ${resolved}`);
    }

    // Must reside within at least one approved root
    const isApproved = this.approvedRoots.some(root => this.isPathWithin(resolved, root));
    if (!isApproved && this.approvedRoots.length > 0) {
      throw new Error(`PathGuard: Path is outside approved workspace roots: ${resolved}`);
    }

    return resolved;
  }

  assertSafePath(targetPath, customBase = null) {
    return this.resolveSafePath(targetPath, customBase);
  }

  addApprovedRoot(newRoot) {
    const norm = this._normalize(newRoot);
    if (norm && !this.approvedRoots.includes(norm)) {
      this.approvedRoots.push(norm);
    }
  }
}

module.exports = PathGuard;
