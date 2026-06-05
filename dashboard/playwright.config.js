/**
 * Playwright 설정 — dashboard e2e 전용.
 *
 * webServer 가 핵심: 테스트 시작 전 자동으로 `npm run dev`(Vite) 를 5173 포트로 띄우고,
 * 모든 테스트가 끝나면 종료한다. CI 가 아닐 때(reuseExistingServer: true)는 이미 떠
 * 있는 dev 서버를 재사용해 로컬 개발 흐름을 끊지 않는다.
 *
 * 백엔드(Ktor) 는 띄우지 않는다 — 모든 API 호출은 spec 내부에서 page.route 로 mock.
 */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  // 30s — Vite HMR 워밍업 + networkidle 대기까지 여유 있게.
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:5173',
    // 첫 재시도에서만 trace 저장 → CI artifact 용량 절약.
    trace: 'on-first-retry',
  },
  projects: [
    {
      // Chromium 한 브라우저만. 회귀 가드가 목적이라 cross-browser 까지는 불필요.
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    port: 5173,
    reuseExistingServer: !process.env.CI,
    // Vite cold start + node_modules 첫 컴파일을 견디는 한도.
    timeout: 60_000,
  },
});
