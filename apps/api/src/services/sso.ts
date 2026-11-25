/**
 * SSO Provider Interface Stub (OIDC / SAML 2.0)
 *
 * Designed so enterprise Single Sign-On can be added in a future release without
 * refactoring session management, RBAC, or audit logging.
 *
 * Planned integration flow:
 * 1. Admin configures IdP metadata (issuer, clientId, clientSecret or SAML IdP cert) in Settings.
 * 2. /api/auth/sso/login redirects to IdP authorization URL with PKCE + state + nonce.
 * 3. /api/auth/sso/callback verifies assertion/ID token, maps external subject to local User
 *    (invite-only or JIT-provisioned if enabled by policy), creates an HttpOnly session,
 *    and records an AuthEvent + AuditLog entry.
 */
export interface SsoIdentity {
  provider: 'oidc' | 'saml';
  subject: string;
  email: string;
  name: string;
  groups: string[];
}

export interface SsoProvider {
  readonly name: string;
  getAuthorizationUrl(state: string, nonce: string): Promise<string>;
  handleCallback(params: Record<string, string>): Promise<SsoIdentity>;
}

export class UnconfiguredSsoProvider implements SsoProvider {
  readonly name = 'unconfigured';

  async getAuthorizationUrl(): Promise<string> {
    throw new Error('SSO is not configured in this deployment.');
  }

  async handleCallback(): Promise<SsoIdentity> {
    throw new Error('SSO is not configured in this deployment.');
  }
}
