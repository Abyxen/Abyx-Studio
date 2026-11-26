'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execSync } = require('node:child_process');

/**
 * VerificationEngine - Autonomous Deliverable Verification & Evidence System
 * References: OpenHands + Harbor + Terminal-Bench
 * 
 * Invariant: The system MUST NOT rely on an agent merely asserting its task is done.
 * Every deliverable must be verified with concrete, independently gathered evidence.
 */
class VerificationEngine {
  constructor(options = {}) {
    this.workspaceRoot = options.workspaceRoot || process.cwd();
    this.gitAdapter = options.gitAdapter || null;
    this.pathGuard = options.pathGuard || null;
    this.timeoutMs = options.timeoutMs || 30000;
  }

  /**
   * Resolves and validates absolute safe workspace path
   */
  _resolvePath(targetPath) {
    if (!targetPath) throw new Error('Target path is required');
    if (path.isAbsolute(targetPath)) return path.normalize(targetPath);
    return path.normalize(path.resolve(this.workspaceRoot, targetPath));
  }

  /**
   * 1. File Existence & Type Verification
   */
  verifyFileExists(targetPath, { expectDirectory = false, minSizeBytes = 1 } = {}) {
    const resolved = this._resolvePath(targetPath);
    const exists = fs.existsSync(resolved);
    
    if (!exists) {
      return {
        passed: false,
        check: 'file_exists',
        path: targetPath,
        resolvedPath: resolved,
        error: `File or directory does not exist at "${targetPath}"`
      };
    }

    const stat = fs.statSync(resolved);
    const isDir = stat.isDirectory();
    
    if (expectDirectory && !isDir) {
      return {
        passed: false,
        check: 'file_exists',
        path: targetPath,
        error: `Expected directory but found regular file at "${targetPath}"`
      };
    }

    if (!expectDirectory && isDir) {
      return {
        passed: false,
        check: 'file_exists',
        path: targetPath,
        error: `Expected file but found directory at "${targetPath}"`
      };
    }

    if (!expectDirectory && stat.size < minSizeBytes) {
      return {
        passed: false,
        check: 'file_exists',
        path: targetPath,
        sizeBytes: stat.size,
        error: `File size (${stat.size} bytes) is below minimum threshold (${minSizeBytes} bytes)`
      };
    }

    return {
      passed: true,
      check: 'file_exists',
      path: targetPath,
      resolvedPath: resolved,
      isDirectory: isDir,
      sizeBytes: stat.size,
      mtime: stat.mtime.toISOString()
    };
  }

