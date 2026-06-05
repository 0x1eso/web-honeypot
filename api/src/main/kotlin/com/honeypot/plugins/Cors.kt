package com.honeypot.plugins

import io.ktor.http.*
import io.ktor.server.application.*
import io.ktor.server.plugins.cors.routing.*
import org.slf4j.LoggerFactory

private val log = LoggerFactory.getLogger("com.honeypot.Cors")

// 기본값: dev (Vite) + Docker dashboard. 운영은 ALLOWED_ORIGINS env로 override.
private const val DEFAULT_ORIGINS = "http://localhost:5173,http://localhost:3000"

/**
 * CORS 화이트리스트 설정.
 *
 * `ALLOWED_ORIGINS` env 가 콤마 구분 origin 리스트를 받는다. 파싱은 의도적으로 lenient —
 * trim 후 빈 항목은 버려서 운영자가 실수로 trailing comma 를 넣어도 부팅이 막히지 않는다.
 * 각 origin 의 scheme(http/https) 을 분리해 Ktor `allowHost` 에 넘기는 이유는, 같은 hostPort 라도
 * scheme 가 다르면 CORS 상 다른 origin 이기 때문이다 (`https://app` ≠ `http://app`).
 * 허용 메서드는 GET + OPTIONS 만 — 본 API 는 read-only 이므로 의도적으로 좁혀 둔다.
 */
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
