const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const http = require('node:http');
const { spawn } = require('node:child_process');

const MODELS_DIR = path.join(__dirname, '..', 'models');

function ensureDir() {
  if (!fs.existsSync(MODELS_DIR)) {
    fs.mkdirSync(MODELS_DIR, { recursive: true });
  }
}

const activeDownloads = new Map();

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const idx = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / (1024 ** idx)).toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
}

// Diffusion architectures that stable-diffusion.cpp and GGUF conversions write
const IMAGE_ARCHITECTURES = new Set([
  'sd1', 'sd2', 'sdxl', 'sd3', 'flux', 'aura', 'hyvid', 'ltxv', 'wan', 'lumina2', 'hidream', 'cosmos', 'chroma', 'qwen_image'
]);

const GGUF_TYPE_SIZES = { 0: 1, 1: 1, 2: 2, 3: 2, 4: 4, 5: 4, 6: 4, 7: 1, 10: 8, 11: 8, 12: 8 };
const GGUF_STRING = 8;
const GGUF_ARRAY = 9;
const HEADER_READ_BYTES = 4 * 1024 * 1024;

function readStart(filePath, length) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const read = fs.readSync(fd, buffer, 0, length, 0);
    return buffer.subarray(0, read);
  } finally {
    fs.closeSync(fd);
  }
}

function readGgufArchitecture(buffer) {
  if (buffer.length < 24 || buffer.toString('latin1', 0, 4) !== 'GGUF') return null;
  let offset = 16;
  const kvCount = Number(buffer.readBigUInt64LE(offset));
  offset += 8;
  const readString = () => {
    const length = Number(buffer.readBigUInt64LE(offset));
    offset += 8;
    const value = buffer.toString('utf8', offset, offset + length);
    offset += length;
    return value;
  };
  const skipValue = (type) => {
    if (type === GGUF_STRING) {
      offset += 8 + Number(buffer.readBigUInt64LE(offset));
    } else if (type === GGUF_ARRAY) {
      const itemType = buffer.readUInt32LE(offset);
      const count = Number(buffer.readBigUInt64LE(offset + 4));
      offset += 12;
      if (itemType === GGUF_STRING) {
        for (let i = 0; i < count; i += 1) offset += 8 + Number(buffer.readBigUInt64LE(offset));
      } else {
        offset += count * (GGUF_TYPE_SIZES[itemType] || 0);
      }
    } else {
      offset += GGUF_TYPE_SIZES[type] || 0;
    }
  };
  try {
    for (let i = 0; i < kvCount; i += 1) {
      const key = readString();
      const type = buffer.readUInt32LE(offset);
      offset += 4;
      if (key === 'general.architecture' && type === GGUF_STRING) return readString();
      skipValue(type);
    }
  } catch (_) {}
  return null;
}

function readSafetensorsKeys(filePath, buffer) {
  if (buffer.length < 8) return null;
  const headerLength = Number(buffer.readBigUInt64LE(0));
  if (!headerLength || headerLength > 200 * 1024 * 1024) return null;
  const header = headerLength + 8 <= buffer.length
    ? buffer.subarray(8, 8 + headerLength)
    : readStart(filePath, headerLength + 8).subarray(8);
  try {
    return Object.keys(JSON.parse(header.toString('utf8')));
  } catch (_) {
    return null;
  }
}

function detectModelKind(filePath) {
  const lower = String(filePath).toLowerCase();
  let buffer;
  try {
    buffer = readStart(filePath, HEADER_READ_BYTES);
  } catch (_) {
    return { kind: 'unknown', detail: 'unreadable' };
  }

  if (buffer.length >= 4 && buffer.toString('latin1', 0, 4) === 'GGUF') {
    const arch = readGgufArchitecture(buffer);
    if (!arch) return { kind: 'text', detail: 'GGUF' };
    if (arch.toLowerCase().includes('whisper')) return { kind: 'speech', detail: 'Whisper GGUF' };
    if (IMAGE_ARCHITECTURES.has(arch.toLowerCase())) return { kind: 'image', detail: arch };
    return { kind: 'text', detail: arch };
  }

  if (lower.endsWith('.safetensors')) {
    const keys = readSafetensorsKeys(filePath, buffer);
    if (keys) {
      const isImage = keys.some(k => k.startsWith('model.diffusion_model.') || k.startsWith('double_blocks.') || k.includes('time_embed'));
      if (isImage) return { kind: 'image', detail: 'Diffusion Safetensors' };
      const isLlm = keys.some(k => k.startsWith('model.layers.') || k.startsWith('transformer.h.'));
      if (isLlm) return { kind: 'text', detail: 'LLM Safetensors' };
    }
    return { kind: 'image', detail: 'Safetensors' };
  }

  if (lower.endsWith('.ckpt')) return { kind: 'image', detail: 'Checkpoint' };
  if (lower.endsWith('.bin') && lower.includes('whisper')) return { kind: 'speech', detail: 'Whisper GGML' };
  if (lower.includes('whisper')) return { kind: 'speech', detail: 'Whisper' };
  if (lower.includes('kokoro') || lower.endsWith('.onnx') || lower.includes('tts')) return { kind: 'voice', detail: 'Kokoro ONNX' };

  return { kind: 'other', detail: 'File' };
}

