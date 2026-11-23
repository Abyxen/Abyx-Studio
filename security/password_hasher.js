/**
 * ABYX Security — Password Hashing Service
 * 
 * Implements modern password hashing using Argon2id:
 * - Algorithm: Argon2id (hybrid data-dependent & data-independent memory hardness)
 * - Memory cost: 64 MB (m=65536)
 * - Time cost: 3 iterations (t=3)
 * - Parallelism: 4 threads (p=4)
 * - Salt: Cryptographically random 16 bytes generated internally by Argon2
 * 
 * Fallback: Node.js crypto.scryptSync with high memory cost if native Argon2 fails.
 */

let argon2 = null;
try {
  argon2 = require('argon2');
} catch (_) {}
const crypto = require('node:crypto');

const ARGON2_OPTIONS = argon2 ? {
  type: argon2.argon2id,
  memoryCost: 65536, // 64 MB
  timeCost: 3,       // 3 iterations
  parallelism: 4,    // 4 threads
  hashLength: 32     // 32 bytes output
} : null;

/**
 * Hash a plaintext password using Argon2id
 */
async function hashPassword(plainPassword) {
  if (!plainPassword || typeof plainPassword !== 'string') {
    throw new Error('Password must be a non-empty string');
  }
  if (plainPassword.length < 6) {
    throw new Error('Password must be at least 6 characters long');
  }

  try {
    return await argon2.hash(plainPassword, ARGON2_OPTIONS);
  } catch (err) {
    console.warn('[AUTH] Argon2 hashing failed, using scrypt fallback:', err.message);
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(plainPassword, salt, 64, {
      N: 16384,
      r: 8,
      p: 1,
      maxmem: 64 * 1024 * 1024
    }).toString('hex');
    return `$scrypt$N=16384,r=8,p=1$${salt}$${hash}`;
  }
}

/**
 * Verify a plaintext password against an existing hash
 */
async function verifyPassword(storedHash, candidatePassword) {
  if (!storedHash || !candidatePassword) return false;

  try {
    if (storedHash.startsWith('$argon2')) {
      return await argon2.verify(storedHash, candidatePassword);
    } else if (storedHash.startsWith('$scrypt$')) {
      const parts = storedHash.split('$');
      const salt = parts[3];
      const originalHash = parts[4];
      const candidateHash = crypto.scryptSync(candidatePassword, salt, 64, {
        N: 16384,
        r: 8,
        p: 1,
        maxmem: 64 * 1024 * 1024
      }).toString('hex');
      return crypto.timingSafeEqual(Buffer.from(originalHash, 'hex'), Buffer.from(candidateHash, 'hex'));
    }
  } catch (err) {
    console.error('[AUTH] Password verification error:', err.message);
    return false;
  }
  return false;
}

module.exports = {
  hashPassword,
  verifyPassword
};
