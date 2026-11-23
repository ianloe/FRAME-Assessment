# User Guide

## For Administrators
Administrators configure organisations, invite users, manage security policy, version the FRAME questionnaire, and monitor system health. See [ADMIN_GUIDE.md](ADMIN_GUIDE.md) for full details.

## For Governance Practitioners & Reviewers (User Role)
1. **Accepting your invitation**: Open the invitation link from your email, set a strong password (12+ characters), and enrol a Passkey or TOTP authenticator.
2. **Registering an AI System**: Navigate to **AI Systems -> Register AI System**, enter the system profile, risk tier, target maturity level, and optional AAEF cross-reference.
3. **Running a FRAME Assessment**:
   - Open an AI System and click **New Assessment** (choose Full across all 5 dimensions or Partial).
   - Work through **Focus**, **Roles**, **Authority**, **Metrics**, and **Evaluation** using the left navigator.
   - Select a maturity level (`1` Initial to `4` Optimising) or `N/A` with justification, enter your rationale and confidence, attach evidence files or links, and post comments.
   - Click **Submit for Review** once all indicators are complete.
4. **Independent Review (Reviewers)**:
   - Users with the **Reviewer** flag can review submitted assessments authored by others (four-eyes rule enforced).
   - Click **Approve & Lock Snapshot** or **Request Changes** with a review reason.
5. **Checklists & Actions**:
   - Track Pre-Deployment and Operational checklists on the AI System detail page.
   - Generate or manage remediation actions under **Actions**.

## For Auditors (Auditor Role)
- **Read-Only Access**: Auditors can view all in-scope AI systems, assessments, approved snapshots, evidence, comments, and the full audit log. Every view of sensitive records is audit logged.
- **Audit Findings**: In **Auditor Workspace**, record independent Audit Findings and Observations without altering any assessment answers.
- **Audit Pack & Verification**: Export an **Audit Pack (ZIP)** from any assessment (contains A4 PDF report, evidence files, response history, audit log extract, and SHA-256 `manifest.json`), and run **Verify Hash Chain Integrity** in the Auditor Workspace.
