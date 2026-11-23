const os = require('node:os');
const { execFile } = require('node:child_process');
const http = require('node:http');

let lastCpuSample = null;
let cachedGpuInfo = null;
let lastGpuPollTime = 0;
let isPollingGpu = false;
let activeLoadedModel = null;
let activeLoadedKind = null;

function getCpuSample() {
  const cpus = os.cpus() || [];
  return cpus.reduce((acc, cpu) => {
    const times = cpu.times;
    acc.idle += times.idle;
    acc.total += times.user + times.nice + times.sys + times.idle + (times.irq || 0);
    return acc;
  }, { idle: 0, total: 0 });
}

function getCpuUsagePercent() {
  const current = getCpuSample();
  if (!lastCpuSample) {
    lastCpuSample = current;
    return 0;
  }
  const idleDelta = current.idle - lastCpuSample.idle;
  const totalDelta = current.total - lastCpuSample.total;
  lastCpuSample = current;
  if (totalDelta <= 0) return 0;
  const usage = Math.max(0, Math.min(100, Math.round((1 - idleDelta / totalDelta) * 1000) / 10));
  return usage;
}

function roundGb(bytes) {
  return Math.round((bytes / (1024 ** 3)) * 10) / 10;
}

function fetchGpuInfo() {
  return new Promise((resolve) => {
    execFile(
      'nvidia-smi',
      ['--query-gpu=name,memory.used,memory.total', '--format=csv,noheader,nounits'],
      { windowsHide: true, timeout: 2000 },
      (err, stdout) => {
        if (err || !stdout) {
          resolve({
            gpu_name: 'DirectX / Integrated GPU',
            vram_used_gb: 0,
            vram_total_gb: 0,
            available: false
          });
          return;
        }
        try {
          const line = stdout.trim().split(/\r?\n/)[0];
          if (line) {
            const parts = line.split(',').map(s => s.trim());
            const name = parts[0] || 'NVIDIA GPU';
            const usedMb = parseFloat(parts[1]) || 0;
            const totalMb = parseFloat(parts[2]) || 0;
            resolve({
              gpu_name: name,
              vram_used_gb: Math.round((usedMb / 1024) * 10) / 10,
              vram_total_gb: Math.round((totalMb / 1024) * 10) / 10,
              available: true
            });
            return;
          }
        } catch (_) {}
        resolve({
          gpu_name: 'NVIDIA GPU',
          vram_used_gb: 0,
          vram_total_gb: 0,
          available: true
        });
      }
    );
  });
}

async function getGpuTelemetry() {
  const now = Date.now();
  if (!cachedGpuInfo || (now - lastGpuPollTime > 3000 && !isPollingGpu)) {
    isPollingGpu = true;
    lastGpuPollTime = now;
    try {
      cachedGpuInfo = await fetchGpuInfo();
    } finally {
      isPollingGpu = false;
    }
  }
  return cachedGpuInfo;
}

async function checkOllamaLoadedModel() {
  return new Promise((resolve) => {
    const req = http.get('http://127.0.0.1:11434/api/ps', { timeout: 800 }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed && Array.isArray(parsed.models) && parsed.models.length > 0) {
            const first = parsed.models[0];
            const name = first.name || first.model || 'Local Model';
            resolve({ name, kind: 'text', size_vram: first.size_vram || 0 });
            return;
          }
        } catch (_) {}
        resolve(null);
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

async function getTelemetry() {
  const gpu = await getGpuTelemetry();
  const cpu_usage = getCpuUsagePercent();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const ram_total_gb = roundGb(totalMem);
  const ram_used_gb = roundGb(totalMem - freeMem);

  let loaded_model = activeLoadedModel;
  let loaded_kind = activeLoadedKind;

  try {
    const ollamaLoaded = await checkOllamaLoadedModel();
    if (ollamaLoaded) {
      loaded_model = ollamaLoaded.name;
      loaded_kind = 'text';
    }
  } catch (_) {}

  return {
    cpu_usage,
    ram_used_gb,
    ram_total_gb,
    gpu_name: gpu.gpu_name,
    vram_used_gb: gpu.vram_used_gb,
    vram_total_gb: gpu.vram_total_gb,
    gpu_available: gpu.available,
    loaded_model,
    loaded_kind
  };
}

function setActiveModel(name, kind = 'text') {
  activeLoadedModel = name;
  activeLoadedKind = kind;
}

async function unloadAllModels() {
  activeLoadedModel = null;
  activeLoadedKind = null;

  // Unload any active Ollama models by setting keep_alive: 0
  const unloaded = [];
  try {
    const loaded = await checkOllamaLoadedModel();
    if (loaded && loaded.name) {
      await new Promise((resolve) => {
        const payload = JSON.stringify({ model: loaded.name, keep_alive: 0 });
        const req = http.request('http://127.0.0.1:11434/api/generate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
          },
          timeout: 2000
        }, (res) => {
          res.on('data', () => {});
          res.on('end', resolve);
        });
        req.on('error', resolve);
        req.on('timeout', () => { req.destroy(); resolve(); });
        req.write(payload);
        req.end();
      });
      unloaded.push(loaded.name);
    }
  } catch (_) {}

  if (global.gc) {
    try { global.gc(); } catch (_) {}
  }

  return { ok: true, unloaded, message: 'All models unloaded and memory reclaimed' };
}

module.exports = {
  getTelemetry,
  unloadAllModels,
  setActiveModel
};
