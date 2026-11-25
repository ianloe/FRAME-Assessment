import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

export interface SecurityPolicy {
  mfaRequiredForAll: boolean;
  passkeyRequiredForAdmins: boolean;
  idleTimeoutMinutes: number;
  absoluteTimeoutHours: number;
  maxFailedLoginAttempts: number;
  lockoutMinutes: number;
  passwordMinLength: number;
  invitationExpiryHours: number;
  stepUpWindowMinutes: number;
}

export const DEFAULT_SECURITY_POLICY: SecurityPolicy = {
  mfaRequiredForAll: true,
  passkeyRequiredForAdmins: false,
  idleTimeoutMinutes: 30,
  absoluteTimeoutHours: 12,
  maxFailedLoginAttempts: 5,
  lockoutMinutes: 15,
  passwordMinLength: 12,
  invitationExpiryHours: 72,
  stepUpWindowMinutes: 10
};

export interface BrandingSettings {
  organisationName: string;
  accentColour: string;
  logoDataUrl: string;
  timezone: string;
}

export const DEFAULT_BRANDING_SETTINGS: BrandingSettings = {
  organisationName: 'FRAME Assessment Platform',
  accentColour: '#0f766e',
  logoDataUrl: '',
  timezone: 'Asia/Singapore'
};

export interface TaxonomySettings {
  lifecycleStages: string[];
  deploymentTypes: string[];
  riskTiers: Array<{ name: string; targetMaturityLevel: number }>;
  regulatoryTags: string[];
  evidenceTypes: string[];
}

export const DEFAULT_TAXONOMY_SETTINGS: TaxonomySettings = {
  lifecycleStages: ['idea', 'pilot', 'production', 'retired'],
  deploymentTypes: [
    'assistant',
    'copilot',
    'autonomous_agent',
    'multi_agent',
    'predictive_model',
    'other'
  ],
  riskTiers: [
    { name: 'low', targetMaturityLevel: 2.5 },
    { name: 'medium', targetMaturityLevel: 3.0 },
    { name: 'high', targetMaturityLevel: 3.5 },
    { name: 'critical', targetMaturityLevel: 4.0 }
  ],
  regulatoryTags: ['MAS FEAT', 'PDPA', 'EU AI Act', 'ISO 42001', 'NIST AI RMF'],
  evidenceTypes: ['policy', 'screenshot', 'log', 'report', 'contract', 'other']
};

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const [row] = await db.select().from(schema.settings).where(eq(schema.settings.key, key)).limit(1);
  if (!row) return fallback;
  return { ...fallback, ...(row.valueJson as Record<string, unknown>) } as T;
}

export async function setSetting<T>(key: string, value: T, updatedBy?: string | null): Promise<void> {
  await db
    .insert(schema.settings)
    .values({
      key,
      valueJson: value as unknown as Record<string, unknown>,
      updatedBy: updatedBy ?? null,
      updatedAt: new Date()
    })
    .onConflictDoUpdate({
      target: schema.settings.key,
      set: {
        valueJson: value as unknown as Record<string, unknown>,
        updatedBy: updatedBy ?? null,
        updatedAt: new Date()
      }
    });
}
