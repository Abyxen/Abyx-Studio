/**
 * ABYX Agentic Engine — Restricted Workspace Filesystem Tool
 * 
 * Provides:
 * - fs_list: Directory listing with type, size, and entry limits
 * - fs_read: Safe file reading with 100KB truncation bounds
 * - fs_search: Filename and content search constrained to workspace
 * - fs_write: Safe file creation or updates within workspace
 * - fs_edit: Surgical text block find-and-replace within files
 * 
 * All actions are strictly validated through PathGuard.
 */

const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');

class WorkspaceFsTool {
  constructor(pathGuard) {
    if (!pathGuard) throw new Error('WorkspaceFsTool requires PathGuard instance');
    this.pathGuard = pathGuard;
  }

  hashFile(filePath) {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  }

  writeAtomically(targetPath, content, options = {}) {
    const safePath = this.pathGuard.resolveSafePath(targetPath, { allowCreate: true });
    const parentDir = path.dirname(safePath);
    if (!fs.existsSync(parentDir)) fs.mkdirSync(parentDir, { recursive: true });
    const revalidated = this.pathGuard.resolveSafePath(targetPath, { allowCreate: true });
    if (revalidated !== safePath) throw new Error('Target changed during filesystem authorization');
    const tempPath = path.join(parentDir, `.abyx-${crypto.randomUUID()}.tmp`);
    let fd;
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
      if (fd !== null && fd !== undefined) fs.closeSync(fd);
      try { fs.unlinkSync(tempPath); } catch (_) {}
      throw error;
    }
    return safePath;
  }

  /**
   * List files and folders inside an approved workspace directory
   */
  async list({ dirPath = '.', maxEntries = 100 } = {}) {
    const safeDir = this.pathGuard.resolveSafePath(dirPath);
    if (!fs.existsSync(safeDir)) {
      return { success: false, error: `Directory not found: "${dirPath}"` };
    }
    const stat = fs.statSync(safeDir);
    if (!stat.isDirectory()) {
      return { success: false, error: `Path is not a directory: "${dirPath}"` };
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
      } catch (e) {
        // Skip inaccessible entries
      }
    }

    return {
      success: true,
      directory: this.pathGuard.getRelativeAlias(safeDir),
      totalFound: items.length,
      returnedCount: results.length,
      entries: results
    };
  }

  /**
   * Read file contents with safety truncation
   */
  async read({ filePath, maxBytes = 100000 } = {}) {
    if (!filePath) return { success: false, error: 'filePath parameter is required' };
    const safePath = this.pathGuard.resolveSafePath(filePath);

    if (!fs.existsSync(safePath)) {
      return { success: false, error: `File not found: "${filePath}"` };
    }

    const stat = fs.statSync(safePath);
    if (stat.isDirectory()) {
      return { success: false, error: `Cannot read directory as file: "${filePath}"` };
    }

    const buffer = fs.readFileSync(safePath);
    const isTruncated = buffer.length > maxBytes;
    const content = buffer.slice(0, maxBytes).toString('utf8');

    return {
      success: true,
      path: this.pathGuard.getRelativeAlias(safePath),
      sizeBytes: stat.size,
      mtimeMs: stat.mtimeMs,
      contentHash: this.hashFile(safePath),
      isTruncated,
      content: isTruncated ? content + `\n\n... [Truncated: displayed ${maxBytes} of ${stat.size} bytes]` : content
    };
  }

  /**
   * Search for files by name pattern or file content
   */
  async search({ query = '', baseDir = '.', maxResults = 25 } = {}) {
    if (!query || typeof query !== 'string') {
      return { success: false, error: 'Search query must be a non-empty string' };
    }
    const safeDir = this.pathGuard.resolveSafePath(baseDir);
    const lowerQuery = query.toLowerCase();
    const matches = [];

    const walk = (currentDir) => {
      if (matches.length >= maxResults) return;
      let entries = [];
      try {
        entries = fs.readdirSync(currentDir);
      } catch (e) {
        return;
      }

      for (const entry of entries) {
        if (matches.length >= maxResults) return;
        const fullPath = path.join(currentDir, entry);
        try {
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) {
            // Avoid traversing hidden or node_modules directories
            if (!entry.startsWith('.') && entry !== 'node_modules') {
              walk(fullPath);
            }
          } else if (stat.isFile()) {
            const relAlias = this.pathGuard.getRelativeAlias(fullPath);
            // 1. Filename match
            if (entry.toLowerCase().includes(lowerQuery)) {
              matches.push({
                path: relAlias,
                matchType: 'filename',
                sizeBytes: stat.size
              });
              continue;
            }

            // 2. Content match (for files under 1MB)
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
        } catch (e) {}
      }
    };

    walk(safeDir);

    return {
      success: true,
      query,
      resultsCount: matches.length,
      matches
    };
  }

  /**
   * Helper: Check if a buffer appears to be binary
   */
  isBinary(buffer, filename = '') {
    if (filename && /\.(?:png|jpe?g|webp|gif|ico|bmp|tiff|pdf|exe|dll|zip|tar|gz|7z|wav|mp3|ogg|flac|mp4|mkv|webm|gguf|bin)$/i.test(filename)) {
      return true;
    }
    if (!buffer || buffer.length === 0) return false;
    const checkLen = Math.min(buffer.length, 1024);
    for (let i = 0; i < checkLen; i++) {
      if (buffer[i] === 0) return true;
    }
    return false;
  }

  /**
   * Compute unified line diff between files or strings
   */
  async getDiff({ filePath, newContent, originalContent = null } = {}) {
    let orig = originalContent;
    if (orig === null && filePath) {
      try {
        const safePath = this.pathGuard.resolveSafePath(filePath);
        orig = fs.existsSync(safePath) ? fs.readFileSync(safePath, 'utf8') : '';
      } catch (_) {
        orig = '';
      }
    }
    const diff = this.computeDiff(orig || '', newContent || '');
    return {
      success: true,
      diffLines: diff.diffLines,
      summary: diff.summary,
      originalContent: orig,
      newContent
    };
  }

  /**
   * Helper: Compute unified line diff between original and modified text
   */
  computeDiff(originalText, modifiedText) {
    const origLines = (originalText || '').split(/\r?\n/);
    const modLines = (modifiedText || '').split(/\r?\n/);
    const diffLines = [];
    let additions = 0;
    let deletions = 0;

    let oIdx = 0;
    let mIdx = 0;

    while (oIdx < origLines.length || mIdx < modLines.length) {
      if (oIdx < origLines.length && mIdx < modLines.length && origLines[oIdx] === modLines[mIdx]) {
        diffLines.push({ type: 'common', text: origLines[oIdx], oldLine: oIdx + 1, newLine: mIdx + 1 });
        oIdx++;
        mIdx++;
      } else {
        // Look ahead for matching anchors
        let matched = false;
        for (let lookahead = 1; lookahead <= 3; lookahead++) {
          if (mIdx + lookahead < modLines.length && oIdx < origLines.length && origLines[oIdx] === modLines[mIdx + lookahead]) {
            for (let k = 0; k < lookahead; k++) {
              diffLines.push({ type: 'added', text: modLines[mIdx + k], newLine: mIdx + k + 1 });
              additions++;
            }
            mIdx += lookahead;
            matched = true;
            break;
          }
        }
        if (!matched) {
          if (oIdx < origLines.length) {
            diffLines.push({ type: 'deleted', text: origLines[oIdx], oldLine: oIdx + 1 });
            deletions++;
            oIdx++;
          }
          if (mIdx < modLines.length) {
            diffLines.push({ type: 'added', text: modLines[mIdx], newLine: mIdx + 1 });
            additions++;
            mIdx++;
          }
        }
      }
    }

    return {
      diffLines,
      summary: { additions, deletions, totalChanges: additions + deletions }
    };
  }

  /**
   * Helper: Safely backup a file before destructive overwrite or edit
   */
  backupFile(safePath) {
    try {
      if (!fs.existsSync(safePath)) return null;
      const backupDir = path.join(path.dirname(safePath), '.abyx_backup');
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
      }
      if (fs.lstatSync(backupDir).isSymbolicLink() || !fs.lstatSync(backupDir).isDirectory()) return null;
      const filename = path.basename(safePath);
      const backupPath = path.join(backupDir, `${filename}.${crypto.randomUUID()}.bak`);
      fs.copyFileSync(this.pathGuard.resolveSafePath(safePath), backupPath, fs.constants.COPYFILE_EXCL);
      this.pathGuard.resolveSafePath(backupPath);
      return backupPath;
    } catch (_) {
      return null;
    }
  }

  /**
   * Atomic file write with conflict detection, backup, and diff generation
   */
  async write({ filePath, content = '', expectedMtime = null, expectedHash, force = false, requireExpectedHash = false } = {}) {
    if (!filePath) return { success: false, error: 'filePath parameter is required' };
    const safePath = this.pathGuard.resolveSafePath(filePath, { allowCreate: true });

    const parentDir = path.dirname(safePath);
    if (!fs.existsSync(parentDir)) {
      this.pathGuard.resolveSafePath(filePath, { allowCreate: true });
      fs.mkdirSync(parentDir, { recursive: true });
      this.pathGuard.resolveSafePath(filePath, { allowCreate: true });
    }

    const existed = fs.existsSync(safePath);
    let originalText = '';

    if (existed) {
      if (requireExpectedHash && !expectedHash) return { success: false, conflict: true, error: 'Read this file first and include its contentHash before editing it.' };
      const stat = fs.statSync(safePath);

      // Check binary file
      const initialBuffer = Buffer.alloc(1024);
      const fd = fs.openSync(safePath, 'r');
      const bytesRead = fs.readSync(fd, initialBuffer, 0, 1024, 0);
      fs.closeSync(fd);
      if (this.isBinary(initialBuffer.subarray(0, bytesRead))) {
        return { success: false, error: `Cannot overwrite binary file "${filePath}" with text content.` };
      }

      // Conflict detection: verify mtime if expectedMtime supplied
      if (expectedMtime && !force) {
        const actualMtime = stat.mtimeMs;
        if (Math.abs(actualMtime - expectedMtime) > 1000) {
          return {
            success: false,
            conflict: true,
            error: `File conflict detected: "${filePath}" has been modified on disk by another process since last inspection.`
          };
        }
      }

      originalText = fs.readFileSync(safePath, 'utf8');
      const actualHash = crypto.createHash('sha256').update(originalText, 'utf8').digest('hex');
      if (expectedHash && actualHash !== expectedHash) return { success: false, conflict: true, error: 'File changed since it was read; review it again before editing.' };
      if (!this.backupFile(safePath)) return { success: false, error: 'Backup failed; refusing to overwrite existing file.' };
    } else if (requireExpectedHash && expectedHash) {
      return { success: false, conflict: true, error: 'File was removed after review; inspect the workspace and retry.' };
    }

    try {
      const atomicOptions = requireExpectedHash || expectedHash ? { expectedHash: existed ? expectedHash : null } : {};
      this.writeAtomically(filePath, content, atomicOptions);
    } catch (writeErr) {
      return { success: false, error: `Atomic write failed: ${writeErr.message}` };
    }

    const stat = fs.statSync(safePath);
    const diffResult = this.computeDiff(originalText, content);

    return {
      success: true,
      action: existed ? 'overwrite' : 'create',
      backedUp: Boolean(existed),
      path: this.pathGuard.getRelativeAlias(safePath),
      sizeBytes: stat.size,
      mtime: stat.mtime.toISOString(),
      mtimeMs: stat.mtimeMs,
      diff: diffResult.diffLines,
      summary: diffResult.summary,
      message: `File successfully ${existed ? 'updated' : 'created'} (${stat.size} bytes)`
    };
  }

  /**
   * Surgical find-and-replace edit with atomic write, backup, and diff generation
   */
  async edit({ filePath, target, replacement, expectedMtime = null, expectedHash, force = false, requireExpectedHash = false } = {}) {
    if (!filePath) return { success: false, error: 'filePath is required' };
    if (typeof target !== 'string' || target === '') {
      return { success: false, error: 'target string to replace cannot be empty' };
    }
    if (typeof replacement !== 'string') {
      return { success: false, error: 'replacement string must be a string' };
    }

    const safePath = this.pathGuard.resolveSafePath(filePath);
    if (!fs.existsSync(safePath)) {
      return { success: false, error: `File not found: "${filePath}"` };
    }

    const stat = fs.statSync(safePath);

    // Conflict detection
    if (expectedMtime && !force) {
      if (Math.abs(stat.mtimeMs - expectedMtime) > 1000) {
        return {
          success: false,
          conflict: true,
          error: `File conflict detected: "${filePath}" was modified since inspection.`
        };
      }
    }

    const original = fs.readFileSync(safePath, 'utf8');
    const actualHash = crypto.createHash('sha256').update(original, 'utf8').digest('hex');
    if (requireExpectedHash && !expectedHash) return { success: false, conflict: true, error: 'Read this file first and include its contentHash before editing it.' };
    if (expectedHash && actualHash !== expectedHash) return { success: false, conflict: true, error: 'File changed since it was read; review it again before editing.' };
    const occurrences = original.split(target).length - 1;

    if (occurrences === 0) {
      return {
        success: false,
        error: `Target text not found in "${filePath}". Ensure whitespace and indentation match exactly.`
      };
    }

    if (occurrences > 1) {
      return {
        success: false,
        error: `Target text occurs ${occurrences} times in "${filePath}". Provide a larger unique snippet.`
      };
    }

    if (!this.backupFile(safePath)) return { success: false, error: 'Backup failed; refusing to edit existing file.' };

    const updated = original.replace(target, replacement);

    // Atomic write
    try {
      this.writeAtomically(filePath, updated, { expectedHash: actualHash });
    } catch (e) {
      return { success: false, error: `Atomic edit failed: ${e.message}` };
    }

    const newStat = fs.statSync(safePath);
    const diffResult = this.computeDiff(original, updated);

    return {
      success: true,
      path: this.pathGuard.getRelativeAlias(safePath),
      occurrencesReplaced: 1,
      mtime: newStat.mtime.toISOString(),
      mtimeMs: newStat.mtimeMs,
      diff: diffResult.diffLines,
      summary: diffResult.summary,
      message: `Successfully edited ${this.pathGuard.getRelativeAlias(safePath)}`
    };
  }

  /**
   * Safely create a folder inside the approved workspace
   */
  async mkdir({ dirPath } = {}) {
    if (!dirPath) return { success: false, error: 'dirPath parameter is required' };
    const safeDir = this.pathGuard.resolveSafePath(dirPath, { allowCreate: true });

    if (!fs.existsSync(safeDir)) {
      this.pathGuard.resolveSafePath(dirPath, { allowCreate: true });
      fs.mkdirSync(safeDir, { recursive: true });
      this.pathGuard.resolveSafePath(dirPath);
    }

    return {
      success: true,
      path: this.pathGuard.getRelativeAlias(safeDir),
      message: `Directory successfully created: ${this.pathGuard.getRelativeAlias(safeDir)}`
    };
  }

  /**
   * Safely move or rename a file or folder inside the approved workspace
   */
  async move({ sourcePath, destinationPath } = {}) {
    if (!sourcePath) return { success: false, error: 'sourcePath is required' };
    if (!destinationPath) return { success: false, error: 'destinationPath is required' };

    const safeSource = this.pathGuard.resolveSafePath(sourcePath);
    if (!fs.existsSync(safeSource)) {
      return { success: false, error: `Source not found: "${sourcePath}"` };
    }

    const safeDest = this.pathGuard.resolveSafePath(destinationPath, { allowCreate: true });
    const destParent = path.dirname(safeDest);
    if (!fs.existsSync(destParent)) {
      this.pathGuard.resolveSafePath(destinationPath, { allowCreate: true });
      fs.mkdirSync(destParent, { recursive: true });
    }

    if (this.pathGuard.resolveSafePath(sourcePath) !== safeSource ||
        this.pathGuard.resolveSafePath(destinationPath, { allowCreate: true }) !== safeDest) {
      return { success: false, error: 'Move path changed during authorization' };
    }
    fs.renameSync(safeSource, safeDest);

    return {
      success: true,
      source: this.pathGuard.getRelativeAlias(safeSource),
      destination: this.pathGuard.getRelativeAlias(safeDest),
      message: `Successfully moved from ${this.pathGuard.getRelativeAlias(safeSource)} to ${this.pathGuard.getRelativeAlias(safeDest)}`
    };
  }

  /**
   * Safely delete a file or directory inside the approved workspace
   */
  async delete({ filePath } = {}) {
    if (!filePath) return { success: false, error: 'filePath parameter is required' };
    const safePath = this.pathGuard.resolveSafePath(filePath);

    if (!fs.existsSync(safePath)) {
      return { success: false, error: `File not found: "${filePath}"` };
    }

    const stat = fs.statSync(safePath);
    if (this.pathGuard.resolveSafePath(filePath) !== safePath) return { success: false, error: 'Delete path changed during authorization' };
    if (stat.isDirectory()) {
      fs.rmSync(safePath, { recursive: true, force: true });
    } else {
      fs.unlinkSync(safePath);
    }

    return {
      success: true,
      path: this.pathGuard.getRelativeAlias(safePath),
      message: `Successfully deleted ${this.pathGuard.getRelativeAlias(safePath)}`
    };
  }
}

module.exports = WorkspaceFsTool;
