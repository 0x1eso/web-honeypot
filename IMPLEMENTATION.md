# 구현 로드맵

---

## Phase 0 — `core/` (C 모듈) ✅ 완료

### 목표
raw socket으로 HTTP 요청을 수신하고, 가짜 응답을 돌려주면서 SQLite에 로그를 기록한다.

### 구현 결과 (Phase 1 작업)
| 파일 | 역할 |
|---|---|
| `main.c` | 진입점, signal handler, logger 초기화 |
| `server.c` | TCP socket + accept 루프 + 연결당 pthread |
| `http_parser.c` | METHOD/PATH/User-Agent/body 추출 (`memmem`, `strncasecmp`) |
| `logger.c` | prepared statement + mutex + WAL/busy_timeout PRAGMA |
| `response.c` | `/admin`/`/login`/`/.env`/`/wp-login.php` 가짜 응답, 그 외 404 |
| `honeypot.h` | `HttpRequest` 구조체 + DB_PATH/PORT/BUF_SIZE/BACKLOG 상수 |
| `Makefile` | `-D_GNU_SOURCE -pthread -lsqlite3 -lpthread` |

### 구현 시 적용된 정책
- timestamp는 `gmtime_r` + `strftime("%Y-%m-%dT%H:%M:%SZ")` 로 ISO 8601 UTC 강제
- HttpRequest 구조체 필드 고정 크기로 자동 cap (path 1024 / user_agent 512 / body 4096)
- `recv` 5초 타임아웃으로 슬로우로리스 방지
- `SIGPIPE` 무시 + `MSG_NOSIGNAL` send로 클라이언트 조기 종료에 견고
- prepared statement는 1개 + mutex로 직렬화
- response body는 모두 정적 문자열 → reflection XSS/명령 주입 표면 없음

---

### STEP 1 — `honeypot.h` 헤더 확정

모든 모듈이 공유하는 구조체와 함수 선언을 먼저 확정한다.

```c
// honeypot.h
#ifndef HONEYPOT_H
#define HONEYPOT_H

#define DB_PATH "/data/honeypot.db"
#define PORT    8080
#define BUF_SIZE 8192

typedef struct {
    char timestamp[32];   // "2024-01-01T12:00:00Z"
    char ip[46];          // IPv4/IPv6
    char method[8];       // "GET", "POST" 등
    char path[1024];
    char user_agent[512];
    char body[4096];
} HttpRequest;

void server_start(int port);
void http_parse(const char *raw, HttpRequest *req);
void logger_init(const char *db_path);
void log_request(const HttpRequest *req);
void send_fake_response(int client_fd, const char *path);

#endif
```

> **주의**: timestamp는 ISO 8601 형식(`2024-01-01T12:00:00Z`)으로 맞춰야 Kotlin 파싱이 편하다.

---

### STEP 2 — `server.c` (소켓 서버)

```
구현 순서:
1. socket() → SO_REUSEADDR 설정
2. bind() → 포트 8080
3. listen() → backlog 10
4. accept() 루프
   └─ 각 연결마다 pthread_create()로 핸들러 스레드 생성
5. 핸들러 스레드:
   └─ recv() → http_parse() → log_request() → send_fake_response() → close()
```

멀티스레드 필요 이유: 스캐너는 동시에 수십 개 연결을 맺으므로 단일 스레드면 큐잉됨.

---

### STEP 3 — `http_parser.c`

```
파싱 대상 raw HTTP 예시:
  POST /login HTTP/1.1\r\n
  Host: 192.168.0.1\r\n
  User-Agent: sqlmap/1.7\r\n
  \r\n
  username=admin'--

파싱 방법:
1. 첫 줄에서 method, path 추출 (strtok or sscanf)
2. 헤더 루프: "User-Agent:" 줄 찾아서 값 복사
3. \r\n\r\n 이후가 body
```

edge case: body가 없는 GET 요청, 헤더가 잘린 요청(BUF_SIZE 초과) 처리 필요.

---

### STEP 4 — `logger.c` (SQLite 기록)

