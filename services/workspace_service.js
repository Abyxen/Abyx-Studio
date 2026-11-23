/**
 * Workspace Service for Abyx / ABYX
 * Manages multi-project workspaces, dedicated folder isolation,
 * output generation directories (PDFs, HTML sites, documents),
 * and active workspace context switching.
 */

const fs = require('node:fs');
const path = require('node:path');
const { workspaceDir: WORKSPACE_BASE } = require('../data_paths');

const META_FILE = path.join(WORKSPACE_BASE, 'workspaces_meta.json');

class WorkspaceService {
  constructor() {
    this.workspaces = [];
    this.activeWorkspaceId = null;
    this.init();
  }

  init() {
    try {
      if (!fs.existsSync(WORKSPACE_BASE)) {
        fs.mkdirSync(WORKSPACE_BASE, { recursive: true });
      }

      // Check if metadata file exists
      if (fs.existsSync(META_FILE)) {
        try {
          const raw = fs.readFileSync(META_FILE, 'utf8');
          const data = JSON.parse(raw);
          this.workspaces = data.workspaces || [];
          this.activeWorkspaceId = data.activeWorkspaceId || null;
        } catch (e) {
          console.error('[WorkspaceService] Error parsing workspaces_meta.json:', e);
        }
      }

      // If empty or initial, discover folders and set up defaults
      if (!this.workspaces || this.workspaces.length === 0) {
        const defaultNames = ['abyx', 'ai duolingo', 'ai'];
        this.workspaces = defaultNames.map((name, idx) => {
          const safeFolder = name.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
          const wsPath = path.join(WORKSPACE_BASE, safeFolder);
          const outputsPath = path.join(wsPath, 'outputs');
          if (!fs.existsSync(outputsPath)) {
            fs.mkdirSync(outputsPath, { recursive: true });
          }
          return {
            id: 'ws_' + (idx === 0 ? 'abyx' : safeFolder),
            name: name,
            folder: safeFolder,
            path: wsPath,
            outputsPath: outputsPath,
            createdAt: new Date().toISOString()
          };
        });
        this.activeWorkspaceId = this.workspaces[0].id;
        this.saveMeta();
      } else {
        // Ensure paths and outputsPath are valid for all workspaces
        this.workspaces.forEach(ws => {
          if (!ws.folder) ws.folder = ws.name.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
          if (!ws.path) ws.path = path.join(WORKSPACE_BASE, ws.folder);
          if (!ws.outputsPath) ws.outputsPath = path.join(ws.path, 'outputs');
          if (!fs.existsSync(ws.outputsPath) && (ws.external !== true || fs.existsSync(ws.path))) {
            fs.mkdirSync(ws.outputsPath, { recursive: true });
          }
        });
      }

      if (!this.activeWorkspaceId && this.workspaces.length > 0) {
        this.activeWorkspaceId = this.workspaces[0].id;
      }
    } catch (err) {
      console.error('[WorkspaceService] Init failed:', err);
    }
  }

