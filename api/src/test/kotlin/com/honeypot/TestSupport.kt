package com.honeypot

import com.honeypot.plugins.configureCors
import com.honeypot.plugins.configureSerialization
import io.ktor.client.*
import io.ktor.client.plugins.contentnegotiation.*
import io.ktor.serialization.kotlinx.json.*
import io.ktor.server.testing.*
import org.jetbrains.exposed.sql.insert
import org.jetbrains.exposed.sql.transactions.transaction
import java.nio.file.Files
import java.nio.file.Path

/**
 * 임시 SQLite 파일을 만들어 [initDatabase] 로 스키마를 깐 뒤 [block] 을 돌리고, finally 에서 파일을 지운다.
 *
 * 각 테스트가 독립된 파일을 잡으므로 병렬 실행 시 데이터 충돌이 없다. Exposed `Database.connect` 는
 * thread-local 컨텍스트라 호출당 새 connection 을 잡지만, 같은 JVM 내에서 마지막 connect 가
 * "기본" 으로 잡히는 부수효과가 있어 테스트 순서에 의존하지 않도록 매 호출 전부 재초기화한다.
 */
fun withTestDb(block: (Path) -> Unit) {
    val path = Files.createTempFile("honeypot-test", ".db")
    try {
        initDatabase(path.toString())
        block(path)
    } finally {
        Files.deleteIfExists(path)
    }
}

/**
 * [AttackLogs] 에 한 행 삽입. 반드시 Exposed [transaction] 또는 newSuspendedTransaction 블록 안에서 호출.
 *
 * 기본값은 분류기에 어떤 패턴으로도 잡히지 않는 중립 값이라, 호출부에서 검증하려는 필드만 override 하면 된다.
 */
fun seedLog(
    ip: String = "1.2.3.4",
    method: String = "GET",
    path: String = "/",
    userAgent: String? = null,
    body: String? = null,
    attackType: String? = null,
    timestamp: String = "2026-01-01T00:00:00.000000000Z",
) {
    AttackLogs.insert {
        it[AttackLogs.ip] = ip
        it[AttackLogs.method] = method
        it[AttackLogs.path] = path
        it[AttackLogs.userAgent] = userAgent
        it[AttackLogs.body] = body
        it[AttackLogs.attackType] = attackType
        it[AttackLogs.timestamp] = timestamp
    }
}

/**
 * [Application.module] 과 동일한 플러그인 스택으로 [testApplication] 을 띄운다 (단, 분류기 백그라운드 루프는 제외).
 *
 * 분류기 루프를 빼는 이유: 라우팅 테스트는 결정적 입력(seedLog 로 직접 라벨 박은 행) 만 검증하므로,
 * 5초 주기로 돌아가는 루프가 테스트 도중 실행되면 race 가 끼어 들어 어설션이 불안정해진다.
 * 분류 로직은 [AttackClassifierTest] 에서 `classifyPending()` 을 직접 호출해 별도 검증.
 */
fun withTestApp(
    dbPath: String,
    block: suspend ApplicationTestBuilder.(client: HttpClient) -> Unit,
) {
    testApplication {
        application {
            initDatabase(dbPath)
            configureSerialization()
            configureCors()
            configureRouting()
        }

        val client = createClient {
            install(ContentNegotiation) {
                json()
            }
        }

        block(client)
    }
}