```c
// 초기화 (프로그램 시작 시 1회)
void logger_init(const char *db_path) {
    sqlite3_open(db_path, &db);
    // schema.sql의 CREATE TABLE 실행
}

// 요청마다 호출
void log_request(const HttpRequest *req) {
    // attack_type은 NULL로 INSERT (Kotlin이 나중에 채움)
    INSERT INTO attack_logs
        (timestamp, ip, method, path, user_agent, body)
    VALUES (?, ?, ?, ?, ?, ?);
}
```

> WAL 모드는 `PRAGMA journal_mode=WAL;`을 logger_init에서 실행.
> 멀티스레드 환경이므로 `sqlite3_config(SQLITE_CONFIG_SERIALIZED)` 또는 mutex로 보호.

---

### STEP 5 — `response.c` (가짜 응답)

공격자가 진짜 취약한 서버라고 믿게 만드는 것이 목적.

| 경로 패턴 | 가짜 응답 |
|---|---|
| `/admin`, `/admin/login` | 200 OK + HTML 로그인 폼 |
| `/.env` | 200 OK + `DB_PASSWORD=supersecret` 텍스트 |
| `/wp-login.php` | 200 OK + WordPress 로그인 HTML |
| `/login`, `/signin` | 200 OK + 일반 로그인 폼 |
| 그 외 | 404 Not Found |

```c
void send_fake_response(int fd, const char *path) {
    if (strstr(path, "admin") || strstr(path, "login")) {
        write(fd, HTTP_200_LOGIN_FORM, ...);
    } else if (strcmp(path, "/.env") == 0) {
        write(fd, HTTP_200_ENV_LEAK, ...);
    } else {
        write(fd, HTTP_404, ...);
    }
}
```

---

### STEP 6 — `main.c`

```c
int main() {
    logger_init(DB_PATH);
    server_start(PORT);  // 블로킹
    return 0;
}
```

---

### Phase 0 체크리스트

- [x] `honeypot.h` 구조체/상수 확정 (DB_PATH, PORT, BUF_SIZE, BACKLOG, HttpRequest)
- [x] `logger_init()`이 DB 파일 + 테이블 자동 생성 (CREATE TABLE IF NOT EXISTS)
- [x] INSERT 시 `attack_type` 컬럼은 NULL (Kotlin 분류기가 후속 UPDATE)
- [x] 멀티스레드 SQLite 접근 보호 (prepared statement + pthread mutex)
- [x] Makefile에 `-lsqlite3 -lpthread` 링크 추가, `-D_GNU_SOURCE`로 memmem 활성화
- [x] `./honeypot` 호스트 빌드 검증 완료 (gcc 13, libsqlite3-dev)

---
---

## 나 담당 — `api/` + `dashboard/`

---

## Phase 1 — Kotlin API 서버 (`api/`) ✅ 완료

### 구현된 파일

| 파일 | 역할 |
|---|---|
| `Application.kt` | 진입점, DB 초기화, 분류기 코루틴 실행 |
| `Database.kt` | Exposed ORM 테이블 정의 + SQLite 연결 |
| `AttackClassifier.kt` | attack_type NULL 행 분류 후 UPDATE (5초 주기) |
| `Routing.kt` | `/api/logs`, `/api/stats`, `/api/top-ips` |
| `Models.kt` | 직렬화용 data class |
| `plugins/Serialization.kt` | JSON 응답 설정 |
| `plugins/Cors.kt` | CORS 허용 |
| `src/main/resources/logback.xml` | 로그 포맷 |

### 분류 규칙 (AttackClassifier)

| 유형 | 판단 기준 |
|---|---|
| SQLi | path/body에 `select`, `union`, `--`, `'`, `1=1` 등 포함 |
| XSS | path/body에 `<script`, `onerror=`, `javascript:`, `alert(` 등 포함 |
| 스캔 | `/.env`, `/.git`, `/wp-login.php`, `/phpmyadmin` 등 경로 패턴 |
| 브루트포스 | 같은 IP가 60초 이내 로그인 경로에 10회 이상 요청 |
| 기타 | 위 어디도 해당 안 됨 |

### API 응답 형식

