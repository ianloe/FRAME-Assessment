# Security Architecture & OWASP ASVS Level 2

## Threat Model Summary

| Threat | Mitigation |
|---|---|
| Unauthorised account creation | No public self-registration; invite-only via Admin with 72h single-use hashed token. |
| Credential stuffing / brute force | Argon2id password hashing, breached-password rejection, progressive account lockout, per-route rate limiting, generic login/reset error messages. |
| Session hijacking & CSRF | Server-side sessions, `HttpOnly; SameSite=Strict` cookies, idle (30m) and absolute (12h) timeouts, session rotation on login/MFA/step-up, per-session `X-CSRF-Token` validation. |
| Privilege escalation / BOLA | Server-side RBAC enforcement (`assertPermission`) + organisation/BU/system scope checks (`isEntityInScope`) on every endpoint; four-eyes rule on assessment approval. |
| Sensitive action abuse | Step-up re-authentication required before MFA changes, user invites/updates, security policy edits, record archival, and report exports. |
| Malicious file uploads | Extension & MIME allow-list, magic-byte sniffing, 10 MB size cap, randomised UUID storage keys, `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`. |
| Audit log tampering | Append-only `audit_logs` table with PostgreSQL advisory-locked SHA-256 hash chain (`prevHash` -> `rowHash`) and on-demand verification endpoint. |

## TOTP Encryption Key Rotation

TOTP secrets are encrypted at rest using AES-256-GCM and tagged with `key_version` (e.g. `v1`).
To rotate keys:
1. Add a new version to `TOTP_ENCRYPTION_KEYS`, e.g. `v1:<old-hex>,v2:<new-hex>`.
2. Set `TOTP_ACTIVE_KEY_VERSION=v2`.
3. Existing `v1` secrets continue to decrypt seamlessly while new enrolments encrypt with `v2`.

## OWASP ASVS Level 2 Checklist

| ASVS Area | Requirement | Status | Implementation |
|---|---|---|---|
| V2.1 Password Security | Min 12 chars, breached password check, Argon2id | Met | `PasswordSchema`, `evaluatePasswordStrength`, `argon2.argon2id` |
| V2.2 General Authenticator | Rate limiting & progressive lockout | Met | `@fastify/rate-limit` + `failedLoginAttempts` / `lockedUntil` |
| V2.5 Credential Recovery | Single-use expiring tokens, no enumeration | Met | `password_reset_tokens` (1h, SHA-256 hashed), generic responses |
| V2.8 One-Time Verifiers | TOTP (RFC 6238), encrypted at rest, recovery codes | Met | `otpauth`, AES-256-GCM `totp_secrets`, 10 hashed `recovery_codes` |
| V2.9 Cryptographic Auth | WebAuthn/FIDO2 with user verification | Met | `@simplewebauthn/server` (`userVerification: 'required'`) |
| V3.2 Session Binding | Server-side sessions, rotation on auth/privilege change | Met | `sessions` table, `createSession`, `rotateSession` |
| V3.3 Session Termination | Idle & absolute timeout, logout & remote revoke | Met | `idleExpiresAt`, `absoluteExpiresAt`, `DELETE /api/auth/sessions/:id` |
| V3.4 Cookie Attributes | HttpOnly, SameSite=Strict, Secure in HTTPS prod | Met | `SESSION_COOKIE_NAME` cookie options |
| V4.1 Access Control | Server-side RBAC + scoping on every endpoint | Met | `assertPermission`, `isEntityInScope`, integration tests |
| V4.2 Operation Level | Four-eyes approval, step-up for sensitive actions | Met | `assessorId !== auth.userId`, `requireStepUp` |
| V5.1 Input Validation | Strict Zod schema validation on all inputs | Met | `@frame/shared` Zod schemas + global `ZodError` handler |
| V5.3 Output / SQLi | Parameterised queries only, safe headers | Met | Drizzle ORM parameterised queries, React auto-escaping |
| V7.1 Log Content | No secrets/tokens logged; tamper-evident hash chain | Met | Fastify `redact` + `audit_logs` SHA-256 chain |
| V12.1 File Upload | Allow-list, magic bytes, size limit, safe download headers | Met | `LocalStorageProvider` + `X-Content-Type-Options: nosniff` |
| V14.4 HTTP Security | CSP, HSTS, X-Content-Type-Options, frame-ancestors none | Met | `@fastify/helmet` configuration in `apps/api/src/app.ts` |
