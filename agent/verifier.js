'use strict';

/**
 * ABYX Independent Verification Engine
 * Certifies whether agent deliverables genuinely meet quality, syntax,
 * and test correctness standards prior to marking tasks completed.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class TaskVerifier {
  /**
   * @param {object} params
   * @param {import('./path_guard')} params.pathGuard
   * @param {import('./tools/lsp_tool')} [params.lspTool]
   * @param {import('./tools/terminal_tool')} [params.terminalTool]
   */
  constructor({ pathGuard, lspTool, terminalTool } = {}) {
    if (!pathGuard) throw new Error('TaskVerifier requires PathGuard');
    this.pathGuard = pathGuard;
    this.lspTool = lspTool || null;
    this.terminalTool = terminalTool || null;
  }

  /**
   * Performs an independent verification suite on a task's declared deliverables
   * @param {object} params
   * @param {string[]} [params.expectedFiles] - Files that must exist and be non-empty
   * @param {string[]} [params.syntaxCheckFiles] - Code files that must pass LSP syntax validation
   * @param {string} [params.testCommand] - Shell test command that must exit with code 0
   * @param {string[]} [params.criteria] - Specific acceptance assertions
   */
  async verify({ expectedFiles = [], syntaxCheckFiles = [], testCommand = null, criteria = [] } = {}) {
    const checks = [];
    const errors = [];

    // 1. Expected Files Verification
    for (const relFile of expectedFiles) {
      try {
        const full = this.pathGuard.resolveSafePath(relFile);
        if (!fs.existsSync(full)) {
          errors.push(`Expected file does not exist: "${relFile}"`);
          checks.push({ name: `File: ${relFile}`, passed: false, error: 'File not found' });
          continue;
        }

        const stat = fs.statSync(full);
        if (stat.size === 0) {
          errors.push(`Expected file is empty (0 bytes): "${relFile}"`);
          checks.push({ name: `File: ${relFile}`, passed: false, error: 'File is empty' });
          continue;
        }

        const hash = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex').slice(0, 12);
        checks.push({ name: `File: ${relFile}`, passed: true, sizeBytes: stat.size, hash });
      } catch (err) {
        errors.push(`File check error for "${relFile}": ${err.message}`);
        checks.push({ name: `File: ${relFile}`, passed: false, error: err.message });
      }
    }

    // 2. Syntax & LSP Diagnostics Verification
    if (this.lspTool) {
      for (const relFile of syntaxCheckFiles) {
        try {
          const diagResult = this.lspTool.checkDiagnostics({ filePath: relFile });
          if (!diagResult.ok) {
            const diagMessages = diagResult.diagnostics.map(d => `Line ${d.line}: ${d.message}`).join(', ');
            errors.push(`Syntax validation failed for "${relFile}": ${diagMessages}`);
            checks.push({ name: `LSP Syntax: ${relFile}`, passed: false, errors: diagResult.diagnostics });
          } else {
            checks.push({ name: `LSP Syntax: ${relFile}`, passed: true });
          }
        } catch (diagErr) {
          errors.push(`LSP check failed for "${relFile}": ${diagErr.message}`);
          checks.push({ name: `LSP Syntax: ${relFile}`, passed: false, error: diagErr.message });
        }
      }
    }

    // 3. Automated Test Execution Verification
    if (testCommand && this.terminalTool) {
      try {
        const execResult = await this.terminalTool.execute({ command: testCommand, timeoutMs: 30000 });
        if (execResult.exitCode !== 0) {
          errors.push(`Test command failed with exit code ${execResult.exitCode}: "${testCommand}"`);
          checks.push({
            name: `Test Command: ${testCommand}`,
            passed: false,
            exitCode: execResult.exitCode,
            stderr: execResult.stderr?.slice(0, 500)
          });
        } else {
          checks.push({
            name: `Test Command: ${testCommand}`,
            passed: true,
            exitCode: 0
          });
        }
      } catch (cmdErr) {
        errors.push(`Test command execution failed: ${cmdErr.message}`);
        checks.push({ name: `Test Command: ${testCommand}`, passed: false, error: cmdErr.message });
      }
    }

    const passed = errors.length === 0;
    return {
      passed,
      timestamp: new Date().toISOString(),
      checksTotal: checks.length,
      checksPassed: checks.filter(c => c.passed).length,
      checks,
      errors,
      summary: passed
        ? `Independent verification PASSED: All ${checks.length} assertions verified.`
        : `Independent verification FAILED: ${errors.length} issue(s) detected.`
    };
  }
}

module.exports = TaskVerifier;