**GET /api/logs**
```json
{
  "total": 1234,
  "logs": [
    {
      "id": 1,
      "timestamp": "2024-01-01T12:00:00Z",
      "ip": "1.2.3.4",
      "method": "POST",
      "path": "/login",
      "userAgent": "sqlmap/1.7",
      "body": "id=1'",
      "attackType": "SQLi"
    }
  ]
}
```

**GET /api/stats**
```json
{
  "total": 1234,
  "byType": { "SQLi": 400, "XSS": 200, "브루트포스": 150, "스캔": 300, "기타": 184 }
}
```

**GET /api/top-ips**
```json
[
  { "ip": "1.2.3.4", "count": 300 },
  { "ip": "5.6.7.8", "count": 150 }
]
```

### ⚠️ Exposed 0.52.0 API 주의사항

구현 중 발견된 호환성 이슈. 아래 규칙을 반드시 따를 것.

```kotlin
// ❌ 구버전 API (0.52.0에서 제거됨)
Table.select { condition }
Table.slice(col1, col2).select { condition }
query.limit(n).offset(m)          // offset()은 메서드가 아님

// ✅ 올바른 API
Table.selectAll().where { condition }
Table.select(col1, col2).where { condition }
query.limit(n, offset)            // limit() 두 번째 인자로 offset 전달

// ✅ transaction 반환 타입은 명시
val result: Pair<Int, List<LogEntry>> = transaction { ... }
```

### Phase 1 체크리스트

- [x] `Database.kt` — 연결 + 테이블 정의
- [x] `AttackClassifier.kt` — 분류 로직 + 5초 주기 실행
- [x] `Routing.kt` — `/api/logs`, `/api/stats`, `/api/top-ips`
- [x] `Application.kt` — 플러그인 등록 + DB 초기화 + 분류기 시작
- [ ] `./gradlew run`으로 로컬 실행 확인 (로컬 JDK 17+ 설치 필요)
- [ ] curl로 각 엔드포인트 응답 확인

---

## Phase 2 — React 대시보드 (`dashboard/`) ✅ 완료

### 구현된 파일

```
dashboard/src/
├── api/
│   └── index.js          ✅ fetchLogs, fetchStats, fetchTopIps
├── components/
│   ├── StatCard.jsx       ✅ 공격 유형별 숫자 카드
│   ├── StatsChart.jsx     ✅ 파이차트 (recharts)
│   ├── TopIps.jsx         ✅ 상위 IP 바차트
│   └── LogTable.jsx       ✅ 필터 + 페이지네이션 테이블
└── App.jsx                ✅ 전체 조합, 10초 자동 갱신
```

### Phase 2 체크리스트

- [x] `api/index.js` — 3개 함수 구현
- [x] `StatCard.jsx` — 요약 숫자 카드
- [x] `StatsChart.jsx` — 파이차트
- [x] `LogTable.jsx` — 필터 + 페이지네이션 테이블
- [x] `TopIps.jsx` — 바차트
- [x] `App.jsx` — 조합 + 10초 자동 갱신
- [ ] 팀원 core/ 완성 후 실제 데이터로 UI 확인

---

## Docker 빌드 현황

| 서비스 | Docker 빌드 | 비고 |
|---|---|---|
| `api` | ✅ 성공 | `gradle:8.8-jdk17` 이미지 사용 |
| `dashboard` | ✅ 성공 | `node:20-alpine` 사용 (CustomEvent 지원) |
| `core` | ✅ 성공 | `gcc:13` + libsqlite3-dev. 호스트 빌드 검증 완료 |

### Phase 1 후속 수정 (2026-05-28)
- `dashboard/src/api/index.js`: BASE를 "API root 전체"(/api 포함)로 통일.
  Docker `VITE_API_URL=/api` + 호출 `${BASE}/logs` → 최종 `/api/logs`.
  이전 코드는 `${BASE}/api/logs` 형태라 Docker 배포 시 `/api/api/logs` 이중 prefix 404가 발생했음.

---

## XSS 표시 정책 (Phase 4)

허니팟 로그는 **공격자가 자유롭게 페이로드를 주입하는 입력**이다. 대시보드가 이를 렌더링할 때 다음 룰을 강제한다.

