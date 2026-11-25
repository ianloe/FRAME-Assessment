# FRAME Assessment Platform

<p align="left">
  <img src="apps/web/public/frame-logo.png" alt="FRAME Logo" width="96" />
</p>

A production-quality, multi-user enterprise AI governance assessment, review, and audit platform built around **FRAME** ("A governance framework for enterprise AI deployment", by Ian Loe, Tactics Solutions, licensed CC BY-NC 4.0).

## Key Features

- **Five FRAME Dimensions**: Assesses **Focus**, **Roles**, **Authority**, **Metrics**, and **Evaluation** across 40 indicators (`F1` to `E9`) and 4 maturity levels (`Initial`, `Developing`, `Defined`, `Optimising`).
- **Role-Aware Portfolio Dashboard**: Recharts 5-dimension radar chart, AI systems by dimension heatmap, maturity trend over time, and filters by organisation, risk tier, and lifecycle stage.
- **AI System Register**: Full CRUD, CSV bulk import with validation preview, CSV export, AAEF cross-reference, and per-system **A4 PDF Governance Dossier** export.
- **Guided Assessment Wizard**: Left-hand dimension navigator, autosave, optimistic locking, cloning with diff highlighting, evidence uploads (local volume behind a `StorageProvider` interface), threaded comments, and transparent score derivation.
- **Four-Eyes Review Workflow**: Draft, In progress, Submitted, In review, Changes requested, and Approved (locked immutable snapshot; authors cannot approve their own submissions).
- **Remediation Actions & Implementation Checklists**: Suggested actions from low-scoring indicators plus Pre-Deployment and Operational FRAME checklists.
- **Auditor Workspace & Audit Pack**: Read-only access across scope, independent Audit Findings, tamper-evident SHA-256 hash-chained Audit Log with integrity verification, and ZIP Audit Pack export with `manifest.json`.
- **Strong Authentication & Security**: Invite-only or Admin direct-create (initial password) user lifecycle, Argon2id password hashing, WebAuthn/FIDO2 Passkeys, RFC 6238 TOTP (AES-256-GCM encrypted at rest), 10 hashed single-use recovery codes, `HttpOnly; SameSite=Strict` sessions, CSRF protection, and step-up re-authentication.
- **Progressive Web App (PWA)**: Installable desktop/mobile web app with the FRAME icon and offline shell caching (API routes remain network-only).

## Quick Start (Docker Compose)

1. Copy the environment template and set strong secrets:
   ```bash
   cp .env.example .env
   ```
   Edit `.env` to set `SESSION_SECRET`, `TOTP_ENCRYPTION_KEYS`, and optionally `ADMIN_PASSWORD` (if omitted, a single-use 72-hour setup link is printed to the `api` container logs on first boot).

2. Start all services (`db`, `mailhog`, `api`, `web`):
   ```bash
   docker compose up --build
   ```

3. Open the application:
   - Web UI (PWA): `http://localhost:8088`
   - OpenAPI / Swagger Docs: `http://localhost:8088/api/docs`
   - MailHog (local SMTP inbox): `http://localhost:8025`

4. Optional Demo Dataset:
   Set `SEED_DEMO=true` in `.env` (or pass `SEED_DEMO=true docker compose up --build`) to seed a demo organisation, three AI systems, sample assessments, actions, and demo accounts (`user@frame.local`, `reviewer@frame.local`, `auditor@frame.local` with password `DemoFrame2026!ChangeMe`, forced to change on login).

## Email & MailHog (Local Development)

`docker-compose.yml` includes **MailHog**, a local SMTP testing server:
- **Purpose**: Captures all outgoing emails sent by the `api` service (user invitation links, password resets, and governance notifications) so no real emails leave your machine during local development or testing.
- **SMTP Endpoint**: `mailhog:1025` (configured automatically in `docker-compose.yml`).
- **Web Inbox**: Open `http://localhost:8025` in your browser to read captured emails and click invitation/reset links.
- **Production**: Point `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, and `SMTP_FROM` in `.env` to your real SMTP provider (such as Amazon SES, Postmark, or Microsoft 365). Note that Admins can also create users directly with an initial password in **Administration -> Users & Invitations** without sending email.

## Architecture Overview

- **Frontend (`apps/web`)**: React 19, TypeScript, Vite, Tailwind CSS, React Router, TanStack Query, React Hook Form, Zod, Recharts, SimpleWebAuthn browser client, `vite-plugin-pwa`.
- **Backend (`apps/api`)**: Node.js, TypeScript, Fastify, Zod validation, OpenAPI (`/api/docs`), Drizzle ORM, Argon2id, SimpleWebAuthn server, AES-256-GCM encrypted TOTP secrets, PDFKit & DOCX A4 report generators, ZIP Audit Pack exporter.
- **Shared (`packages/shared`)**: Single source of truth for RBAC permissions, FRAME scoring engine, FRAME v1.0 questionnaire & checklists, and Zod schemas.
- **Database**: PostgreSQL 16 with versioned SQL migrations in `apps/api/drizzle/`.

## Documentation

- [Architecture & ERD](docs/ARCHITECTURE.md)
- [Security & OWASP ASVS Level 2](docs/SECURITY.md)
- [Assumptions & Editable Defaults](docs/ASSUMPTIONS.md)
- [Administrator Guide](docs/ADMIN_GUIDE.md)
- [User & Practitioner Guide](docs/USER_GUIDE.md)
- [API Reference](docs/API.md)
- [Deployment, TLS & Backup Guide](docs/DEPLOYMENT.md)

## Attribution & Licence

- Application source code: [MIT License](LICENSE)
- FRAME governance framework content: [CC BY-NC 4.0](NOTICE) by Ian Loe, Tactics Solutions (`https://github.com/ianloe/FRAME`)
