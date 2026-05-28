# Web Honeypot

공격자를 유인하여 실제 공격 트래픽을 수집·분류·시각화하는 저상호작용 웹 허니팟 시스템.

---

> ## 위협 모델 / 운영 경계 (반드시 읽을 것)
>
> 이 프로젝트는 **학습용**이다. 다음 환경에서만 운영한다:
>
> - 로컬 개발 머신 (Docker 격리)
> - 격리된 사설 네트워크 / VLAN / lab 환경
>
> **금지**:
> - 공인 IP에 직접 노출 (NAT 포워딩, 클라우드 인스턴스 public IP 등)
> - 운영망과 같은 서브넷
> - 인증 없는 대시보드를 인터넷에 게시
>
> 허니팟은 정의상 공격을 유도하는 시스템이라 노출 시 실제 침해 트래픽을 받는다.
> 그 트래픽을 다른 서비스에 영향 없는 환경에서 받을 책임은 운영자에게 있다.

---

## 개요

이 프로젝트는 취약한 서버처럼 위장한 가짜 엔드포인트를 노출하고, 유입되는 HTTP 요청을 자동으로 분석하여 공격 패턴을 파악하는 것을 목적으로 한다. SQL 인젝션, XSS, 브루트포스, 디렉터리 스캔 등 다양한 공격 유형을 실시간으로 수집하고 대시보드에서 확인할 수 있다.

---

## 기술 스택

- **C** — raw socket 기반 HTTP 서버, 패킷 수신 및 로그 기록
- **Kotlin / Ktor** — 공격 분류 엔진, REST API 서버
- **SQLite** — 로그 저장소 (WAL 모드)
- **React + Vite** — 실시간 통계 대시보드
- **Docker** — 격리 환경 구성

---

## 시스템 구조

```
공격자 HTTP 요청
      ↓
  C 서버 (포트 8080)
  - 요청 수신 및 파싱
  - 가짜 응답 반환
  - SQLite에 로그 기록
      ↓
  SQLite DB
      ↓
  Kotlin/Ktor API 서버
  - 공격 유형 자동 분류
  - REST API 제공
      ↓
  React 대시보드
  - 차트 및 로그 시각화
```

---

## 디렉터리 구조

```
honeypot/
├── core/               # C 모듈 (raw socket HTTP 서버, 멀티스레드, SQLite 로깅)
│   ├── main.c
│   ├── server.c
│   ├── http_parser.c
│   ├── logger.c
│   ├── response.c
│   └── honeypot.h
├── api/                # Kotlin/Ktor 서버 (공격 분류 + REST API)
│   ├── src/
│   └── build.gradle.kts
├── dashboard/          # React 프론트엔드 (실시간 통계)
│   ├── src/
│   └── package.json
├── db/
│   └── schema.sql
├── docker-compose.yml
└── README.md
```

---

## DB 스키마

```sql
CREATE TABLE attack_logs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp   TEXT    NOT NULL,
    ip          TEXT    NOT NULL,
    method      TEXT    NOT NULL,
    path        TEXT    NOT NULL,
    user_agent  TEXT,
    body        TEXT,
    attack_type TEXT
);

PRAGMA journal_mode=WAL;
```

C 모듈이 `attack_type`을 제외하고 INSERT하면, Kotlin 서버가 주기적으로 읽어 분류 후 UPDATE한다.

---

## 수집 항목

각 HTTP 요청에 대해 다음 정보를 기록한다.

- 수신 시각
- 공격자 IP 주소
- HTTP 메서드 (GET, POST 등)
- 요청 경로 (`/admin`, `/.env` 등)
- User-Agent
- 요청 바디 (페이로드)
- 공격 유형 (SQLi / XSS / 브루트포스 / 스캔 / 기타)

---

## API 엔드포인트

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/logs` | 최근 로그 목록 |
| GET | `/api/stats` | 공격 유형별 통계 |
| GET | `/api/top-ips` | 상위 공격자 IP 목록 |

---

## 사전 요구사항

| 도구 | 최소 버전 | 용도 |
|---|---|---|
| GCC | 11+ | C 모듈 빌드 |
| libsqlite3-dev | - | C 모듈 SQLite 연동 |
| JDK | 17+ | Kotlin/Ktor API 서버 |
| Node.js | 18+ | React 대시보드 |
| Docker + Compose | - | 통합 실행 (선택) |

---

## 클론 후 초기 설정

```bash
git clone <repo-url>
cd web-honeypot
```

**C 모듈 (core/)**
```bash
# Ubuntu/Debian
sudo apt install gcc libsqlite3-dev

cd core && make
```

**Kotlin API 서버 (api/)**
```bash
# JDK 17+ 필요 (gradlew가 Gradle 자동 다운로드)
cd api
./gradlew build       # Mac/Linux
gradlew.bat build     # Windows
```

**React 대시보드 (dashboard/)**
```bash
cd dashboard
npm install           # 클론 후 반드시 실행 (node_modules는 git에 포함 안 됨)
npm run dev
```

---

## 실행 방법

**Docker로 한번에 실행 (권장)**
```bash
docker-compose up --build
```

**개별 실행 (개발 시)**
```bash
# C 모듈 (포트 8080)
cd core && ./honeypot

# Kotlin API 서버 (포트 8081)
cd api && ./gradlew run

# React 대시보드 (포트 5173)
cd dashboard && npm run dev
```

---

## 주의사항

이 프로젝트는 학습 목적으로 제작되었다. 반드시 Docker로 격리된 환경 또는 사설 네트워크에서만 운영해야 한다. 공인 IP 환경에 직접 노출할 경우 실제 공격 트래픽이 유입되며, 이에 따른 법적·윤리적 책임은 운영자에게 있다.
