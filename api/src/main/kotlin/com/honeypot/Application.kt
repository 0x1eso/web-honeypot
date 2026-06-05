package com.honeypot

import com.honeypot.plugins.configureCors
import com.honeypot.plugins.configureSerialization
import io.ktor.server.application.*
import io.ktor.server.cio.*
import io.ktor.server.engine.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineName
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.slf4j.LoggerFactory

private val log = LoggerFactory.getLogger("com.honeypot.AttackClassifierLoop")

/**
 * API 프로세스 엔트리 포인트.
 *
 * Ktor CIO 엔진을 0.0.0.0:8081 에 바인딩한다. core/logger.c 가 같은 SQLite 파일에
 * 쓰는 동안 본 프로세스는 read + classify 용도로 동시에 접근하므로, DB 초기화 시
 * WAL 모드 활성화(Database.kt)가 전제 조건이다.
 */
fun main() {
    embeddedServer(CIO, port = 8081, host = "0.0.0.0", module = Application::module).start(wait = true)
}

/**
 * Ktor Application 부트스트랩.
 *
 * 초기화 순서가 중요하다: DB → 직렬화 → CORS → 라우팅 → 분류기 루프.
 * 라우팅 핸들러가 분류 결과를 읽으므로, DB 가 준비된 뒤에야 핸들러를 install 한다.
 * DB_PATH env 가 없으면 core 모듈과 동일한 기본 경로(`./data/honeypot.db`) 를 사용한다.
 */
fun Application.module() {
    val dbPath = System.getenv("DB_PATH") ?: "./data/honeypot.db"

    initDatabase(dbPath)
    configureSerialization()
    configureCors()
    configureRouting()

    startClassifierLoop()
}

/**
 * 분류기 백그라운드 루프.
 *
 * SupervisorJob으로 격리해 한 사이클 실패가 전체 Application scope를 무너뜨리지 않게 한다.
 * ApplicationStopping 이벤트에서 cancel 하여 graceful shutdown.
 */
private fun Application.startClassifierLoop() {
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO + CoroutineName("AttackClassifier"))

    environment.monitor.subscribe(ApplicationStopping) {
        log.info("ApplicationStopping → classifier scope cancel")
        scope.cancel()
    }

    scope.launch {
        log.info("classifier loop start (interval=5s)")
        while (isActive) {
            try {
                AttackClassifier.classifyPending()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                log.warn("classifyPending failed: {}", e.message, e)
            }
            delay(5_000)
        }
        log.info("classifier loop exit")
    }
}
