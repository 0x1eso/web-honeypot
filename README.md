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

## Windows에서 빠른 시작 (Docker Desktop)

배포 없이 윈도우 PC에서 로컬로 시연·실습할 때의 가장 확실한 경로다.
core(C 모듈)는 `memmem`·pthread·POSIX 소켓 같은 리눅스 전용 기능을 쓰므로
윈도우 네이티브 빌드는 되지 않는다. Docker는 리눅스 컨테이너 안에서
빌드하므로 이 이식성 문제를 전부 우회한다.

아래는 모두 **PowerShell** 기준이다.

### 0. 사전 설치 (최초 1회)

```powershell
winget install -e --id Git.Git
winget install -e --id Docker.DockerDesktop
```

설치 후 **Docker Desktop을 실행**하고 엔진(고래 아이콘)이 초록색이 될 때까지
기다린다. 최초 실행 시 WSL2 설치를 요구하면 안내대로 진행 후 재부팅한다.

```powershell
docker version
docker compose version
```

### 1. 클론

```powershell
cd ~
git clone https://github.com/0x1eso/web-honeypot.git
cd web-honeypot
```

### 2. 빌드 + 실행

```powershell
docker compose up --build -d
```

최초 1회는 이미지 빌드로 5~8분 걸린다. 세 컨테이너가 모두 `(healthy)`인지 확인:

```powershell
docker compose ps
docker compose logs -f   # 부팅 로그 확인 (Ctrl+C 로 빠져나옴)
```

### 3. 접속

브라우저에서 `http://localhost:3000` 으로 연다. 처음엔 수집 데이터가 없어
화면이 비어 있다 — 다음 단계로 채운다.

### 4. 샘플 공격 트래픽 주입 (대시보드 채우기)

honeypot 본체(core, 8080)에 가짜 공격을 보낸다. 윈도우 기본 `curl.exe`를
쓴다(PowerShell의 `curl` 별칭과 구분하려고 `.exe`를 명시):

```powershell
# SQLi
curl.exe "http://localhost:8080/login?id=admin%27%20OR%201=1--"

# XSS
curl.exe -X POST --data "c=<script>alert(1)</script>" "http://localhost:8080/comment"

# 스캔 (민감 경로 탐색)
curl.exe "http://localhost:8080/.env"
curl.exe "http://localhost:8080/wp-admin"
curl.exe "http://localhost:8080/etc/passwd"

# 브루트포스 (같은 IP로 로그인 12회 → 60초/10회 임계 초과)
1..12 | ForEach-Object { curl.exe -X POST --data "user=admin&password=x" "http://localhost:8080/login" }

# 기타 (정상처럼 보이는 요청)
curl.exe "http://localhost:8080/"
```

주입 후 10~15초 기다린다(분류기 5초 주기 + 대시보드 10초 폴링). 곧 다섯
유형이 색깔별로 카드·차트·로그 표에 채워진다. 모든 요청이 같은 PC에서 가니
공격자 IP는 `127.0.0.1`로 기록된다(정상).

### 5. 종료 / 정리

```powershell
docker compose stop     # 잠깐 멈춤 (데이터 유지)
docker compose start    # 다시 시작
docker compose down     # 컨테이너 제거 (수집 데이터는 볼륨에 유지)
docker compose down -v  # 수집 데이터까지 삭제
```

### 6. 트러블슈팅

| 증상 | 해결 |
|---|---|
| `error during connect ... docker_engine` | Docker Desktop이 안 켜짐 → 실행 후 엔진 초록 확인 |
| `ports are not available: ... 3000` (또는 8080) | 포트 점유 → 점유 앱 종료, 또는 `docker-compose.yml`의 `"3000:8080"`을 `"3001:8080"`으로 바꾼 뒤 `http://localhost:3001` |
| 대시보드는 뜨는데 숫자가 0 | 4번 주입 누락 또는 주입 후 15초 미경과 |
| `dashboard`가 `(unhealthy)`/재시작 반복 | `docker compose logs dashboard`로 원인 확인 |

---

## 주의사항

이 프로젝트는 학습 목적으로 제작되었다. 반드시 Docker로 격리된 환경 또는 사설 네트워크에서만 운영해야 한다. 공인 IP 환경에 직접 노출할 경우 실제 공격 트래픽이 유입되며, 이에 따른 법적·윤리적 책임은 운영자에게 있다.