const MODEL_DETAIL_WORDS = {
  fp16: 'FP16',
  fp32: 'FP32',
  bf16: 'BF16',
  vae: 'VAE included',
  hyper: 'Hyper',
  lightning: 'Lightning',
  turbo: 'Turbo',
  pruned: 'Pruned',
  onnx: 'ONNX'
};

function describeModelFile(filename) {
  const base = String(filename || '').replace(/\.(safetensors|ckpt|gguf|bin|json|onnx|pt|pth)$/i, '');
  const details = [];
  let rest = base;

  if (/^mmproj[-_]/i.test(rest)) {
    details.push('Vision add-on');
    rest = rest.replace(/^mmproj[-_]/i, '');
  }
  const quant = rest.match(/(?:^|[-_.])((?:I?Q\d+(?:_[A-Z0-9]+)*)|F16|F32)$/i);
  if (quant) {
    details.push(quant[1].toUpperCase());
    rest = rest.slice(0, quant.index);
  }
  const words = [];
  rest.split(/[-_\s]+/).filter(Boolean).forEach((token) => {
    const parts = /^[a-z]/.test(token)
      ? token.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/(\d)([A-Z][a-z])/g, '$1 $2').split(' ')
      : [token];
    parts.forEach((part) => {
      const key = part.toLowerCase();
      if (key in MODEL_DETAIL_WORDS) {
        const label = MODEL_DETAIL_WORDS[key];
        if (label && !details.includes(label)) details.push(label);
      } else {
        words.push(part);
      }
    });
  });

  return {
    displayName: words.join(' ') || base,
    details: details.join(' · ')
  };
}

function scanLocalModels() {
  ensureDir();
  const results = [];
  try {
    const files = fs.readdirSync(MODELS_DIR);
    for (const f of files) {
      const fullPath = path.join(MODELS_DIR, f);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.isFile()) {
          const kindInfo = detectModelKind(fullPath);
          const meta = describeModelFile(f);
          results.push({
            name: f,
            displayName: meta.displayName,
            details: meta.details || kindInfo.detail,
            filename: f,
            path: fullPath,
            sizeBytes: stat.size,
            sizeFormatted: formatBytes(stat.size),
            kind: kindInfo.kind,
            architecture: kindInfo.detail,
            createdAt: stat.birthtime || stat.mtime
          });
        }
      } catch (_) {}
    }
  } catch (_) {}
  return results;
}

function openModelsFolder() {
  ensureDir();
  try {
    if (process.platform === 'win32') {
      spawn('explorer.exe', [MODELS_DIR], { detached: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [MODELS_DIR], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [MODELS_DIR], { detached: true, stdio: 'ignore' }).unref();
    }
    return { ok: true, path: MODELS_DIR };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function searchHuggingFace(query, limit = 20) {
  return new Promise((resolve) => {
    if (!query || !query.trim()) return resolve([]);
    const params = new URLSearchParams({
      search: query.trim(),
      limit: String(limit),
      full: 'true',
      config: 'true'
    });
    const url = `https://huggingface.co/api/models?${params.toString()}`;
    const req = https.get(url, { headers: { 'User-Agent': 'Abyx-Studio' }, timeout: 10000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (Array.isArray(json)) {
            const list = json.map(m => ({
              id: m.id,
              name: m.id,
              downloads: m.downloads || 0,
              likes: m.likes || 0,
              pipeline_tag: m.pipeline_tag || 'text-generation',
              tags: m.tags || []
            }));
            return resolve(list);
          }
        } catch (_) {}
        resolve([]);
      });
    });
    req.on('error', () => resolve([]));
    req.on('timeout', () => { req.destroy(); resolve([]); });
  });
}

