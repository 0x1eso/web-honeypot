/**
 * 대시보드 스모크 e2e 테스트.
 *
 * 의도: 백엔드 없이도 프론트가 안전하게 부팅되는지 보증한다.
 * 모든 /api/* 호출을 page.route 로 가로채 빈 응답을 돌려준다.
 *
 * Mock 응답 shape 은 App.jsx 가 destructure 하는 형태와 일치해야 한다:
 *   fetchStats()   -> { total, byType }      (StatCard, StatsChart)
 *   fetchTopIps()  -> Array<{ ip, count }>   (TopIps)
 *   fetchLogs()    -> { total, logs }        (LogTable)
 * shape 이 어긋나면 TypeError 가 터져 Test B 의 pageerror 카운트로 잡힌다.
 */
import { test, expect } from '@playwright/test';

const MOCK_STATS = { total: 0, byType: {} };
const MOCK_TOP_IPS = [];
const MOCK_LOGS = { total: 0, logs: [] };

// URL substring 매칭으로 엔드포인트별 mock body 를 고른다.
// 매칭 안 되면 null → 호출 측에서 route.continue() 로 실제 네트워크에 위임.
function mockResponse(url, body) {
  if (url.includes('/stats')) return body ?? MOCK_STATS;
  if (url.includes('/top-ips')) return body ?? MOCK_TOP_IPS;
  if (url.includes('/logs')) return body ?? MOCK_LOGS;
  return null;
}

test.describe('Dashboard smoke tests', () => {
  /**
   * Test A — `/api/api/` 이중 prefix 회귀 가드.
   *
   * api/index.js 의 BASE 는 이미 `/api` 를 포함한다. 누군가 호출부에
   * `${BASE}/api/logs` 처럼 또 prefix 를 붙이면 `/api/api/logs` 가 되어 404.
   * 이 테스트는 모든 outgoing request URL 을 모아 그런 패턴이 없는지 확인한다.
   */
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

  /**
   * Test B — 페이지 로드 직후 throw 된 JS 에러가 0건임을 확인.
   *
   * 차트 라이브러리(recharts)나 destructure(`stats.byType?.[...]`) 같은 곳에서
   * undefined 다루기를 잘못하면 첫 페인트에서 TypeError 가 발생한다.
   * pageerror 이벤트로 잡아 회귀를 차단.
   */
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
