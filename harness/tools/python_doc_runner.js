/**
 * Python Document & Media Tool Runner
 * Dispatches PDF (ReportLab), DOCX (python-docx), XLSX (openpyxl with formulas),
 * PPTX (python-pptx), Image (Pillow), and ZIP operations with SHA-256 verification.
 */

const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

class PythonDocRunner {
  constructor(workspaceRoot = process.cwd()) {
    this.workspaceRoot = path.resolve(workspaceRoot);
    const servicesPath = path.resolve(__dirname, '..', '..', 'services', 'python_doc_tools.py');
    const toolsPath = path.resolve(__dirname, '..', '..', 'tools', 'python_doc_tools.py');
    this.scriptPath = fs.existsSync(servicesPath) ? servicesPath : toolsPath;
    this.name = 'advanced_doc_generator';
    this.description = 'Generates verified PDF (ReportLab), DOCX (python-docx), XLSX (openpyxl with formulas), PPTX (python-pptx), Images (Pillow), and ZIP archives.';
  }

  getSchema() {
    return {
      type: 'object',
      properties: {
        tool: {
          type: 'string',
          enum: ['pdf', 'docx', 'xlsx', 'pptx', 'image', 'zip'],
          description: 'Type of document or media operation'
        },
        outputPath: { type: 'string', description: 'Relative path for generated file' },
        title: { type: 'string', description: 'Document or presentation title' },
        paragraphs: { type: 'array', items: { type: 'string' } },
        sections: { type: 'array', items: { type: 'object' } },
        sheetName: { type: 'string' },
        headers: { type: 'array', items: { type: 'string' } },
        rows: { type: 'array', items: { type: 'array' } },
        formulaCell: { type: 'string' },
        formula: { type: 'string' },
        slides: { type: 'array', items: { type: 'object' } },
        action: { type: 'string', enum: ['create', 'extract', 'verify'] },
        zipPath: { type: 'string' },
        files: { type: 'object' },
        extractTo: { type: 'string' }
      },
      required: ['tool']
    };
  }

  execute(payload) {
    const enrichedPayload = { ...payload };

    if (enrichedPayload.outputPath) {
      enrichedPayload.outputPath = path.resolve(this.workspaceRoot, enrichedPayload.outputPath);
    }
    if (enrichedPayload.zipPath) {
      enrichedPayload.zipPath = path.resolve(this.workspaceRoot, enrichedPayload.zipPath);
    }
    if (enrichedPayload.extractTo) {
      enrichedPayload.extractTo = path.resolve(this.workspaceRoot, enrichedPayload.extractTo);
    }

    const payloadJson = JSON.stringify(enrichedPayload);
    const res = spawnSync('python', [this.scriptPath, payloadJson], {
      cwd: this.workspaceRoot,
      encoding: 'utf-8',
      env: process.env,
      timeout: 30000
    });

    if (res.error) {
      return { error: `Subprocess error: ${res.error.message}` };
    }

    const stdout = (res.stdout || '').trim();
    if (res.status !== 0) {
      return {
        error: `Python document tool failed with code ${res.status}`,
        stderr: res.stderr || stdout
      };
    }

    try {
      return JSON.parse(stdout);
    } catch (_) {
      return { output: stdout, status: 'completed' };
    }
  }
}

module.exports = { PythonDocRunner };
