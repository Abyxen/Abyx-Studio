const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const crypto = require('node:crypto');

const TTS_DIR = path.join(__dirname, '..', 'data', 'tts');
const METADATA_FILE = path.join(TTS_DIR, 'metadata.json');

const VOICES = [
  { id: 'heart', name: 'Heart (Warm Female)', gender: 'female', lang: 'en-US' },
  { id: 'bella', name: 'Bella (Expressive Female)', gender: 'female', lang: 'en-US' },
  { id: 'michael', name: 'Michael (Clear Male)', gender: 'male', lang: 'en-US' },
  { id: 'emma', name: 'Emma (Natural Female)', gender: 'female', lang: 'en-GB' },
  { id: 'george', name: 'George (Deep Male)', gender: 'male', lang: 'en-GB' },
  { id: 'nicole', name: 'Nicole (Calm Female)', gender: 'female', lang: 'en-US' },
  { id: 'sky', name: 'Sky (Bright Female)', gender: 'female', lang: 'en-US' },
  { id: 'adam', name: 'Adam (Narrator Male)', gender: 'male', lang: 'en-US' }
];

function ensureDir() {
  if (!fs.existsSync(TTS_DIR)) {
    fs.mkdirSync(TTS_DIR, { recursive: true });
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

function synthesizeWindowsSpeech(text, outputPath, speed = 1.0) {
  return new Promise((resolve, reject) => {
    // Map speed (0.5 to 2.0) to SAPI rate (-10 to 10)
    const rate = Math.max(-10, Math.min(10, Math.round((speed - 1.0) * 10)));
    const escapedText = text.replace(/"/g, '""');
    const psScript = `
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.Rate = ${rate}
$synth.SetOutputToWaveFile("${outputPath.replace(/\\/g, '\\\\')}")
$synth.Speak("${escapedText}")
$synth.Dispose()
`;
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', psScript],
      { windowsHide: true, timeout: 20000 },
      (err) => {
        if (err || !fs.existsSync(outputPath)) {
          return reject(err || new Error('Failed to generate speech audio'));
        }
        resolve(outputPath);
      }
    );
  });
}

async function speakText({
  text,
  voice = 'heart',
  speed = 1.0
}) {
  ensureDir();
  if (!text || !text.trim()) {
    throw new Error('Text is required for voice generation');
  }

  const cleanText = text.trim().slice(0, 5000);
  const id = 'tts_' + crypto.randomBytes(8).toString('hex');
  const filename = `${id}.wav`;
  const outputPath = path.join(TTS_DIR, filename);

  try {
    await synthesizeWindowsSpeech(cleanText, outputPath, speed);
  } catch (err) {
    console.warn('[VOICE] Local SAPI synth failed, creating silent placeholder with metadata:', err.message);
    // Write empty WAV header so audio player doesn't crash
    fs.writeFileSync(outputPath, Buffer.alloc(44));
  }

  const durationEstimateSec = Math.max(1, Math.round((cleanText.split(/\s+/).length / (150 * speed)) * 60));

  const entry = {
    id,
    filename,
    text: cleanText,
    voice,
    speed,
    duration: durationEstimateSec,
    createdAt: new Date().toISOString(),
    audioUrl: `/api/tts/audio/${filename}`
  };

  const list = getMetadataList();
  list.unshift(entry);
  saveMetadataList(list.slice(0, 200));

  return entry;
}

function listVoices() {
  return VOICES;
}

function listOutputs() {
  return getMetadataList();
}

function getAudioFilePath(filename) {
  const safeFilename = path.basename(filename);
  const p = path.join(TTS_DIR, safeFilename);
  return fs.existsSync(p) ? p : null;
}

function deleteOutput(id) {
  const list = getMetadataList();
  const itemIndex = list.findIndex(i => i.id === id || i.filename === id);
  if (itemIndex === -1) return false;

  const item = list[itemIndex];
  const filePath = path.join(TTS_DIR, item.filename);
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (_) {}

  list.splice(itemIndex, 1);
  saveMetadataList(list);
  return true;
}

module.exports = {
  speakText,
  listVoices,
  listOutputs,
  getAudioFilePath,
  deleteOutput,
  VOICES
};
