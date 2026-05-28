# ===== Stage 1: build =====
# gcc:13 = debian:bookworm 기반. 같은 base에서 빌드해 glibc 호환 보장.
FROM gcc:13 AS builder

RUN apt-get update \
 && apt-get install -y --no-install-recommends libsqlite3-dev \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /src
COPY . /src
RUN make

# ===== Stage 2: runtime (non-root, 최소 이미지) =====
FROM debian:bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends libsqlite3-0 ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd -r honeypot \
 && useradd  -r -g honeypot -d /app -s /usr/sbin/nologin honeypot \
 && mkdir -p /app /data \
 && chown honeypot:honeypot /app /data

WORKDIR /app
COPY --from=builder --chown=honeypot:honeypot /src/honeypot /app/honeypot

USER honeypot
EXPOSE 8080
CMD ["/app/honeypot"]
