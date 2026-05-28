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

// GET /healthz - liveness/readiness용. DB ping 성공 시 200, 실패 시 503.
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

// GET /api/logs?limit=100&offset=0&type=SQLi
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

// GET /api/stats
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

// GET /api/top-ips?limit=10
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
