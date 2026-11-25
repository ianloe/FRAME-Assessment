import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, desc, inArray } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { decryptTotpSecret, encryptTotpSecret } from '../services/crypto.js';
import { getSetting, setSetting } from '../services/settings.js';
import { isEntityInScope } from '../services/scope.js';
import { writeAuditLog } from '../services/audit.js';
import { assertPermission, requireFullAuth, requireStepUp } from '../middleware/auth.js';

export const LlmProviderSchema = z.enum([
  'openrouter',
  'gemini',
  'openai',
  'anthropic',
  'agnes-ai',
  'deepseek',
  'custom'
]);

export type LlmProvider = z.infer<typeof LlmProviderSchema>;

export interface StoredAiInsightsConfig {
  enabled: boolean;
  allowUserOverride: boolean;
  provider: LlmProvider;
  model: string;
  baseUrl: string;
  encryptedApiKey: string;
  keyVersion: string;
  keyHint: string;
}

export const DEFAULT_AI_INSIGHTS_CONFIG: StoredAiInsightsConfig = {
  enabled: false,
  allowUserOverride: true,
  provider: 'openrouter',
  model: 'openai/gpt-4o-mini',
  baseUrl: '',
  encryptedApiKey: '',
  keyVersion: 'v1',
  keyHint: ''
};

const DEFAULT_BASE_URLS: Record<LlmProvider, string> = {
  openrouter: 'https://openrouter.ai/api/v1',
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
  'agnes-ai': 'https://api.agnes-ai.com/v1',
  deepseek: 'https://api.deepseek.com/v1',
  custom: ''
};

function validateOutboundUrl(rawUrl: string): void {
  if (!rawUrl) return;
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Base URL must use http:// or https://');
  }
  const host = parsed.hostname.toLowerCase();
  if (host === '169.254.169.254' || host === 'metadata.google.internal') {
    throw new Error('Disallowed metadata host in Base URL');
  }
}

