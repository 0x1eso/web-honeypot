/**
 * @file logger.c
 * @brief SQLite WAL 모드 기반 공격 로그 기록. 멀티스레드 직렬화.
 *
 * 의존성:
 *   - libsqlite3 (-lsqlite3)
 *   - pthread mutex (-lpthread)
 *
 * 동시성 모델:
 *   - prepared statement 1개를 모든 worker thread 가 공유 + db_mutex 로 직렬화.
 *     SQLite 자체도 single-writer 라 thread-per-statement 로 가도 결국 직렬화
 *     되므로, mutex 비용 < prepare/finalize 비용 이라는 trade-off 로 단순화.
 *   - WAL 모드 + busy_timeout=5s 로 reader(Kotlin/Ktor API)와 writer 충돌을 흡수.
 *
 * 스키마 일관성:
 *   - 아래 CREATE_SQL 은 db/schema.sql 및 api/Database.kt 의 정의와 반드시 일치.
 *   - LENGTH(...) CHECK 는 HttpRequest 의 char[N] 크기와 1:1 매칭한다.
 *     C 측 truncation 이 우선 적용되므로 CHECK 위반은 실질적으로 발생 안 함 —
 *     일종의 belt-and-suspenders.
 *
 * 보안 메모:
 *   - 모든 INSERT 는 bound parameter (?). 문자열 concatenation SQL 없음.
 *     SQL injection 표면 0 (로그 자체는 attacker-controlled 이지만 안전).
 */
#include <pthread.h>
#include <sqlite3.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "honeypot.h"

/* 글로벌 핸들. 프로세스 lifetime 동안 유지. */
static sqlite3        *db          = NULL;
static sqlite3_stmt   *insert_stmt = NULL;
/* 정적 초기화 가능한 fast mutex. uncontended 시 거의 비용 없음. */
static pthread_mutex_t db_mutex    = PTHREAD_MUTEX_INITIALIZER;

/* attack_logs 스키마. db/schema.sql 및 api/Database.kt 와 동일해야 한다. */
static const char *CREATE_SQL =
    "CREATE TABLE IF NOT EXISTS attack_logs ("
    "  id          INTEGER PRIMARY KEY AUTOINCREMENT,"
    "  timestamp   TEXT    NOT NULL  CHECK (LENGTH(timestamp) <= 32),"
    "  ip          TEXT    NOT NULL  CHECK (LENGTH(ip)        <= 45),"
    "  method      TEXT    NOT NULL  CHECK (LENGTH(method)    <= 7),"
    "  path        TEXT    NOT NULL  CHECK (LENGTH(path)      <= 1024),"
    "  user_agent  TEXT              CHECK (user_agent  IS NULL OR LENGTH(user_agent)  <= 512),"
    "  body        TEXT              CHECK (body        IS NULL OR LENGTH(body)        <= 4096),"
    "  attack_type TEXT              CHECK (attack_type IS NULL OR LENGTH(attack_type) <= 32)"
    ");";

/* PRAGMA 설정:
 *   journal_mode=WAL  → reader/writer 동시성 향상 (대시보드 SELECT 가 INSERT 와 충돌 안 함).
 *   synchronous=NORMAL → fsync 빈도 완화. crash 시 마지막 트랜잭션만 손실, schema 손상 없음.
 *   busy_timeout=5000ms → "database is locked" 시 자동 backoff. honeypot 트래픽은
 *                          순간 burst 가 있어 짧은 락 경합을 흡수해야 한다. */
static const char *PRAGMA_SQL =
    "PRAGMA journal_mode=WAL;"
    "PRAGMA synchronous=NORMAL;"
    "PRAGMA busy_timeout=5000;";

/* attack_type 은 분류기(Kotlin)가 나중에 UPDATE 하므로 INSERT 시점에는 비운다. */
static const char *INSERT_SQL =
    "INSERT INTO attack_logs"
    "  (timestamp, ip, method, path, user_agent, body)"
    "  VALUES (?, ?, ?, ?, ?, ?);";

/**
 * @brief sqlite3_exec 래퍼. 실패해도 abort 하지 않고 stderr 로만 경고.
 *        PRAGMA/CREATE TABLE 같은 idempotent 부팅 작업용.
 */
static void run_or_warn(const char *label, const char *sql) {
    char *err = NULL;
    if (sqlite3_exec(db, sql, NULL, NULL, &err) != SQLITE_OK) {
        fprintf(stderr, "[honeypot] %s failed: %s\n", label, err ? err : "?");
        sqlite3_free(err);
    }
}

/**
 * @brief DB 파일 open + 스키마 생성 + INSERT prepared statement 준비.
 *
 * 실패 정책:
 *   - open 실패 / prepare 실패: exit(1). DB 없이 honeypot 을 띄우는 건
 *     로그 손실을 의미하므로 차라리 부팅을 막아 운영자가 알아채게 한다.
 *   - PRAGMA / CREATE TABLE 실패: 경고만 출력 (이미 존재하는 DB 가 다른 PRAGMA
 *     를 갖고 있어도 INSERT 자체는 가능하므로).
 */
