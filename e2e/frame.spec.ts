import { test, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import * as OTPAuth from 'otpauth';

const SCREENSHOT_DIR =
  '/Users/ianloe/.gemini/antigravity/brain/41dbe71b-b072-46d1-ba40-c60aed1156f1/walkthrough-screenshots';

test.beforeAll(() => {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
});

test('Admin passkey enrolment, passwordless login, permissions matrix, and hash-chain verification', async ({
  browser
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();

  // Attach virtual WebAuthn authenticator via CDP
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true
    }
  });

  await page.goto('/login');
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01-login.png') });

  await page.getByLabel('Email address').fill('admin@frame.local');
  await page.getByLabel('Password').fill('FrameAdmin2026!Secure');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();

  // Redirected to /mfa for enrolment
  await expect(page.getByText('Enrol Multi-Factor Authentication')).toBeVisible();
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '02-mfa-enrol.png') });

  // Register Passkey via virtual authenticator
  await page.getByRole('button', { name: 'Register Passkey' }).click();
  await expect(page.getByText('Governance Portfolio Dashboard')).toBeVisible({ timeout: 15000 });
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '03-dashboard.png') });

  // Check Admin Permissions Matrix & Audit Chain
  await page.getByRole('link', { name: 'Administration' }).click();
  await page.getByRole('button', { name: 'View as Role Matrix' }).click();
  await expect(page.getByText('Live RBAC Permissions Matrix')).toBeVisible();
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '04-admin-matrix.png') });

  await page.getByRole('button', { name: 'Health & Integrity' }).click();
  await page.getByRole('button', { name: 'Verify Audit Log Hash Chain' }).click();
  await expect(page.getByText(/Hash chain valid across/i)).toBeVisible();

  // Sign out and test passwordless Passkey login
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('button', { name: 'Sign in with a passkey' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
  await expect(page.getByText('Governance Portfolio Dashboard')).toBeVisible({ timeout: 15000 });

  await context.close();
});

test('Demo User TOTP enrolment, Assessment Wizard, and Auditor Workspace', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto('/login');
  await page.getByLabel('Email address').fill('user@frame.local');
  await page.getByLabel('Password').fill('DemoFrame2026!ChangeMe');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();

  await expect(page.getByText('Enrol Multi-Factor Authentication')).toBeVisible();
  await page.getByRole('button', { name: 'Generate QR code' }).click();
  const manualKey = await page.locator('code').innerText();

  const totp = new OTPAuth.TOTP({
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(manualKey.trim())
  });

  await page.getByPlaceholder('Enter 6-digit code').fill(totp.generate());
  await page.getByRole('button', { name: 'Verify & Activate' }).click();

  await expect(page.getByText('Save your recovery codes')).toBeVisible();
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '05-recovery-codes.png') });
  await page.getByRole('button', { name: /continue to dashboard/i }).click();

  // Navigate to Assessments & open an assessment
  await page.getByRole('link', { name: 'Assessments' }).click();
  await page.getByRole('link', { name: /Q3 2026 Production Governance Review/i }).click();
  await expect(page.getByText('How this score was derived:')).toBeVisible();
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '06-assessment-wizard.png') });

  await page.getByRole('button', { name: 'Sign out' }).click();

  // Auditor login + TOTP enrolment + Auditor Workspace
  await page.getByLabel('Email address').fill('auditor@frame.local');
  await page.getByLabel('Password').fill('DemoFrame2026!ChangeMe');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();

  await page.getByRole('button', { name: 'Generate QR code' }).click();
  const audKey = await page.locator('code').innerText();
  const audTotp = new OTPAuth.TOTP({
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(audKey.trim())
  });
  await page.getByPlaceholder('Enter 6-digit code').fill(audTotp.generate());
  await page.getByRole('button', { name: 'Verify & Activate' }).click();
  await page.getByRole('button', { name: /continue to dashboard/i }).click();

  await page.getByRole('link', { name: 'Auditor Workspace' }).click();
  await expect(page.getByText('Record Audit Finding or Observation')).toBeVisible();
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '07-auditor-workspace.png') });

  await context.close();
});
