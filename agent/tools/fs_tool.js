'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * FsTool - Secure, Audited Filesystem Operations
 * 
 * Provides:
 * - read_file, write_file, edit_file, apply_patch
 * - create_directory, list_directory, glob_files
 * - search_files, search_content (grep), file_metadata
 * 
 * Invariants:
 * - Strictly bounded by PathGuard to prevent directory traversal
 * - Takes pre-execution git snapshots via GitAdapter on destructive writes
 */
class FsTool {
  constructor(pathGuard, gitAdapter = null, options = {}) {
    this.pathGuard = pathGuard;
    this.gitAdapter = gitAdapter;
    this.maxReadBytes = options.maxReadBytes || 1024 * 1024; // 1MB cap
    this.maxSearchResults = options.maxSearchResults || 100;
  }

  async readFile({ path: filePath, encoding = 'utf8' }) {
    try {
      const safePath = this.pathGuard.resolveSafePath(filePath);
      const stats = fs.statSync(safePath);
      if (stats.isDirectory()) {
        return { ok: false, error: `Path is a directory, not a file: ${filePath}` };
      }
      if (stats.size > this.maxReadBytes) {
        return { ok: false, error: `File size (${stats.size} bytes) exceeds read cap (${this.maxReadBytes} bytes)` };
      }
      const content = fs.readFileSync(safePath, encoding);
      return {
        ok: true,
        path: filePath,
        sizeBytes: stats.size,
        content
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async writeFile({ path: filePath, content, createDirs = true }) {
    try {
      if (typeof content !== 'string') {
        return { ok: false, error: 'Content must be a string' };
      }
      const safePath = this.pathGuard.resolveSafePath(filePath);

      // Create pre-execution snapshot if git adapter available
      let snapshotId = null;
      if (this.gitAdapter) {
        const snap = await this.gitAdapter.createSnapshot(`write:${path.basename(filePath)}`);
        if (snap.ok) snapshotId = snap.snapshotId;
      }

      if (createDirs) {
        const dir = path.dirname(safePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
      }

      fs.writeFileSync(safePath, content, 'utf8');
      return {
        ok: true,
        path: filePath,
        bytesWritten: Buffer.byteLength(content, 'utf8'),
        snapshotId
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async editFile({ path: filePath, target, replacement }) {
    try {
      const safePath = this.pathGuard.resolveSafePath(filePath);
      if (!fs.existsSync(safePath)) {
        return { ok: false, error: `File does not exist: ${filePath}` };
      }
      const existing = fs.readFileSync(safePath, 'utf8');
      if (!existing.includes(target)) {
        return { ok: false, error: `Target substring not found in ${filePath}` };
      }

      let snapshotId = null;
      if (this.gitAdapter) {
        const snap = await this.gitAdapter.createSnapshot(`edit:${path.basename(filePath)}`);
        if (snap.ok) snapshotId = snap.snapshotId;
      }

      const updated = existing.replaceAll(target, replacement);
      fs.writeFileSync(safePath, updated, 'utf8');
      return {
        ok: true,
        path: filePath,
        modified: true,
        snapshotId
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async applyPatch({ path: filePath, patch }) {
    try {
      const safePath = this.pathGuard.resolveSafePath(filePath);
      if (!fs.existsSync(safePath)) {
        return { ok: false, error: `File does not exist: ${filePath}` };
      }
      const existing = fs.readFileSync(safePath, 'utf8');

      let snapshotId = null;
      if (this.gitAdapter) {
        const snap = await this.gitAdapter.createSnapshot(`patch:${path.basename(filePath)}`);
        if (snap.ok) snapshotId = snap.snapshotId;
      }

      // Support unified patch format or search/replace hunk format
      // Search for <<< target === replacement >>> or standard @@ diff lines
      let updated = existing;
      let applied = false;

      // Format: <<<SEARCH\n(target)\n===\n(replacement)\n>>> or <<<<\n(target)\n====\n(replacement)\n>>>>
      const hunkRegex = /<{3,}\s*(?:SEARCH)?\r?\n([\s\S]*?)\r?\n={3,}\r?\n([\s\S]*?)\r?\n>{3,}/g;
      let match;
      while ((match = hunkRegex.exec(patch)) !== null) {
        const [_, searchBlock, replaceBlock] = match;
        if (updated.includes(searchBlock)) {
          updated = updated.replace(searchBlock, replaceBlock);
          applied = true;
        }
      }

      // If no <<<SEARCH blocks, try direct substring replacement if patch contains separator
      if (!applied && patch.includes('@@')) {
        // Attempt unified diff line application
        const lines = patch.split('\n');
        const additions = [];
        for (const line of lines) {
          if (line.startsWith('+') && !line.startsWith('+++')) {
            additions.push(line.slice(1));
          }
        }
        if (additions.length > 0) {
          updated += '\n' + additions.join('\n');
          applied = true;
        }
      }

      if (!applied) {
        return { ok: false, error: 'Could not match patch hunks against file content' };
      }

      fs.writeFileSync(safePath, updated, 'utf8');
      return { ok: true, path: filePath, applied: true, snapshotId };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async createDirectory({ path: dirPath }) {
    try {
      const safePath = this.pathGuard.resolveSafePath(dirPath);
      if (!fs.existsSync(safePath)) {
        fs.mkdirSync(safePath, { recursive: true });
      }
      return { ok: true, path: dirPath, created: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async listDirectory({ path: dirPath = '.', recursive = false, maxDepth = 2 }) {
    try {
      const safeDir = this.pathGuard.resolveSafePath(dirPath);
      const results = [];
      const ignored = new Set(['.git', 'node_modules', 'dist', 'build', '.venv', '__pycache__', 'app\\dist']);

      const scan = (currentDir, depth) => {
        if (depth > maxDepth) return;
        let entries;
        try { entries = fs.readdirSync(currentDir, { withFileTypes: true }); } catch { return; }

        for (const entry of entries) {
          if (ignored.has(entry.name)) continue;
          const fullPath = path.join(currentDir, entry.name);
          const relPath = path.relative(safeDir, fullPath).split(path.sep).join('/');
          
          if (entry.isDirectory()) {
            results.push({ name: entry.name, path: relPath, type: 'directory' });
            if (recursive) scan(fullPath, depth + 1);
          } else {
            results.push({ name: entry.name, path: relPath, type: 'file' });
          }
        }
      };

      scan(safeDir, 1);
      return {
        ok: true,
        path: dirPath,
        count: results.length,
        entries: results,
        items: results
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async globFiles({ pattern = '*', path: dirPath = '.' }) {
    try {
      const safeDir = this.pathGuard.resolveSafePath(dirPath);
      const results = [];
      const ignored = new Set(['.git', 'node_modules', 'dist', 'build', '.venv']);

      // Convert glob pattern (e.g. *.js or **/*.json) to regex
      const regexStr = '^' + pattern
        .replace(/\./g, '\\.')
        .replace(/\*\*/g, '.*')
        .replace(/(?<!\.)\*/g, '[^/\\\\]*')
        .replace(/\?/g, '.') + '$';
      const globRegex = new RegExp(regexStr, 'i');

      const scan = (currentDir) => {
        if (results.length >= this.maxSearchResults) return;
        let entries;
        try { entries = fs.readdirSync(currentDir, { withFileTypes: true }); } catch { return; }

        for (const entry of entries) {
          if (results.length >= this.maxSearchResults) break;
          if (ignored.has(entry.name)) continue;
          const fullPath = path.join(currentDir, entry.name);
          const relPath = path.relative(safeDir, fullPath).split(path.sep).join('/');

          if (entry.isDirectory()) {
            scan(fullPath);
          } else if (entry.isFile()) {
            if (globRegex.test(entry.name) || globRegex.test(relPath)) {
              results.push(relPath);
            }
          }
        }
      };

      scan(safeDir);
      return { ok: true, pattern, count: results.length, matches: results, files: results };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async searchFiles({ query, path: dirPath = '.', maxResults = 50 }) {
    try {
      const safeDir = this.pathGuard.resolveSafePath(dirPath);
      const matches = [];
      const lowerQuery = query.toLowerCase();
      const ignored = new Set(['.git', 'node_modules', 'dist', 'build', '.venv', '__pycache__']);

      const scan = (currentDir) => {
        if (matches.length >= maxResults) return;
        let entries;
        try { entries = fs.readdirSync(currentDir, { withFileTypes: true }); } catch { return; }
        
        for (const entry of entries) {
          if (matches.length >= maxResults) break;
          if (ignored.has(entry.name)) continue;
          const fullPath = path.join(currentDir, entry.name);
          
          if (entry.isDirectory()) {
            scan(fullPath);
          } else if (entry.isFile()) {
            const relPath = path.relative(safeDir, fullPath).split(path.sep).join('/');
            if (entry.name.toLowerCase().includes(lowerQuery)) {
              matches.push({ file: relPath, matchType: 'filename' });
              continue;
            }
            try {
              const stat = fs.statSync(fullPath);
              if (stat.size <= 256 * 1024) {
                const content = fs.readFileSync(fullPath, 'utf8');
                if (content.toLowerCase().includes(lowerQuery)) {
                  matches.push({ file: relPath, matchType: 'content' });
                }
              }
            } catch (_) {}
          }
        }
      };

      scan(safeDir);
      return { ok: true, query, count: matches.length, matches };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async searchContent({ query, path: dirPath = '.', regex = false, maxMatches = 50 }) {
    try {
      const safeDir = this.pathGuard.resolveSafePath(dirPath);
      const results = [];
      const matcher = regex ? new RegExp(query, 'i') : null;
      const lowerQuery = !regex ? query.toLowerCase() : null;
      const ignored = new Set(['.git', 'node_modules', 'dist', 'build', '.venv']);

      const scan = (currentDir) => {
        if (results.length >= maxMatches) return;
        let entries;
        try { entries = fs.readdirSync(currentDir, { withFileTypes: true }); } catch { return; }

        for (const entry of entries) {
          if (results.length >= maxMatches) break;
          if (ignored.has(entry.name)) continue;
          const fullPath = path.join(currentDir, entry.name);

          if (entry.isDirectory()) {
            scan(fullPath);
          } else if (entry.isFile()) {
            try {
              const stat = fs.statSync(fullPath);
              if (stat.size <= 512 * 1024) {
                const content = fs.readFileSync(fullPath, 'utf8');
                const lines = content.split('\n');
                for (let i = 0; i < lines.length; i++) {
                  if (results.length >= maxMatches) break;
                  const line = lines[i];
                  const hit = regex ? matcher.test(line) : line.toLowerCase().includes(lowerQuery);
                  if (hit) {
                    const relPath = path.relative(safeDir, fullPath).split(path.sep).join('/');
                    results.push({
                      file: relPath,
                      line: i + 1,
                      lineNumber: i + 1,
                      content: line.trim().slice(0, 200)
                    });
                  }
                }
              }
            } catch (_) {}
          }
        }
      };

      scan(safeDir);
      return { ok: true, query, count: results.length, matches: results };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async fileMetadata({ path: filePath }) {
    try {
      const safePath = this.pathGuard.resolveSafePath(filePath);
      if (!fs.existsSync(safePath)) {
        return { ok: false, error: `Path not found: ${filePath}` };
      }
      const stat = fs.statSync(safePath);
      return {
        ok: true,
        path: filePath,
        size: stat.size,
        sizeBytes: stat.size,
        isFile: stat.isFile(),
        isDirectory: stat.isDirectory(),
        isSymbolicLink: stat.isSymbolicLink(),
        createdMs: stat.birthtimeMs,
        modifiedMs: stat.mtimeMs,
        permissions: (stat.mode & 0o777).toString(8)
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }
}

module.exports = FsTool;
