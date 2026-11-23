'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const VAULT_DIR = path.resolve(process.env.ABYX_DATA_DIR || path.join(__dirname, '..', 'data'), 'secure_vault');
const secretCache = new Map();

function ensureVaultDir() {
  fs.mkdirSync(VAULT_DIR, { recursive: true, mode: 0o700 });
  try { if (process.platform !== 'win32') fs.chmodSync(VAULT_DIR, 0o700); } catch {}
}

function getVaultFilename(profileId, providerId) {
  const hash = crypto.createHash('sha256').update(`${profileId}::${providerId}`).digest('hex');
  return path.join(VAULT_DIR, `${hash}.enc`);
}

const powershellScript = `$ErrorActionPreference='Stop'; $j=[Console]::In.ReadToEnd() | ConvertFrom-Json; Add-Type -AssemblyName System.Security; $inputBytes=[Convert]::FromBase64String([string]$j.value); if($j.mode -eq 'encrypt'){ $outputBytes=[System.Security.Cryptography.ProtectedData]::Protect($inputBytes,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser) } else { $outputBytes=[System.Security.Cryptography.ProtectedData]::Unprotect($inputBytes,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser) }; [Console]::Out.Write([Convert]::ToBase64String($outputBytes))`;

function windowsDpapi(mode, value) {
  const encodedScript = Buffer.from(powershellScript, 'utf16le').toString('base64');
  const result = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encodedScript], {
    input: JSON.stringify({ mode, value: Buffer.from(value, mode === 'encrypt' ? 'utf8' : 'base64').toString('base64') }), encoding: 'utf8', windowsHide: true, timeout: 10000, maxBuffer: 1024 * 1024
  });
  if (result.error || result.status !== 0) throw new Error(`Windows DPAPI operation failed (${result.error?.code || result.status || 'unknown'})`);
  const output = (result.stdout || '').trim();
  return mode === 'encrypt' ? output : Buffer.from(output, 'base64').toString('utf8');
}

function keyFilePath() { return path.join(VAULT_DIR, '.vault-key'); }
function portableKey() {
  ensureVaultDir();
  const filename = keyFilePath();
  if (!fs.existsSync(filename)) {
    const key = crypto.randomBytes(32);
    try { fs.writeFileSync(filename, key, { flag: 'wx', mode: 0o600 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  const key = fs.readFileSync(filename);
  if (key.length !== 32) throw new Error('Credential key file is invalid');
  try { if (process.platform !== 'win32') fs.chmodSync(filename, 0o600); } catch {}
  return key;
}

function encryptPortable(plainText) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', portableKey(), iv);
  const data = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  return { v: 3, provider: 'aes-256-gcm-keyfile', iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}

function decryptPortable(payload) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', portableKey(), Buffer.from(payload.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(payload.data, 'base64')), decipher.final()]).toString('utf8');
}

function legacyKey() {
  const seed = `${process.env.COMPUTERNAME || 'ABYX'}_${process.env.USERPROFILE || 'LOCAL'}_VAULT_KEY_2026`;
  return crypto.createHash('sha256').update(seed).digest();
}

function decryptLegacy(payload) {
  if (!payload || !payload.iv || !payload.tag || !payload.data) return null;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', legacyKey(), Buffer.from(payload.iv, 'hex'));
    decipher.setAuthTag(Buffer.from(payload.tag, 'hex'));
    return decipher.update(payload.data, 'hex', 'utf8') + decipher.final('utf8');
  } catch { return null; }
}

function encryptSecret(secret) {
  if (process.platform === 'win32') return { v: 3, provider: 'windows-dpapi-current-user', data: windowsDpapi('encrypt', secret) };
  return encryptPortable(secret);
}

function decryptSecret(serialized) {
  let payload;
  try { payload = JSON.parse(serialized); } catch { return null; }
  try {
    if (payload?.v === 3 && payload.provider === 'windows-dpapi-current-user' && process.platform === 'win32') return windowsDpapi('decrypt', payload.data);
    if (payload?.v === 3 && payload.provider === 'aes-256-gcm-keyfile' && process.platform !== 'win32') return decryptPortable(payload);
    if (payload?.fallback || payload?.v === 2) {
      const migrated = decryptLegacy(payload);
      if (migrated && process.platform === 'win32') return migrated;
      if (migrated && process.platform !== 'win32') return migrated;
    }
  } catch { return null; }
  return null;
}

function storeSecret(profileId, providerId, secret) {
  const cacheKey = `${profileId}:${providerId}`;
  if (!secret || typeof secret !== 'string') {
    removeSecret(profileId, providerId);
    return null;
  }
  const trimmed = secret.trim();
  if (!trimmed || trimmed.length > 16384) throw new Error('Credential is empty or too large');
  ensureVaultDir();
  const filename = getVaultFilename(profileId, providerId);
  const payload = encryptSecret(trimmed);
  fs.writeFileSync(filename, JSON.stringify(payload), { mode: 0o600 });
  secretCache.set(cacheKey, trimmed);
  return {
    providerId, profileId,
    keyMasked: trimmed.length > 8 ? `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}` : '****',
    keyLength: trimmed.length,
    storeType: payload.provider,
    credRef: path.basename(filename)
  };
}

function getSecret(profileId, providerId) {
  const cacheKey = `${profileId}:${providerId}`;
  if (secretCache.has(cacheKey)) return secretCache.get(cacheKey);
  const filename = getVaultFilename(profileId, providerId);
  if (!fs.existsSync(filename)) { secretCache.set(cacheKey, null); return null; }
  try {
    const serialized = fs.readFileSync(filename, 'utf8');
    const secret = decryptSecret(serialized);
    if (secret) {
      const old = JSON.parse(serialized);
      if (old.v !== 3) fs.writeFileSync(filename, JSON.stringify(encryptSecret(secret)), { mode: 0o600 });
    }
    secretCache.set(cacheKey, secret || null);
    return secret || null;
  } catch { secretCache.set(cacheKey, null); return null; }
}

function removeSecret(profileId, providerId) {
  const cacheKey = `${profileId}:${providerId}`;
  secretCache.delete(cacheKey);
  const filename = getVaultFilename(profileId, providerId);
  try { if (fs.existsSync(filename)) fs.unlinkSync(filename); return true; } catch { return false; }
}

function clearProfileCache(profileId) {
  for (const key of secretCache.keys()) if (key.startsWith(`${profileId}:`)) secretCache.delete(key);
}

module.exports = { storeSecret, getSecret, removeSecret, clearProfileCache, decryptSecret, encryptSecret };
