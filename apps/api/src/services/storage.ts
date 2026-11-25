import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { sha256Hex } from './crypto.js';

export interface StoredFileResult {
  storageKey: string;
  sizeBytes: number;
  sha256Hash: string;
  mimeType: string;
}

export interface StorageProvider {
  save(buffer: Buffer, originalFilename: string, declaredMime: string): Promise<StoredFileResult>;
  read(storageKey: string): Promise<Buffer>;
  remove(storageKey: string): Promise<void>;
}

const ALLOWED_EXTENSIONS = new Set([
  '.pdf',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.txt',
  '.csv',
  '.json',
  '.docx',
  '.xlsx',
  '.md'
]);

const ALLOWED_MIMES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'text/plain',
  'text/csv',
  'text/markdown',
  'application/json',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
]);

function sniffMagicBytes(buf: Buffer, ext: string): string | null {
  if (buf.length >= 4 && buf.subarray(0, 4).toString('ascii') === '%PDF') {
    return 'application/pdf';
  }
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return 'image/png';
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'image/jpeg';
  }
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) {
    // ZIP container (DOCX / XLSX)
    if (ext === '.docx') {
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    }
    if (ext === '.xlsx') {
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    }
  }
  if (ext === '.txt' || ext === '.csv' || ext === '.json' || ext === '.md') {
    // Reject obvious binary/null-byte payloads in text files
    if (buf.includes(0x00)) return null;
    if (ext === '.json') return 'application/json';
    if (ext === '.csv') return 'text/csv';
    if (ext === '.md') return 'text/markdown';
    return 'text/plain';
  }
  if (ext === '.webp' && buf.length >= 12 && buf.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

export type AntivirusHook = (buffer: Buffer, filename: string) => Promise<{ clean: boolean; reason?: string }>;

const defaultAntivirusHook: AntivirusHook = async () => ({ clean: true });

export class LocalStorageProvider implements StorageProvider {
  private baseDir: string;
  private avHook: AntivirusHook;

  constructor(baseDir: string, avHook: AntivirusHook = defaultAntivirusHook) {
    this.baseDir = path.resolve(baseDir);
    this.avHook = avHook;
  }

  async save(buffer: Buffer, originalFilename: string, declaredMime: string): Promise<StoredFileResult> {
    if (buffer.length === 0) {
      throw new Error('Uploaded file is empty');
    }
    if (buffer.length > config.maxUploadBytes) {
      throw new Error(`File exceeds maximum size of ${config.maxUploadBytes} bytes`);
    }

    const ext = path.extname(originalFilename).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      throw new Error(`File extension ${ext || '(none)'} is not permitted`);
    }

    const sniffed = sniffMagicBytes(buffer, ext);
    const effectiveMime = sniffed ?? declaredMime;
    if (!sniffed || !ALLOWED_MIMES.has(effectiveMime)) {
      throw new Error('File content does not match an allowed file type');
    }

    const avResult = await this.avHook(buffer, originalFilename);
    if (!avResult.clean) {
      throw new Error(avResult.reason ?? 'File rejected by antivirus scan');
    }

    await fs.mkdir(this.baseDir, { recursive: true });
    const storageKey = `${crypto.randomUUID()}${ext}`;
    const fullPath = path.join(this.baseDir, storageKey);
    await fs.writeFile(fullPath, buffer, { mode: 0o600 });

    return {
      storageKey,
      sizeBytes: buffer.length,
      sha256Hash: sha256Hex(buffer),
      mimeType: effectiveMime
    };
  }

  async read(storageKey: string): Promise<Buffer> {
    const safeName = path.basename(storageKey);
    const fullPath = path.join(this.baseDir, safeName);
    return fs.readFile(fullPath);
  }

  async remove(storageKey: string): Promise<void> {
    const safeName = path.basename(storageKey);
    const fullPath = path.join(this.baseDir, safeName);
    await fs.unlink(fullPath).catch(() => undefined);
  }
}

export const storageProvider: StorageProvider = new LocalStorageProvider(config.uploadDir);
