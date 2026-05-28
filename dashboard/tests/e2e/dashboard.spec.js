import { test, expect } from '@playwright/test';

// Mock response shapes are derived from what App.jsx destructures:
//   fetchStats()   -> sets `stats` used as stats.total, stats.byType[key]
//   fetchTopIps()  -> sets `topIps` passed as data prop to TopIps (array)
//   fetchLogs()    -> sets `logsRes` destructured as { total, logs }
const MOCK_STATS = { total: 0, byType: {} };
const MOCK_TOP_IPS = [];
const MOCK_LOGS = { total: 0, logs: [] };

function mockResponse(url, body) {
  if (url.includes('/stats')) return body ?? MOCK_STATS;
  if (url.includes('/top-ips')) return body ?? MOCK_TOP_IPS;
  if (url.includes('/logs')) return body ?? MOCK_LOGS;
  return null;
}

test.describe('Dashboard smoke tests', () => {
  test('Test A — no /api/api/ double-prefix regression', async ({ page }) => {
    const requestedUrls = [];

    // Track every outgoing request URL before it leaves the browser.
    page.on('request', (req) => requestedUrls.push(req.url()));

    // Intercept all requests; mock API endpoints so no real backend is needed.
    await page.route('**/*', async (route) => {
      const url = route.request().url();
      const body = mockResponse(url, null);

      if (body !== null) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(body),
        });
      } else {
        await route.continue();
      }
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const apiUrls = requestedUrls.filter((u) => u.includes('/api/'));

    // Sanity check: the dashboard actually attempted at least one API call.
    expect(
      apiUrls.length,
      'Expected at least one /api/ request but none were made'
    ).toBeGreaterThan(0);

    // Regression guard: no URL must contain the double-prefix /api/api/.
    const doublePrefix = apiUrls.filter((u) => u.includes('/api/api/'));
    expect(
      doublePrefix.some((u) => u.includes('/api/api/')),
      `Double-prefix /api/api/ detected in: ${doublePrefix.join(', ')}`
    ).toBe(false);
  });

  test('Test B — page renders without JS errors', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    // Intercept and mock API calls so rendering succeeds without a backend.
    await page.route('**/*', async (route) => {
      const url = route.request().url();
      const body = mockResponse(url, null);

      if (body !== null) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(body),
        });
      } else {
        await route.continue();
      }
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('body')).toBeVisible();

    expect(
      pageErrors,
      `Unexpected JS errors on page load: ${pageErrors.join('; ')}`
    ).toHaveLength(0);
  });
});
