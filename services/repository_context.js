'use strict';

const fs = require('node:fs');
const path = require('node:path');

const IGNORED = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', 'vendor', 'target', '.venv', '__pycache__', '.next', '.cache']);
const CONFIG_FILES = new Set(['package.json', 'pyproject.toml', 'requirements.txt', 'Cargo.toml', 'go.mod', 'pom.xml', 'build.gradle', 'Makefile', 'CMakeLists.txt', 'tsconfig.json', 'pytest.ini', 'jest.config.js', 'vitest.config.js']);

class RepositoryContext {
  constructor(pathGuard, options = {}) {
    this.pathGuard = pathGuard;
    this.maxFiles = options.maxFiles || 4000;
    this.maxFileBytes = options.maxFileBytes || 256 * 1024;
    this.maxTotalBytes = options.maxTotalBytes || 32 * 1024 * 1024;
  }

  async inspect({ baseDir = '.' } = {}) {
    const root = this.pathGuard.resolveSafePath(baseDir);
    const files = [];
    let scannedBytes = 0;
    let truncated = false;
    const visit = (dir, depth) => {
      if (depth > 16 || files.length >= this.maxFiles || scannedBytes >= this.maxTotalBytes) { truncated = true; return; }
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (files.length >= this.maxFiles || scannedBytes >= this.maxTotalBytes) { truncated = true; break; }
        if (entry.isSymbolicLink() || IGNORED.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { visit(full, depth + 1); continue; }
        if (!entry.isFile()) continue;
        let stat;
        try { stat = fs.statSync(full); } catch { continue; }
        const relative = path.relative(root, full).split(path.sep).join('/');
        files.push({ path: relative, sizeBytes: stat.size, modifiedMs: stat.mtimeMs, config: CONFIG_FILES.has(entry.name), test: /(^|\/)(test|tests|__tests__)(\/|$)|\.(test|spec)\.[^.]+$/i.test(relative) });
        if (stat.size <= this.maxFileBytes && scannedBytes + stat.size <= this.maxTotalBytes) scannedBytes += stat.size;
      }
    };
    visit(root, 0);
    const ecosystems = new Set();
    const dependencies = {};
    const tests = files.filter(file => file.test).map(file => file.path);
    const configurations = files.filter(file => file.config).map(file => file.path);
    for (const file of files) {
      if (/package\.json$/.test(file.path)) ecosystems.add('node');
      if (/(pyproject\.toml|requirements\.txt)$/.test(file.path)) ecosystems.add('python');
      if (/Cargo\.toml$/.test(file.path)) ecosystems.add('rust');
      if (/go\.mod$/.test(file.path)) ecosystems.add('go');
      if (/(pom\.xml|build\.gradle)$/.test(file.path)) ecosystems.add('java');
      if (CONFIG_FILES.has(path.basename(file.path)) && file.sizeBytes <= 128 * 1024) {
        try {
          const content = fs.readFileSync(this.pathGuard.resolveSafePath(path.join(root, file.path)), 'utf8');
          if (file.path.endsWith('package.json')) {
            const manifest = JSON.parse(content);
            dependencies.node = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }).slice(0, 200);
          } else if (file.path.endsWith('requirements.txt')) {
            dependencies.python = content.split(/\r?\n/).map(line => line.trim().match(/^([A-Za-z0-9_.-]+)/)?.[1]).filter(Boolean).slice(0, 200);
          } else if (file.path.endsWith('Cargo.toml')) {
            dependencies.rust = [...content.matchAll(/^\s*([A-Za-z0-9_-]+)\s*=/gm)].map(match => match[1]).slice(0, 200);
          } else if (file.path.endsWith('go.mod')) {
            dependencies.go = [...content.matchAll(/^\s*([\w.-]+\.[\w.-]+(?:\/[^\s]+)*)\s+v\S+/gm)].map(match => match[1]).slice(0, 200);
          }
        } catch {}
      }
    }
    return { root: this.pathGuard.getRelativeAlias(root), fileCount: files.length, scannedBytes, truncated, ecosystems: [...ecosystems], dependencies, configurations, tests, files };
  }

  async search({ query, baseDir = '.', maxResults = 25 } = {}) {
    if (typeof query !== 'string' || !query.trim() || query.length > 1000) throw new TypeError('query must be a non-empty string up to 1000 characters');
    const inventory = await this.inspect({ baseDir });
    const root = this.pathGuard.resolveSafePath(baseDir);
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const results = [];
    for (const file of inventory.files) {
      if (file.sizeBytes > this.maxFileBytes) continue;
      const full = this.pathGuard.resolveSafePath(path.join(root, file.path));
      let content;
      try { content = fs.readFileSync(full); } catch { continue; }
      if (content.includes(0)) continue;
      const text = content.toString('utf8');
      const lower = `${file.path}\n${text}`.toLowerCase();
      const score = terms.reduce((sum, term) => sum + (lower.match(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length, 0);
      if (!score) continue;
      const firstTerm = terms.find(term => text.toLowerCase().includes(term));
      const at = firstTerm ? text.toLowerCase().indexOf(firstTerm) : 0;
      results.push({ path: file.path, score, snippet: text.slice(Math.max(0, at - 120), Math.min(text.length, at + 280)).replace(/\0/g, '') });
    }
    results.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
    return { query, results: results.slice(0, Math.max(1, Math.min(Number(maxResults) || 25, 100))), truncated: inventory.truncated };
  }
}

module.exports = RepositoryContext;
