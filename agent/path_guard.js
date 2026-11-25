/**
 * ABYX Agentic Engine — Secure Path Guard
 * 
 * Enforces strict containment within approved workspace roots:
 * - Detects and blocks path traversal attempts (../, ..\, encoded traversal, null bytes)
 * - Resolves canonical realpath to prevent symlink escapes
 * - Blocks access to OS system locations (Windows, System32, Program Files, AppData)
 * - Blocks access to ABYX credentials, DPAPI vault, .env files, SSH keys, and Git internal objects
 */

const path = require('node:path');
const fs = require('node:fs');
const { workspaceDir } = require('../data_paths');

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

class PathGuard {
  /**
   * @param {string|string[]} approvedRoots - Base directories allowed for agent file access
   */
  constructor(approvedRoots = null) {
    const defaultWorkspace = workspaceDir;
    if (!fs.existsSync(defaultWorkspace)) {
      try { fs.mkdirSync(defaultWorkspace, { recursive: true }); } catch (e) {}
    }

    if (Array.isArray(approvedRoots) && approvedRoots.length > 0) {
      this.approvedRoots = approvedRoots.map(r => this.canonicalizeRoot(r));
    } else if (typeof approvedRoots === 'string') {
      this.approvedRoots = [this.canonicalizeRoot(approvedRoots)];
    } else {
      this.approvedRoots = [this.canonicalizeRoot(defaultWorkspace)];
    }
  }

  /**
   * Primary approved root directory
   */
  get defaultRoot() {
    return this.approvedRoots[0];
  }

  canonicalizeRoot(root) {
    const absolute = path.resolve(root);
    return fs.existsSync(absolute) ? fs.realpathSync.native(absolute) : absolute;
  }

  isContained(candidate, root) {
    const relative = path.relative(root, candidate);
    return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
  }

  /**
   * Validates and resolves a user or model-supplied path into a safe, contained absolute path.
   * Throws an Error if the path is malicious, attempts traversal, or accesses restricted secrets.
   * 
   * @param {string} inputPath - Raw path requested
   * @param {Object} options - { allowCreate: boolean, baseDir: string }
   * @returns {string} Fully resolved, verified safe canonical path
   */
  resolveSafePath(inputPath, options = {}) {
    if (!inputPath || typeof inputPath !== 'string') {
      throw new Error('Invalid path: path argument must be a non-empty string');
    }

    // 1. Detect null byte injection
    if (inputPath.includes('\0') || inputPath.includes('%00')) {
      throw new Error('Security Violation: Null byte detected in path');
    }

    // Detect NTFS Alternate Data Streams (e.g. file.txt:stream)
    const strippedDrive = inputPath.trim().replace(/^['"]|['"]$/g, '').replace(/^[a-zA-Z]:/, '');
    if (strippedDrive.includes(':')) {
      throw new Error('Security Violation: Stream syntax detected in path');
    }

    // 2. Normalize and strip surrounding quotes/whitespace
    let clean = inputPath.trim().replace(/^['"]|['"]$/g, '');

    // 3. Reject Windows device names (CON, PRN, AUX, NUL, COM1..9, LPT1..9)
    const baseName = path.basename(clean);
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(baseName)) {
      throw new Error(`Security Violation: Reserved device name not permitted: "${baseName}"`);
    }

    // 4. Resolve against active base root
    const baseRoot = options.baseDir ? this.resolveSafePath(options.baseDir) : this.defaultRoot;
    let candidate;

    if (path.isAbsolute(clean)) {
      candidate = path.normalize(clean);
    } else {
      candidate = path.normalize(path.join(baseRoot, clean));
    }

    // 5. Containment Check: Verify candidate begins with one of the approved roots
    const isContained = this.approvedRoots.some(root => this.isContained(candidate, root));

    if (!isContained) {
      throw new Error(`Security Violation: Path "${inputPath}" traverses outside approved workspace boundaries`);
    }

    // 6. Secret & Sensitive Pattern Inspection
    for (const pattern of RESTRICTED_PATH_PATTERNS) {
      // If pattern is a system path like /appdata/ and an approved root is located under it (e.g. temp dirs), skip
      if (pattern.source.includes('appdata') && this.approvedRoots.some(r => /appdata/i.test(r))) {
        continue;
      }
      if (pattern.test(candidate)) {
        throw new Error(`Security Violation: Access to sensitive file or directory is blocked: "${path.basename(candidate)}"`);
      }
    }

    const root = this.approvedRoots.find(item => this.isContained(candidate, item));
    if (!root) throw new Error('Security Violation: Path is outside approved workspace');
    let existing = candidate;
    const missing = [];
    while (true) {
      try {
        if (fs.lstatSync(existing).isSymbolicLink()) throw new Error('Security Violation: Symbolic link or junction in path');
        break;
      } catch (error) {
        if (error.message.startsWith('Security Violation:')) throw error;
        if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
        missing.unshift(path.basename(existing));
        const parent = path.dirname(existing);
        if (parent === existing) throw new Error('Security Violation: No existing path ancestor');
        existing = parent;
      }
    }
    const canonicalAncestor = fs.realpathSync.native(existing);
    if (!this.isContained(canonicalAncestor, root)) throw new Error('Security Violation: Existing ancestor escapes approved workspace');
    let walk = root;
    const relativeExisting = path.relative(root, existing);
    for (const part of relativeExisting.split(path.sep).filter(Boolean)) {
      walk = path.join(walk, part);
      if (fs.lstatSync(walk).isSymbolicLink()) throw new Error(`Security Violation: Symbolic link or junction in path: "${path.basename(walk)}"`);
    }
    const resolved = fs.existsSync(candidate) ? fs.realpathSync.native(candidate) : path.join(canonicalAncestor, ...missing);
    if (!this.isContained(resolved, root)) throw new Error('Security Violation: Resolved path escapes approved workspace');
    return resolved;
  }

  resolve(inputPath, options = {}) {
    return this.resolveSafePath(inputPath, options);
  }

  /**
   * Helper checking if a target path is strictly contained without throwing
   */
  isPathSafe(inputPath, options = {}) {
    try {
      this.resolveSafePath(inputPath, options);
      return true;
    } catch (e) {
      return false;
    }
  }

  isSafePath(inputPath, options = {}) {
    return this.isPathSafe(inputPath, options);
  }

  /**
   * Converts full path to user-friendly relative alias
   */
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
}

module.exports = PathGuard;
