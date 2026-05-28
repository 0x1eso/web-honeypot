/* logger.c - SQLite WAL 모드에서 attack_logs 테이블에 요청을 기록한다.
 *
 * 멀티스레드 환경이므로 prepared statement 한 개 + mutex로 직렬화한다.
 * attack_type 컬럼은 Kotlin/Ktor 분류기가 나중에 UPDATE 한다.
 */
#include <pthread.h>
#include <sqlite3.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "honeypot.h"

static sqlite3        *db          = NULL;
static sqlite3_stmt   *insert_stmt = NULL;
static pthread_mutex_t db_mutex    = PTHREAD_MUTEX_INITIALIZER;

/* db/schema.sql 및 api/Database.kt 와 동일한 정의를 들고 있어야 한다.
 * 길이 CHECK는 HttpRequest 구조체 필드 크기와 맞춘 cap. */
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

static const char *PRAGMA_SQL =
    "PRAGMA journal_mode=WAL;"
    "PRAGMA synchronous=NORMAL;"
    "PRAGMA busy_timeout=5000;";

static const char *INSERT_SQL =
    "INSERT INTO attack_logs"
    "  (timestamp, ip, method, path, user_agent, body)"
    "  VALUES (?, ?, ?, ?, ?, ?);";

static void run_or_warn(const char *label, const char *sql) {
    char *err = NULL;
    if (sqlite3_exec(db, sql, NULL, NULL, &err) != SQLITE_OK) {
        fprintf(stderr, "[honeypot] %s failed: %s\n", label, err ? err : "?");
        sqlite3_free(err);
    }
}

void logger_init(const char *db_path) {
    if (sqlite3_open(db_path, &db) != SQLITE_OK) {
        fprintf(stderr, "[honeypot] sqlite3_open(%s) failed: %s\n",
                db_path, db ? sqlite3_errmsg(db) : "no handle");
        exit(1);
    }

    run_or_warn("PRAGMA",       PRAGMA_SQL);
    run_or_warn("CREATE TABLE", CREATE_SQL);

    if (sqlite3_prepare_v2(db, INSERT_SQL, -1, &insert_stmt, NULL) != SQLITE_OK) {
        fprintf(stderr, "[honeypot] prepare INSERT failed: %s\n",
                sqlite3_errmsg(db));
        exit(1);
    }
    fprintf(stdout, "[honeypot] logger ready: %s\n", db_path);
}

static void bind_text_or_null(sqlite3_stmt *stmt, int idx, const char *value) {
    if (value && value[0]) {
        sqlite3_bind_text(stmt, idx, value, -1, SQLITE_TRANSIENT);
    } else {
        sqlite3_bind_null(stmt, idx);
    }
}

void log_request(const HttpRequest *req) {
    if (!req || !db || !insert_stmt) return;

    pthread_mutex_lock(&db_mutex);

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
        fprintf(stderr, "[honeypot] INSERT failed (%d): %s\n",
                rc, sqlite3_errmsg(db));
    }

    pthread_mutex_unlock(&db_mutex);
}

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
