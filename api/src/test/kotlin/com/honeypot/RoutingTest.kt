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

    /** 정상 경로에서 `/healthz` 가 200 + `status="ok"` + `db="ok"` 를 모두 채워 응답하는지 가드 (성공 응답에서도 db 필드 명시 전달 결정의 회귀 방지). */
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

    /** seedLog 로 넣은 행 수가 `total` 과 `logs.size` 양쪽에 그대로 반영되는지 확인 (기본 페이지네이션 경로). */
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

    /** `?type=` 쿼리가 count 와 list 양쪽에 동일 WHERE 로 적용돼 total/페이지가 어긋나지 않는지 가드 (쿼리 파라미터 이름이 `attack_type` 이 아니라 `type` 이라는 점도 함께 잠금). */
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

    /** limit/offset 으로 5건 중 슬라이스 2건만 돌려주면서 total 은 5 로 유지하는지 가드. */
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

    /** 음수 offset 이 와도 500 이 아니라 200 으로 첫 페이지를 돌려주는지 가드 (Routing.kt 의 coerceAtLeast(0L) 회귀 방지). */
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

    /** `/api/stats` 가 미분류 행을 `total` 엔 포함하되 `byType` 엔 제외하는지 가드 (`WHERE attack_type IS NOT NULL` 결정 잠금). */
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

    /** `/api/top-ips` 가 COUNT(id) DESC 정렬을 지켜 카운트 큰 IP 가 first() 로 오는지 가드. */
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
