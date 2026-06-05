package com.honeypot

import kotlinx.serialization.Serializable

/**
 * API JSON 응답 DTO 집합.
 *
 * dashboard(React) 와 1:1 로 매칭되는 wire 포맷이라, 필드 추가/이름 변경은 곧 클라이언트 깨짐이다.
 * 모든 클래스는 `kotlinx.serialization` 으로 직렬화되며, nullable 필드는 JSON 에서 `null` 로 그대로
 * 내려간다 (encodeDefaults 기본값 false 의 영향을 받지 않도록 호출부에서 명시 전달).
 */

/** `/api/logs` 응답 한 행. `attackType` 이 null 이면 분류기가 아직 처리하지 않은 상태를 뜻한다. */
@Serializable
data class LogEntry(
    val id: Int,
    val timestamp: String,
    val ip: String,
    val method: String,
    val path: String,
    val userAgent: String?,
    val body: String?,
    val attackType: String?
)

/** `/api/logs` 페이지네이션 응답. `total` 은 필터 적용 후 전체 개수, `logs` 는 현재 페이지 슬라이스. */
@Serializable
data class LogsResponse(
    val total: Int,
    val logs: List<LogEntry>
)

/** `/api/stats` 요약. `total` 은 미분류 포함 전체, `byType` 은 라벨된 행만의 카운트라 합이 다를 수 있다. */
@Serializable
data class StatsResponse(
    val total: Int,
    val byType: Map<String, Int>
)

/** `/api/top-ips` 한 행. */
@Serializable
data class IpCount(
    val ip: String,
    val count: Int
)

/**
 * `/healthz` 응답.
 *
 * `status` 는 `"ok"` 또는 `"db_unreachable"`. `db` 는 운영 관측성을 위해 성공 시에도 `"ok"` 로
 * 채워서 응답만 보고 DB ping 통과 여부를 알 수 있게 한다 (실패 시에는 예외 message 의 짧은 사유).
 */
@Serializable
data class HealthResponse(
    val status: String,
    val db: String? = null
)
