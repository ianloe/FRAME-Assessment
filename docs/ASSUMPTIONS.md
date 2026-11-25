# Assumptions and Editable Defaults

All FRAME dimensions, 40 maturity indicators, 4 maturity level definitions, interpreting-results bands, and implementation checklist items were extracted directly from `/reference` (`https://github.com/ianloe/FRAME`).

Where the reference material is silent on operational or software-specific parameters, the platform implements sensible, clearly labelled defaults that an Administrator can edit in the UI or configuration:

| Area | Default Implemented | Where Editable | Rationale |
|---|---|---|---|
| Indicator weights | Equal weight (`1.0`) for all 40 indicators | Admin -> Questionnaires (clone draft, edit weights, publish) | `maturity-assessment.md` specifies unweighted averaging; weights allow risk-weighted tailoring per organisation. |
| Weakest-link overall score cap | Disabled by default (`weakestLinkCapEnabled: false`, `weakestLinkMaxDelta: 0.5`) | Questionnaire `scoringConfigJson` | Allows governance teams to optionally cap overall maturity if one dimension lags severely. |
| Rationale required threshold | Required for maturity ratings `>= 3` (Defined or Optimising) | Questionnaire `scoringConfigJson.rationaleRequiredAboveRating` | Ensures high maturity claims are substantiated with written rationale before submission. |
| Confidence levels | `low`, `medium`, `high` (default `medium`) | Per-response selector in Assessment Wizard | Captures assessor certainty alongside maturity score. |
| Target maturity by risk tier | Low: `2.5`, Medium: `3.0`, High: `3.5`, Critical: `4.0` (default `3.0` per FRAME) | Admin -> Taxonomy / AI System Register | `maturity-assessment.md` sets Level 3 as production target; risk-tier targets support tiered gap analysis. |
| Regulatory exposure tags | `MAS FEAT`, `PDPA`, `EU AI Act`, `ISO 42001`, `NIST AI RMF` | Admin -> Taxonomy | Common enterprise AI regulatory frameworks; fully editable. |
| Evidence types | `policy`, `screenshot`, `log`, `report`, `contract`, `other` | Admin -> Taxonomy | Covers typical governance artefacts. |
| Security policy defaults | MFA required for all (`true`), Passkey required for Admins (`false`), Idle timeout `30` min, Absolute timeout `12` hr, Lockout after `5` failed attempts (`15` min base progressive), Invitation expiry `72` hr, Step-up window `10` min | Admin -> Security Policy | Aligned with OWASP ASVS Level 2 recommendations. |
| Default timezone & date format | `Asia/Singapore`, `D MMM YYYY` / ISO | Admin -> Branding & Settings | Matches practitioner operating context. |