async function callLlm(params: {
  provider: LlmProvider;
  model: string;
  baseUrl: string;
  apiKey: string;
  systemPrompt: string;
  userPrompt: string;
}): Promise<string> {
  const effectiveBase = (params.baseUrl || DEFAULT_BASE_URLS[params.provider]).replace(/\/+$/, '');
  if (!effectiveBase) {
    throw new Error('A Base URL is required for custom LLM providers.');
  }
  validateOutboundUrl(effectiveBase);

  if (params.provider === 'gemini') {
    const endpoint = `${effectiveBase}/models/${encodeURIComponent(params.model)}:generateContent?key=${encodeURIComponent(params.apiKey)}`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: params.systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: params.userPrompt }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 1800 }
      })
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini API error (${res.status}): ${errText.slice(0, 300)}`);
    }
    const json = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    return json.candidates?.[0]?.content?.parts?.[0]?.text ?? 'No insight returned.';
  }

  if (params.provider === 'anthropic') {
    const endpoint = `${effectiveBase}/messages`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': params.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: params.model,
        max_tokens: 1800,
        system: params.systemPrompt,
        messages: [{ role: 'user', content: params.userPrompt }]
      })
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Anthropic API error (${res.status}): ${errText.slice(0, 300)}`);
    }
    const json = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    return json.content?.find((c) => c.type === 'text')?.text ?? 'No insight returned.';
  }

  // OpenAI-compatible (openrouter, openai, deepseek, agnes-ai, custom)
  const endpoint = effectiveBase.endsWith('/chat/completions')
    ? effectiveBase
    : `${effectiveBase}/chat/completions`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${params.apiKey}`
  };
  if (params.provider === 'openrouter') {
    headers['X-Title'] = 'FRAME Assessment Platform';
  }

  const res = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: params.model,
      temperature: 0.3,
      max_tokens: 1800,
      messages: [
        { role: 'system', content: params.systemPrompt },
        { role: 'user', content: params.userPrompt }
      ]
    })
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`LLM provider error (${res.status}): ${errText.slice(0, 300)}`);
  }
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return json.choices?.[0]?.message?.content ?? 'No insight returned.';
}

function sanitizeForClient(cfg: StoredAiInsightsConfig) {
  return {
    enabled: cfg.enabled,
    allowUserOverride: cfg.allowUserOverride,
    provider: cfg.provider,
    model: cfg.model,
    baseUrl: cfg.baseUrl,
    hasApiKey: Boolean(cfg.encryptedApiKey),
    keyHint: cfg.keyHint
  };
}

export async function aiInsightsRoutes(app: FastifyInstance) {
  // Admin: get global AI Insights config
  app.get('/api/admin/ai-insights', { preHandler: requireFullAuth }, async (request, reply) => {
    if (!assertPermission(request, reply, 'security_policy:manage')) return;
    const cfg = await getSetting<StoredAiInsightsConfig>(
      'ai_insights_config',
      DEFAULT_AI_INSIGHTS_CONFIG
    );
    return sanitizeForClient(cfg);
  });

  // Admin: update global AI Insights config
  app.put('/api/admin/ai-insights', { preHandler: requireStepUp }, async (request, reply) => {
    if (!assertPermission(request, reply, 'security_policy:manage')) return;
    const body = z
      .object({
        enabled: z.boolean(),
        allowUserOverride: z.boolean().default(true),
        provider: LlmProviderSchema,
        model: z.string().trim().min(1).max(160),
        baseUrl: z.string().trim().max(500).default(''),
        apiKey: z.string().trim().max(500).optional()
      })
      .parse(request.body);

    if (body.baseUrl) validateOutboundUrl(body.baseUrl);

    const existing = await getSetting<StoredAiInsightsConfig>(
      'ai_insights_config',
      DEFAULT_AI_INSIGHTS_CONFIG
    );

    let encryptedApiKey = existing.encryptedApiKey;
    let keyVersion = existing.keyVersion;
    let keyHint = existing.keyHint;

    if (body.apiKey && body.apiKey.length > 0) {
      const enc = encryptTotpSecret(body.apiKey);
      encryptedApiKey = enc.encryptedSecret;
      keyVersion = enc.keyVersion;
      keyHint = body.apiKey.length >= 8 ? `...${body.apiKey.slice(-4)}` : 'configured';
    }

    const next: StoredAiInsightsConfig = {
      enabled: body.enabled,
      allowUserOverride: body.allowUserOverride,
      provider: body.provider,
      model: body.model,
      baseUrl: body.baseUrl,
      encryptedApiKey,
      keyVersion,
      keyHint
    };

    await setSetting('ai_insights_config', next, request.auth!.userId);
    await writeAuditLog({
      actorId: request.auth!.userId,
      actorRole: request.auth!.role,
      action: 'ai_insights.config_update',
      entityType: 'settings',
      entityId: 'ai_insights_config',
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? '',
      afterJson: {
        enabled: next.enabled,
        allowUserOverride: next.allowUserOverride,
        provider: next.provider,
        model: next.model
      }
    });

    return sanitizeForClient(next);
  });

  // User: view effective AI Insights availability & own override
  app.get('/api/ai-insights/config', { preHandler: requireFullAuth }, async (request) => {
    const auth = request.auth!;
    const globalCfg = await getSetting<StoredAiInsightsConfig>(
      'ai_insights_config',
      DEFAULT_AI_INSIGHTS_CONFIG
    );
    const userKey = `ai_insights_user:${auth.userId}`;
    const userCfg = await getSetting<StoredAiInsightsConfig>(userKey, DEFAULT_AI_INSIGHTS_CONFIG);

    return {
      globalEnabled: globalCfg.enabled,
      allowUserOverride: globalCfg.allowUserOverride,
      globalProvider: globalCfg.provider,
      globalModel: globalCfg.model,
      globalHasApiKey: Boolean(globalCfg.encryptedApiKey),
      userConfig: sanitizeForClient(userCfg)
    };
  });

  // User: save personal LLM override (when allowUserOverride is enabled or user is admin)
  app.put('/api/ai-insights/user-config', { preHandler: requireFullAuth }, async (request, reply) => {
    const auth = request.auth!;
    const globalCfg = await getSetting<StoredAiInsightsConfig>(
      'ai_insights_config',
      DEFAULT_AI_INSIGHTS_CONFIG
    );
    if (!globalCfg.allowUserOverride && auth.role !== 'admin') {
      return reply
        .code(403)
        .send({ error: 'Personal LLM configuration is disabled by Administrator policy.' });
    }

    const body = z
      .object({
        enabled: z.boolean(),
        provider: LlmProviderSchema,
        model: z.string().trim().min(1).max(160),
        baseUrl: z.string().trim().max(500).default(''),
        apiKey: z.string().trim().max(500).optional()
      })
      .parse(request.body);

    if (body.baseUrl) validateOutboundUrl(body.baseUrl);

    const userKey = `ai_insights_user:${auth.userId}`;
    const existing = await getSetting<StoredAiInsightsConfig>(userKey, DEFAULT_AI_INSIGHTS_CONFIG);

    let encryptedApiKey = existing.encryptedApiKey;
    let keyVersion = existing.keyVersion;
    let keyHint = existing.keyHint;

    if (body.apiKey && body.apiKey.length > 0) {
      const enc = encryptTotpSecret(body.apiKey);
      encryptedApiKey = enc.encryptedSecret;
      keyVersion = enc.keyVersion;
      keyHint = body.apiKey.length >= 8 ? `...${body.apiKey.slice(-4)}` : 'configured';
    }

    const next: StoredAiInsightsConfig = {
      enabled: body.enabled,
      allowUserOverride: true,
      provider: body.provider,
      model: body.model,
      baseUrl: body.baseUrl,
      encryptedApiKey,
      keyVersion,
      keyHint
    };

    await setSetting(userKey, next, auth.userId);
    return sanitizeForClient(next);
  });

  // Generate AI Governance Insights for one or multiple AI systems
  app.post('/api/ai-insights/generate', { preHandler: requireFullAuth }, async (request, reply) => {
    const auth = request.auth!;
    const body = z
      .object({
        aiSystemIds: z.array(z.string().uuid()).min(1).max(15),
        focusPrompt: z.string().trim().max(1000).optional()
      })
      .parse(request.body);

    const globalCfg = await getSetting<StoredAiInsightsConfig>(
      'ai_insights_config',
      DEFAULT_AI_INSIGHTS_CONFIG
    );
    const userCfg = await getSetting<StoredAiInsightsConfig>(
      `ai_insights_user:${auth.userId}`,
      DEFAULT_AI_INSIGHTS_CONFIG
    );

    const useUserCfg =
      (globalCfg.allowUserOverride || auth.role === 'admin') &&
      userCfg.enabled &&
      Boolean(userCfg.encryptedApiKey);

    const activeCfg = useUserCfg ? userCfg : globalCfg;

    if (!activeCfg.enabled) {
      return reply.code(400).send({
        error:
          'AI Insights is not enabled. An Administrator must enable AI Insights (or configure a personal LLM).'
      });
    }
    if (!activeCfg.encryptedApiKey) {
      return reply.code(400).send({
        error: 'No LLM API key is configured. Please configure an API key in Administration or My Security.'
      });
    }

    const systems = await db
      .select()
      .from(schema.aiSystems)
      .where(inArray(schema.aiSystems.id, body.aiSystemIds));

    if (systems.length === 0) {
      return reply.code(404).send({ error: 'No matching AI systems found.' });
    }

    for (const sys of systems) {
      const inScope = isEntityInScope(auth.role, auth.scopes, {
        organisationId: sys.organisationId,
        businessUnitId: sys.businessUnitId,
        aiSystemId: sys.id
      });
      if (!assertPermission(request, reply, 'ai_system:view', { inScope })) return;
    }

    const allAssessments = await db
      .select()
      .from(schema.assessments)
      .where(inArray(schema.assessments.aiSystemId, body.aiSystemIds))
      .orderBy(desc(schema.assessments.assessmentDate));

    const allActions = await db
      .select()
      .from(schema.actions)
      .where(inArray(schema.actions.aiSystemId, body.aiSystemIds));

    const allFindings = await db
      .select()
      .from(schema.auditFindings)
      .where(inArray(schema.auditFindings.aiSystemId, body.aiSystemIds));

    const contextBlocks = systems.map((sys) => {
      const sysAssessments = allAssessments.filter(
        (a) => a.aiSystemId === sys.id && a.status !== 'archived'
      );
      const latest = sysAssessments[0];
      const sysActions = allActions.filter((a) => a.aiSystemId === sys.id);
      const sysFindings = allFindings.filter((f) => f.aiSystemId === sys.id);

      return {
        name: sys.name,
        department: sys.department || 'Not specified',
        lifecycleStage: sys.lifecycleStage,
        deploymentType: sys.deploymentType,
        riskTier: sys.riskTier,
        targetMaturityLevel: sys.targetMaturityLevel,
        regulatoryTags: sys.regulatoryTags,
        aaefReference: sys.aaefReference,
        latestAssessment: latest
          ? {
              title: latest.title,
              status: latest.status,
              overallScore: latest.overallScore,
              dimensionScores: latest.dimensionScoresJson,
              narrativeSummary: latest.narrativeSummary
            }
          : null,
        openActions: sysActions
          .filter((a) => a.status !== 'completed' && a.status !== 'cancelled')
          .map((a) => ({ title: a.title, priority: a.priority, status: a.status })),
        auditFindings: sysFindings.map((f) => ({
          title: f.title,
          severity: f.severity,
          status: f.status
        }))
      };
    });

    const systemPrompt = [
      'You are an expert enterprise AI governance advisor using the FRAME framework (Focus, Roles, Authority, Metrics, Evaluation).',
      'Analyse the provided AI system governance data and produce concise, actionable insights in British English.',
      'Do not use em dashes anywhere in your response.',
      'Structure your response with: 1) Executive Summary, 2) Key Governance Gaps & Risks, 3) Prioritised FRAME Recommendations (by dimension).'
    ].join(' ');

    const userPrompt = [
      body.focusPrompt ? `Specific practitioner focus: ${body.focusPrompt}\n` : '',
      `AI Systems Data (JSON):\n${JSON.stringify(contextBlocks, null, 2)}`
    ].join('\n');

    const apiKey = decryptTotpSecret(activeCfg.encryptedApiKey, activeCfg.keyVersion);
    const insightText = await callLlm({
      provider: activeCfg.provider,
      model: activeCfg.model,
      baseUrl: activeCfg.baseUrl,
      apiKey,
      systemPrompt,
      userPrompt
    });

    await writeAuditLog({
      actorId: auth.userId,
      actorRole: auth.role,
      action: 'ai_insights.generate',
      entityType: 'ai_system',
      entityId: body.aiSystemIds.join(','),
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? '',
      afterJson: {
        provider: activeCfg.provider,
        model: activeCfg.model,
        systemCount: systems.length
      }
    });

    return {
      provider: activeCfg.provider,
      model: activeCfg.model,
      generatedAt: new Date().toISOString(),
      insights: insightText
    };
  });
}
