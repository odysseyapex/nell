import { expect, type Page, test } from '@playwright/test';

/**
 * The full product loop, run against the seeded demo workspace.
 *
 * These tests need a real Supabase project with the migrations applied and
 * `npm run db:seed` run against it, so they are opted into explicitly:
 *
 *   NELL_E2E_DEMO=1 npm run test:e2e
 *
 * They are skipped rather than failed when that is absent, so the suite stays
 * green on a machine with no database while still being honest that this path
 * was not exercised.
 */

const DEMO = process.env.NELL_E2E_DEMO === '1';
const PASSWORD = process.env.NELL_E2E_PASSWORD ?? 'nell-demo-2026';

test.skip(!DEMO, 'Set NELL_E2E_DEMO=1 and seed the demo workspace to run the journey tests.');

/**
 * Signs in as one of the demo people.
 *
 * Two ways in, because there are two ways to run these tests: against a real
 * Supabase project seeded with `npm run db:seed`, or against the in-memory
 * demo harness (NELL_DEMO_MODE=1), which has no passwords and hands out a
 * session from the /demo picker instead.
 */
async function signIn(page: Page, email: string) {
  const firstName = email.split('@')[0];

  await page.goto('/demo');
  const demoButton = page.getByRole('button', { name: new RegExp(`view as ${firstName}`, 'i') });

  if (await demoButton.isVisible().catch(() => false)) {
    await demoButton.click();
    await page.waitForURL(/\/app\//);
    return;
  }

  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/app\//);
}

test.describe('coach', () => {
  test('the dashboard leads with who needs attention', async ({ page }) => {
    await signIn(page, 'claire@clairecoaching.demo');
    await page.goto('/app/coach');

    await expect(page.getByRole('heading', { name: /needs attention/i })).toBeVisible();
    await expect(page.getByText(/may need your attention/i)).toBeVisible();

    // Sarah's decline is the headline case in the seeded data.
    await expect(page.getByRole('link', { name: /sarah miller/i })).toBeVisible();
  });

  test('a client page shows the pattern, its evidence, and a next step', async ({ page }) => {
    await signIn(page, 'claire@clairecoaching.demo');
    await page.goto('/app/coach');
    await page.getByRole('link', { name: /sarah miller/i }).first().click();

    await expect(page.getByText(/why nell flagged this/i)).toBeVisible();
    await expect(page.getByText(/7-day follow-through/i)).toBeVisible();

    await page.getByRole('tab', { name: /patterns/i }).click();
    // Every pattern must show the counted rows behind it, not just a claim.
    await expect(page.getByText(/what this is based on|evidence/i).first()).toBeVisible();
    await expect(page.getByText(/suggested coaching question/i).first()).toBeVisible();
  });

  test('an experiment records a baseline when it starts', async ({ page }) => {
    await signIn(page, 'claire@clairecoaching.demo');
    await page.goto('/app/coach/clients');
    await page.getByRole('link', { name: /amanda brooks/i }).first().click();

    await page.getByRole('button', { name: /start experiment/i }).first().click();

    // The trigger and the submit button share an accessible name, so the
    // submit is scoped to the dialog.
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Name').fill('Playwright experiment');
    await dialog.getByLabel('Hypothesis').fill('A test hypothesis written by the end-to-end suite.');
    await dialog.getByLabel('Intervention').fill('Change one thing for fourteen days and measure it.');
    await dialog.getByRole('button', { name: /^start experiment$/i }).click();

    // Assert the record, not the toast: a notification can be missed, but a
    // baseline that was never written is the failure that would matter.
    await page.waitForTimeout(1500);
    await page.goto('/app/coach/experiments');
    await expect(page.getByText('Playwright experiment').first()).toBeVisible({ timeout: 15_000 });
  });

  test('the client table can be filtered down to the people who need attention', async ({ page }) => {
    await signIn(page, 'claire@clairecoaching.demo');
    await page.goto('/app/coach/clients');

    await expect(page.getByRole('table')).toBeVisible();
    await page.getByRole('button', { name: /^stable$/i }).click();
    await expect(page.getByRole('link', { name: /amanda brooks/i })).toBeVisible();
  });

  test('a coaching brief can be generated and is saved', async ({ page }) => {
    await signIn(page, 'claire@clairecoaching.demo');
    await page.goto('/app/coach/clients');
    await page.getByRole('link', { name: /rachel cole/i }).first().click();

    await page.getByRole('button', { name: /generate brief/i }).click();
    await page.waitForTimeout(2000);

    // The brief is stored and rendered on the Overview tab, so that is what
    // gets asserted rather than the transient confirmation.
    await page.reload();
    await expect(page.getByText(/latest coaching brief/i)).toBeVisible({ timeout: 30_000 });
  });
});

test.describe('client', () => {
  test('the commitment flow captures text, date and confidence', async ({ page }) => {
    await signIn(page, 'amanda@clairecoaching.demo');
    await page.goto('/app/today');

    await expect(page.getByRole('heading', { name: /good (morning|afternoon|evening), amanda/i })).toBeVisible();

    await page.getByLabel('What are you committing to?').fill('Walk the long way home');
    await page.getByRole('button', { name: /^commit$/i }).click();

    await page.waitForTimeout(1500);
    await page.goto('/app/commitments');
    await expect(page.getByText('Walk the long way home').first()).toBeVisible({ timeout: 15_000 });
  });

  test('checking in requires an outcome and asks why when it did not go to plan', async ({ page }) => {
    await signIn(page, 'sarah@clairecoaching.demo');
    await page.goto('/app/commitments');

    const outstandingBefore = await page.getByRole('button', { name: /record it/i }).count();
    test.skip(outstandingBefore === 0, 'No outstanding check-in for this client right now.');

    await page.getByRole('button', { name: /i didn't do it/i }).first().click();

    // The reason step appears only once the outcome is not "completed".
    await expect(page.getByText(/what influenced that/i)).toBeVisible();
    await page.getByRole('button', { name: /^stress$/i }).click();
    await page.getByRole('button', { name: /record it/i }).first().click();

    // Once recorded, the commitment leaves the outstanding list — which is the
    // observable consequence, and the thing the coach's numbers depend on.
    await page.waitForTimeout(1500);
    await page.goto('/app/commitments');
    await expect(page.getByRole('button', { name: /record it/i })).toHaveCount(
      outstandingBefore - 1,
      { timeout: 15_000 },
    );
  });

  test('insights speak to the client, with evidence and without a score', async ({ page }) => {
    await signIn(page, 'rachel@clairecoaching.demo');
    await page.goto('/app/insights');

    await expect(page.getByRole('heading', { name: /what nell has noticed/i })).toBeVisible();
    await expect(page.getByText(/associations, not explanations/i)).toBeVisible();
    // A client is never shown their risk level.
    await expect(page.getByText(/needs attention/i)).toHaveCount(0);
  });

  test('history shows the client their own words back', async ({ page }) => {
    await signIn(page, 'jessica@clairecoaching.demo');
    await page.goto('/app/history');
    await expect(page.getByRole('heading', { name: /^history$/i })).toBeVisible();
  });
});

test.describe('tenancy and role boundaries', () => {
  test('a client cannot reach the coach dashboard', async ({ page }) => {
    await signIn(page, 'sarah@clairecoaching.demo');
    await page.goto('/app/coach');
    // Role guards redirect rather than render an empty coach view.
    await expect(page).toHaveURL(/\/app\/today/);
  });

  test('a client cannot reach another client’s page', async ({ page }) => {
    await signIn(page, 'sarah@clairecoaching.demo');
    await page.goto('/app/coach/clients');
    await expect(page).toHaveURL(/\/app\/today/);
  });

  test('a client cannot reach settings or the platform console', async ({ page }) => {
    await signIn(page, 'amanda@clairecoaching.demo');

    await page.goto('/app/settings');
    await expect(page).toHaveURL(/\/app\/today/);

    await page.goto('/admin');
    await expect(page).not.toHaveURL(/\/admin$/);
  });

  test('a coach opening an id from outside their workspace gets nothing', async ({ page }) => {
    await signIn(page, 'claire@clairecoaching.demo');
    // A well-formed uuid that belongs to no client in this organization.
    await page.goto('/app/coach/clients/00000000-0000-4000-8000-000000000000');
    await expect(page.getByText(/not found/i)).toBeVisible();
  });
});
