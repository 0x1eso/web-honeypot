# 구현 로드맵

---

## 팀원 담당 — `core/` (C 모듈)

### 목표
raw socket으로 HTTP 요청을 수신하고, 가짜 응답을 돌려주면서 SQLite에 로그를 기록한다.

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

### 팀원 체크리스트

- [ ] `honeypot.h` 구조체/상수 확정 후 나한테 공유 (DB_PATH, timestamp 포맷)
- [ ] `logger_init()` 호출 시 DB 파일 + 테이블 자동 생성
- [ ] INSERT 시 `attack_type` 컬럼은 NULL
- [ ] 멀티스레드 SQLite 접근 보호
- [ ] Makefile에 `-lsqlite3 -lpthread` 링크 추가

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
| `core` | 팀원 코드 대기 중 | Dockerfile은 작성됨 |

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
