const fs = require('fs');
const path = require('path');
let DatabaseSync;
try {
  DatabaseSync = require('node:sqlite').DatabaseSync;
} catch (_) {}

const rootDir = path.resolve(__dirname, '..');
console.log('Running personal data scrubbing on:', rootDir);

// 1. Clean SQLite databases
const dbPaths = [
  path.join(rootDir, 'app/data/abyx_memory.db'),
  path.join(rootDir, 'app/data/abyx_unified.db'),
  path.join(rootDir, 'data/abyx.db')
];

if (DatabaseSync) {
  for (const dbPath of dbPaths) {
    if (fs.existsSync(dbPath)) {
      try {
        const db = new DatabaseSync(dbPath);
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
        for (const { name } of tables) {
          if (name.startsWith('sqlite_')) continue;
          try {
            const cols = db.prepare(`PRAGMA table_info(${name})`).all();
            const textCols = cols.filter(c => /text|varchar|clob|blob/i.test(c.type) || !c.type).map(c => c.name);
            for (const col of textCols) {
              try {
                const res = db.prepare(`DELETE FROM ${name} WHERE ${col} LIKE '%Abiral%' OR ${col} LIKE '%Dawadi%' OR ${col} LIKE '%OMEN%'`).run();
                if (res && res.changes > 0) {
                  console.log(`Cleaned ${res.changes} rows from ${path.basename(dbPath)} table ${name} col ${col}`);
                }
              } catch (_) {}
            }
          } catch (_) {}
        }
        db.close();
      } catch (e) {
        console.warn(`Could not process DB ${dbPath}:`, e.message);
      }
    }
  }
}

// 2. Clean backend files with hardcoded personal hardware tags
const replacements = [
  {
    file: path.join(rootDir, 'services/ai_providers.js'),
    changes: [
      { from: /Strictly uses user-configured cloud providers \(with valid keys\) or the local RTX 5060 engine\./g, to: 'Strictly uses user-configured cloud providers (with valid keys) or the local inference engine.' },
      { from: /Local RTX 5060 \(Reasoning Mode\)/g, to: 'Local Inference (Reasoning Mode)' },
      { from: /executed on local RTX 5060 with step-by-step reasoning/g, to: 'executed on local accelerator with step-by-step reasoning' },
      { from: /Local RTX 5060 \(Fast Reflex\)/g, to: 'Local Inference (Fast Reflex)' },
      { from: /Instant sub-second response on local RTX 5060 GPU/g, to: 'Instant sub-second response on local accelerator' },
      { from: /\/\/ 4\. Default: Local Model on RTX 5060/g, to: '// 4. Default: Local Model on Local GPU/CPU' },
      { from: /Local RTX 5060 Model/g, to: 'Local Model' },
      { from: /Executed securely on local RTX 5060 GPU/g, to: 'Executed securely on local accelerator' }
    ]
  },
  {
    file: path.join(rootDir, 'scripts/server/serve.cjs'),
    changes: [
      { from: /Generating image on local RTX 5060 GPU with/g, to: 'Generating image on local GPU with' },
      { from: /Executed strictly on local RTX 5060 GPU/g, to: 'Executed strictly on local accelerator' },
      { from: /Executed on local RTX 5060 GPU/g, to: 'Executed on local accelerator' }
    ]
  },
  {
    file: path.join(rootDir, 'services/free_apis_service.js'),
    changes: [
      { from: /Unlimited \(RTX 5060\)/g, to: 'Unlimited (Local GPU)' }
    ]
  },
  {
    file: path.join(rootDir, 'services/image_studio_service.js'),
    changes: [
      { from: /Run local GPU image generation via sd-cli\.exe on NVIDIA GeForce RTX 5060/g, to: 'Run local GPU image generation via sd-cli.exe on local GPU' }
    ]
  },
  {
    file: path.join(rootDir, 'services/obsidian_vault.js'),
    changes: [
      { from: /Local model runtime running on dedicated RTX 5060 GPU with 8GB VRAM\./g, to: 'Local model runtime running on dedicated accelerator.' }
    ]
  },
  {
    file: path.join(rootDir, 'agent/model_router.js'),
    changes: [
      { from: /\/\/ Hardware-aware inference queues \(1 serialized for RTX 5060, 4 for cloud\)/g, to: '// Hardware-aware inference queues (1 serialized for local GPU, 4 for cloud)' },
      { from: /model: cpus\[0\]\?\.model \|\| 'AMD Ryzen 9 8940HX'/g, to: "model: cpus[0]?.model || 'Local Processor'" }
    ]
  }
];

for (const { file, changes } of replacements) {
  if (fs.existsSync(file)) {
    let content = fs.readFileSync(file, 'utf8');
    let modified = false;
    for (const { from, to } of changes) {
      if (from.test(content)) {
        content = content.replace(from, to);
        modified = true;
      }
    }
    if (modified) {
      fs.writeFileSync(file, content, 'utf8');
      console.log(`Updated hardware references in: ${path.relative(rootDir, file)}`);
    }
  }
}

console.log('Personal data scrubbing complete.');
