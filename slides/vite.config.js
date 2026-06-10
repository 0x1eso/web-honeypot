// 발표 덱 빌드 설정.
// vite-plugin-singlefile: JS/CSS 를 전부 index.html 안에 인라인 →
// 산출물이 단일 .html 하나로 떨어져 file:// 로 어디서 열어도 동작한다.
// (외부 CDN/폰트 의존 없음 — 폰트는 시스템 폰트 스택만 사용)
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: {
    target: "es2018",
    cssCodeSplit: false,
  },
});
