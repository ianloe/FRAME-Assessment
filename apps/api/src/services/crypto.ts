import crypto from 'node:crypto';
import argon2 from 'argon2';
import { config } from '../config.js';

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536, // 64 MiB
    timeCost: 3,
    parallelism: 1
  });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export function sha256Hex(input: string | Buffer): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function generateOpaqueToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function encryptTotpSecret(plainSecret: string): {
  encryptedSecret: string;
  keyVersion: string;
} {
  const keyVersion = config.totpActiveKeyVersion;
  const key = config.totpEncryptionKeys[keyVersion];
  if (!key) {
    throw new Error(`Missing TOTP encryption key for version ${keyVersion}`);
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plainSecret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    encryptedSecret: `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`,
    keyVersion
  };
}

export function decryptTotpSecret(encryptedSecret: string, keyVersion: string): string {
  const key = config.totpEncryptionKeys[keyVersion];
  if (!key) {
    throw new Error(`Missing TOTP decryption key for version ${keyVersion}`);
  }
  const [ivHex, tagHex, dataHex] = encryptedSecret.split(':');
  if (!ivHex || !tagHex || !dataHex) {
    throw new Error('Malformed encrypted TOTP secret');
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataHex, 'hex')),
    decipher.final()
  ]);
  return decrypted.toString('utf8');
}

const COMMON_BREACHED_PASSWORDS = new Set([
  'password1234',
  'password12345',
  '123456789012',
  'qwerty123456',
  'admin1234567',
  'letmein12345',
  'welcome12345',
  'iloveyou1234',
  'monkey123456',
  'dragon123456',
  'sunshine1234',
  'princess1234',
  'football1234',
  'baseball1234',
  'frameadmin123',
  'changeme1234',
  'trustno11234'
]);

export interface PasswordStrengthResult {
  acceptable: boolean;
  score: number; // 0..4
  feedback: string[];
}

export function evaluatePasswordStrength(
  password: string,
  userHints: string[] = []
): PasswordStrengthResult {
  const feedback: string[] = [];
  const lower = password.toLowerCase();

  if (password.length < 12) {
    feedback.push('Must be at least 12 characters long.');
  }
  if (COMMON_BREACHED_PASSWORDS.has(lower)) {
    feedback.push('This password appears in known breached-password lists.');
  }
  for (const hint of userHints) {
    if (hint && hint.length >= 3 && lower.includes(hint.toLowerCase())) {
      feedback.push('Avoid including your name or email address in your password.');
      break;
    }
  }

  let classes = 0;
  if (/[a-z]/.test(password)) classes++;
  if (/[A-Z]/.test(password)) classes++;
  if (/[0-9]/.test(password)) classes++;
  if (/[^A-Za-z0-9]/.test(password)) classes++;

  if (classes < 3) {
    feedback.push('Use a mix of uppercase, lowercase, numbers, and symbols.');
  }
  if (/^(.)\1+$/.test(password) || /(012345|123456|abcdef|qwerty)/i.test(password)) {
    feedback.push('Avoid repeated or sequential character patterns.');
  }

  let score = 0;
  if (password.length >= 12) score++;
  if (password.length >= 16) score++;
  if (classes >= 3) score++;
  if (classes === 4 && feedback.length === 0) score++;

  return {
    acceptable: password.length >= 12 && !COMMON_BREACHED_PASSWORDS.has(lower) && classes >= 2,
    score: Math.min(4, score),
    feedback
  };
}
