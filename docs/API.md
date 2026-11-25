# API Reference

The FRAME Assessment Platform exposes a RESTful JSON API validated with Zod.

- **Interactive OpenAPI / Swagger UI**: `/api/docs` (e.g. `http://localhost:8080/api/docs`)
- **Health Endpoints**: `GET /healthz`, `GET /readyz`, `GET /metrics`

## Authentication & CSRF
- Sessions use `HttpOnly`, `SameSite=Strict` cookies (`frame_session`).
- All state-changing requests (`POST`, `PUT`, `PATCH`, `DELETE`) require the `X-CSRF-Token` header returned by `/api/auth/me` or login.
- Sensitive endpoints (`POST /api/admin/invitations`, `PUT /api/admin/security-policy`, `GET /api/reports/*`, etc.) require recent step-up re-authentication (`POST /api/auth/step-up/verify`).
