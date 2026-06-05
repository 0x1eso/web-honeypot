package com.honeypot

import org.jetbrains.exposed.sql.*
import org.jetbrains.exposed.sql.transactions.transaction
import org.slf4j.LoggerFactory
import java.io.File

/**
 * `attack_logs` 테이블의 Exposed 매핑.
 *
 * 컬럼 정의는 core/logger.c 가 `INSERT` 하는 스키마 및 db/schema.sql 과 1:1 로 맞추어야 한다.
 * `attack_type` 은 NULLABLE — core 가 raw 로그를 먼저 적재하고, 분류기 루프가 나중에
 * `attack_type` 컬럼만 채워 넣는 2-phase 패턴이라 `null = 미분류` 상태가 정상이다.
 */
object AttackLogs : Table("attack_logs") {
    val id         = integer("id").autoIncrement()
    val timestamp  = text("timestamp")
    val ip         = text("ip")
    val method     = text("method")
    val path       = text("path")
    val userAgent  = text("user_agent").nullable()
    val body       = text("body").nullable()
    val attackType = text("attack_type").nullable()
    override val primaryKey = PrimaryKey(id)
}

private val log = LoggerFactory.getLogger("com.honeypot.Database")

// core/logger.c 와 db/schema.sql 과 동일한 정의를 유지한다.
private const val CREATE_TABLE_SQL = """
    CREATE TABLE IF NOT EXISTS attack_logs (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp   TEXT    NOT NULL  CHECK (LENGTH(timestamp) <= 32),
        ip          TEXT    NOT NULL  CHECK (LENGTH(ip)        <= 45),
        method      TEXT    NOT NULL  CHECK (LENGTH(method)    <= 7),
        path        TEXT    NOT NULL  CHECK (LENGTH(path)      <= 1024),
        user_agent  TEXT              CHECK (user_agent  IS NULL OR LENGTH(user_agent)  <= 512),
        body        TEXT              CHECK (body        IS NULL OR LENGTH(body)        <= 4096),
        attack_type TEXT              CHECK (attack_type IS NULL OR LENGTH(attack_type) <= 32)
    );
"""

private val MIGRATIONS = listOf(
    "CREATE INDEX IF NOT EXISTS idx_logs_attack_type  ON attack_logs(attack_type);",
    "CREATE INDEX IF NOT EXISTS idx_logs_ip_timestamp ON attack_logs(ip, timestamp);",
    "CREATE INDEX IF NOT EXISTS idx_logs_timestamp    ON attack_logs(timestamp);",
)

/**
 * SQLite 파일 연결 및 스키마 보장.
 *
 * core 모듈(C) 와 같은 DB 파일을 공유하므로 PRAGMA 값(WAL / synchronous=NORMAL /
 * busy_timeout=5000) 을 core/db/sqlite.c 의 값과 일치시켜야 한다. 한쪽이라도 다르면
 * 동시 INSERT(core) ↔ SELECT(api) 상황에서 SQLITE_BUSY 처리가 비대칭해진다.
 * CREATE TABLE / CREATE INDEX 는 IF NOT EXISTS 이므로 idempotent — 매 부팅마다 실행해도 안전.
 * `createMissingTablesAndColumns` 는 빈 데이터 디렉토리로 시작했을 때 컬럼 누락을 잡는 안전망.
 *
 * @param dbPath  SQLite 파일 경로. 디렉토리가 없으면 만들고 진행한다.
 */
fun initDatabase(dbPath: String) {
    File(dbPath).parentFile?.mkdirs()

    Database.connect(
        url = "jdbc:sqlite:$dbPath",
        driver = "org.sqlite.JDBC",
        // 매 connection 마다 PRAGMA 적용. core 모듈과 동일한 값으로 맞춰
        // 동시 쓰기 시 SQLITE_BUSY가 5초까지 대기하도록 한다.
        setupConnection = { conn ->
            conn.createStatement().use { stmt ->
                stmt.execute("PRAGMA journal_mode=WAL;")
                stmt.execute("PRAGMA synchronous=NORMAL;")
                stmt.execute("PRAGMA busy_timeout=5000;")
            }
        }
    )

    transaction {
        exec(CREATE_TABLE_SQL)
        for (sql in MIGRATIONS) {
            exec(sql)
        }
        // 안전망: 빈 환경에서 컬럼 누락 시 보강.
        SchemaUtils.createMissingTablesAndColumns(AttackLogs)
    }
    log.info("database ready: {} (WAL, busy_timeout=5s, indexes=3)", dbPath)
}
