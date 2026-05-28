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
 * Creates a temp SQLite DB file, initialises it via [initDatabase], runs [block],
 * and deletes the file in a finally block. Each call is isolated.
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
 * Inserts a single row into [AttackLogs].
 * Must be called inside a Exposed [transaction] or [newSuspendedTransaction] block.
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
 * Launches a [testApplication] wired with the same plugin stack as [Application.module]
 * except the classifier background loop. Passes a JSON-capable [HttpClient] to [block].
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