  /**
   * 2. File Content Assertions & Placeholder Detection
   */
  verifyFileContent(targetPath, {
    contains = [],
    notContains = [],
    regex = null,
    forbidPlaceholders = true,
    minLines = 1,
    maxLines = null,
    jsonValid = false
  } = {}) {
    const existsCheck = this.verifyFileExists(targetPath);
    if (!existsCheck.passed) return existsCheck;

    const resolved = existsCheck.resolvedPath;
    const content = fs.readFileSync(resolved, 'utf8');
    const lines = content.split('\n');
    const failures = [];

    // Check min / max lines
    if (lines.length < minLines) {
      failures.push(`Line count (${lines.length}) below minimum required (${minLines})`);
    }
    if (maxLines !== null && lines.length > maxLines) {
      failures.push(`Line count (${lines.length}) exceeds maximum limit (${maxLines})`);
    }

    // Required strings
    for (const pattern of (Array.isArray(contains) ? contains : [contains])) {
      if (pattern && !content.includes(pattern)) {
        failures.push(`Required string missing: "${pattern.slice(0, 80)}"`);
      }
    }

    // Prohibited strings
    for (const pattern of (Array.isArray(notContains) ? notContains : [notContains])) {
      if (pattern && content.includes(pattern)) {
        failures.push(`Forbidden string detected: "${pattern.slice(0, 80)}"`);
      }
    }

    // Regex assertion
    if (regex) {
      const regObj = typeof regex === 'string' ? new RegExp(regex) : regex;
      if (!regObj.test(content)) {
        failures.push(`Content failed to match regex pattern: ${regObj.toString()}`);
      }
    }

    // Check for lazy mock placeholders
    if (forbidPlaceholders) {
      const placeholderPatterns = [
        /\/\/\s*TODO:?\s*implement/i,
        /\/\/\s*stub/i,
        /throw new Error\(["']not implemented["']\)/i,
        /console\.log\(["']TODO["']\)/i,
        /pass\s*#\s*TODO/i
      ];
      for (const ph of placeholderPatterns) {
        if (ph.test(content)) {
          failures.push(`Unimplemented mock placeholder detected: ${ph.toString()}`);
          break;
        }
      }
    }

    // JSON syntax validation
    if (jsonValid) {
      try {
        JSON.parse(content);
      } catch (err) {
        failures.push(`Invalid JSON syntax: ${err.message}`);
      }
    }

    const sha256 = crypto.createHash('sha256').update(content).digest('hex');

    return {
      passed: failures.length === 0,
      check: 'file_content',
      path: targetPath,
      linesCount: lines.length,
      sha256,
      failures
    };
  }

  /**
   * 3. Patch Integrity Validation
   */
  verifyPatch(targetPath, originalContent, patchHunk) {
    const existsCheck = this.verifyFileExists(targetPath);
    if (!existsCheck.passed) return existsCheck;

    const currentContent = fs.readFileSync(existsCheck.resolvedPath, 'utf8');
    
    // Check if patch actually altered file from original
    const modified = currentContent !== originalContent;
    if (!modified) {
      return {
        passed: false,
        check: 'patch_validation',
        path: targetPath,
        error: 'File content was identical before and after patch application (no-op patch)'
      };
    }

    // Basic syntax check for JS/JSON files
    const ext = path.extname(targetPath).toLowerCase();
    if (ext === '.json') {
      try {
        JSON.parse(currentContent);
      } catch (err) {
        return {
          passed: false,
          check: 'patch_validation',
          path: targetPath,
          error: `Patch introduced invalid JSON syntax: ${err.message}`
        };
      }
    }

    return {
      passed: true,
      check: 'patch_validation',
      path: targetPath,
      modified: true
    };
  }

  /**
   * 4. Build Verification
   */
  verifyBuild({ command = 'npm run build', cwd = this.workspaceRoot, timeoutMs = this.timeoutMs } = {}) {
    const startTime = Date.now();
    try {
      const cleanEnv = { ...process.env };
      delete cleanEnv.NODE_TEST_CONTEXT;

      const stdout = execSync(command, {
        cwd,
        timeout: timeoutMs,
        encoding: 'utf8',
        env: cleanEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      });
      return {
        passed: true,
        check: 'build_verification',
        command,
        durationMs: Date.now() - startTime,
        stdout: stdout.slice(-2000),
        exitCode: 0
      };
    } catch (err) {
      return {
        passed: false,
        check: 'build_verification',
        command,
        durationMs: Date.now() - startTime,
        exitCode: err.status ?? 1,
        stdout: (err.stdout || '').slice(-2000),
        stderr: (err.stderr || err.message || '').slice(-2000),
        error: `Build failed with exit code ${err.status ?? 1}`
      };
    }
  }

  /**
   * 5. Automated Test Execution Verification
   * Invariant: Never claim tests passed if they were not run!
   */
  verifyTests({ command, cwd = this.workspaceRoot, timeoutMs = this.timeoutMs } = {}) {
    if (!command) {
      return {
        passed: false,
        check: 'test_execution',
        error: 'No test command specified. Refusing to report tests passed without actual execution.'
      };
    }

    const startTime = Date.now();
    try {
      const cleanEnv = { ...process.env };
      delete cleanEnv.NODE_TEST_CONTEXT;

      const stdout = execSync(command, {
        cwd,
        timeout: timeoutMs,
        encoding: 'utf8',
        env: cleanEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      });

      // Parse TAP / summary output
      const passMatch = stdout.match(/(?:# pass|passed:?)\s*(\d+)/i);
      const failMatch = stdout.match(/(?:# fail|failed:?)\s*(\d+)/i);
      const totalMatch = stdout.match(/(?:# tests|total:?)\s*(\d+)/i);

      const passCount = passMatch ? Number(passMatch[1]) : 0;
      const failCount = failMatch ? Number(failMatch[1]) : 0;
      const totalCount = totalMatch ? Number(totalMatch[1]) : (passCount + failCount);

      const testsActuallyRan = totalCount > 0 || passCount > 0 || /ok \d+/i.test(stdout);
      if (!testsActuallyRan) {
        return {
          passed: false,
          check: 'test_execution',
          command,
          durationMs: Date.now() - startTime,
          stdout: stdout.slice(-2000),
          error: 'Test command exited code 0 but zero test assertions were executed (no tests found)'
        };
      }

      return {
        passed: failCount === 0,
        check: 'test_execution',
        command,
        durationMs: Date.now() - startTime,
        passCount,
        failCount,
        totalCount,
        stdout: stdout.slice(-2000),
        exitCode: 0
      };
    } catch (err) {
      return {
        passed: false,
        check: 'test_execution',
        command,
        durationMs: Date.now() - startTime,
        exitCode: err.status ?? 1,
        stdout: (err.stdout || '').slice(-2000),
        stderr: (err.stderr || err.message || '').slice(-2000),
        error: `Tests failed with exit code ${err.status ?? 1}`
      };
    }
  }

  /**
   * 6. Git Diff & Change Boundary Inspection
   */
  verifyGitDiff({
    expectedFiles = [],
    forbiddenFiles = ['.env', 'id_rsa', 'package-lock.json'],
    forbiddenPatterns = [/AKIA[0-9A-Z]{16}/, /ghp_[0-9a-zA-Z]{36}/] // API key leakage checks
  } = {}) {
    try {
      const statusOutput = execSync('git status --porcelain', {
        cwd: this.workspaceRoot,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      });

      const changedFiles = statusOutput
        .split('\n')
        .map(l => l.trim().slice(3).trim())
        .filter(f => f.length > 0);

      const violations = [];

      // Check forbidden files
      for (const forbidden of forbiddenFiles) {
        if (changedFiles.some(f => f.includes(forbidden))) {
          violations.push(`Forbidden sensitive file modified or staged: "${forbidden}"`);
        }
      }

      // Check expected files if specified
      if (expectedFiles.length > 0) {
        for (const exp of expectedFiles) {
          if (!changedFiles.some(f => f.includes(exp))) {
            violations.push(`Expected target file was not modified in git: "${exp}"`);
          }
        }
      }

      // Check diff for credential leaks
      const diffOutput = execSync('git diff HEAD', {
        cwd: this.workspaceRoot,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      });

      for (const pattern of forbiddenPatterns) {
        if (pattern.test(diffOutput)) {
          violations.push(`Potential credential leak detected in git diff matching: ${pattern.toString()}`);
        }
      }

      return {
        passed: violations.length === 0,
        check: 'git_diff',
        changedFiles,
        violations
      };
    } catch (err) {
      return {
        passed: false,
        check: 'git_diff',
        error: `Failed to inspect git diff: ${err.message}`
      };
    }
  }

  /**
   * Comprehensive Multi-Check Verification Pipeline
   */
  async runSuite(verificationPlan) {
    const startTime = Date.now();
    const results = [];
    let allPassed = true;

    for (const step of verificationPlan.steps || []) {
      let stepResult = null;
      try {
        if (step.type === 'file_exists') {
          stepResult = this.verifyFileExists(step.path, step.options);
        } else if (step.type === 'file_content') {
          stepResult = this.verifyFileContent(step.path, step.options);
        } else if (step.type === 'build') {
          stepResult = this.verifyBuild(step.options);
        } else if (step.type === 'tests') {
          stepResult = this.verifyTests(step.options);
        } else if (step.type === 'git_diff') {
          stepResult = this.verifyGitDiff(step.options);
        } else {
          stepResult = { passed: false, error: `Unknown verification step type: "${step.type}"` };
        }
      } catch (err) {
        stepResult = { passed: false, check: step.type, error: err.message };
      }

      results.push({ name: step.name || step.type, ...stepResult });
      if (!stepResult.passed) {
        allPassed = false;
        if (verificationPlan.bailFast) break;
      }
    }

    return {
      passed: allPassed,
      totalChecks: results.length,
      passedChecks: results.filter(r => r.passed).length,
      failedChecks: results.filter(r => !r.passed).length,
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
      results
    };
  }
}

module.exports = VerificationEngine;
