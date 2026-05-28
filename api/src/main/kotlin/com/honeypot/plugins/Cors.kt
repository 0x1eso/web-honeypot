package com.honeypot.plugins

import io.ktor.http.*
import io.ktor.server.application.*
import io.ktor.server.plugins.cors.routing.*
import org.slf4j.LoggerFactory

private val log = LoggerFactory.getLogger("com.honeypot.Cors")

// 기본값: dev (Vite) + Docker dashboard. 운영은 ALLOWED_ORIGINS env로 override.
private const val DEFAULT_ORIGINS = "http://localhost:5173,http://localhost:3000"

fun Application.configureCors() {
    val origins = (System.getenv("ALLOWED_ORIGINS") ?: DEFAULT_ORIGINS)
        .split(",")
        .map { it.trim() }
        .filter { it.isNotEmpty() }

    install(CORS) {
        for (origin in origins) {
            val scheme = when {
                origin.startsWith("https://") -> "https"
                origin.startsWith("http://")  -> "http"
                else                          -> "http"
            }
            val hostPort = origin
                .removePrefix("https://")
                .removePrefix("http://")
                .substringBefore("/")
            allowHost(hostPort, schemes = listOf(scheme))
        }
        allowHeader(HttpHeaders.ContentType)
        allowMethod(HttpMethod.Get)
        allowMethod(HttpMethod.Options)
    }
    log.info("CORS allowed origins: {}", origins)
}
