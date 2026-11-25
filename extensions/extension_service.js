/**
 * ABYX Extension & Skill Ingestion Service
 * 
 * Supports:
 * - Direct installation from GitHub URLs (repos, subdirectories, or raw SKILL.md files)
 * - Direct installation from Local Disk paths (folders or single files)
 * - Auto-detection of Skills, Plugins, and MCP Servers
 * - Strict permission gating and immediate runtime activation
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const PackageManager = require('./package_manager');
const { ExtensionKind, ExtensionStatus } = require('./types');
const { dataDir } = require('../data_paths');
let abyxSkills = null;
try { abyxSkills = require('../services/abyx_skills'); } catch {}

let mcpClient = null;
try { mcpClient = require('../services/mcp_client'); } catch (e) {}

class ExtensionService {
  constructor(profileRoot = dataDir) {
    this.profileRoot = path.resolve(profileRoot);
    this.profileId = path.basename(this.profileRoot);
    const profileExtensions = path.join(this.profileRoot, 'extensions');
    const legacyExtensions = path.join(dataDir, 'extensions');
    if (this.profileId === 'prof_default' && !fs.existsSync(profileExtensions) && fs.existsSync(legacyExtensions)) {
      fs.mkdirSync(this.profileRoot, { recursive: true });
      fs.cpSync(legacyExtensions, profileExtensions, { recursive: true, errorOnExist: false, force: false });
    }
    this.packageManager = new PackageManager(null, { extensionsDir: profileExtensions });
  }

  /**
   * Parse a GitHub URL into owner, repo, branch, and subpath
   */
  parseGitHubUrl(input) {
    if (!input || typeof input !== 'string') return null;
    const str = input.trim();

    // Raw GitHub user content URL
    // e.g. https://raw.githubusercontent.com/owner/repo/main/path/to/SKILL.md
    const rawMatch = str.match(/^https?:\/\/raw\.githubusercontent\.com\/([^\/]+)\/([^\/]+)\/([^\/]+)\/(.+)$/i);
    if (rawMatch) {
      return {
        isRawFile: true,
        owner: rawMatch[1],
        repo: rawMatch[2],
        branch: rawMatch[3],
        filePath: rawMatch[4],
        rawUrl: str
      };
    }

    // Standard GitHub repo or tree URL
    // e.g. https://github.com/owner/repo/tree/main/sub/path
    // or https://github.com/owner/repo
    const ghMatch = str.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([^\/]+)\/([^\/\s#?]+)(?:\/(?:tree|blob)\/([^\/\s#?]+)(?:\/(.+))?)?/i);
    if (ghMatch) {
      return {
        isRawFile: false,
        owner: ghMatch[1],
        repo: ghMatch[2].replace(/\.git$/i, ''),
        branch: ghMatch[3] || 'main',
        subPath: ghMatch[4] ? ghMatch[4].replace(/\/+$/, '') : null
      };
    }

    // Shorthand: owner/repo
    const shortMatch = str.match(/^([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)$/);
    if (shortMatch && !str.includes('\\') && !fs.existsSync(str)) {
      return {
        isRawFile: false,
        owner: shortMatch[1],
        repo: shortMatch[2],
        branch: 'main',
        subPath: null
      };
    }

    return null;
  }

  /**
   * Download a GitHub repository or raw file to a temporary staging folder
   */
  async downloadFromGitHub(ghInfo) {
    const stageDir = path.join(os.tmpdir(), `abyx_pkg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
    fs.mkdirSync(stageDir, { recursive: true });

    // 1. Raw file download (e.g. SKILL.md)
    if (ghInfo.isRawFile) {
      const res = await fetch(ghInfo.rawUrl);
      if (!res.ok) {
        throw new Error(`Failed to download raw file from GitHub (${res.status}): ${res.statusText}`);
      }
      const text = await res.text();
      const targetName = path.basename(ghInfo.filePath) || 'SKILL.md';
      fs.writeFileSync(path.join(stageDir, targetName), text, 'utf8');
      if (targetName.toLowerCase() !== 'skill.md') {
        fs.writeFileSync(path.join(stageDir, 'SKILL.md'), text, 'utf8');
      }
      return stageDir;
    }

    // 2. Repository zip archive download
    const zipPath = path.join(os.tmpdir(), `abyx_repo_${Date.now()}.zip`);
    const extractPath = path.join(os.tmpdir(), `abyx_extracted_${Date.now()}`);

    const tryBranches = [ghInfo.branch, 'main', 'master'].filter(Boolean);
    let downloaded = false;

    for (const br of tryBranches) {
      const zipUrl = `https://codeload.github.com/${ghInfo.owner}/${ghInfo.repo}/zip/refs/heads/${br}`;
      try {
        const res = await fetch(zipUrl);
        if (res.ok) {
          const arrayBuf = await res.arrayBuffer();
          fs.writeFileSync(zipPath, Buffer.from(arrayBuf));
          downloaded = true;
          break;
        }
      } catch (e) {}
    }

    if (!downloaded) {
      // Fallback: Try GitHub API archive link
      const fallbackUrl = `https://api.github.com/repos/${ghInfo.owner}/${ghInfo.repo}/zipball`;
      const res = await fetch(fallbackUrl, {
        headers: { 'User-Agent': 'ABYX-Assistant' }
      });
      if (!res.ok) {
        throw new Error(`Could not download GitHub repository "${ghInfo.owner}/${ghInfo.repo}". Please check the repository URL.`);
      }
      const arrayBuf = await res.arrayBuffer();
      fs.writeFileSync(zipPath, Buffer.from(arrayBuf));
    }

    // Extract zip cleanly using PowerShell Expand-Archive with windowsHide
    fs.mkdirSync(extractPath, { recursive: true });
    if (process.platform === 'win32') {
      const psCmd = `Expand-Archive -Path '${zipPath.replace(/'/g, "''")}' -DestinationPath '${extractPath.replace(/'/g, "''")}' -Force`;
      const res = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psCmd], {
        windowsHide: true,
        timeout: 30000
      });
      if (res.error) {
        throw new Error(`Failed to extract repository archive: ${res.error.message}`);
      }
    } else {
      spawnSync('unzip', ['-q', '-o', zipPath, '-d', extractPath], { timeout: 30000 });
    }

    try { fs.unlinkSync(zipPath); } catch (e) {}

    // Find the unpacked top-level directory (GitHub archives extract into <repo>-<branch>)
    const extractedEntries = fs.readdirSync(extractPath, { withFileTypes: true });
    let rootDir = extractPath;
    if (extractedEntries.length === 1 && extractedEntries[0].isDirectory()) {
      rootDir = path.join(extractPath, extractedEntries[0].name);
    }

    // If a subpath was requested (e.g. /tree/main/skills/python-pro)
    let packageDir = rootDir;
    if (ghInfo.subPath) {
      const candidateSub = path.join(rootDir, ...ghInfo.subPath.split('/'));
      if (fs.existsSync(candidateSub)) {
        packageDir = candidateSub;
      }
    }

    // Copy to final staging directory
    this.packageManager.copyDir(packageDir, stageDir);

    // Clean up extraction temp
    try { fs.rmSync(extractPath, { recursive: true, force: true }); } catch (e) {}

    return stageDir;
  }

  /**
   * Prepares and normalizes a package directory from either a GitHub URL or local disk path.
   * Auto-synthesizes manifest.json if missing for raw skills, plugins, or MCP servers.
   */
  async preparePackage(source) {
    if (!source || typeof source !== 'string' || !source.trim()) {
      throw new Error('Please enter a GitHub repository link or a local disk path.');
    }

    const trimmed = source.trim();
    const ghInfo = this.parseGitHubUrl(trimmed);

    let packageDir = '';
    let isTemp = false;

    if (ghInfo) {
      packageDir = await this.downloadFromGitHub(ghInfo);
      isTemp = true;
    } else {
      // Local disk path
      const resolved = path.resolve(trimmed);
      if (!fs.existsSync(resolved)) {
        throw new Error(`Local path does not exist on disk: "${trimmed}"`);
      }

      const stat = fs.statSync(resolved);
      if (stat.isFile()) {
        // Single file provided (e.g. SKILL.md or my_tool.js)
        const stageDir = path.join(os.tmpdir(), `abyx_pkg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
        fs.mkdirSync(stageDir, { recursive: true });
        const targetName = path.basename(resolved);
        fs.copyFileSync(resolved, path.join(stageDir, targetName));
        if (targetName.toLowerCase() !== 'skill.md' && targetName.toLowerCase().endsWith('.md')) {
          fs.copyFileSync(resolved, path.join(stageDir, 'SKILL.md'));
        }
        packageDir = stageDir;
        isTemp = true;
      } else {
        packageDir = resolved;
      }
    }

    // Auto-synthesize manifest.json if package contains SKILL.md, package.json, or mcp config
    this.ensureManifest(packageDir);

    return { packageDir, isTemp };
  }

  /**
   * Inspects a package directory and synthesizes manifest.json if absent
   */
  ensureManifest(dir) {
    const manifestPath = path.join(dir, 'manifest.json');
    if (fs.existsSync(manifestPath)) {
      return; // Already has manifest.json
    }

    const dirName = path.basename(dir).toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    const skillPath = path.join(dir, 'SKILL.md');
    const pkgJsonPath = path.join(dir, 'package.json');
    const mcpConfigPath = [
      path.join(dir, 'mcp.json'),
      path.join(dir, 'mcp_config.json'),
      path.join(dir, 'mcp-server.json')
    ].find(p => fs.existsSync(p));

    let manifest = null;

    if (fs.existsSync(skillPath)) {
      // Parse frontmatter
      const content = fs.readFileSync(skillPath, 'utf8');
      const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      const meta = {};
      if (fmMatch) {
        for (const line of fmMatch[1].split('\n')) {
          const idx = line.indexOf(':');
          if (idx !== -1) meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
        }
      }

      manifest = {
        id: (meta.name || dirName).toLowerCase().replace(/[^a-z0-9_-]/g, '-'),
        name: meta.name || dirName,
        version: meta.version || '1.0.0',
        kind: ExtensionKind.SKILL,
        description: meta.description || 'Custom engineering or domain skill',
        author: meta.author || 'User Provided',
        permissions: []
      };
    } else if (mcpConfigPath) {
      // MCP Server directory
      let mcpData = {};
      try { mcpData = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8')); } catch (e) {}

      manifest = {
        id: dirName,
        name: mcpData.name || dirName,
        version: mcpData.version || '1.0.0',
        kind: ExtensionKind.MCP,
        description: mcpData.description || 'Model Context Protocol tool server',
        author: mcpData.author || 'User Provided',
        permissions: ['terminal:execute'],
        tools: mcpData.tools || []
      };
    } else if (fs.existsSync(pkgJsonPath)) {
      // Node.js package
      let pkgData = {};
      try { pkgData = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8')); } catch (e) {}

      manifest = {
        id: (pkgData.name || dirName).toLowerCase().replace(/[^a-z0-9_-]/g, '-'),
        name: pkgData.name || dirName,
        version: pkgData.version || '1.0.0',
        kind: ExtensionKind.PLUGIN,
        description: pkgData.description || 'Custom JavaScript extension plugin',
        author: typeof pkgData.author === 'string' ? pkgData.author : (pkgData.author?.name || 'User Provided'),
        entryPoint: pkgData.main || 'index.js',
        permissions: ['filesystem:read'],
        tools: []
      };
    } else {
      // Generic folder: check for any markdown or index.js
      const files = fs.readdirSync(dir);
      const mdFile = files.find(f => f.toLowerCase().endsWith('.md'));
      const jsFile = files.find(f => f.toLowerCase().endsWith('.js'));

      if (mdFile) {
        // Create SKILL.md from the markdown file
        fs.copyFileSync(path.join(dir, mdFile), path.join(dir, 'SKILL.md'));
        manifest = {
          id: dirName,
          name: dirName,
          version: '1.0.0',
          kind: ExtensionKind.SKILL,
          description: `Custom skill loaded from ${mdFile}`,
          author: 'Imported',
          permissions: []
        };
      } else if (jsFile) {
        manifest = {
          id: dirName,
          name: dirName,
          version: '1.0.0',
          kind: ExtensionKind.PLUGIN,
          description: `Custom JavaScript tool (${jsFile})`,
          author: 'Imported',
          entryPoint: jsFile,
          permissions: ['filesystem:read'],
          tools: []
        };
      } else {
        throw new Error('Directory contains neither SKILL.md, manifest.json, package.json, nor readable code/markdown files.');
      }
    }

    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  }

  /**
   * Inspect a package from GitHub URL or local disk path without installing
   */
  async inspect(source) {
    const { packageDir, isTemp } = await this.preparePackage(source);
    try {
      const inspected = this.packageManager.inspectPackage(packageDir);
      return {
        ok: true,
        manifest: inspected.manifest,
        contentHash: inspected.contentHash,
        permissions: inspected.requestedPermissions,
        preview: inspected.preview
      };
    } finally {
      if (isTemp) {
        try { fs.rmSync(packageDir, { recursive: true, force: true }); } catch (e) {}
      }
    }
  }

  /**
   * Install an extension/skill from GitHub URL or local disk path
   */
  async install(source, { grantedPermissions = null, enabled = true, installationApproved = false, expectedContentHash = null } = {}) {
    if (installationApproved !== true) throw new Error('Explicit installation approval is required before installing an extension package');
    const { packageDir, isTemp } = await this.preparePackage(source);
    try {
      const inspected = this.packageManager.inspectPackage(packageDir);
      if (!expectedContentHash || expectedContentHash !== inspected.contentHash) throw new Error('Package contents changed after inspection; inspect again before approving installation');
      const effectivePermissions = grantedPermissions;

      const result = this.packageManager.install(packageDir, {
        grantedPermissions: effectivePermissions,
        enabled,
        installationApproved,
        expectedContentHash,
        provenance: source
      });

      if (result.extension.kind === ExtensionKind.SKILL && abyxSkills?.indexSkills) {
        abyxSkills.indexSkills(true, this.profileId);
      }

      // 2. If it's an MCP Server, register it into mcp_config.json
      if (result.extension.kind === ExtensionKind.MCP && mcpClient && result.extension.status === ExtensionStatus.ENABLED) {
        this.registerMcpServer(result.extension);
      }

      return {
        ok: true,
        installed: true,
        extension: result.extension,
        message: result.message
      };
    } finally {
      if (isTemp) {
        try { fs.rmSync(packageDir, { recursive: true, force: true }); } catch (e) {}
      }
    }
  }

  async update(id, source, { grantedPermissions, installationApproved = false, expectedContentHash } = {}) {
    if (installationApproved !== true || !Array.isArray(grantedPermissions) || typeof expectedContentHash !== 'string') {
      throw new Error('Explicit update approval, inspected content hash and reviewed permissions are required');
    }
    const { packageDir, isTemp } = await this.preparePackage(source);
    try {
      const inspected = this.packageManager.inspectPackage(packageDir);
      if (inspected.contentHash !== expectedContentHash) throw new Error('Package contents changed after inspection; inspect again before approving update');
      const result = this.packageManager.update(id, packageDir, {
        grantedPermissions,
        installationApproved,
        expectedContentHash,
        provenance: source
      });
      if (result.extension.kind === ExtensionKind.SKILL && abyxSkills?.indexSkills) abyxSkills.indexSkills(true, this.profileId);
      return { ok: true, updated: true, extension: result.extension, message: result.message };
    } finally {
      if (isTemp) { try { fs.rmSync(packageDir, { recursive: true, force: true }); } catch {} }
    }
  }

  /**
   * Register installed MCP server into mcp_config.json
   */
  registerMcpServer(extRecord) {
    const server = {
      enabled: extRecord.status === ExtensionStatus.ENABLED,
      description: extRecord.description,
      path: extRecord.installPath,
      tools: extRecord.tools || []
    };
    mcpClient.addServer(extRecord.id, server, this.profileId);
  }

  /**
   * List all installed extensions and skills
   */
  list() {
    const extensions = this.packageManager.listExtensions();
    // Return formatted array compatible with frontend
    return extensions.map(e => ({
      ...e,
      enabled: e.status === ExtensionStatus.ENABLED
    }));
  }

  /**
   * Toggle extension enabled status
   */
  toggle(id, enabled) {
    const current = this.packageManager.getExtension(id);
    if (!current) throw new Error(`Extension "${id}" is not installed`);
    if (enabled && current.kind !== ExtensionKind.SKILL) throw new Error('Executable plugins and MCP packages remain disabled until an isolated extension host is available');
    const ext = enabled
      ? this.packageManager.enable(id)
      : this.packageManager.disable(id);

    if (ext.kind === ExtensionKind.SKILL && abyxSkills?.indexSkills) {
      abyxSkills.indexSkills(true, this.profileId);
    }

    return { ok: true, extension: ext };
  }

  /**
   * Uninstall an extension
   */
  uninstall(id) {
    const ext = this.packageManager.getExtension(id);
    const res = this.packageManager.uninstall(id);

    if (ext?.kind === ExtensionKind.SKILL && abyxSkills?.indexSkills) {
      abyxSkills.indexSkills(true, this.profileId);
    }

    if (ext?.kind === ExtensionKind.MCP) {
      // Remove from mcp_config.json
      mcpClient.deleteServer(id, this.profileId);
    }
    return { ok: true, ...res };
  }
}

module.exports = { ExtensionService, createExtensionService: profileRoot => new ExtensionService(profileRoot) };
