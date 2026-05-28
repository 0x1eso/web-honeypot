# ===== Stage 1: build =====
FROM gradle:8.8-jdk17 AS builder
WORKDIR /build

# Copy Gradle metadata first for better layer caching
COPY settings.gradle.kts build.gradle.kts gradle.properties ./
COPY gradle ./gradle
COPY gradlew ./
# (gradlew.bat not needed in Linux container)

# Pre-fetch dependencies
RUN gradle --no-daemon dependencies || true

# Copy source and build a runnable distribution
COPY src ./src
RUN gradle --no-daemon installDist

# ===== Stage 2: runtime (non-root) =====
FROM eclipse-temurin:17-jre

# non-root user 생성 + /data 볼륨 마운트 지점 ownership 처리.
# (named volume 첫 마운트 시 Docker가 컨테이너 안의 ownership을 복사한다.)
RUN groupadd -r app \
 && useradd  -r -g app -d /app -s /usr/sbin/nologin app \
 && mkdir -p /app /data \
 && chown app:app /app /data

WORKDIR /app

# Copy the prepared distribution (scripts + libs)
COPY --from=builder --chown=app:app /build/build/install/honeypot-api ./

# SQLite DB location (overridden by docker-compose)
ENV DB_PATH=/data/honeypot.db

USER app
EXPOSE 8081

CMD ["./bin/honeypot-api"]
