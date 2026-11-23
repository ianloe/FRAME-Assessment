import crypto from 'node:crypto';

function parseEncryptionKeys(raw: string): Record<string, Buffer> {
  const result: Record<string, Buffer> = {};
  for (const part of raw.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;
    const version = trimmed.slice(0, colonIdx).trim();
    const hexKey = trimmed.slice(colonIdx + 1).trim();
    if (hexKey.length === 64) {
      result[version] = Buffer.from(hexKey, 'hex');
    } else {
      result[version] = crypto.createHash('sha256').update(hexKey).digest();
    }
  }
  if (Object.keys(result).length === 0) {
    result.v1 = crypto.createHash('sha256').update('dev-only-totp-key').digest();
  }
  return result;
}

export const config = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 3001),
  appBaseUrl: process.env.APP_BASE_URL ?? 'http://localhost:8080',
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:8080',
  defaultTimezone: process.env.DEFAULT_TIMEZONE ?? 'Asia/Singapore',
  databaseUrl:
    process.env.DATABASE_URL ?? 'postgresql://frame:frame_dev_password@localhost:5432/frame_db',
  sessionSecret: process.env.SESSION_SECRET ?? 'dev-session-secret-change-in-production-32chars',
  totpEncryptionKeys: parseEncryptionKeys(
    process.env.TOTP_ENCRYPTION_KEYS ??
      'v1:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
  ),
  totpActiveKeyVersion: process.env.TOTP_ACTIVE_KEY_VERSION ?? 'v1',
  webauthnRpName: process.env.WEBAUTHN_RP_NAME ?? 'FRAME Assessment Platform',
  webauthnRpId: process.env.WEBAUTHN_RP_ID ?? 'localhost',
  webauthnOrigin: process.env.WEBAUTHN_ORIGIN ?? 'http://localhost:8080',
  adminName: process.env.ADMIN_NAME ?? 'Platform Administrator',
  adminEmail: (process.env.ADMIN_EMAIL ?? 'admin@frame.local').toLowerCase(),
  adminPassword: process.env.ADMIN_PASSWORD ?? '',
  seedDemo: process.env.SEED_DEMO === 'true',
  smtpHost: process.env.SMTP_HOST ?? 'localhost',
  smtpPort: Number(process.env.SMTP_PORT ?? 1025),
  smtpSecure: process.env.SMTP_SECURE === 'true',
  smtpUser: process.env.SMTP_USER ?? '',
  smtpPass: process.env.SMTP_PASS ?? '',
  smtpFrom: process.env.SMTP_FROM ?? 'noreply@frame.local',
  storageDriver: process.env.STORAGE_DRIVER ?? 'local',
  uploadDir: process.env.UPLOAD_DIR ?? './uploads',
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES ?? 10 * 1024 * 1024)
};
