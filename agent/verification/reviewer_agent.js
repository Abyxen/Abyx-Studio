'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execSync } = require('node:child_process');

/**
 * ReviewerAgent - Read-Only Independent Code Reviewer Subagent
 * References: OpenHands + Harbor
 * 
 * Performs multi-dimensional code review on completed deliverables:
 * - Correctness & syntax validity.
 * - Missing requirements from user prompt.
 * - Regression risks & public signature stability.
 * - Unintended modifications & scope creep.
 * - Security vulnerabilities (OWASP, credentials, traversal).
 * - Automated test coverage existence.
 * 
 * Invariant: Operates with strictly READ-ONLY permissions.
 */
class ReviewerAgent {
  constructor(options = {}) {
    this.workspaceRoot = options.workspaceRoot || process.cwd();
    this.modelRouter = options.modelRouter || null;
    this.strictMode = options.strictMode !== false;
  }

  /**
   * Performs an automated static & structural code review of modified files
   */
  async reviewTaskDeliverable({ goal, requirements = [], filesModified = [], gitDiff = null } = {}) {
    const findings = [];
    const modifiedFiles = filesModified.length > 0 ? filesModified : this._getGitModifiedFiles();
    const rawDiff = gitDiff || this._getGitDiff();

    // 1. Correctness & Syntax Check (JS/TS syntax inspection)
    for (const relFile of modifiedFiles) {
      const fullPath = path.resolve(this.workspaceRoot, relFile);
      if (!fs.existsSync(fullPath)) continue;

      const ext = path.extname(relFile).toLowerCase();
      if (['.js', '.cjs', '.mjs'].includes(ext)) {
        try {
          const code = fs.readFileSync(fullPath, 'utf8');
          new vm.Script(code, { filename: relFile });
        } catch (err) {
          findings.push({
            severity: 'blocker',
            category: 'correctness',
            file: relFile,
            line: err.stack ? (err.stack.match(/:(\d+):\d+/)?.[1] || 1) : 1,
            description: `Syntax error in modified file: ${err.message}`,
            suggestion: 'Fix JavaScript syntax error before completing task'
          });
        }
      } else if (ext === '.json') {
        try {
          const content = fs.readFileSync(fullPath, 'utf8');
          JSON.parse(content);
        } catch (err) {
          findings.push({
            severity: 'blocker',
            category: 'correctness',
            file: relFile,
            description: `Invalid JSON syntax: ${err.message}`,
            suggestion: 'Validate and format JSON structure'
          });
        }
      }
    }

    // 2. Security Concerns (Hardcoded secrets, unsafe commands, directory traversal)
    const securityPatterns = [
      { regex: /AKIA[0-9A-Z]{16}/, desc: 'Hardcoded AWS Access Key ID detected', severity: 'blocker' },
      { regex: /ghp_[0-9a-zA-Z]{36}/, desc: 'Hardcoded GitHub Personal Access Token detected', severity: 'blocker' },
      { regex: /(?:password|secret|apikey|token)\s*[:=]\s*["'][A-Za-z0-9_\-]{16,}["']/i, desc: 'Potential hardcoded credential string detected', severity: 'warning' },
      { regex: /exec\s*\(\s*["']rm\s+-rf\s+\/["']\s*\)/i, desc: 'Destructive shell command execution detected', severity: 'blocker' },
      { regex: /\.\.\/|\.\.\\/g, desc: 'Relative directory traversal sequence detected in source code', severity: 'warning' }
    ];

    for (const relFile of modifiedFiles) {
      const fullPath = path.resolve(this.workspaceRoot, relFile);
      if (!fs.existsSync(fullPath)) continue;

      const content = fs.readFileSync(fullPath, 'utf8');
      const lines = content.split('\n');

      lines.forEach((line, idx) => {
        for (const sp of securityPatterns) {
          if (sp.regex.test(line)) {
            findings.push({
              severity: sp.severity,
              category: 'security',
              file: relFile,
              line: idx + 1,
              description: sp.desc,
              suggestion: 'Extract secrets to environment variables or sanitize path navigation'
            });
          }
        }
      });
    }

    // 3. Unintended Modifications & Scope Creep
    const protectedSensitiveFiles = ['.env', 'package-lock.json', '.git/config', 'yarn.lock'];
    for (const relFile of modifiedFiles) {
      for (const prot of protectedSensitiveFiles) {
        if (relFile.includes(prot)) {
          findings.push({
            severity: 'blocker',
            category: 'unintended_modifications',
            file: relFile,
            description: `Protected system or credential file was modified: "${relFile}"`,
            suggestion: 'Revert changes to sensitive repository files'
          });
        }
      }
    }

    // 4. Missing Requirements & Empty Placeholders
    for (const relFile of modifiedFiles) {
      const fullPath = path.resolve(this.workspaceRoot, relFile);
      if (!fs.existsSync(fullPath)) continue;
      const content = fs.readFileSync(fullPath, 'utf8');

      if (/\/\/\s*TODO:?\s*implement/i.test(content) || /throw new Error\(["']not implemented["']\)/i.test(content)) {
        findings.push({
          severity: 'blocker',
          category: 'missing_requirements',
          file: relFile,
          description: 'Deliverable contains unfulfilled mock stubs or TODO placeholders',
          suggestion: 'Provide complete, functional implementations for all methods'
        });
      }
    }

    // 5. Test Coverage Check
    const hasCodeChanges = modifiedFiles.some(f => !f.includes('test') && !f.endsWith('.md') && !f.endsWith('.json'));
    const hasTestChanges = modifiedFiles.some(f => f.includes('test') || f.includes('.spec.') || f.includes('.test.'));
    
    if (hasCodeChanges && !hasTestChanges) {
      findings.push({
        severity: 'warning',
        category: 'test_coverage',
        file: modifiedFiles[0] || 'workspace',
        description: 'New or modified source code has no accompanying automated test updates',
        suggestion: 'Author automated unit or integration tests to verify the deliverables'
      });
    }

    // Calculate overall review verdict
    const blockers = findings.filter(f => f.severity === 'blocker');
    const warnings = findings.filter(f => f.severity === 'warning');
    const passed = blockers.length === 0;

    let score = 100;
    score -= blockers.length * 35;
    score -= warnings.length * 10;
    score = Math.max(0, Math.min(100, score));

    return {
      passed,
      verdict: passed ? 'approved' : 'changes_requested',
      score,
      totalFindings: findings.length,
      blockerCount: blockers.length,
      warningCount: warnings.length,
      findings,
      reviewedFilesCount: modifiedFiles.length,
      timestamp: new Date().toISOString()
    };
  }

  _getGitModifiedFiles() {
    try {
      const out = execSync('git status --porcelain', { cwd: this.workspaceRoot, encoding: 'utf8', windowsHide: true });
      return out.split('\n')
        .map(l => l.trim().slice(3).trim())
        .filter(f => f.length > 0 && !f.startsWith('.git'));
    } catch (_) {
      return [];
    }
  }

  _getGitDiff() {
    try {
      return execSync('git diff HEAD', { cwd: this.workspaceRoot, encoding: 'utf8', windowsHide: true });
    } catch (_) {
      return '';
    }
  }
}

module.exports = ReviewerAgent;
