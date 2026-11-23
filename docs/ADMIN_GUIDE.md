# Administrator Guide

## Initial Bootstrap
1. Start the stack with `docker compose up --build`.
2. If `ADMIN_PASSWORD` was not set in `.env`, inspect the `api` container logs (`docker compose logs api`) for the single-use setup URL (`/accept-invite?token=...`).
3. Set a strong password (12+ characters) and enrol a Passkey or TOTP authenticator app. Save the 10 recovery codes.

## Managing Organisations, Users, and Scopes
- Go to **Administration -> Organisations** to create organisations and business units.
- Go to **Administration -> Users & Invitations** to invite Users, Reviewers (check the Reviewer flag), and Auditors, scoped to one or more organisations.
- Use **Reset MFA** (requires a mandatory audit reason) if a user loses their authenticator or passkey.
- Use **Administration -> View as Role Matrix** to inspect the live RBAC permissions matrix generated from the server code.

## Managing FRAME Questionnaire Versions
- Go to **Administration -> Questionnaires** to view the active `FRAME v1.0` version.
- Published versions are immutable so historic assessments remain accurate.
- Click **Clone to Draft** to customise question weights, guidance, or scoring configuration, then **Publish** when ready.

## Audit Log Integrity & Demo Cleanup
- Go to **Administration -> Health & Integrity** and click **Verify Audit Log Hash Chain** to validate the SHA-256 chain across all audit records.
- If `SEED_DEMO=true` was used for evaluation, click **Remove Demo Data** (requires step-up authentication) before production use.
