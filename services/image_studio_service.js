const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const http = require('node:http');
const crypto = require('node:crypto');

const IMAGES_DIR = path.join(__dirname, '..', 'data', 'images');
const METADATA_FILE = path.join(IMAGES_DIR, 'metadata.json');

function ensureDir() {
  if (!fs.existsSync(IMAGES_DIR)) {
    fs.mkdirSync(IMAGES_DIR, { recursive: true });
  }
}

function getMetadataList() {
  ensureDir();
  try {
    if (fs.existsSync(METADATA_FILE)) {
      return JSON.parse(fs.readFileSync(METADATA_FILE, 'utf8'));
    }
  } catch (_) {}
  return [];
}

function saveMetadataList(list) {
  ensureDir();
  fs.writeFileSync(METADATA_FILE, JSON.stringify(list, null, 2), 'utf8');
}

function downloadImage(url, destPath) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, { timeout: 30000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadImage(res.headers.location, destPath).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Failed to download image: HTTP ${res.statusCode}`));
      }
      const fileStream = fs.createWriteStream(destPath);
      res.pipe(fileStream);
      fileStream.on('finish', () => {
        fileStream.close(() => resolve(destPath));
      });
      fileStream.on('error', (err) => {
        fs.unlink(destPath, () => reject(err));
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Image generation download timed out'));
    });
  });
}

const ASPECT_RATIO_MAP = {
  '1:1': { width: 1024, height: 1024 },
  '4:3': { width: 1024, height: 768 },
  '3:4': { width: 768, height: 1024 },
  '16:9': { width: 1280, height: 720 },
  '9:16': { width: 720, height: 1280 },
  '21:9': { width: 1344, height: 576 }
};

async function generateImage({
  prompt,
  negative_prompt = '',
  aspect_ratio = '1:1',
  width,
  height,
  sampler = 'euler_a',
  steps = 60,
  cfg_scale = 7.0,
  seed,
  model = 'local'
}) {
  ensureDir();
  if (!prompt || !prompt.trim()) {
    throw new Error('Prompt is required for image generation');
  }

  const dims = ASPECT_RATIO_MAP[aspect_ratio] || { width: 512, height: 512 };
  const targetWidth = width || (dims.width > 512 ? 512 : dims.width);
  const targetHeight = height || (dims.height > 512 ? 512 : dims.height);
  const targetSeed = seed !== undefined && seed !== null && seed !== '' ? Number(seed) : Math.floor(Math.random() * 2147483647);

  const imageId = 'img_' + crypto.randomBytes(8).toString('hex');
  const filename = `${imageId}.png`;
  const filePath = path.join(IMAGES_DIR, filename);

  const localSdCli = path.join(__dirname, '..', 'app', 'backend', 'win', 'cuda', 'sd-cli.exe');
  const modelsDir = path.join(__dirname, '..', 'app', 'models');
  const preferredModel = path.join(modelsDir, 'epicrealism_naturalSinRC1VAE.safetensors');
  const fallbackModel = path.join(modelsDir, 'Juggernaut_RunDiffusionPhoto2_Lightning_4Steps.safetensors');
  const localModel = fs.existsSync(preferredModel) ? preferredModel : (fs.existsSync(fallbackModel) ? fallbackModel : null);

  const isExplicitCloud = typeof model === 'string' && (model.startsWith('cloud:') || model.startsWith('pollinations'));
  let generatedLocally = false;

  // 1. Primary: Run local GPU image generation via sd-cli.exe on NVIDIA GeForce RTX 5060
  if (!isExplicitCloud && fs.existsSync(localSdCli) && localModel) {
    try {
      console.log(`[image_studio_service] Running local GPU generation with ${path.basename(localModel)}...`);
      await new Promise((resolve, reject) => {
        const { execFile } = require('child_process');
        const args = [
          '-m', localModel,
          '-p', prompt.trim(),
          '-o', filePath,
          '-W', String(targetWidth),
          '-H', String(targetHeight),
          '--steps', String(steps || 60),
          '--sampling-method', sampler || 'euler_a'
        ];
        execFile(localSdCli, args, { timeout: 90000 }, (err) => {
          if (err) return reject(err);
          resolve();
        });
      });
      if (fs.existsSync(filePath) && fs.statSync(filePath).size > 1000) {
        generatedLocally = true;
        console.log(`[image_studio_service] Local GPU generation succeeded: ${filePath}`);
      }
    } catch (localErr) {
      console.warn(`[image_studio_service] Local GPU generation error: ${localErr.message}`);
    }
  }

  // 2. If not generated locally and not strictly local, fall back to Pollinations
  if (!generatedLocally) {
    if (model === 'local') {
      throw new Error('Local AI image model failed to generate on GPU. Check GPU VRAM and model files.');
    }
    console.log('[image_studio_service] Using Pollinations AI generation fallback...');
    const encodedPrompt = encodeURIComponent(prompt.trim());
    const pollinationsUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${targetWidth}&height=${targetHeight}&seed=${targetSeed}&model=${encodeURIComponent(model || 'flux')}&nologo=true`;
    await downloadImage(pollinationsUrl, filePath);
  }

  const metaItem = {
    id: imageId,
    filename,
    prompt: prompt.trim(),
    negative_prompt: negative_prompt.trim(),
    aspect_ratio,
    width: targetWidth,
    height: targetHeight,
    sampler,
    steps,
    cfg_scale,
    seed: targetSeed,
    model: generatedLocally ? (localModel ? path.basename(localModel).replace(/\.safetensors$/i, '') : 'local:gpu') : model,
    createdAt: new Date().toISOString(),
    url: `/api/images/file/${filename}`
  };

  const list = getMetadataList();
  list.unshift(metaItem);
  saveMetadataList(list.slice(0, 500));

  return metaItem;
}

function listImages() {
  return getMetadataList();
}

function deleteImage(id) {
  const list = getMetadataList();
  const itemIndex = list.findIndex(i => i.id === id || i.filename === id);
  if (itemIndex === -1) return false;

  const item = list[itemIndex];
  const filePath = path.join(IMAGES_DIR, item.filename);
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (_) {}

  list.splice(itemIndex, 1);
  saveMetadataList(list);
  return true;
}

function getImageFilePath(filename) {
  const safeFilename = path.basename(filename);
  const p = path.join(IMAGES_DIR, safeFilename);
  return fs.existsSync(p) ? p : null;
}

module.exports = {
  generateImage,
  listImages,
  deleteImage,
  getImageFilePath,
  IMAGES_DIR
};
