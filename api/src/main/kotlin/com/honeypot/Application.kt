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

fun main() {
    embeddedServer(CIO, port = 8081, host = "0.0.0.0", module = Application::module).start(wait = true)
}

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
