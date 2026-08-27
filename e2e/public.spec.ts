import { expect, test } from '@playwright/test';

/**
 * Checks that need no data and no Supabase project: the marketing surface,
 * the auth screens, and the guarantee that unauthenticated traffic cannot
 * reach anything behind the app shell.
 */

test.describe('public surface', () => {
  test('the landing page states the positioning above the fold', async ({ page }) => {
    await page.goto('/');
    await expect(
      page.getByRole('heading', { name: /know which clients need you before they tell you/i }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: /start free/i }).first()).toBeVisible();
  });

  test('the landing page carries the not-a-medical-service disclaimer', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText(/not a medical, dietetic, psychological or therapeutic service/i)).toBeVisible();
  });

  test('signup collects a business name, so every coach lands in their own workspace', async ({ page }) => {
    await page.goto('/signup');
    await expect(page.getByLabel('Business name')).toBeVisible();
    await expect(page.getByLabel('Work email')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
  });

  test('an unknown invitation token is refused rather than half-accepted', async ({ page }) => {
    await page.goto('/invite/definitely-not-a-real-token');
    await expect(page.getByText(/no longer valid/i)).toBeVisible();
  });
});

test.describe('access control', () => {
  for (const path of ['/app', '/app/coach', '/app/today', '/app/settings', '/admin', '/onboarding']) {
    test(`signed-out traffic to ${path} is sent to sign in`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login/);
    });
  }

  test('the sign-in redirect remembers where the visitor was heading', async ({ page, request }) => {
    // Preserving the intended destination is middleware's job, and the demo
    // harness bypasses middleware by design (its cookie is the session). The
    // redirect itself is still asserted above for every protected path; only
    // the `next` parameter is middleware-specific.
    const demoMode = (await request.get('/demo')).status() === 200;
    test.skip(demoMode, 'Middleware is bypassed in demo mode; nothing to assert here.');

    await page.goto('/app/coach/clients');
    await expect(page).toHaveURL(/next=%2Fapp%2Fcoach%2Fclients/);
  });

  test('API routes refuse unauthenticated callers', async ({ request }) => {
    const checkout = await request.post('/api/stripe/checkout', { data: { plan: 'coach' } });
    expect([401, 403, 503]).toContain(checkout.status());

    const portal = await request.post('/api/stripe/portal');
    expect([401, 403, 503]).toContain(portal.status());
  });

  test('the nightly job refuses a request with no cron secret', async ({ request }) => {
    const response = await request.post('/api/cron/nightly');
    // 401 when a secret is configured, 503 when scheduled jobs are switched
    // off entirely. Never 200.
    expect([401, 503]).toContain(response.status());
  });

  test('the Stripe webhook refuses an unsigned payload', async ({ request }) => {
    const response = await request.post('/api/stripe/webhook', {
      data: { type: 'customer.subscription.updated' },
    });
    expect([400, 503]).toContain(response.status());
  });

  test('crawlers are kept out of the application', async ({ request }) => {
    const robots = await request.get('/robots.txt');
    const body = await robots.text();
    expect(body).toContain('Disallow: /app');
    expect(body).toContain('Disallow: /admin');
  });
});
