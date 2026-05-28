package com.honeypot

import kotlinx.serialization.Serializable

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

@Serializable
data class LogsResponse(
    val total: Int,
    val logs: List<LogEntry>
)

@Serializable
data class StatsResponse(
    val total: Int,
    val byType: Map<String, Int>
)

@Serializable
data class IpCount(
    val ip: String,
    val count: Int
)

@Serializable
data class HealthResponse(
    val status: String,         // "ok" | "db_unreachable"
    val db: String? = null      // 실패 시 짧은 사유
)
