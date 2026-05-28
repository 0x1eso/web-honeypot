package com.honeypot

import io.ktor.client.call.*
import io.ktor.client.request.*
import io.ktor.http.*
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.jetbrains.exposed.sql.transactions.transaction
import org.junit.jupiter.api.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class RoutingTest {

    // -------------------------------------------------------------------------
    // /healthz
    // -------------------------------------------------------------------------

    @Test
    fun `healthz returns ok with db ok`() = withTestDb { dbPath ->
        runTest {
            withTestApp(dbPath.toString()) { client ->
                val response = client.get("/healthz")
                assertEquals(HttpStatusCode.OK, response.status)

                val body = response.body<HealthResponse>()
                assertEquals("ok", body.status)
                // 성공 응답에서도 db 필드가 "ok" 로 채워져야 한다 (운영 관측성).
                assertEquals("ok", body.db)
            }
        }
    }

    // -------------------------------------------------------------------------
    // GET /api/logs
    // -------------------------------------------------------------------------

    @Test
    fun `logs list returns seeded rows`() = withTestDb { dbPath ->
        runTest {
            transaction { repeat(3) { seedLog(ip = "10.0.0.$it") } }

            withTestApp(dbPath.toString()) { client ->
                val response = client.get("/api/logs?limit=10&offset=0")
                assertEquals(HttpStatusCode.OK, response.status)

                val body = response.body<LogsResponse>()
                assertEquals(3, body.total)
                assertEquals(3, body.logs.size)
            }
        }
    }

    @Test
    fun `logs filter by attack_type via type param`() = withTestDb { dbPath ->
        // NOTE: Routing.kt uses query param "type", not "attack_type"
        runTest {
            transaction {
                seedLog(ip = "1.1.1.1", attackType = "SQLi")
                seedLog(ip = "2.2.2.2", attackType = "XSS")
                seedLog(ip = "3.3.3.3", attackType = null)
            }

            withTestApp(dbPath.toString()) { client ->
                val response = client.get("/api/logs?type=SQLi")
                assertEquals(HttpStatusCode.OK, response.status)

                val body = response.body<LogsResponse>()
                assertEquals(1, body.total)
                assertEquals(1, body.logs.size)
                assertEquals("SQLi", body.logs.first().attackType)
            }
        }
    }

    @Test
    fun `logs pagination returns correct slice`() = withTestDb { dbPath ->
        runTest {
            transaction { repeat(5) { seedLog(ip = "10.0.0.$it") } }

            withTestApp(dbPath.toString()) { client ->
                val response = client.get("/api/logs?limit=2&offset=2")
                assertEquals(HttpStatusCode.OK, response.status)

                val body = response.body<LogsResponse>()
                assertEquals(5, body.total)
                assertEquals(2, body.logs.size)
            }
        }
    }

    @Test
    fun `logs negative offset is clamped to zero`() = withTestDb { dbPath ->
        // Routing.kt: coerceAtLeast(0L) — negative offset treated as 0
        runTest {
            transaction { repeat(2) { seedLog(ip = "10.0.0.$it") } }

            withTestApp(dbPath.toString()) { client ->
                val response = client.get("/api/logs?offset=-5")
                // Must return 200, not 500
                assertEquals(HttpStatusCode.OK, response.status)

                val body = response.body<LogsResponse>()
                assertEquals(2, body.total)
            }
        }
    }

    // -------------------------------------------------------------------------
    // GET /api/stats
    // -------------------------------------------------------------------------

    @Test
    fun `stats returns counts by attack_type excluding nulls`() = withTestDb { dbPath ->
        // Routing.kt: WHERE attack_type IS NOT NULL — null rows excluded from byType
        runTest {
            transaction {
                seedLog(ip = "1.0.0.1", attackType = "SQLi")
                seedLog(ip = "1.0.0.2", attackType = "SQLi")
                seedLog(ip = "1.0.0.3", attackType = "XSS")
                seedLog(ip = "1.0.0.4", attackType = null)
            }

            withTestApp(dbPath.toString()) { client ->
                val response = client.get("/api/stats")
                assertEquals(HttpStatusCode.OK, response.status)

                val body = response.body<StatsResponse>()
                // total includes all 4 rows
                assertEquals(4, body.total)
                // byType only includes non-null attack_type rows
                assertEquals(2, body.byType["SQLi"])
                assertEquals(1, body.byType["XSS"])
                // null row is not in byType
                assertTrue(!body.byType.containsKey("null") && !body.byType.containsKey("기타"))
            }
        }
    }

    // -------------------------------------------------------------------------
    // GET /api/top-ips
    // -------------------------------------------------------------------------

    @Test
    fun `top_ips returns ips sorted by count descending`() = withTestDb { dbPath ->
        runTest {
            transaction {
                repeat(3) { seedLog(ip = "1.1.1.1") }
                repeat(1) { seedLog(ip = "2.2.2.2") }
            }

            withTestApp(dbPath.toString()) { client ->
                val response = client.get("/api/top-ips")
                assertEquals(HttpStatusCode.OK, response.status)

                val body = response.body<List<IpCount>>()
                assertTrue(body.isNotEmpty())
                assertEquals("1.1.1.1", body.first().ip)
                assertEquals(3, body.first().count)
            }
        }
    }
}
