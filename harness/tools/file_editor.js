/**
 * Smart File Editor with contiguous block replacement, unified diffs, and verification.
 */

const fs = require('node:fs');
const path = require('node:path');

class SmartFileEditor {
  constructor(workspaceRoot) {
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.name = 'smart_file_editor';
    this.description = 'Smart contiguous block replacement, diff generator, and file reader/writer.';
  }

  getSchema() {
    return {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['read', 'write', 'edit', 'preview'] },
        path: { type: 'string' },
        content: { type: 'string' },
        target: { type: 'string' },
        replacement: { type: 'string' }
      },
      required: ['action', 'path']
    };
  }

  execute(args) {
    const { action, path: filePath, content, target, replacement } = args;
    try {
      if (action === 'write') {
        const res = this.writeFile(filePath, content || '');
        return { ...res, status: 'written' };
      } else if (action === 'read') {
        const text = this.readFile(filePath);
        return { status: 'read', content: text };
      } else if (action === 'edit') {
        const res = this.blockReplace(filePath, target, replacement);
        return { ...res, status: 'edited' };
      } else if (action === 'preview') {
        return this.getMarkdownPreview(filePath);
      } else {
        return { error: `Unknown editor action: ${action}` };
      }
    } catch (err) {
      return { error: `Boundary violation or error: ${err.message}` };
    }
  }

  _resolvePath(relPath) {
    const resolved = path.resolve(this.workspaceRoot, relPath);
    if (!resolved.startsWith(this.workspaceRoot)) {
      throw new Error(`Path traversal denied: ${relPath}`);
    }
    return resolved;
  }

  readFile(relPath) {
    const target = this._resolvePath(relPath);
    if (!fs.existsSync(target)) {
      throw new Error(`File not found: ${relPath}`);
    }
    return fs.readFileSync(target, 'utf-8');
  }

  writeFile(relPath, content) {
    const target = this._resolvePath(relPath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const existed = fs.existsSync(target);
    fs.writeFileSync(target, content, 'utf-8');
    return {
      path: relPath,
      created: !existed,
      bytesWritten: Buffer.byteLength(content, 'utf-8'),
      status: 'success'
    };
  }

  blockReplace(relPath, targetBlock, replacementBlock) {
    const target = this._resolvePath(relPath);
    if (!fs.existsSync(target)) {
      throw new Error(`File not found: ${relPath}`);
    }
    const original = fs.readFileSync(target, 'utf-8');
    if (!original.includes(targetBlock)) {
      throw new Error(`Target block not found in ${relPath}`);
    }

    const occurrences = original.split(targetBlock).length - 1;
    if (occurrences > 1) {
      throw new Error(`Ambiguous replacement: target block occurs ${occurrences} times in ${relPath}`);
    }

    const updated = original.replace(targetBlock, replacementBlock);
    fs.writeFileSync(target, updated, 'utf-8');

    // Generate lightweight diff
    const diff = `--- a/${relPath}\n+++ b/${relPath}\n@@ -1 +1 @@\n-${targetBlock}\n+${replacementBlock}\n`;

    return {
      path: relPath,
      diff,
      status: 'success',
      bytesChanged: updated.length - original.length
    };
  }

  getMarkdownPreview(relPath) {
    const content = this.readFile(relPath);
    const headings = content
      .split('\n')
      .filter(l => l.trim().startsWith('#'))
      .map(l => l.trim());
    return {
      path: relPath,
      isMarkdown: relPath.endsWith('.md'),
      headings,
      rawContent: content
    };
  }
}

module.exports = { SmartFileEditor };
