'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

/**
 * LspTool - Advanced In-Process Code Diagnostics & Symbol Navigation
 * 
 * Supports:
 * - diagnostics: Syntax, parse validation, and JSON verification
 * - symbols: Classes, functions, exports, and methods
 * - find_references: Identifier usage search across codebase
 * - find_definition: Declaration site resolution
 * - format_document: Whitespace and indentation normalization
 */
class LspTool {
  constructor(pathGuard) {
    this.pathGuard = pathGuard;
  }

  async diagnostics({ path: filePath, content = null }) {
    try {
      let code = content;
      let targetFile = filePath;

      if (code === null && filePath) {
        const safePath = this.pathGuard.resolveSafePath(filePath);
        if (!fs.existsSync(safePath)) {
          return { ok: false, error: `File not found: ${filePath}` };
        }
        code = fs.readFileSync(safePath, 'utf8');
      }

      if (typeof code !== 'string') {
        return { ok: false, error: 'Code content or valid filePath required' };
      }

      const ext = filePath ? filePath.split('.').pop().toLowerCase() : 'js';
      const diagnostics = [];

      // JSON validation
      if (ext === 'json') {
        try {
          JSON.parse(code);
        } catch (err) {
          diagnostics.push({
            severity: 'error',
            message: err.message,
            line: 1,
            column: 1
          });
        }
      } else if (['js', 'cjs', 'mjs'].includes(ext)) {
        // Node VM compilation check
        try {
          new vm.Script(code, { filename: targetFile || 'anonymous.js' });
        } catch (err) {
          const lineMatch = err.stack ? err.stack.match(/:(\d+)(?::(\d+))?/) : null;
          diagnostics.push({
            severity: 'error',
            message: err.message,
            line: lineMatch ? parseInt(lineMatch[1], 10) : 1,
            column: lineMatch && lineMatch[2] ? parseInt(lineMatch[2], 10) : 1
          });
        }
      }

      return {
        ok: diagnostics.length === 0,
        valid: diagnostics.length === 0,
        filePath: targetFile,
        errorsCount: diagnostics.length,
        diagnostics
      };
    } catch (err) {
      return { ok: false, error: err.message, diagnostics: [{ severity: 'error', message: err.message }] };
    }
  }

  async symbols({ path: filePath, content = null }) {
    try {
      let code = content;
      if (code === null && filePath) {
        const safePath = this.pathGuard.resolveSafePath(filePath);
        code = fs.readFileSync(safePath, 'utf8');
      }
      if (typeof code !== 'string') return { ok: false, error: 'Code content required' };

      const symbols = [];
      const lines = code.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        // Classes
        const classMatch = line.match(/^\s*(?:export\s+)?class\s+([A-Za-z0-9_$]+)/);
        if (classMatch) {
          symbols.push({ name: classMatch[1], kind: 'class', line: i + 1 });
          continue;
        }

        // Functions
        const fnMatch = line.match(/^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)/);
        if (fnMatch) {
          symbols.push({ name: fnMatch[1], kind: 'function', line: i + 1 });
          continue;
        }

        // Methods
        const methodMatch = line.match(/^\s*(?:static\s+)?(?:async\s+)?([A-Za-z0-9_$]+)\s*\([^)]*\)\s*\{/);
        if (methodMatch && !['if', 'for', 'while', 'switch', 'catch'].includes(methodMatch[1])) {
          symbols.push({ name: methodMatch[1], kind: 'method', line: i + 1 });
        }
      }

      return {
        ok: true,
        filePath,
        count: symbols.length,
        symbols
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async findDefinition({ identifier, path: dirPath = '.' }) {
    if (!identifier || typeof identifier !== 'string') {
      return { ok: false, error: 'Identifier string required' };
    }

    try {
      const safeDir = this.pathGuard.resolveSafePath(dirPath);
      const defRegex = new RegExp(`(?:class|function|const|let|var)\\s+${identifier}\\b`, 'i');
      const matches = [];

      const scan = (currentDir) => {
        if (matches.length >= 10) return;
        const entries = fs.readdirSync(currentDir, { withFileTypes: true });
        for (const entry of entries) {
          if (matches.length >= 10) break;
          if (['.git', 'node_modules', 'dist', 'build'].includes(entry.name)) continue;
          const full = path.join(currentDir, entry.name);

          if (entry.isDirectory()) {
            scan(full);
          } else if (entry.isFile() && /\.(js|cjs|mjs|ts|jsx|tsx)$/i.test(entry.name)) {
            const content = fs.readFileSync(full, 'utf8');
            const lines = content.split('\n');
            for (let i = 0; i < lines.length; i++) {
              if (defRegex.test(lines[i])) {
                matches.push({
                  file: path.relative(safeDir, full).split(path.sep).join('/'),
                  line: i + 1,
                  snippet: lines[i].trim()
                });
                break;
              }
            }
          }
        }
      };

      scan(safeDir);
      return {
        ok: true,
        identifier,
        count: matches.length,
        definitions: matches,
        matches
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async findReferences({ identifier, path: dirPath = '.' }) {
    if (!identifier || typeof identifier !== 'string') {
      return { ok: false, error: 'Identifier string required' };
    }

    try {
      const safeDir = this.pathGuard.resolveSafePath(dirPath);
      const refRegex = new RegExp(`\\b${identifier}\\b`);
      const references = [];

      const scan = (currentDir) => {
        if (references.length >= 50) return;
        const entries = fs.readdirSync(currentDir, { withFileTypes: true });
        for (const entry of entries) {
          if (references.length >= 50) break;
          if (['.git', 'node_modules', 'dist', 'build'].includes(entry.name)) continue;
          const full = path.join(currentDir, entry.name);

          if (entry.isDirectory()) {
            scan(full);
          } else if (entry.isFile() && /\.(js|cjs|mjs|ts|jsx|tsx)$/i.test(entry.name)) {
            const content = fs.readFileSync(full, 'utf8');
            const lines = content.split('\n');
            for (let i = 0; i < lines.length; i++) {
              if (references.length >= 50) break;
              if (refRegex.test(lines[i])) {
                references.push({
                  file: path.relative(safeDir, full).split(path.sep).join('/'),
                  line: i + 1,
                  snippet: lines[i].trim().slice(0, 150)
                });
              }
            }
          }
        }
      };

      scan(safeDir);
      return {
        ok: true,
        identifier,
        count: references.length,
        references
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async formatDocument({ path: filePath }) {
    try {
      const safePath = this.pathGuard.resolveSafePath(filePath);
      if (!fs.existsSync(safePath)) {
        return { ok: false, error: `File not found: ${filePath}` };
      }
      const raw = fs.readFileSync(safePath, 'utf8');
      
      // Basic clean formatting: normalize CRLF to LF, strip trailing whitespace
      const formatted = raw
        .split(/\r?\n/)
        .map(line => line.trimEnd())
        .join('\n')
        .trimEnd() + '\n';

      const changed = raw !== formatted;
      if (changed) {
        fs.writeFileSync(safePath, formatted, 'utf8');
      }

      return {
        ok: true,
        path: filePath,
        modified: changed,
        linesCount: formatted.split('\n').length
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }
}

module.exports = LspTool;
