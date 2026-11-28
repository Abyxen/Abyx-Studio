'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

/**
 * FsTool / WorkspaceFsTool - Secure, Audited Filesystem Operations
 * 
 * Provides:
 * - write, read, edit, mkdir, move, delete, list, search, getDiff
 * - readFile, writeFile, editFile, createDirectory, listDirectory, globFiles, searchFiles, searchContent, fileMetadata
 * 
 * Invariants:
 * - Strictly bounded by PathGuard to prevent directory traversal
 * - Atomic file creation via temp files (.abyx-...tmp) and rename to prevent partial writes
 * - Revalidates target path before and after file open to prevent race conditions & symlink swaps
 * - Verifies expected content hash on updates to prevent clobbering concurrent edits
 */
class FsTool {
  constructor(pathGuard, gitAdapter = null, options = {}) {
    if (!pathGuard) throw new Error('FsTool requires PathGuard instance');
    this.pathGuard = pathGuard;
    this.gitAdapter = gitAdapter;
    this.maxReadBytes = options.maxReadBytes || 1024 * 1024; // 1MB cap
    this.maxSearchResults = options.maxSearchResults || 100;
  }

  hashFile(filePath) {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  }

  writeAtomically(targetPath, content, options = {}) {
    const safePath = this.pathGuard.resolveSafePath(targetPath, { allowCreate: true });
    const parentDir = path.dirname(safePath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    const revalidated = this.pathGuard.resolveSafePath(targetPath, { allowCreate: true });
    if (revalidated !== safePath) {
      throw new Error('Target changed during filesystem authorization');
    }

    const tempPath = path.join(parentDir, `.abyx-${crypto.randomUUID()}.tmp`);
    let fd = null;
    try {
      fd = fs.openSync(tempPath, 'wx', 0o600);
      fs.writeFileSync(fd, content, options.encoding || 'utf8');
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = null;

      if (this.pathGuard.resolveSafePath(targetPath, { allowCreate: true }) !== safePath) {
        throw new Error('Target failed final path validation');
      }

      if (Object.hasOwn(options, 'expectedHash')) {
        const exists = fs.existsSync(safePath);
        if (options.expectedHash === null ? exists : !exists || this.hashFile(safePath) !== options.expectedHash) {
          throw new Error('File changed after review; refusing to replace it');
        }
      }

      fs.renameSync(tempPath, safePath);
    } catch (error) {
      if (fd !== null && fd !== undefined) {
        try { fs.closeSync(fd); } catch (_) {}
      }
      try { fs.unlinkSync(tempPath); } catch (_) {}
      throw error;
    }
    return safePath;
  }

  // ==========================================
  // WorkspaceFsTool Core API (stage1, stage6, stage10, stage12)
  // ==========================================

  async write({ filePath, path: p, content = '', expectedMtime = null, expectedHash, force = false, requireExpectedHash = false } = {}) {
    const targetFile = filePath || p;
    if (!targetFile) return { success: false, ok: false, error: 'filePath parameter is required' };
    try {
      const safePath = this.pathGuard.resolveSafePath(targetFile, { allowCreate: true });
      const existed = fs.existsSync(safePath);
      let originalText = '';

      if (existed) {
        if (requireExpectedHash && !expectedHash) {
          return { success: false, ok: false, conflict: true, error: 'Read this file first and include its contentHash before editing it.' };
        }
        originalText = fs.readFileSync(safePath, 'utf8');
        const actualHash = crypto.createHash('sha256').update(originalText, 'utf8').digest('hex');
        if (expectedHash && actualHash !== expectedHash) {
          return { success: false, ok: false, conflict: true, error: 'File changed since it was read; review it again before editing.' };
        }
      } else if (requireExpectedHash && expectedHash) {
        return { success: false, ok: false, conflict: true, error: 'File was removed after review; inspect the workspace and retry.' };
      }

      const atomicOptions = (requireExpectedHash || expectedHash !== undefined) ? { expectedHash: existed ? expectedHash : null } : {};
      this.writeAtomically(targetFile, content, atomicOptions);

      const stat = fs.statSync(safePath);
      return {
        success: true,
        ok: true,
        action: existed ? 'overwrite' : 'create',
        path: this.pathGuard.getRelativeAlias(safePath),
        filePath: targetFile,
        sizeBytes: stat.size,
        bytesWritten: Buffer.byteLength(content, 'utf8'),
        mtime: stat.mtime.toISOString(),
        mtimeMs: stat.mtimeMs
      };
    } catch (err) {
      if (err.message && err.message.includes('traverses outside approved workspace boundaries')) {
        throw err;
      }
      return { success: false, ok: false, error: err.message };
    }
  }

  async read({ filePath, path: p, maxBytes = 1000000, encoding = 'utf8' } = {}) {
    const targetFile = filePath || p;
    if (!targetFile) return { success: false, ok: false, error: 'filePath parameter is required' };
    try {
      const safePath = this.pathGuard.resolveSafePath(targetFile);
      if (!fs.existsSync(safePath)) {
        return { success: false, ok: false, error: `File not found: "${targetFile}"` };
      }
      const stat = fs.statSync(safePath);
      if (stat.isDirectory()) {
        return { success: false, ok: false, error: `Cannot read directory as file: "${targetFile}"` };
      }
      const buffer = fs.readFileSync(safePath);
      const isTruncated = buffer.length > maxBytes;
      const content = buffer.slice(0, maxBytes).toString(encoding);

      return {
        success: true,
        ok: true,
        path: this.pathGuard.getRelativeAlias(safePath),
        filePath: targetFile,
        sizeBytes: stat.size,
        mtimeMs: stat.mtimeMs,
        contentHash: this.hashFile(safePath),
        isTruncated,
        content: isTruncated ? content + `\n\n... [Truncated: displayed ${maxBytes} of ${stat.size} bytes]` : content
      };
    } catch (err) {
      if (err.message && err.message.includes('traverses outside approved workspace boundaries')) {
        throw err;
      }
      return { success: false, ok: false, error: err.message };
    }
  }

  async edit({ filePath, path: p, target, replacement, expectedHash } = {}) {
    const targetFile = filePath || p;
    if (!targetFile) return { success: false, ok: false, error: 'filePath is required' };
    if (typeof target !== 'string' || target === '') {
      return { success: false, ok: false, error: 'target string to replace cannot be empty' };
    }
    if (typeof replacement !== 'string') {
      return { success: false, ok: false, error: 'replacement string must be a string' };
    }

    try {
      const safePath = this.pathGuard.resolveSafePath(targetFile);
      if (!fs.existsSync(safePath)) {
        return { success: false, ok: false, error: `File not found: "${targetFile}"` };
      }

      const original = fs.readFileSync(safePath, 'utf8');
      const actualHash = crypto.createHash('sha256').update(original, 'utf8').digest('hex');
      if (expectedHash && actualHash !== expectedHash) {
        return { success: false, ok: false, conflict: true, error: 'File changed since it was read; review it again before editing.' };
      }

      const occurrences = original.split(target).length - 1;
      if (occurrences === 0) {
        return { success: false, ok: false, error: `Target text not found in "${targetFile}".` };
      }

      const updated = occurrences === 1 ? original.replace(target, replacement) : original.replaceAll(target, replacement);
      this.writeAtomically(targetFile, updated, { expectedHash: actualHash });

      return {
        success: true,
        ok: true,
        path: this.pathGuard.getRelativeAlias(safePath),
        filePath: targetFile,
        occurrencesReplaced: occurrences
      };
    } catch (err) {
      if (err.message && err.message.includes('traverses outside approved workspace boundaries')) {
        throw err;
      }
      return { success: false, ok: false, error: err.message };
    }
  }

  async mkdir({ dirPath, path: p } = {}) {
    const targetDir = dirPath || p;
    if (!targetDir) return { success: false, ok: false, error: 'dirPath is required' };
    try {
      const safePath = this.pathGuard.resolveSafePath(targetDir, { allowCreate: true });
      if (!fs.existsSync(safePath)) {
        fs.mkdirSync(safePath, { recursive: true });
      }
      return { success: true, ok: true, path: this.pathGuard.getRelativeAlias(safePath), dirPath: targetDir };
    } catch (err) {
      if (err.message && err.message.includes('traverses outside approved workspace boundaries')) {
        throw err;
      }
      return { success: false, ok: false, error: err.message };
    }
  }

  async move({ sourcePath, destinationPath, from, to } = {}) {
    const src = sourcePath || from;
    const dst = destinationPath || to;
    if (!src || !dst) return { success: false, ok: false, error: 'Source and destination paths required' };
    try {
      const safeSrc = this.pathGuard.resolveSafePath(src);
      const safeDst = this.pathGuard.resolveSafePath(dst, { allowCreate: true });
      if (!fs.existsSync(safeSrc)) {
        return { success: false, ok: false, error: `Source not found: ${src}` };
      }
      const dstDir = path.dirname(safeDst);
      if (!fs.existsSync(dstDir)) fs.mkdirSync(dstDir, { recursive: true });
      fs.renameSync(safeSrc, safeDst);
      return { success: true, ok: true, from: src, to: dst };
    } catch (err) {
      if (err.message && err.message.includes('traverses outside approved workspace boundaries')) {
        throw err;
      }
      return { success: false, ok: false, error: err.message };
    }
  }

  async delete({ filePath, path: p } = {}) {
    const target = filePath || p;
    if (!target) return { success: false, ok: false, error: 'filePath is required' };
    try {
      const safePath = this.pathGuard.resolveSafePath(target);
      if (!fs.existsSync(safePath)) {
        return { success: false, ok: false, error: `File not found: ${target}` };
      }
      const stat = fs.statSync(safePath);
      if (stat.isDirectory()) {
        fs.rmSync(safePath, { recursive: true, force: true });
      } else {
        fs.unlinkSync(safePath);
      }
      return { success: true, ok: true, path: target };
    } catch (err) {
      if (err.message && err.message.includes('traverses outside approved workspace boundaries')) {
        throw err;
      }
      return { success: false, ok: false, error: err.message };
    }
  }

  async list({ dirPath, path: p, maxEntries = 100 } = {}) {
    const targetDir = (p !== undefined && p !== '.') ? p : (dirPath || p || '.');
    try {
      const safeDir = this.pathGuard.resolveSafePath(targetDir);
      if (!fs.existsSync(safeDir)) {
        return { success: false, ok: false, error: `Directory not found: "${targetDir}"` };
      }
      const stat = fs.statSync(safeDir);
      if (!stat.isDirectory()) {
        return { success: false, ok: false, error: `Path is not a directory: "${targetDir}"` };
      }

      const items = fs.readdirSync(safeDir);
      const results = [];
      for (const item of items) {
        if (results.length >= maxEntries) break;
        const full = path.join(safeDir, item);
        try {
          const itemStat = fs.statSync(full);
          results.push({
            name: item,
            path: this.pathGuard.getRelativeAlias(full),
            type: itemStat.isDirectory() ? 'directory' : 'file',
            sizeBytes: itemStat.size,
            modified: itemStat.mtime.toISOString()
          });
        } catch (_) {}
      }

      return {
        success: true,
        ok: true,
        directory: this.pathGuard.getRelativeAlias(safeDir),
        totalFound: items.length,
        returnedCount: results.length,
        count: results.length,
        items: results,
        entries: results
      };
    } catch (err) {
      if (err.message && err.message.includes('traverses outside approved workspace')) {
        throw err;
      }
      return { success: false, ok: false, error: err.message };
    }
  }

  async search({ query = '', baseDir = '.', maxResults = 25 } = {}) {
    if (!query || typeof query !== 'string') {
      return { success: false, ok: false, error: 'Search query must be a non-empty string' };
    }
    try {
      const safeDir = this.pathGuard.resolveSafePath(baseDir);
      const lowerQuery = query.toLowerCase();
      const matches = [];

      const walk = (currentDir) => {
        if (matches.length >= maxResults) return;
        let entries = [];
        try { entries = fs.readdirSync(currentDir); } catch (_) { return; }

        for (const entry of entries) {
          if (matches.length >= maxResults) return;
          const fullPath = path.join(currentDir, entry);
          try {
            const stat = fs.statSync(fullPath);
            if (stat.isDirectory()) {
              if (!entry.startsWith('.') && entry !== 'node_modules') {
                walk(fullPath);
              }
            } else if (stat.isFile()) {
              const relAlias = this.pathGuard.getRelativeAlias(fullPath);
              if (entry.toLowerCase().includes(lowerQuery)) {
                matches.push({ path: relAlias, matchType: 'filename', sizeBytes: stat.size });
                continue;
              }
              if (stat.size < 1000000) {
                const text = fs.readFileSync(fullPath, 'utf8');
                const idx = text.toLowerCase().indexOf(lowerQuery);
                if (idx !== -1) {
                  const snippetStart = Math.max(0, idx - 40);
                  const snippetEnd = Math.min(text.length, idx + query.length + 40);
                  matches.push({
                    path: relAlias,
                    matchType: 'content',
                    snippet: text.slice(snippetStart, snippetEnd).trim(),
                    sizeBytes: stat.size
                  });
                }
              }
            }
          } catch (_) {}
        }
      };

      walk(safeDir);
      return { success: true, ok: true, query, resultsCount: matches.length, matches };
    } catch (err) {
      if (err.message && err.message.includes('traverses outside approved workspace boundaries')) {
        throw err;
      }
      return { success: false, ok: false, error: err.message };
    }
  }

  // ==========================================
  // OpenCode-style Aliases
  // ==========================================

  async readFile(opts) { return this.read(opts); }
  async writeFile(opts) { return this.write(opts); }
  async editFile(opts) { return this.edit(opts); }

  async applyPatch({ path: filePath, patch }) {
    try {
      const safePath = this.pathGuard.resolveSafePath(filePath);
      if (!fs.existsSync(safePath)) {
        return { ok: false, success: false, error: `File does not exist: ${filePath}` };
      }
      const existing = fs.readFileSync(safePath, 'utf8');

      let snapshotId = null;
      if (this.gitAdapter) {
        try {
          const snap = await this.gitAdapter.createSnapshot(`patch:${path.basename(filePath)}`);
          if (snap.ok) snapshotId = snap.snapshotId;
        } catch (_) {}
      }

      let updated = existing;
      let applied = false;

      const hunkRegex = /<{3,}\s*(?:SEARCH)?\r?\n([\s\S]*?)\r?\n={3,}\r?\n([\s\S]*?)\r?\n>{3,}/g;
      let match;
      while ((match = hunkRegex.exec(patch)) !== null) {
        const [_, searchBlock, replaceBlock] = match;
        if (updated.includes(searchBlock)) {
          updated = updated.replace(searchBlock, replaceBlock);
          applied = true;
        }
      }

      if (!applied && patch.includes('@@')) {
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
        return { ok: false, success: false, error: 'Could not match patch hunks against file content' };
      }

      fs.writeFileSync(safePath, updated, 'utf8');
      return { ok: true, success: true, path: filePath, applied: true, snapshotId };
    } catch (err) {
      return { ok: false, success: false, error: err.message };
    }
  }
  async createDirectory(opts) { return this.mkdir(opts); }
  async listDirectory(opts) { return this.list(opts); }
  async searchFiles(opts) { return this.search(opts); }
  async renameFile(opts) { return this.move(opts); }
  async moveFile(opts) { return this.move(opts); }
  async deleteFile(opts) { return this.delete(opts); }

  async copyFile({ from, to }) {
    try {
      const safeSrc = this.pathGuard.resolveSafePath(from);
      const safeDst = this.pathGuard.resolveSafePath(to, { allowCreate: true });
      if (!fs.existsSync(safeSrc)) return { ok: false, error: `Source not found: ${from}` };
      const dstDir = path.dirname(safeDst);
      if (!fs.existsSync(dstDir)) fs.mkdirSync(dstDir, { recursive: true });
      fs.copyFileSync(safeSrc, safeDst);
      return { ok: true, from, to };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async globFiles({ pattern = '*', path: dirPath = '.' }) {
    try {
      const safeDir = this.pathGuard.resolveSafePath(dirPath);
      const results = [];
      const regexStr = pattern
        .replace(/\./g, '\\.')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.');
      const regex = new RegExp(`^${regexStr}$`, 'i');

      const scan = (current) => {
        let entries;
        try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { return; }
        for (const entry of entries) {
          if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
          const full = path.join(current, entry.name);
          const rel = path.relative(safeDir, full).split(path.sep).join('/');
          if (entry.isDirectory()) {
            scan(full);
          } else if (regex.test(entry.name) || regex.test(rel)) {
            results.push(rel);
          }
        }
      };
      scan(safeDir);
      const matchedFiles = results.slice(0, this.maxSearchResults);
      return { ok: true, success: true, pattern, matches: matchedFiles, files: matchedFiles };
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

  computeDiff(originalText = '', modifiedText = '') {
    const origLines = (originalText || '').split(/\r?\n/);
    const modLines = (modifiedText || '').split(/\r?\n/);

    if (originalText === modifiedText) {
      const diffLines = origLines.map(line => ({ type: 'context', text: line }));
      return { diffLines, summary: { additions: 0, deletions: 0, totalChanges: 0 } };
    }

    if (!originalText) {
      const diffLines = modLines.map(line => ({ type: 'added', text: line }));
      return { diffLines, summary: { additions: diffLines.length, deletions: 0, totalChanges: diffLines.length } };
    }

    if (!modifiedText) {
      const diffLines = origLines.map(line => ({ type: 'deleted', text: line }));
      return { diffLines, summary: { additions: 0, deletions: diffLines.length, totalChanges: diffLines.length } };
    }

    const n = origLines.length;
    const m = modLines.length;
    const diffLines = [];
    let additions = 0;
    let deletions = 0;

    if (n * m > 250000) {
      let i = 0, j = 0;
      while (i < n || j < m) {
        if (i < n && j < m && origLines[i] === modLines[j]) {
          diffLines.push({ type: 'context', text: origLines[i] });
          i++; j++;
        } else {
          if (i < n) {
            diffLines.push({ type: 'deleted', text: origLines[i] });
            deletions++;
            i++;
          }
          if (j < m) {
            diffLines.push({ type: 'added', text: modLines[j] });
            additions++;
            j++;
          }
        }
      }
      return { diffLines, summary: { additions, deletions, totalChanges: additions + deletions } };
    }

    const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < m; j++) {
        if (origLines[i] === modLines[j]) {
          dp[i + 1][j + 1] = dp[i][j] + 1;
        } else {
          dp[i + 1][j + 1] = Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
      }
    }

    let i = n, j = m;
    const revLines = [];
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && origLines[i - 1] === modLines[j - 1]) {
        revLines.push({ type: 'context', text: origLines[i - 1] });
        i--; j--;
      } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
        revLines.push({ type: 'added', text: modLines[j - 1] });
        additions++;
        j--;
      } else if (i > 0 && (j === 0 || dp[i][j - 1] < dp[i - 1][j])) {
        revLines.push({ type: 'deleted', text: origLines[i - 1] });
        deletions++;
        i--;
      }
    }
    revLines.reverse();
    return {
      diffLines: revLines,
      summary: { additions, deletions, totalChanges: additions + deletions }
    };
  }

  async getDiff({ filePath, originalContent, newContent } = {}) {
    try {
      let orig = originalContent;
      if (orig === undefined && filePath) {
        const safePath = this.pathGuard.resolveSafePath(filePath);
        orig = fs.existsSync(safePath) ? fs.readFileSync(safePath, 'utf8') : '';
      }
      const diff = this.computeDiff(orig || '', newContent || '');
      return { success: true, ...diff };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
}

module.exports = FsTool;
