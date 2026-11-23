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
      this.approvedRoots = approvedRoots.map(r => path.resolve(r));
    } else if (typeof approvedRoots === 'string') {
      this.approvedRoots = [path.resolve(approvedRoots)];
    } else {
      this.approvedRoots = [defaultWorkspace];
    }
  }

  /**
   * Primary approved root directory
   */
  get defaultRoot() {
    return this.approvedRoots[0];
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

    // 2. Normalize and strip surrounding quotes/whitespace
    let clean = inputPath.trim().replace(/^['"]|['"]$/g, '');

    // 3. Reject Windows device names (CON, PRN, AUX, NUL, COM1..9, LPT1..9)
    const baseName = path.basename(clean);
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(baseName)) {
      throw new Error(`Security Violation: Reserved device name not permitted: "${baseName}"`);
    }

    // 4. Resolve against active base root
    const baseRoot = options.baseDir ? path.resolve(options.baseDir) : this.defaultRoot;
    let candidate;

    if (path.isAbsolute(clean)) {
      candidate = path.normalize(clean);
    } else {
      candidate = path.normalize(path.join(baseRoot, clean));
    }

    // 5. Containment Check: Verify candidate begins with one of the approved roots
    const isContained = this.approvedRoots.some(root => {
      const normRoot = path.normalize(root).toLowerCase();
      const normCandidate = candidate.toLowerCase();
      return normCandidate === normRoot || normCandidate.startsWith(normRoot + path.sep);
    });

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

    // 7. Symlink escape check for existing paths
    if (fs.existsSync(candidate)) {
      try {
        const canonical = fs.realpathSync(candidate);
        const isCanonicalContained = this.approvedRoots.some(root => {
          const normRoot = path.normalize(root).toLowerCase();
          const normCanonical = canonical.toLowerCase();
          return normCanonical === normRoot || normCanonical.startsWith(normRoot + path.sep);
        });

        if (!isCanonicalContained) {
          throw new Error(`Security Violation: Symlink escapes approved workspace boundary: "${inputPath}" -> "${canonical}"`);
        }
        return canonical;
      } catch (err) {
        if (err.message.includes('Security Violation')) throw err;
        // Fall back to normalized candidate if realpath inspection failed on valid file
      }
    } else if (options.allowCreate) {
      // For paths to be created, ensure the parent directory is valid and contained
      const parentDir = path.dirname(candidate);
      if (fs.existsSync(parentDir)) {
        const canonicalParent = fs.realpathSync(parentDir);
        const isParentContained = this.approvedRoots.some(root => {
          const normRoot = path.normalize(root).toLowerCase();
          const normParent = canonicalParent.toLowerCase();
          return normParent === normRoot || normParent.startsWith(normRoot + path.sep);
        });
        if (!isParentContained) {
          throw new Error(`Security Violation: Target directory resolves outside approved workspace boundary`);
        }
      }
    }

    return candidate;
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
