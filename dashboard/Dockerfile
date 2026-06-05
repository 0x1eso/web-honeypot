# =============================================================================
# Stage 1: build — Node.js 로 Vite/React SPA 빌드.
# =============================================================================
# node:20-alpine: alpine 기반 최소 이미지. 빌드 산출물(/app/dist) 만 다음 stage 로 넘기므로
# 빌더 자체의 OS 호환성은 무관 (musl libc 이슈 없음).
FROM node:20-alpine AS builder
WORKDIR /app

# ▼ lockfile + package.json 만 먼저 복사 → 의존성 변동 없으면 npm install 캐시 재사용.
#   소스 변경만으로는 이 layer 가 무효화되지 않아 CI 빌드 시간 단축.
COPY package.json package-lock.json ./
RUN npm install

# Vite 는 빌드 시점에 환경변수를 정적 치환 → ARG/ENV 가 bundle 안에 inject 된다.
# 런타임 환경변수가 통하지 않는 이유: 빌드된 JS 안에 /api 문자열이 박혀 들어가기 때문.
# 코드의 BASE 는 이미 /api 를 포함하므로 호출은 ${BASE}/logs (= /api/logs) 형태.
ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL

COPY . .
# npm run build: tsc + vite build → dist/ 에 hash-suffixed 정적 산출물 생성.
RUN npm run build

# =============================================================================
# Stage 2: runtime — non-root nginx.
# =============================================================================
# nginxinc/nginx-unprivileged: 표준 nginx 이미지와 달리 master process 를
# nginx user(uid 101) 로 실행 → 컨테이너 침투 시 root 권한 회피.
# < 1024 포트 바인딩 불가 → 기본 listen 8080 (nginx.conf 도 동일).
FROM nginxinc/nginx-unprivileged:alpine

# ▼ COPY 의 기본 소유자는 root 라서 --chown=nginx:nginx 를 지정하지 않으면
#   nginx user 가 conf/html 파일을 읽을 권한이 없어 [emerg] permission denied 로 죽는다.
#   이게 non-root nginx 이미지에서 가장 흔한 첫 부팅 실패 원인.
COPY --from=builder --chown=nginx:nginx /app/dist /usr/share/nginx/html
COPY --chown=nginx:nginx nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 8080
# base image 의 ENTRYPOINT/CMD (nginx -g 'daemon off;') 그대로 사용 → CMD 생략.
# daemon off: 컨테이너 PID 1 이 foreground 로 살아 있어야 docker 가 종료 신호를 전달 가능.
