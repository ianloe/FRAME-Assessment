# Architecture

## System Context & Containers

```mermaid
flowchart LR
  User["Practitioner / Reviewer / Auditor / Admin"] --> Proxy["TLS Reverse Proxy (Caddy / Nginx)"]
  Proxy --> Web["Web Container (nginx-unprivileged + React SPA)"]
  Web -->|/api/*| Api["API Container (Fastify + TypeScript)"]
  Api --> Db["PostgreSQL 16 (frame_pgdata volume)"]
  Api --> Storage["File Storage (frame_uploads / S3 interface)"]
  Api --> Smtp["SMTP Provider (MailHog in dev)"]
```

## Backend Choice: Fastify vs NestJS

Fastify was chosen over NestJS for:
1. Minimal dependency surface and fast cold-start in non-root Alpine containers.
2. Explicit, auditable security middleware pipeline (`@fastify/helmet`, `@fastify/cors`, `@fastify/cookie`, `@fastify/rate-limit`, custom `authenticateRequest` / `requireFullAuth` / `requireStepUp`).
3. Native Zod validation and OpenAPI generation (`@fastify/swagger` at `/api/docs`).

## Entity Relationship Diagram (Core Domain)

```mermaid
erDiagram
  ORGANISATIONS ||--o{ BUSINESS_UNITS : contains
  ORGANISATIONS ||--o{ AI_SYSTEMS : owns
  BUSINESS_UNITS ||--o{ AI_SYSTEMS : scopes
  USERS ||--o{ USER_SCOPES : assigned
  USERS ||--o{ SESSIONS : holds
  USERS ||--o{ WEBAUTHN_CREDENTIALS : enrols
  USERS ||--o| TOTP_SECRETS : enrols
  USERS ||--o{ RECOVERY_CODES : owns
  QUESTIONNAIRE_VERSIONS ||--o{ DIMENSIONS : defines
  DIMENSIONS ||--o{ QUESTIONS : contains
  AI_SYSTEMS ||--o{ ASSESSMENTS : evaluated_by
  QUESTIONNAIRE_VERSIONS ||--o{ ASSESSMENTS : versions
  ASSESSMENTS ||--o{ RESPONSES : records
  RESPONSES ||--o{ RESPONSE_HISTORY : audits
  ASSESSMENTS ||--o{ EVIDENCE : backed_by
  ASSESSMENTS ||--o{ REVIEW_RECORDS : reviewed_via
  AI_SYSTEMS ||--o{ ACTIONS : remediates
  AI_SYSTEMS ||--o{ CHECKLIST_RUNS : tracks
  ASSESSMENTS ||--o{ AUDIT_FINDINGS : observed_in
```
