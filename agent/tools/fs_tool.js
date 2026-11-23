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
const path = require('node:path');

class WorkspaceFsTool {
  constructor(pathGuard) {
    if (!pathGuard) throw new Error('WorkspaceFsTool requires PathGuard instance');
    this.pathGuard = pathGuard;
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
   * Write text to a file inside the approved workspace
   */
  async write({ filePath, content = '' } = {}) {
    if (!filePath) return { success: false, error: 'filePath parameter is required' };
    const safePath = this.pathGuard.resolveSafePath(filePath, { allowCreate: true });

    const parentDir = path.dirname(safePath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    const existed = fs.existsSync(safePath);
    fs.writeFileSync(safePath, content, 'utf8');
    const stat = fs.statSync(safePath);

    return {
      success: true,
      action: existed ? 'overwrite' : 'create',
      path: this.pathGuard.getRelativeAlias(safePath),
      sizeBytes: stat.size,
      message: `File successfully written (${stat.size} bytes)`
    };
  }

  /**
   * Surgical find-and-replace edit within a file
   */
  async edit({ filePath, target, replacement } = {}) {
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

    const original = fs.readFileSync(safePath, 'utf8');
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

    const updated = original.replace(target, replacement);
    fs.writeFileSync(safePath, updated, 'utf8');

    return {
      success: true,
      path: this.pathGuard.getRelativeAlias(safePath),
      occurrencesReplaced: 1,
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
      fs.mkdirSync(safeDir, { recursive: true });
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
      fs.mkdirSync(destParent, { recursive: true });
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
