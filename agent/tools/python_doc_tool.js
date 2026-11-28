'use strict';

/**
 * Python Document & Media Tool
 * Bridges the agent tool gateway to the verified Python document suite:
 * ReportLab PDF, python-docx, openpyxl XLSX (with live formulas),
 * python-pptx PPTX, Pillow images, and SHA-256 verified ZIP archives.
 */

const { spawnSync } = require('node:child_process');
const path = require('node:path');

class PythonDocTool {
  constructor(workspaceRoot = process.cwd()) {
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.scriptPath = path.resolve(__dirname, '..', '..', 'services', 'python_doc_tools.py');
  }

  execute(payload) {
    const enrichedPayload = { ...payload };

    if (enrichedPayload.outputPath && !path.isAbsolute(enrichedPayload.outputPath)) {
      enrichedPayload.outputPath = path.resolve(this.workspaceRoot, enrichedPayload.outputPath);
    }
    if (enrichedPayload.zipPath && !path.isAbsolute(enrichedPayload.zipPath)) {
      enrichedPayload.zipPath = path.resolve(this.workspaceRoot, enrichedPayload.zipPath);
    }
    if (enrichedPayload.extractTo && !path.isAbsolute(enrichedPayload.extractTo)) {
      enrichedPayload.extractTo = path.resolve(this.workspaceRoot, enrichedPayload.extractTo);
    }

    const payloadJson = JSON.stringify(enrichedPayload);
    const res = spawnSync('python', [this.scriptPath, payloadJson], {
      cwd: this.workspaceRoot,
      encoding: 'utf-8',
      timeout: 30000,
      env: { ...process.env, PYTHONUNBUFFERED: '1' }
    });

    if (res.error) {
      return { success: false, error: res.error.message, status: 'error' };
    }

    try {
      const output = JSON.parse(res.stdout);
      return {
        success: output.status === 'success',
        ...output
      };
    } catch (_) {
      return {
        success: res.status === 0,
        rawOutput: res.stdout,
        error: res.stderr || 'Failed to parse JSON result from python_doc_tools'
      };
    }
  }
}

module.exports = PythonDocTool;
module.exports.PythonDocTool = PythonDocTool;
