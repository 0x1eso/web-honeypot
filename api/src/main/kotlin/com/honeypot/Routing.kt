package com.honeypot

import io.ktor.http.*
import io.ktor.server.application.*
import io.ktor.server.response.*
import io.ktor.server.routing.*
import kotlinx.coroutines.Dispatchers
import org.jetbrains.exposed.sql.*
import org.jetbrains.exposed.sql.transactions.experimental.newSuspendedTransaction
import org.slf4j.LoggerFactory

private val log = LoggerFactory.getLogger("com.honeypot.Routing")

/**
 * HTTP 엔드포인트 트리 등록.
 *
 * `/healthz` 는 docker-compose healthcheck 와 운영 모니터링에서 직접 호출하므로
 * `/api` prefix 밖에 두고, 데이터 조회용 엔드포인트만 `/api` 그룹에 묶는다.
 * 새 엔드포인트는 가능한 한 `/api` 안에 추가해 dashboard / external 경계가 단순해지도록 한다.
 */
fun Application.configureRouting() {
    routing {
        healthz()
        route("/api") {
            getLogs()
            getStats()
            getTopIps()
        }
    }
}

/**
 * `GET /healthz` — liveness/readiness 프로브.
 *
 * `SELECT 1;` 한 줄로 JDBC 커넥션을 실제로 잡아 보는 데까지 검증한다.
 * 단순 200 OK 가 아니라 DB ping 까지 통과해야만 200 을 돌려주므로, WAL 잠금이나
 * 파일 권한 문제 같은 운영 사고가 healthcheck 단계에서 잡힌다.
 */
private fun Route.healthz() {
    get("/healthz") {
        val ok = runCatching {
            newSuspendedTransaction(Dispatchers.IO) {
                exec("SELECT 1;")
            }
        }
        if (ok.isSuccess) {
            // 성공 시에도 db 필드를 명시적으로 "ok" 로 채워서 운영 관측성에서
            // DB ping 자체가 통과했는지가 응답으로 확인 가능하게 한다.
            // (data class default value 가 kotlinx.serialization 의 encodeDefaults=false 로
            //  드롭되는 함정을 피하기 위해 명시 전달)
            call.respond(HttpStatusCode.OK, HealthResponse(status = "ok", db = "ok"))
        } else {
            val cause = ok.exceptionOrNull()
            log.warn("healthz: DB ping failed", cause)
            call.respond(
                HttpStatusCode.ServiceUnavailable,
                HealthResponse(status = "db_unreachable", db = cause?.message)
            )
        }
    }
}

/**
 * `GET /api/logs?limit&offset&type` — 공격 로그 페이지네이션 조회.
 *
 * limit 은 1..500 으로 clamp 해 한 응답이 무한정 커지지 않도록 한다. offset 은 음수가 와도
 * 500 이 아니라 0 으로 떨어뜨려서 클라이언트 버그가 서버 오류로 번지지 않도록 한다.
 * `type` 이 있으면 count / list 둘 다 동일 WHERE 절을 쓰므로 total 과 실제 페이지가 어긋나지 않는다.
 * 모든 DB 작업은 단일 `newSuspendedTransaction(Dispatchers.IO)` 안에서 수행해 Ktor 의
 * suspend 컨텍스트와 Exposed 의 thread-local 트랜잭션이 충돌하지 않게 한다.
 */
private fun Route.getLogs() {
    get("/logs") {
        val limit = (call.request.queryParameters["limit"]?.toIntOrNull() ?: 100)
            .coerceIn(1, 500)
        val pageOffset = (call.request.queryParameters["offset"]?.toLongOrNull() ?: 0L)
            .coerceAtLeast(0L)
        val type = call.request.queryParameters["type"]

        val result: Pair<Int, List<LogEntry>> = newSuspendedTransaction(Dispatchers.IO) {
            // count와 list는 같은 transaction 안에서도 각자 별도 Query 객체를 사용한다.
            // (Exposed Query는 limit/offset이 내부 상태이므로 재사용 시 함정이 있음)
            val countQuery = if (type != null) {
                AttackLogs.selectAll().where { AttackLogs.attackType eq type }
            } else {
                AttackLogs.selectAll()
            }
            val total = countQuery.count().toInt()

            val listQuery = if (type != null) {
                AttackLogs.selectAll().where { AttackLogs.attackType eq type }
            } else {
                AttackLogs.selectAll()
            }
            val logs = listQuery
                .orderBy(AttackLogs.id, SortOrder.DESC)
                .limit(limit, pageOffset)
                .map { row ->
                    LogEntry(
                        id         = row[AttackLogs.id],
                        timestamp  = row[AttackLogs.timestamp],
                        ip         = row[AttackLogs.ip],
                        method     = row[AttackLogs.method],
                        path       = row[AttackLogs.path],
                        userAgent  = row[AttackLogs.userAgent],
                        body       = row[AttackLogs.body],
                        attackType = row[AttackLogs.attackType]
                    )
                }
            Pair(total, logs)
        }

        call.respond(LogsResponse(total = result.first, logs = result.second))
    }
}

/**
 * `GET /api/stats` — 대시보드 요약 카드용 집계.
 *
 * `total` 은 미분류 행을 포함하지만 `byType` 은 `attack_type IS NOT NULL` 만 카운트한다.
 * 분류기 사이클이 아직 처리하지 못한 행이 "기타" 로 잘못 합쳐지지 않도록 의도적으로 갈라놓은 것.
 */
private fun Route.getStats() {
    get("/stats") {
        val response = newSuspendedTransaction(Dispatchers.IO) {
            val total = AttackLogs.selectAll().count().toInt()

            val countExpr = AttackLogs.id.count()
            val byType = AttackLogs
                .select(AttackLogs.attackType, countExpr)
                .where { AttackLogs.attackType.isNotNull() }
                .groupBy(AttackLogs.attackType)
                .associate { row ->
                    (row[AttackLogs.attackType] ?: "기타") to row[countExpr].toInt()
                }

            StatsResponse(total = total, byType = byType)
        }

        call.respond(response)
    }
}

/**
 * `GET /api/top-ips?limit` — 요청 수 상위 IP 목록.
 *
 * limit 1..100 clamp. GROUP BY ip + COUNT(id) DESC 정렬이라 인덱스 없이도
 * 현재 데이터 볼륨에서 충분히 빠르지만, 장기적으로 idx_logs_ip_timestamp 가
 * 커버하지 못하는 read 패턴이므로 데이터가 커지면 별도 인덱스를 고려한다.
 */
private fun Route.getTopIps() {
    get("/top-ips") {
        val limit = (call.request.queryParameters["limit"]?.toIntOrNull() ?: 10)
            .coerceIn(1, 100)

        val result = newSuspendedTransaction(Dispatchers.IO) {
            val countExpr = AttackLogs.id.count()
            AttackLogs
                .select(AttackLogs.ip, countExpr)
                .groupBy(AttackLogs.ip)
                .orderBy(countExpr, SortOrder.DESC)
                .limit(limit)
                .map { row ->
                    IpCount(
                        ip    = row[AttackLogs.ip],
                        count = row[countExpr].toInt()
                    )
                }
        }

        call.respond(result)
    }
}
