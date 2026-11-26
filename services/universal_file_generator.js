/**
 * AXOM Universal File Generator Engine
 * Generates, compiles, and packages any file format (PDF, ZIP, TAR, HTML, JSON, CSV, Markdown, Binary).
 * Supports automatic Desktop/workspace alias resolution and provides ready-to-download URLs.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const os = require('node:os');
const crypto = require('node:crypto');
const { dataDir } = require('../data_paths');
const { runSilentProcess } = require('./silent_process');
const workspaceService = require('./workspace_service');

const USER_DESKTOP = path.join(process.env.USERPROFILE || os.homedir(), 'Desktop');
const PathGuard = require('../agent/path_guard');
const workspaceRoot = () => {
  const root = workspaceService.getActiveWorkspace()?.path || path.join(dataDir, 'workspace');
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error('The active project folder is unavailable. Select a folder that still exists.');
  return root;
};
const getPathGuard = () => new PathGuard({ approvedRoots: [workspaceRoot()] });

function writeWorkspaceFile(target, data, encoding = null) {
  const guard = getPathGuard();
  const safeTarget = guard.resolveSafePath(target, { allowCreate: true });
  const parent = path.dirname(safeTarget);
  if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });
  if (guard.resolveSafePath(target, { allowCreate: true }) !== safeTarget) throw new Error('File target changed during validation');
  const temp = path.join(parent, `.abyx-${crypto.randomUUID()}.tmp`);
  let fd;
  try {
    fd = fs.openSync(temp, 'wx', 0o600);
    if (encoding) fs.writeFileSync(fd, data, encoding);
    else fs.writeFileSync(fd, data);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    if (guard.resolveSafePath(target, { allowCreate: true }) !== safeTarget) throw new Error('File target failed final validation');
    fs.renameSync(temp, safeTarget);
  } catch (error) {
    if (fd !== null && fd !== undefined) fs.closeSync(fd);
    try { fs.unlinkSync(temp); } catch (_) {}
    throw error;
  }
  return safeTarget;
}

function removeWorkspaceFile(target) {
  const safeTarget = getPathGuard().resolveSafePath(target);
  if (fs.existsSync(safeTarget)) fs.unlinkSync(safeTarget);
}

/**
 * Safely resolves target paths with Desktop and workspace aliases, guarded against path traversal and secret access
 */
