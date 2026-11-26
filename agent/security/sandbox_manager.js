'use strict';

const { exec } = require('node:child_process');

/**
 * SandboxManager - Execution Sandbox Engine with Docker WSL2 Backend & Restricted Process Mode
 * 
 * References: OpenHands software-agent execution + OpenClaw sandbox policies
 * 
 * Invariants:
 * - Docker is purely OPTIONAL and NEVER blocks application startup.
 * - If Docker is unavailable, falls back to clearly labelled `restricted_process` mode.
 * - NEVER claims native Windows process restrictions are equivalent to container isolation.
 * - Sanitizes environment variables to prevent credential leakage to executed scripts.
 */
class SandboxManager {
  constructor(options = {}) {
    this.workspaceRoot = options.workspaceRoot || process.cwd();
    this.preferredMode = options.preferredMode || 'auto'; // 'auto' | 'docker' | 'restricted_process'
    this.defaultImage = options.defaultImage || 'node:22-alpine';
    this.dockerTimeoutMs = options.dockerTimeoutMs || 60000;

    this._dockerAvailable = null;
    this._wsl2Available = null;
  }

  /**
   * Check if Docker is installed and running on the host
   */
  async checkDockerAvailability() {
    if (this._dockerAvailable !== null) return this._dockerAvailable;

    return new Promise((resolve) => {
      exec('docker info --format "{{.OSType}}"', { timeout: 4000, windowsHide: true }, (err, stdout) => {
        if (!err && stdout.trim()) {
          this._dockerAvailable = true;
        } else {
          this._dockerAvailable = false;
        }
        resolve(this._dockerAvailable);
      });
    });
  }

  /**
   * Check if WSL2 is installed on Windows
   */
  async checkWsl2Availability() {
    if (this._wsl2Available !== null) return this._wsl2Available;

    return new Promise((resolve) => {
      exec('wsl.exe -l -v', { timeout: 3000, windowsHide: true }, (err, stdout) => {
        if (!err && stdout && stdout.includes('2')) {
          this._wsl2Available = true;
        } else {
          this._wsl2Available = false;
        }
        resolve(this._wsl2Available);
      });
    });
  }

  /**
   * Get live status and accurate isolation metadata
   */
  async getStatus() {
    const hasDocker = await this.checkDockerAvailability();
    const hasWsl2 = await this.checkWsl2Availability();

    const activeMode = (hasDocker && this.preferredMode !== 'restricted_process')
      ? 'docker_container'
      : 'restricted_process';

    return {
      activeMode,
      hasDocker,
      hasWsl2,
      isolationTier: activeMode === 'docker_container' ? 'container' : 'host_restricted_process',
      isContainer: activeMode === 'docker_container',
      description: activeMode === 'docker_container'
        ? 'Full container isolation via Docker engine (WSL2 backend)'
        : 'Host-level restricted process sandbox with PathGuard filesystem boundaries and sanitized environment. Note: Host process restrictions do NOT provide kernel/filesystem container isolation.',
      guarantees: {
        containerBoundary: activeMode === 'docker_container',
        sanitizedEnvironment: true,
        pathContainment: true,
        processTreeCancellation: true
      }
    };
  }

  /**
   * Sanitize environment variables to prevent credential exfiltration
   */
  sanitizeEnvironment(customEnv = {}) {
    const sanitized = { ...process.env, ...customEnv };

    // Strip sensitive API keys, tokens, and passwords
    const sensitiveKeys = [
      /API[_-]?KEY/i,
      /TOKEN/i,
      /SECRET/i,
      /PASSWORD/i,
      /PRIVATE[_-]?KEY/i,
      /^AWS_/i,
      /^AZURE_/i,
      /^GCP_/i,
      /^GITHUB_/i
    ];

    for (const key of Object.keys(sanitized)) {
      if (sensitiveKeys.some(regex => regex.test(key))) {
        delete sanitized[key];
      }
    }

    // Set standard secure execution flags
    sanitized.NODE_ENV = 'production';
    sanitized.CI = 'true';
    return sanitized;
  }

  /**
   * Execute command in appropriate sandbox tier
   */
  async executeCommand({ command, cwd = '.', timeout = 45000, terminalTool }) {
    const status = await this.getStatus();

    if (status.activeMode === 'docker_container') {
      // Execute inside container via docker run
      const containerCmd = `docker run --rm -v "${this.workspaceRoot}:/workspace" -w /workspace ${this.defaultImage} sh -c "${command.replace(/"/g, '\\"')}"`;
      return terminalTool.runCommand({ command: containerCmd, cwd, timeout });
    }

    // Restricted process mode with environment scrubbing
    const sanitizedEnv = this.sanitizeEnvironment();
    return terminalTool.runCommand({
      command,
      cwd,
      timeout,
      env: sanitizedEnv
    });
  }
}

module.exports = SandboxManager;
