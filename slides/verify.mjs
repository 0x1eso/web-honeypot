/**
 * verify.mjs — 빌드된 단일 HTML 덱의 실동작 검증 (일회성).
 * 시스템 Chrome 을 headless 로 구동: 슬라이드 전환(키/클릭), 페이지 표시,
 * 인쇄 모드 슬라이드 노출을 확인하고 스크린샷을 남긴다.
 */
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const FILE = "file:///home/eser/dev/web-honeypot/web-honeypot-slides.html";
mkdirSync("shots", { recursive: true });

const browser = await chromium.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

const results = [];
const check = (name, ok, detail = "") =>
  results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);

const pageNum = async () =>
  (await page.locator(".pageNum").innerText()).replace(/\s+/g, " ").trim();

await page.goto(FILE);
await page.waitForTimeout(900);

check("초기 로드 = 01/12", (await pageNum()).startsWith("01"), await pageNum());
await page.screenshot({ path: "shots/s01-title.png" });

// → 키 두 번: 03 (아키텍처)
await page.keyboard.press("ArrowRight");
await page.keyboard.press("ArrowRight");
await page.waitForTimeout(700);
check("ArrowRight ×2 = 03", (await pageNum()).startsWith("03"), await pageNum());
await page.screenshot({ path: "shots/s03-architecture.png" });

// ← 키: 02
await page.keyboard.press("ArrowLeft");
await page.waitForTimeout(500);
check("ArrowLeft = 02", (await pageNum()).startsWith("02"), await pageNum());

// 우측 클릭 = 다음 (03)
await page.mouse.click(1200, 450);
await page.waitForTimeout(500);
check("우측 클릭 = 다음(03)", (await pageNum()).startsWith("03"), await pageNum());

// 좌측 클릭 = 이전 (02)
await page.mouse.click(120, 450);
await page.waitForTimeout(500);
check("좌측 클릭 = 이전(02)", (await pageNum()).startsWith("02"), await pageNum());

// End = 12, 마지막에서 → 눌러도 12 유지 (클램프)
await page.keyboard.press("End");
await page.waitForTimeout(600);
await page.keyboard.press("ArrowRight");
await page.waitForTimeout(300);
check("End + → 클램프 = 12", (await pageNum()).startsWith("12"), await pageNum());
await page.screenshot({ path: "shots/s12-retro.png" });

// 6번 슬라이드 (분류 엔진) 스크린샷
await page.keyboard.press("Home");
for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowRight");
await page.waitForTimeout(800);
check("Home + → ×5 = 06", (await pageNum()).startsWith("06"), await pageNum());
await page.screenshot({ path: "shots/s06-classifier.png" });

// 인쇄 모드: 12장 전부 visible 인지 (transition 정착 대기 후 측정)
await page.emulateMedia({ media: "print" });
await page.waitForTimeout(600);
const visible = await page.evaluate(
  () =>
    [...document.querySelectorAll(".slide")].filter(
      (s) => getComputedStyle(s).visibility !== "hidden"
    ).length
);
check("인쇄 모드 — 12장 전부 노출", visible === 12, `${visible}/12`);

await browser.close();
console.log(results.join("\n"));
const fails = results.filter((r) => r.startsWith("FAIL")).length;
process.exit(fails ? 1 : 0);