void logger_init(const char *db_path) {
    if (sqlite3_open(db_path, &db) != SQLITE_OK) {
        fprintf(stderr, "[honeypot] sqlite3_open(%s) failed: %s\n",
                db_path, db ? sqlite3_errmsg(db) : "no handle");
        exit(1);
    }

    run_or_warn("PRAGMA",       PRAGMA_SQL);
    run_or_warn("CREATE TABLE", CREATE_SQL);

    /* prepare_v2: SQL 을 한 번만 컴파일해 두고 매 요청마다 reset + bind + step.
     * sqlite3_exec 매번 호출 대비 ~10배 이상 빠르고 SQL injection 차단까지 덤. */
    if (sqlite3_prepare_v2(db, INSERT_SQL, -1, &insert_stmt, NULL) != SQLITE_OK) {
        fprintf(stderr, "[honeypot] prepare INSERT failed: %s\n",
                sqlite3_errmsg(db));
        exit(1);
    }
    fprintf(stdout, "[honeypot] logger ready: %s\n", db_path);
}

/**
 * @brief 빈 문자열은 NULL 로 바인딩한다 (DB 가 빈 문자열과 NULL 을 구분하도록).
 *        대시보드 쿼리에서 "User-Agent 없음" 필터를 user_agent IS NULL 로 짤 수 있게.
 */
static void bind_text_or_null(sqlite3_stmt *stmt, int idx, const char *value) {
    if (value && value[0]) {
        /* SQLITE_TRANSIENT: SQLite 가 즉시 내부 복사. 우리 버퍼는 sqlite3_step
         * 후 곧 재사용되므로 SQLITE_STATIC 은 위험. */
        sqlite3_bind_text(stmt, idx, value, -1, SQLITE_TRANSIENT);
    } else {
        sqlite3_bind_null(stmt, idx);
    }
}

/**
 * @brief 한 요청을 attack_logs 에 INSERT. 스레드 안전.
 *
 * invariant (db_mutex 가 지키는 것):
 *   - insert_stmt 는 한 번에 한 스레드만 reset/bind/step 한다.
 *     SQLite prepared statement 는 thread-safe 하지 않음.
 *
 * fail-safe:
 *   - DB 미초기화 / req=NULL 이면 silent no-op (서버 자체는 계속 살아야 함).
 *   - method/path 가 비어 있으면 CHECK 제약(NOT NULL) 위반을 피하려고
 *     "?" / "/" placeholder 로 대체. 동일한 가드가 server.c 에도 있어서
 *     이중 방어.
 */
void log_request(const HttpRequest *req) {
    if (!req || !db || !insert_stmt) return;

    pthread_mutex_lock(&db_mutex);

    /* reset: 이전 step 의 상태(SQLITE_DONE/ERROR)를 초기화. clear_bindings:
     * 이전 바인딩 잔재 제거. 둘 다 호출 안 하면 stale 값으로 INSERT 될 수 있음. */
    sqlite3_reset(insert_stmt);
    sqlite3_clear_bindings(insert_stmt);

    sqlite3_bind_text(insert_stmt, 1, req->timestamp, -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(insert_stmt, 2, req->ip,        -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(insert_stmt, 3,
                      req->method[0] ? req->method : "?",
                      -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(insert_stmt, 4,
                      req->path[0]   ? req->path   : "/",
                      -1, SQLITE_TRANSIENT);
    bind_text_or_null(insert_stmt, 5, req->user_agent);
    bind_text_or_null(insert_stmt, 6, req->body);

    int rc = sqlite3_step(insert_stmt);
    if (rc != SQLITE_DONE) {
        /* CHECK 위반 / disk full / I/O 에러 등. 한 요청만 버리고 계속. */
        fprintf(stderr, "[honeypot] INSERT failed (%d): %s\n",
                rc, sqlite3_errmsg(db));
    }

    pthread_mutex_unlock(&db_mutex);
}

/**
 * @brief Statement finalize + DB close. 이중 호출 안전 (NULL 가드).
 *
 * 일반적으로는 호출되지 않는다 — server_start 는 무한 루프라 main 이
 * 반환하지 않음. SIGTERM 도 shutdown_handler 가 _exit() 로 즉시 죽이므로
 * OS 의 자동 정리에 맡긴다. 본 함수는 미래의 graceful shutdown 경로용.
 */
void logger_shutdown(void) {
    pthread_mutex_lock(&db_mutex);
    if (insert_stmt) {
        sqlite3_finalize(insert_stmt);
        insert_stmt = NULL;
    }
    if (db) {
        sqlite3_close(db);
        db = NULL;
    }
    pthread_mutex_unlock(&db_mutex);
}
