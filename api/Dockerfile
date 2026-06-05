# =============================================================================
# Stage 1: build — Gradle + JDK17 로 Kotlin 컴파일 및 distribution 패키징.
# =============================================================================
# gradle:8.8-jdk17 사용 이유:
#   repo 에 gradle-wrapper.jar 가 누락되어 있을 수 있어 호스트 ./gradlew 실패 가능.
#   컨테이너 안에서는 gradle 바이너리를 직접 호출 → wrapper 의존 제거.
FROM gradle:8.8-jdk17 AS builder
WORKDIR /build

# ▼ 의존성 메타파일 먼저 복사 → Docker layer caching 최적화.
#   소스만 바뀌고 build.gradle.kts 가 그대로면 이 RUN 단계의 캐시가 재사용되어
#   외부 maven 의존성 다운로드를 건너뜀 (CI 빌드 시간 ↓).
COPY settings.gradle.kts build.gradle.kts gradle.properties ./
COPY gradle ./gradle
COPY gradlew ./
# (gradlew.bat 은 Windows 전용이라 Linux 컨테이너에서 불필요.)

# 의존성 prefetch — 실패해도 빌드는 진행( || true).
# --no-daemon: 컨테이너는 단발성 실행이라 daemon 보유의 가치 없음, RAM/시간 절약.
RUN gradle --no-daemon dependencies || true

# 소스 복사는 의존성 캐시 단계 뒤에 위치 → 소스 변경이 의존성 캐시를 무효화하지 않음.
COPY src ./src
# installDist: build/install/<project>/{bin, lib} 구조의 실행 가능한 distribution 생성.
# (fat JAR 대신 distribution 을 쓰는 이유: lib 디렉터리가 분리되어 runtime stage 에서 layer 분리 가능.)
RUN gradle --no-daemon installDist

# =============================================================================
# Stage 2: runtime — JRE 만 포함, non-root.
# =============================================================================
# eclipse-temurin:17-jre: JDK 가 아닌 JRE 만 → 컴파일러/도구 제외로 이미지 크기 ↓ + 공격 표면 ↓.
FROM eclipse-temurin:17-jre

# non-root user 생성 + /data 볼륨 마운트 지점 ownership 처리.
# (compose 의 named volume 첫 마운트 시 Docker 가 컨테이너 안 ownership 을
#  호스트로 복사해 줘서 호스트 uid 충돌 없이 쓰기 가능.)
RUN groupadd -r app \
 && useradd  -r -g app -d /app -s /usr/sbin/nologin app \
 && mkdir -p /app /data \
 && chown app:app /app /data

WORKDIR /app

# --chown 으로 복사 시점에 ownership 지정 → 런타임 USER 가 read/exec 가능.
# bin/ 안의 셸 스크립트 + lib/ 안의 JAR 들이 함께 복사됨 (installDist 구조).
COPY --from=builder --chown=app:app /build/build/install/honeypot-api ./

# DB_PATH: core 와 공유하는 SQLite 파일 위치. compose 가 동일 값으로 override 함.
ENV DB_PATH=/data/honeypot.db

# USER 전환 — 이 시점 이후 모든 명령은 non-root 로 실행.
USER app
EXPOSE 8081

# Gradle installDist 가 생성한 launcher 스크립트. JVM 옵션은 JAVA_OPTS env 로 주입 가능.
CMD ["./bin/honeypot-api"]
