'use strict';

/**
 * ABYX Language Server Protocol (LSP) & Code Intelligence Tool
 * Provides static analysis, syntax diagnostics, symbol extraction,
 * and pre-flight diff safety verification before applying file modifications.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');

class LspTool {
  /**
   * @param {import('../path_guard')} pathGuard
   */
  constructor(pathGuard) {
    if (!pathGuard) throw new Error('LspTool requires PathGuard');
    this.pathGuard = pathGuard;
  }

  /**
   * Checks a file or code snippet for syntax errors and diagnostics.
   * Supports JS, TS, JSON, Python, and generic languages.
   */
  checkDiagnostics({ filePath, content } = {}) {
    let code = content;
    let targetPath = null;
    let ext = '';

    if (filePath) {
      targetPath = this.pathGuard.resolveSafePath ? this.pathGuard.resolveSafePath(filePath) : path.resolve(filePath);
      ext = path.extname(targetPath).toLowerCase();
      if (code === undefined && fs.existsSync(targetPath)) {
        code = fs.readFileSync(targetPath, 'utf8');
      }
    }

    if (code === undefined) {
      throw new Error('Either filePath or content must be provided for diagnostics check');
    }

    const diagnostics = [];

    // 1. JSON Validation
    if (ext === '.json') {
      try {
        JSON.parse(code);
      } catch (err) {
        const lineMatch = err.message.match(/at position (\d+)/) || err.message.match(/line (\d+) column (\d+)/);
        diagnostics.push({
          severity: 'error',
          source: 'json-parser',
          message: err.message,
          line: lineMatch ? parseInt(lineMatch[1], 10) : 1,
          column: 1
        });
      }
      return { ok: diagnostics.length === 0, file: filePath || 'snippet', diagnostics };
    }

    // 2. JavaScript / TypeScript static syntax check
    if (['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx'].includes(ext) || !ext) {
      // Fast Node.js VM syntax check for JS/CJS/MJS
      if (['.js', '.cjs'].includes(ext)) {
        try {
          new vm.Script(code, { filename: filePath || 'snippet.js' });
        } catch (err) {
          diagnostics.push({
            severity: 'error',
            source: 'v8-syntax-check',
            message: err.message,
            stack: err.stack ? err.stack.split('\n')[0] : '',
            line: err.lineNumber || 1,
            column: err.columnNumber || 1
          });
        }
      }

      // Check for unmatched brackets/delimiters
      const balanceErrors = this._checkDelimiterBalance(code);
      diagnostics.push(...balanceErrors);

      return {
        ok: diagnostics.length === 0,
        file: filePath || 'snippet',
        diagnostics,
        summary: diagnostics.length === 0 ? 'No syntax errors detected.' : `${diagnostics.length} diagnostic issues found.`
      };
    }

    // 3. Python static syntax check
    if (ext === '.py') {
      try {
        const pythonCheck = spawnSync('python', ['-c', 'import sys, ast; ast.parse(sys.stdin.read())'], {
          input: code,
          encoding: 'utf8',
          timeout: 4000
        });
        if (pythonCheck.status !== 0 && pythonCheck.stderr) {
          const match = pythonCheck.stderr.match(/line (\d+)/i);
          diagnostics.push({
            severity: 'error',
            source: 'py-ast-check',
            message: pythonCheck.stderr.trim().split('\n').pop(),
            line: match ? parseInt(match[1], 10) : 1,
            column: 1
          });
        }
      } catch {
        // Fallback delimiter check if python binary is unavailable
        diagnostics.push(...this._checkDelimiterBalance(code));
      }
      return { ok: diagnostics.length === 0, file: filePath || 'snippet', diagnostics };
    }

    // Default fallback delimiter check
    diagnostics.push(...this._checkDelimiterBalance(code));
    return { ok: diagnostics.length === 0, file: filePath || 'snippet', diagnostics };
  }

  /**
   * Extracts symbols (functions, classes, variables, exports) from a source file.
   */
  getSymbols({ filePath, content } = {}) {
    let code = content;
    let targetPath = null;
    let ext = '';

    if (filePath) {
      targetPath = this.pathGuard.resolveSafePath ? this.pathGuard.resolveSafePath(filePath) : path.resolve(filePath);
      ext = path.extname(targetPath).toLowerCase();
      if (code === undefined && fs.existsSync(targetPath)) {
        code = fs.readFileSync(targetPath, 'utf8');
      }
    }

    if (code === undefined) {
      throw new Error('Either filePath or content must be provided for symbol extraction');
    }

    const symbols = [];
    const lines = code.split('\n');

    lines.forEach((line, index) => {
      const lineNum = index + 1;
      const trimmed = line.trim();

      // Class definitions
      const classMatch = trimmed.match(/^export\s+(?:default\s+)?class\s+([A-Za-z0-9_$]+)|^class\s+([A-Za-z0-9_$]+)/);
      if (classMatch) {
        symbols.push({
          name: classMatch[1] || classMatch[2],
          kind: 'class',
          line: lineNum,
          signature: trimmed
        });
        return;
      }

      // Function definitions
      const fnMatch = trimmed.match(/^(?:async\s+)?function\s+([A-Za-z0-9_$]+)|^export\s+(?:async\s+)?function\s+([A-Za-z0-9_$]+)/);
      if (fnMatch) {
        symbols.push({
          name: fnMatch[1] || fnMatch[2],
          kind: 'function',
          line: lineNum,
          signature: trimmed.split('{')[0].trim()
        });
        return;
      }

      // Arrow functions & const/let functions
      const arrowMatch = trimmed.match(/^(?:export\s+)?(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?\(/);
      if (arrowMatch) {
        symbols.push({
          name: arrowMatch[1],
          kind: 'function',
          line: lineNum,
          signature: trimmed.split('=>')[0].trim()
        });
        return;
      }

      // Python def/class
      if (ext === '.py') {
        const pyDef = trimmed.match(/^def\s+([A-Za-z0-9_]+)\s*\(/);
        if (pyDef) {
          symbols.push({ name: pyDef[1], kind: 'function', line: lineNum, signature: trimmed });
          return;
        }
        const pyClass = trimmed.match(/^class\s+([A-Za-z0-9_]+)/);
        if (pyClass) {
          symbols.push({ name: pyClass[1], kind: 'class', line: lineNum, signature: trimmed });
          return;
        }
      }
    });

    return {
      filePath: filePath || 'snippet',
      count: symbols.length,
      symbols
    };
  }

  /**
   * Finds occurrences and references to a symbol across approved workspace files.
   */
  findReferences({ symbol, searchDir = '' } = {}) {
    if (!symbol || typeof symbol !== 'string') throw new Error('Symbol name required');
    const root = searchDir ? (this.pathGuard.resolveSafePath ? this.pathGuard.resolveSafePath(searchDir) : path.resolve(searchDir)) : this.pathGuard.defaultRoot;
    const results = [];

    const walk = (dir) => {
      if (results.length >= 100) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile() && /\.(js|jsx|ts|tsx|json|py|cjs|mjs)$/i.test(entry.name)) {
          try {
            const content = fs.readFileSync(full, 'utf8');
            if (content.includes(symbol)) {
              const lines = content.split('\n');
              lines.forEach((line, idx) => {
                if (line.includes(symbol) && results.length < 100) {
                  results.push({
                    file: path.relative(this.pathGuard.defaultRoot, full),
                    line: idx + 1,
                    text: line.trim()
                  });
                }
              });
            }
          } catch {}
        }
      }
    };

    walk(root);
    return { symbol, count: results.length, references: results };
  }

  /**
   * Pre-flight diff verification:
   * Validates whether applying target -> replacement introduces syntax breaks or balance issues.
   */
  validateDiff({ filePath, target, replacement } = {}) {
    if (!filePath || target === undefined || replacement === undefined) {
      throw new Error('filePath, target, and replacement are required to validate diff');
    }

    const resolved = this.pathGuard.resolveSafePath ? this.pathGuard.resolveSafePath(filePath) : path.resolve(filePath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Cannot validate diff for non-existent file: ${filePath}`);
    }

    const currentContent = fs.readFileSync(resolved, 'utf8');
    if (!currentContent.includes(target)) {
      return {
        valid: false,
        error: `Target string was not found in file: "${target.slice(0, 100)}"`,
        diagnostics: []
      };
    }

    // Compute preview content
    const previewContent = currentContent.replace(target, replacement);

    // Run diagnostics check on preview content
    const result = this.checkDiagnostics({ filePath, content: previewContent });

    return {
      valid: result.ok,
      file: filePath,
      diagnostics: result.diagnostics,
      warning: result.ok ? null : 'Applying this diff introduces syntax or delimiter errors.',
      safeToApply: result.ok
    };
  }

  /**
   * Internal helper: Verifies matching delimiters: (), {}, []
   */
  _checkDelimiterBalance(code) {
    const errors = [];
    const stack = [];
    const pairs = { '(': ')', '{': '}', '[': ']' };
    const matching = { ')': '(', '}': '{', ']': '[' };

    let inString = null;
    let isEscaped = false;
    let inLineComment = false;
    let inBlockComment = false;
    let line = 1;
    let col = 0;

    for (let i = 0; i < code.length; i++) {
      const char = code[i];
      col++;

      if (char === '\n') {
        line++;
        col = 0;
        inLineComment = false;
        continue;
      }

      if (inLineComment) continue;

      if (inBlockComment) {
        if (char === '*' && code[i + 1] === '/') {
          inBlockComment = false;
          i++;
        }
        continue;
      }

      if (inString) {
        if (isEscaped) {
          isEscaped = false;
        } else if (char === '\\') {
          isEscaped = true;
        } else if (char === inString) {
          inString = null;
        }
        continue;
      }

      if (char === '/' && code[i + 1] === '/') {
        inLineComment = true;
        i++;
        continue;
      }
      if (char === '/' && code[i + 1] === '*') {
        inBlockComment = true;
        i++;
        continue;
      }

      if (char === '"' || char === "'" || char === '`') {
        inString = char;
        continue;
      }

      if (pairs[char]) {
        stack.push({ char, line, col });
      } else if (matching[char]) {
        if (stack.length === 0) {
          errors.push({
            severity: 'error',
            source: 'lsp-delimiter-check',
            message: `Unexpected closing delimiter '${char}'`,
            line,
            column: col
          });
        } else {
          const top = stack.pop();
          if (pairs[top.char] !== char) {
            errors.push({
              severity: 'error',
              source: 'lsp-delimiter-check',
              message: `Mismatched delimiter: expected '${pairs[top.char]}' to close '${top.char}' (line ${top.line}), but found '${char}'`,
              line,
              column: col
            });
          }
        }
      }
    }

    while (stack.length > 0) {
      const unclosed = stack.pop();
      errors.push({
        severity: 'error',
        source: 'lsp-delimiter-check',
        message: `Unclosed delimiter '${unclosed.char}' opened at line ${unclosed.line}, column ${unclosed.col}`,
        line: unclosed.line,
        column: unclosed.col
      });
    }

    return errors;
  }
}

module.exports = LspTool;