function startHuggingFaceDownload({ repoId, filename, downloadUrl }) {
  ensureDir();
  const id = `${repoId}/${filename}`;
  if (activeDownloads.has(id)) {
    return { ok: false, message: 'Download already running', id };
  }

  const destPath = path.join(MODELS_DIR, path.basename(filename));
  const url = downloadUrl || `https://huggingface.co/${repoId}/resolve/main/${filename}`;

  const downloadState = {
    id,
    repoId,
    filename,
    destPath,
    bytesDownloaded: 0,
    totalBytes: 0,
    progress: 0,
    status: 'starting',
    speed: '0 MB/s',
    error: null
  };
  activeDownloads.set(id, downloadState);

  const performDownload = (targetUrl) => {
    const client = targetUrl.startsWith('https') ? https : http;
    const req = client.get(targetUrl, { headers: { 'User-Agent': 'Abyx-Studio' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return performDownload(res.headers.location);
      }
      if (res.statusCode !== 200) {
        downloadState.status = 'error';
        downloadState.error = `HTTP ${res.statusCode}`;
        return;
      }

      downloadState.totalBytes = parseInt(res.headers['content-length'] || '0', 10);
      downloadState.status = 'downloading';

      const fileStream = fs.createWriteStream(destPath);
      let lastBytes = 0;
      let lastTime = Date.now();

      res.on('data', (chunk) => {
        downloadState.bytesDownloaded += chunk.length;
        if (downloadState.totalBytes > 0) {
          downloadState.progress = Math.round((downloadState.bytesDownloaded / downloadState.totalBytes) * 100);
        }
        const now = Date.now();
        if (now - lastTime >= 1000) {
          const deltaBytes = downloadState.bytesDownloaded - lastBytes;
          const mbPerSec = (deltaBytes / (1024 * 1024)) / ((now - lastTime) / 1000);
          downloadState.speed = `${mbPerSec.toFixed(1)} MB/s`;
          lastBytes = downloadState.bytesDownloaded;
          lastTime = now;
        }
      });

      res.pipe(fileStream);

      fileStream.on('finish', () => {
        fileStream.close();
        downloadState.status = 'completed';
        downloadState.progress = 100;
        setTimeout(() => activeDownloads.delete(id), 10000);
      });

      fileStream.on('error', (err) => {
        downloadState.status = 'error';
        downloadState.error = err.message;
        try { fs.unlinkSync(destPath); } catch (_) {}
      });
    });

    req.on('error', (err) => {
      downloadState.status = 'error';
      downloadState.error = err.message;
    });

    downloadState._req = req;
  };

  performDownload(url);
  return { ok: true, id, status: 'started' };
}

function getDownloadProgress(id) {
  if (id) {
    const s = activeDownloads.get(id);
    return s ? {
      id: s.id,
      progress: s.progress,
      status: s.status,
      speed: s.speed,
      downloaded: formatBytes(s.bytesDownloaded),
      total: formatBytes(s.totalBytes),
      error: s.error
    } : null;
  }
  const all = [];
  for (const [k, s] of activeDownloads.entries()) {
    all.push({
      id: s.id,
      progress: s.progress,
      status: s.status,
      speed: s.speed,
      downloaded: formatBytes(s.bytesDownloaded),
      total: formatBytes(s.totalBytes),
      error: s.error
    });
  }
  return all;
}

function cancelDownload(id) {
  const s = activeDownloads.get(id);
  if (s) {
    if (s._req) {
      try { s._req.destroy(); } catch (_) {}
    }
    try {
      if (fs.existsSync(s.destPath)) fs.unlinkSync(s.destPath);
    } catch (_) {}
    activeDownloads.delete(id);
    return true;
  }
  return false;
}

function deleteModel(filename) {
  ensureDir();
  const safeFilename = path.basename(filename);
  const targetPath = path.join(MODELS_DIR, safeFilename);
  if (fs.existsSync(targetPath)) {
    try {
      fs.unlinkSync(targetPath);
      return { ok: true, filename: safeFilename };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }
  return { ok: false, error: 'File not found' };
}

module.exports = {
  scanLocalModels,
  searchHuggingFace,
  startHuggingFaceDownload,
  getDownloadProgress,
  cancelDownload,
  deleteModel,
  openModelsFolder,
  detectModelKind,
  describeModelFile,
  MODELS_DIR
};