function resolveSafePath(inputPath) {
  const root = workspaceRoot();
  const pathGuard = getPathGuard();
  if (!inputPath) return path.join(root, `file_${Date.now()}.txt`);
  let clean = inputPath.trim().replace(/^['"]|['"]$/g, '');
  clean = clean.replace(/^(?:desktop|workspace)[\/\\]/i, '');
  if (/^(?:desktop|workspace)$/i.test(clean)) clean = '';
  if (!clean) clean = `file_${Date.now()}.txt`;
  return pathGuard.resolveSafePath(clean, { allowCreate: true, baseDir: root });
}

/**
 * Converts an absolute path to a clean, user-facing relative alias
 */
function getRelativeAlias(fullPath) {
  if (!fullPath) return '';
  const norm = path.normalize(fullPath);
  const normDesktop = path.normalize(USER_DESKTOP);
  const normWorkspace = path.normalize(workspaceRoot());

  if (norm.toLowerCase().startsWith(normDesktop.toLowerCase())) {
    const rel = path.relative(normDesktop, norm);
    return `Desktop/${rel.replace(/\\/g, '/')}`;
  }
  if (norm.toLowerCase().startsWith(normWorkspace.toLowerCase())) {
    const rel = path.relative(normWorkspace, norm);
    return rel.replace(/\\/g, '/');
  }
  return norm;
}

/**
 * Detect MIME types for file serving & direct browser download
 */
function getMimeType(filePath) {
  const ext = path.extname(filePath || '').toLowerCase();
  const mimeMap = {
    '.pdf': 'application/pdf',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.rtf': 'application/rtf',
    '.zip': 'application/zip',
    '.tar': 'application/x-tar',
    '.gz': 'application/gzip',
    '.tgz': 'application/gzip',
    '.rar': 'application/vnd.rar',
    '.7z': 'application/x-7z-compressed',
    '.html': 'text/html; charset=utf-8',
    '.htm': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.md': 'text/markdown; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.csv': 'text/csv; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.py': 'text/x-python; charset=utf-8',
    '.rs': 'text/x-rust; charset=utf-8',
    '.sh': 'text/x-shellscript; charset=utf-8',
    '.ps1': 'text/plain; charset=utf-8'
  };
  return mimeMap[ext] || 'application/octet-stream';
}

/**
 * Run a Python helper script safely using silent runner (0ms window popup, 100% bypass of Windows Terminal)
 */
async function runPythonScript(scriptPath, args = []) {
  const pythonExe = process.env.PYTHON_PATH || 'python';
  const res = await runSilentProcess(pythonExe, [scriptPath, ...args], {
    cwd: workspaceRoot(),
    timeoutMs: 15000
  });

  if (res.ok) {
    return { stdout: res.stdout, stderr: res.stderr };
  } else {
    throw new Error(`Python script failed (${res.exitCode}): ${res.stderr || res.stdout}`);
  }
}

/**
 * Core Universal File Generator
 */
async function generateFile({
  filePath,
  fileType,
  content = '',
  title,
  author = 'AXOM Intelligence',
  files = null,
  base64Data = null,
  sourceDir = null
}) {
  const targetPath = resolveSafePath(filePath);
  const targetDir = path.dirname(targetPath);
  if (!fs.existsSync(targetDir)) {
    getPathGuard().resolveSafePath(targetPath, { allowCreate: true });
    fs.mkdirSync(targetDir, { recursive: true });
    getPathGuard().resolveSafePath(targetPath, { allowCreate: true });
  }

  const ext = path.extname(targetPath).toLowerCase();
  const effectiveType = (fileType || ext.replace(/^\./, '') || 'txt').toLowerCase();

  // 1. PDF Generation
  if (effectiveType === 'pdf' || ext === '.pdf') {
    const pdfScript = path.join(__dirname, '..', 'scripts', 'pdf_builder.py');
    const docTitle = title || path.basename(targetPath, path.extname(targetPath)).replace(/[-_]/g, ' ');
    
    // Write temp payload file to avoid PowerShell argument length & quote escaping limits
    const tempPayloadPath = path.join(workspaceRoot(), `temp_pdf_${crypto.randomUUID()}.json`);
    const payloadDir = path.dirname(tempPayloadPath);
    if (!fs.existsSync(payloadDir)) {
      getPathGuard().resolveSafePath(tempPayloadPath, { allowCreate: true });
      fs.mkdirSync(payloadDir, { recursive: true });
    }

    writeWorkspaceFile(tempPayloadPath, JSON.stringify({
      output: targetPath,
      title: docTitle,
      author: author || 'AXOM Intelligence',
      content: content || `# ${docTitle}\n\nGenerated by AXOM Intelligence Engine.`
    }), 'utf8');

    try {
      const res = await runPythonScript(pdfScript, ['--json', tempPayloadPath]);
      try { removeWorkspaceFile(tempPayloadPath); } catch (_) {}
      
      const stats = fs.statSync(targetPath);
      const alias = getRelativeAlias(targetPath);
      return {
        success: true,
        action: 'generate_file',
        file_path: targetPath,
        relative_path: alias,
        file_name: path.basename(targetPath),
        file_type: 'pdf',
        size_bytes: stats.size,
        download_url: `/api/files/download?path=${encodeURIComponent(alias)}`,
        message: `Successfully generated PDF document (${stats.size} bytes) at: ${alias}`
      };
    } catch (err) {
      try { removeWorkspaceFile(tempPayloadPath); } catch (_) {}
      throw err;
    }
  }

  // 2. Archive Generation (ZIP, TAR, TAR.GZ, RAR)
  if (['zip', 'tar', 'tgz', 'gz', 'rar'].includes(effectiveType) || ['.zip', '.tar', '.tgz', '.tar.gz', '.rar'].includes(ext)) {
    const archiveScript = path.join(__dirname, '..', 'scripts', 'archive_builder.py');
    let archiveTargetPath = targetPath;
    if (ext === '.rar') {
      // Create universal zip with appropriate archive format for cross-platform compatibility
      archiveTargetPath = targetPath.replace(/\.rar$/i, '.zip');
    }

    const tempJsonPath = path.join(workspaceRoot(), `temp_archive_${crypto.randomUUID()}.json`);
    const payloadDir = path.dirname(tempJsonPath);
    if (!fs.existsSync(payloadDir)) {
      getPathGuard().resolveSafePath(tempJsonPath, { allowCreate: true });
      fs.mkdirSync(payloadDir, { recursive: true });
    }

    let args = ['--output', archiveTargetPath];

    if (sourceDir && fs.existsSync(sourceDir)) {
      const safeSourceDir = getPathGuard().resolveSafePath(sourceDir);
      if (!fs.statSync(safeSourceDir).isDirectory()) throw new Error('Archive source must be a workspace directory');
      args.push('--source-dir', safeSourceDir);
    } else {
      let entries = [];
      if (Array.isArray(files) && files.length > 0) {
        entries = files;
      } else if (content) {
        entries = [{
          path: 'content.txt',
          content: content
        }];
      } else {
        entries = [{
          path: 'README.txt',
          content: 'Created by AXOM Archive Engine'
        }];
      }
      writeWorkspaceFile(tempJsonPath, JSON.stringify(entries), 'utf8');
      args.push('--json', tempJsonPath);
    }

    try {
      await runPythonScript(archiveScript, args);
      try { removeWorkspaceFile(tempJsonPath); } catch (_) {}

      const stats = fs.statSync(archiveTargetPath);
      const alias = getRelativeAlias(archiveTargetPath);
      return {
        success: true,
        action: 'generate_file',
        file_path: archiveTargetPath,
        relative_path: alias,
        file_name: path.basename(archiveTargetPath),
        file_type: 'zip',
        size_bytes: stats.size,
        download_url: `/api/files/download?path=${encodeURIComponent(alias)}`,
        message: `Successfully generated archive (${stats.size} bytes) at: ${alias}`
      };
    } catch (err) {
      try { removeWorkspaceFile(tempJsonPath); } catch (_) {}
      throw err;
    }
  }

  // 2b. Office Documents & Spreadsheets & Presentations (.docx, .xlsx, .pptx) & Raster Graphics (.png, .jpg, .webp, .ico, .bmp, .gif)
  const officeTypes = ['docx', 'xlsx', 'pptx'];
  const imageTypes = ['png', 'jpg', 'jpeg', 'webp', 'ico', 'bmp', 'gif'];
  const cleanExt = ext.replace(/^\./, '');
  const isOffice = officeTypes.includes(effectiveType) || officeTypes.includes(cleanExt);
  const isRasterImage = !base64Data && (imageTypes.includes(effectiveType) || imageTypes.includes(cleanExt));

  if (isOffice || isRasterImage) {
    const officeScript = path.join(__dirname, '..', 'scripts', 'office_builder.py');
    const docTitle = title || path.basename(targetPath, path.extname(targetPath)).replace(/[-_]/g, ' ');
    const builderType = isOffice ? (officeTypes.includes(cleanExt) ? cleanExt : effectiveType) : 'image';
    const tempPayloadPath = path.join(workspaceRoot(), `temp_office_${crypto.randomUUID()}.json`);
    const payloadDir = path.dirname(tempPayloadPath);
    if (!fs.existsSync(payloadDir)) {
      getPathGuard().resolveSafePath(tempPayloadPath, { allowCreate: true });
      fs.mkdirSync(payloadDir, { recursive: true });
    }

    writeWorkspaceFile(tempPayloadPath, JSON.stringify({
      output: targetPath,
      title: docTitle,
      author: author || 'ABYX Intelligence',
      content: content || `# ${docTitle}\n\nGenerated by ABYX Intelligence Engine.`
    }), 'utf8');

    try {
      await runPythonScript(officeScript, ['--type', builderType, '--json', tempPayloadPath]);
      try { removeWorkspaceFile(tempPayloadPath); } catch (_) {}

      const stats = fs.statSync(targetPath);
      const alias = getRelativeAlias(targetPath);
      return {
        success: true,
        action: 'generate_file',
        file_path: targetPath,
        relative_path: alias,
        file_name: path.basename(targetPath),
        file_type: builderType,
        size_bytes: stats.size,
        download_url: `/api/files/download?path=${encodeURIComponent(alias)}`,
        message: `Successfully generated ${builderType.toUpperCase()} file (${stats.size} bytes) at: ${alias}`
      };
    } catch (err) {
      try { removeWorkspaceFile(tempPayloadPath); } catch (_) {}
      throw err;
    }
  }

  // 2c. Rich Text Format (.rtf)
  if (effectiveType === 'rtf' || ext === '.rtf') {
    const escaped = String(content || '').replace(/\\/g, '\\\\').replace(/\{/g, '\\{').replace(/\}/g, '\\}').replace(/\r?\n/g, '\\par\n');
    const rtfBody = `{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Calibri;}}\\fs22 ${escaped}}`;
    writeWorkspaceFile(targetPath, rtfBody, 'utf8');
    const stats = fs.statSync(targetPath);
    const alias = getRelativeAlias(targetPath);
    return {
      success: true,
      action: 'generate_file',
      file_path: targetPath,
      relative_path: alias,
      file_name: path.basename(targetPath),
      file_type: 'rtf',
      size_bytes: stats.size,
      download_url: `/api/files/download?path=${encodeURIComponent(alias)}`,
      message: `Successfully generated RTF document (${stats.size} bytes) at: ${alias}`
    };
  }

  // 3. Binary / Base64 Data
  if (base64Data) {
    const buf = Buffer.from(base64Data, 'base64');
    writeWorkspaceFile(targetPath, buf);
    const stats = fs.statSync(targetPath);
    const alias = getRelativeAlias(targetPath);
    return {
      success: true,
      action: 'generate_file',
      file_path: targetPath,
      relative_path: alias,
      file_name: path.basename(targetPath),
      file_type: effectiveType,
      size_bytes: stats.size,
      download_url: `/api/files/download?path=${encodeURIComponent(alias)}`,
      message: `Successfully written binary file (${stats.size} bytes) at: ${alias}`
    };
  }

  // 4. Standard Text, HTML, Code, Markdown, CSV, JSON
  writeWorkspaceFile(targetPath, content || '', 'utf8');
  const stats = fs.statSync(targetPath);
  const alias = getRelativeAlias(targetPath);

  return {
    success: true,
    action: 'write_file',
    file_path: targetPath,
    relative_path: alias,
    file_name: path.basename(targetPath),
    file_type: effectiveType,
    size_bytes: stats.size,
    download_url: `/api/files/download?path=${encodeURIComponent(alias)}`,
    message: `Successfully generated file (${stats.size} bytes) at: ${alias}`
  };
}

module.exports = {
  resolveSafePath,
  getRelativeAlias,
  getMimeType,
  generateFile,
  USER_DESKTOP,
  get WORKSPACE_DIR() { return workspaceRoot(); }
};
