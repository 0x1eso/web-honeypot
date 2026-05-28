# ===== Stage 1: build =====
FROM node:20-alpine AS builder
WORKDIR /app

# Install deps with reproducible lockfile
COPY package.json package-lock.json ./
RUN npm install

# Build with VITE_API_URL baked in (nginx will proxy /api -> api:8081).
# 코드의 BASE는 이미 /api 를 포함하므로 호출은 ${BASE}/logs 형태가 된다.
ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL

COPY . .
RUN npm run build

# ===== Stage 2: runtime (non-root nginx) =====
# nginxinc/nginx-unprivileged 는 nginx user로 master process를 실행하므로
# < 1024 포트를 바인딩할 수 없어 기본 8080 listen. nginx.conf 도 8080으로 맞춰져 있음.
FROM nginxinc/nginx-unprivileged:alpine
# nginx-unprivileged 는 nginx user (uid 101) 로 master process 를 실행한다.
# COPY 의 기본 소유자는 root 라서 --chown=nginx:nginx 를 지정하지 않으면
# nginx 가 conf 파일과 html 디렉터리를 읽을 권한이 없어 [emerg] permission denied 로 죽는다.
COPY --from=builder --chown=nginx:nginx /app/dist /usr/share/nginx/html
COPY --chown=nginx:nginx nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 8080
# base image 의 CMD (nginx -g 'daemon off;') 그대로 사용