| 위치 | 룰 |
|---|---|
| React JSX 보간 (`{log.path}`) | OK — React가 기본 escape |
| `dangerouslySetInnerHTML` | **금지** (코드 review 차단) |
| recharts `Tooltip` / `LabelList` custom render | 반환값은 **문자열만**. `<div>` 등 JSX 반환 시 escape 보장 안 됨 |
| URL/CSV/JSON export | 텍스트 escape 필수. CSV는 `,` `"` `\n` 이스케이프 + `=`/`@`/`+`/`-` prefix 차단 (수식 주입) |
| 클립보드 복사 | DOM 텍스트만 복사. innerHTML 금지 |

CSP가 `script-src 'self'` 만 허용하므로 인라인 스크립트는 브라우저 차단되지만, 위 룰은 **defense-in-depth**로 유지한다.

---

## Phase 2~4 변경 메모 (2026-05-28)

### Phase 2 (API 정합성 & 관측성)
- classifier 코루틴: SupervisorJob + Dispatchers.IO + ApplicationStopping cancel
- 모든 핸들러 `newSuspendedTransaction(Dispatchers.IO)` 격리
- `/healthz` 추가, Docker healthcheck 3종
- offset 음수 clamp, count/list Query 객체 분리
- logback ISO 8601 + 분류기 logger

### Phase 3 (DB 성능 & 동시성)
- 인덱스 3개: `idx_logs_attack_type`, `idx_logs_ip_timestamp`, `idx_logs_timestamp`
- SQLite PRAGMA via setupConnection (`busy_timeout=5000`)
- brute force 4 sumOf 쿼리 → 단일 OR 쿼리 (중복 카운트 제거)
- CHECK 제약 (path 1024 / body 4096 / 등) 3-way 일치 (`schema.sql` / `core/logger.c` / `api/Database.kt`)

### Phase 4 (보안 보강)
- CORS `anyHost()` → `ALLOWED_ORIGINS` env 화이트리스트
- nginx 보안 헤더 5종 (X-Content-Type-Options / X-Frame-Options / Referrer-Policy / Permissions-Policy / CSP)
- Dockerfile 3개 모두 non-root + 멀티스테이지 (core: `debian:bookworm-slim`, api: `app` user, dashboard: `nginxinc/nginx-unprivileged:alpine` 8080)
- compose: api 호스트 publish 제거 (`expose`만), dashboard `3000:8080` 매핑
- README 상단 위협 모델 박스

### Phase 5 (테스트 & 마무리)

#### 5.1 Ktor 통합 + AttackClassifier 단위 테스트
- `api/build.gradle.kts` 테스트 deps 추가 (JUnit 5, ktor-server-test-host, kotlinx-coroutines-test). JUnit 4 브리지(`kotlin-test-junit`) 제거 — JUnit 5와 충돌 회피.
- `api/src/test/kotlin/com/honeypot/TestSupport.kt`: `withTestDb` (temp 파일 DB) + `seedLog` + `withTestApp` (production plugin 순서 미러링, classifier loop 제외).
- `api/src/test/kotlin/com/honeypot/RoutingTest.kt`: 7 케이스 (`/healthz` DB ping, `/api/logs` 목록·필터·페이지네이션·offset 음수 클램프, `/api/stats` byType, `/api/top-ips` 정렬).
- `api/src/test/kotlin/com/honeypot/AttackClassifierTest.kt`: 5 케이스 (SQLi / XSS / 스캔 / 브루트포스 / 기타 fallback).
- 발견된 production 제약 (테스트가 코드에 맞춰 작성됨):
  - `/api/logs` 필터 파라미터는 `type` (코드의 실제 query key)
  - 레이블은 한국어 (`SQLi` / `XSS` / `스캔` / `브루트포스` / `기타`)
  - `/api/stats`의 `byType`은 attack_type NULL 행을 제외 (`total`만 포함)

