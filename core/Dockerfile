# =============================================================================
# Stage 1: build — gcc 풀스택 이미지에서 C 바이너리 빌드.
# =============================================================================
# gcc:13 = debian:bookworm 기반. runtime stage(debian:bookworm-slim) 와
# 같은 distro/glibc 버전 → 빌드된 바이너리의 동적 링킹이 runtime 에서 그대로 동작.
# (e.g., alpine 으로 빌드하면 musl libc 라 debian runtime 에서 link error.)
FROM gcc:13 AS builder

# libsqlite3-dev: build-time 헤더(sqlite3.h) 와 정적 링크 메타데이터 필요.
# --no-install-recommends + 캐시 정리: 이미지 크기 최소화 (build stage 라도 디스크 비용 ↓).
RUN apt-get update \
 && apt-get install -y --no-install-recommends libsqlite3-dev \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /src
# 소스 트리 전체 복사 — core 는 소스 파일 수가 적어 부분 복사로 캐시 최적화할 여지가 없음.
COPY . /src
RUN make

# =============================================================================
# Stage 2: runtime — non-root, 최소 이미지.
# =============================================================================
# debian:bookworm-slim: gcc 이미지의 ~700MB → ~80MB. 실행에 필요한 libc/libsqlite3 만 유지.
FROM debian:bookworm-slim

# libsqlite3-0: runtime 동적 라이브러리 (헤더 X). ca-certificates: 향후 outbound TLS 대비.
# 같은 RUN 안에서 user 까지 생성 → layer 수 최소화 (Docker layer caching 베스트프랙티스).
RUN apt-get update \
 && apt-get install -y --no-install-recommends libsqlite3-0 ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 # -r: 시스템 계정(uid < 1000) 으로 생성 → 일반 user 와 구분.
 # -s /usr/sbin/nologin: 셸 비활성 → 컨테이너 침투 시 인터랙티브 접근 차단.
 && groupadd -r honeypot \
 && useradd  -r -g honeypot -d /app -s /usr/sbin/nologin honeypot \
 && mkdir -p /app /data \
 # /data: SQLite 파일 위치 (compose 의 named volume 마운트 지점).
 #        volume 마운트 시 docker 가 컨테이너 안 ownership 을 복사 → honeypot 이 쓰기 가능.
 && chown honeypot:honeypot /app /data

WORKDIR /app
# --chown 으로 복사 시점에 ownership 지정 → 별도 chown 레이어 회피 (이미지 크기 ↓).
COPY --from=builder --chown=honeypot:honeypot /src/honeypot /app/honeypot

# USER 전환: 이 시점 이후 모든 명령(CMD 포함) 이 non-root 로 실행.
# raw socket 이지만 8080 (> 1024) 바인딩이라 root 권한 불필요.
USER honeypot
EXPOSE 8080
CMD ["/app/honeypot"]