  saveMeta() {
    const temporaryPath = `${META_FILE}.tmp`;
    try {
      fs.writeFileSync(temporaryPath, JSON.stringify({
        activeWorkspaceId: this.activeWorkspaceId,
        workspaces: this.workspaces
      }, null, 2), 'utf8');
      fs.renameSync(temporaryPath, META_FILE);
    } catch (err) {
      try { if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath); } catch (_) {}
      console.error('[WorkspaceService] Failed to save workspaces_meta.json:', err);
      throw err;
    }
  }

  getWorkspaces() {
    return this.workspaces.map(w => {
      const exists = fs.existsSync(w.path);
      const isDir = exists && fs.statSync(w.path).isDirectory();
      return {
        id: w.id,
        name: w.name,
        folder: w.folder,
        path: w.path,
        outputsPath: w.outputsPath,
        available: Boolean(exists && isDir),
        createdAt: w.createdAt,
        isActive: w.id === this.activeWorkspaceId
      };
    });
  }

  getActiveWorkspace() {
    let ws = this.workspaces.find(w => w.id === this.activeWorkspaceId);
    if (!ws && this.workspaces.length > 0) {
      ws = this.workspaces[0];
      this.activeWorkspaceId = ws.id;
    }
    if (!ws) return null;
    const exists = fs.existsSync(ws.path);
    const isDir = exists && fs.statSync(ws.path).isDirectory();
    return {
      ...ws,
      available: Boolean(exists && isDir)
    };
  }

  setActiveWorkspace(id) {
    const ws = this.workspaces.find(w => w.id === id);
    if (!ws) return false;
    if (!fs.existsSync(ws.path) || !fs.statSync(ws.path).isDirectory()) return false;
    const previousId = this.activeWorkspaceId;
    this.activeWorkspaceId = id;
    try { this.saveMeta(); } catch (error) { this.activeWorkspaceId = previousId; throw error; }
    return true;
  }

  createWorkspace(name, selectedPath = null) {
    if (!name || typeof name !== 'string') throw new Error('Workspace name must be a string');
    const cleanName = name.trim();
    if (!cleanName || cleanName.length > 80) throw new Error('Workspace name must be between 1 and 80 characters');

    let targetDir;
    if (typeof selectedPath === 'string' && selectedPath.trim()) {
      targetDir = path.resolve(selectedPath.trim());
    } else {
      const safeFolder = cleanName.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
      targetDir = path.join(WORKSPACE_BASE, safeFolder);
    }

    if (!fs.existsSync(targetDir)) {
      try {
        fs.mkdirSync(targetDir, { recursive: true });
      } catch (err) {
        throw new Error(`Could not create folder "${targetDir}": ${err.message}`);
      }
    }

    const wsPath = fs.realpathSync(targetDir);
    if (!fs.statSync(wsPath).isDirectory()) throw new Error('The selected project path is not a folder');
    if (this.workspaces.some(workspace => path.resolve(workspace.path).toLowerCase() === path.resolve(wsPath).toLowerCase())) {
      throw new Error('That folder is already assigned to a project');
    }
    const safeFolder = path.basename(wsPath);
    const outputsPath = path.join(wsPath, 'outputs');

    if (!fs.existsSync(outputsPath)) {
      fs.mkdirSync(outputsPath, { recursive: true });
    }

    const newWs = {
      id: 'ws_' + Date.now(),
      name: cleanName,
      folder: safeFolder,
      path: wsPath,
      outputsPath: outputsPath,
      external: true,
      createdAt: new Date().toISOString()
    };

    this.workspaces.push(newWs);
    const previousId = this.activeWorkspaceId;
    this.activeWorkspaceId = newWs.id;
    try {
      this.saveMeta();
    } catch (error) {
      this.workspaces.pop();
      this.activeWorkspaceId = previousId;
      throw error;
    }
    return newWs;
  }

  deleteWorkspace(id) {
    const idx = this.workspaces.findIndex(w => w.id === id);
    if (idx === -1) return false;
    if (this.workspaces.length <= 1) return false;
    const previousActiveId = this.activeWorkspaceId;
    const removed = this.workspaces.splice(idx, 1)[0];

    if (this.activeWorkspaceId === id) {
      this.activeWorkspaceId = this.workspaces.length > 0 ? this.workspaces[0].id : null;
    }
    try {
      this.saveMeta();
    } catch (error) {
      this.workspaces.splice(idx, 0, removed);
      this.activeWorkspaceId = previousActiveId;
      throw error;
    }
    return true;
  }

  listOutputs(workspaceId = null) {
    const ws = workspaceId ? this.workspaces.find(w => w.id === workspaceId) : this.getActiveWorkspace();
    if (!ws || !fs.existsSync(ws.outputsPath)) return [];

    try {
      const files = fs.readdirSync(ws.outputsPath);
      return files.map(file => {
        const full = path.join(ws.outputsPath, file);
        const stat = fs.statSync(full);
        const ext = path.extname(file).toLowerCase();
        let type = 'document';
        if (ext === '.pdf') type = 'pdf';
        else if (ext === '.html' || ext === '.htm') type = 'html';
        else if (['.png', '.jpg', '.jpeg', '.webp', '.svg'].includes(ext)) type = 'image';
        else if (['.json', '.csv', '.txt', '.md'].includes(ext)) type = 'data';

        return {
          filename: file,
          name: file,
          size: stat.size,
          type: type,
          extension: ext,
          createdAt: stat.birthtime || stat.mtime,
          downloadUrl: `/api/workspaces/output?file=${encodeURIComponent(file)}&workspaceId=${encodeURIComponent(ws.id)}`
        };
      });
    } catch (e) {
      console.error('[WorkspaceService] Error reading outputs for', ws.name, e);
      return [];
    }
  }

  saveOutput(filename, content, workspaceId = null) {
    const ws = workspaceId ? this.workspaces.find(w => w.id === workspaceId) : this.getActiveWorkspace();
    if (!ws) throw new Error('Active workspace not found');

    if (!fs.existsSync(ws.outputsPath)) {
      fs.mkdirSync(ws.outputsPath, { recursive: true });
    }

    const safeFile = path.basename(filename);
    const targetPath = path.join(ws.outputsPath, safeFile);

    if (Buffer.isBuffer(content)) {
      fs.writeFileSync(targetPath, content);
    } else if (typeof content === 'string') {
      // Check if base64 data
      if (content.startsWith('data:') && content.includes(';base64,')) {
        const base64Data = content.split(';base64,').pop();
        fs.writeFileSync(targetPath, Buffer.from(base64Data, 'base64'));
      } else {
        fs.writeFileSync(targetPath, content, 'utf8');
      }
    } else {
      fs.writeFileSync(targetPath, JSON.stringify(content, null, 2), 'utf8');
    }

    return {
      success: true,
      filename: safeFile,
      path: targetPath,
      workspaceId: ws.id,
      downloadUrl: `/api/workspaces/output?file=${encodeURIComponent(safeFile)}&workspaceId=${encodeURIComponent(ws.id)}`
    };
  }
}

const workspaceService = new WorkspaceService();
module.exports = workspaceService;