#### 5.2 dashboard Playwright `/api/api/` 회귀 차단
- `dashboard/package.json` `@playwright/test ^1.48.0` + `test:e2e` / `test:e2e:install` 스크립트.
- `dashboard/playwright.config.js` (ESM) — chromium 단일, `webServer: npm run dev` 자동 기동, `reuseExistingServer: !CI`.
- `dashboard/tests/e2e/dashboard.spec.js`:
  - A: `page.route('**/*')` 로 `/api` 요청 모킹 (오프라인 테스트). 모든 요청 URL 캡처 → `/api/`에 매치는 1개 이상 + `/api/api/` 포함은 0개 (회귀 차단).
  - B: pageerror 0건 + body 가시성 검증.
- 모킹 shape: `stats={total:0, byType:{}}`, `top-ips=[]`, `logs={total:0, logs:[]}` (App.jsx의 destructuring 경로에 맞춤).
- `.gitignore` Playwright artifact 3 줄 추가.

#### 5.3 PAGE_SIZE 단일화 (M4)
- 기존: `App.jsx:9` 와 `LogTable.jsx:12` 양쪽에 `PAGE_SIZE=20` 중복.
- 변경: `App.jsx` 모듈 상수로 단일화, `<LogTable pageSize={PAGE_SIZE} />` prop 전달. LogTable 내부 중복 정의 제거.

#### 5.4 인라인 style → tokens.css (M10)
- `dashboard/src/styles/tokens.css` 신설: color (semantic + attack-type 별 surface/border), space-1~10, radius, text size, duration/ease.
- `main.jsx`에서 tokens.css를 index.css 보다 먼저 import.
- 컴포넌트별 co-located CSS (`StatCard.css` / `StatsChart.css` / `TopIps.css` / `LogTable.css`) 신설. 인라인 `style={{}}` 28건 제거.
- 제외: recharts API 값 (`COLORS`, `Cell fill`, `contentStyle`) 은 DOM style 이 아니라 라이브러리 API 이므로 유지.
- 유지: `StatCard.jsx` 의 동적 색상 CSS variable 1건 (`style={{ '--accent': color }}`) — 의도적 잔류.
- `npm run build` 성공 (259ms, CSS 7.21 KB, JS 596 KB — recharts 번들 경고는 사전 존재 이슈).

#### 5.5 메타 파일 (L2-L4)
- `.env.example`: `DB_PATH`, `ALLOWED_ORIGINS`, `VITE_API_URL` 가이드.
- `LICENSE`: MIT + 운영 책임 면책 NOTE (README 위협 모델과 일치).
- `data/.gitkeep`: 마운트 디렉터리 git 추적 유지 (`.gitignore` 의 `!data/.gitkeep` 와 짝).

#### 5.6 brute force 정책 명문화 (M11)
- `AttackClassifier.kt` 클래스 KDoc: 레이블 집합, 매칭 우선순위, 60초 슬라이딩 윈도우 + 임계 10회 정책, 인덱스 의존성, false positive 의도, 레이블 변경 시 UI 동기화 필요성 명시.

### ⚠️ Dockerfile 주의사항

- `dashboard/Dockerfile`: `node:18-alpine` → `node:20-alpine` 필요 (Node 18 구버전에 `CustomEvent` 미지원)
- `dashboard/Dockerfile`: `npm ci` 대신 `npm install` 사용 (lock file 버전 불일치 방지)
- `api/Dockerfile`: `gradle --no-daemon installDist` 로 배포용 스크립트 생성

---

## 통합 순서

```
[팀원] core/ 구현 완료
  └─ DB에 실제 데이터 INSERT 확인

[합치기] docker-compose up --build
  └─ 세 컨테이너 모두 정상 실행 확인
  └─ http://localhost:3000 에서 대시보드 확인
```

---

## 팀원과 맞춰야 할 것 (협업 인터페이스)

| 항목 | 값 |
|---|---|
| SQLite 파일 경로 | `/data/honeypot.db` (Docker 볼륨) |
| timestamp 포맷 | `2024-01-01T12:00:00Z` (ISO 8601) |
| INSERT 시 attack_type | NULL로 비워둠 |
| C 서버 포트 | 8080 |
| Kotlin API 포트 | 8081 |
| React 포트 | 5173 (dev) / 3000 (Docker) |
