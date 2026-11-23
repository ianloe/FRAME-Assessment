import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { ZodError } from 'zod';
import { config } from './config.js';
import { pool } from './db/index.js';
import { authRoutes } from './routes/auth.js';
import { adminRoutes } from './routes/admin.js';
import { systemRoutes } from './routes/systems.js';
import { assessmentRoutes } from './routes/assessments.js';
import { governanceRoutes } from './routes/governance.js';
import { reportRoutes } from './routes/reports.js';
import { aiInsightsRoutes } from './routes/aiInsights.js';

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: config.nodeEnv === 'production' ? 'info' : 'warn',
      redact: ['req.headers.authorization', 'req.headers.cookie']
    },
    trustProxy: true
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"]
      }
    },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
  });

  await app.register(cors, {
    origin: config.corsOrigin,
    credentials: true
  });

  await app.register(cookie);

  await app.register(rateLimit, {
    max: 200,
    timeWindow: '1 minute'
  });

  await app.register(multipart, {
    limits: {
      fileSize: config.maxUploadBytes,
      files: 1
    }
  });

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'FRAME Assessment Platform API',
        description:
          'REST API for the FRAME ("A governance framework for enterprise AI deployment") Assessment Platform.',
        version: '1.0.0'
      }
    }
  });

  await app.register(swaggerUi, {
    routePrefix: '/api/docs'
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: 'Validation error',
        issues: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
      });
    }
    const statusCode = (error as { statusCode?: number }).statusCode ?? 500;
    if (statusCode >= 500) {
      app.log.error(error);
      return reply.code(500).send({ error: 'Internal server error' });
    }
    return reply.code(statusCode).send({ error: (error as Error).message });
  });

  // Health & Metrics
  app.get('/healthz', async () => ({ status: 'ok' }));
  app.get('/readyz', async (_request, reply) => {
    try {
      await pool.query('SELECT 1');
      return { status: 'ready' };
    } catch {
      return reply.code(503).send({ status: 'not_ready' });
    }
  });
  app.get('/metrics', async (_request, reply) => {
    const uptime = process.uptime();
    const mem = process.memoryUsage().rss;
    return reply
      .header('Content-Type', 'text/plain; version=0.0.4')
      .send(
        `frame_api_uptime_seconds ${uptime.toFixed(2)}\nframe_api_memory_rss_bytes ${mem}\n`
      );
  });

  await app.register(authRoutes);
  await app.register(adminRoutes);
  await app.register(systemRoutes);
  await app.register(assessmentRoutes);
  await app.register(governanceRoutes);
  await app.register(reportRoutes);
  await app.register(aiInsightsRoutes);

  return app;
}
