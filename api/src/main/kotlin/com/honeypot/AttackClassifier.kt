package com.honeypot

import kotlinx.coroutines.Dispatchers
import org.jetbrains.exposed.sql.*
import org.jetbrains.exposed.sql.transactions.experimental.newSuspendedTransaction
import org.slf4j.LoggerFactory

/**
 * 공격 분류 정책 (단순 패턴 기반, 저상호작용 honeypot 용)
 *
 *  레이블 집합  : "SQLi" | "XSS" | "스캔" | "브루트포스" | "기타"
 *  처리 단위    : `classifyPending()` 1 사이클당 미분류 행 최대 BATCH_LIMIT(=500) 개.
 *                남은 행은 다음 사이클에서 이어 처리. (Application.kt 의 loop 가 주기 호출)
 *  매칭 우선순위: SQLi → XSS → 스캔 → 브루트포스 → 기타  (먼저 매치되는 순서로 확정)
 *  대소문자     : path/body 모두 lowercase 변환 후 contains 비교.
 *
 *  브루트포스 정책:
 *      - 동일 IP 가 60 초 슬라이딩 윈도우 안에 "로그인성" 경로(login/admin/signin/password 포함)
 *        에 BRUTE_FORCE_THRESHOLD(=10) 회 이상 요청하면 매칭.
 *      - 단일 OR 절 + COUNT 로 한 row 가 두 패턴에 매치되어도 1 회만 카운트 (중복 카운트 없음).
 *      - (ip, timestamp) 인덱스(idx_logs_ip_timestamp)로 풀스캔 회피.
 *      - timestamp 파싱 실패 시 false 반환하고 warn 로그. (분류는 다른 규칙으로 진행)
 *
 *  한계 / 운영 메모:
 *      - 정규식 기반이 아니라 substring contains 라서 false positive 가능 (e.g. 단어 "select" 가
 *        정상 path 에 들어가도 SQLi 로 분류됨). honeypot 특성상 false positive 의 비용보다 false
 *        negative 의 비용이 크다고 판단하여 의도적으로 느슨하게 둔다.
 *      - 패턴 목록 변경은 코드 PR 로만 (DB / env 로 동적 주입 안 함).
 *      - 레이블을 변경하면 dashboard/recharts 및 /api/stats 응답 카테고리 표시가 깨질 수 있으므로
 *        UI 도 함께 갱신할 것.
 */
object AttackClassifier {

    private val log = LoggerFactory.getLogger(AttackClassifier::class.java)

    private val sqliPatterns = listOf(
        "select", "union", "insert", "update", "delete", "drop", "create", "alter",
        "1=1", "1 =1", "' or", "' and", "--", "/*", "*/", "xp_", "exec(",
        "sleep(", "benchmark(", "waitfor"
    )

    private val xssPatterns = listOf(
        "<script", "</script>", "onerror=", "onload=", "onclick=", "onmouseover=",
        "javascript:", "alert(", "document.cookie", "eval(", "<img", "<iframe",
        "<svg", "expression("
    )

    private val scanPaths = listOf(
        "/.env", "/.git", "/.ssh", "/wp-login.php", "/wp-admin", "/phpmyadmin",
        "/admin", "/config", "/backup", "/shell", "/.htaccess", "/etc/passwd",
        "/proc/self", "/actuator", "/.aws", "/xmlrpc.php", "/console",
        "/.DS_Store", "/web.config"
    )

    // 한 사이클당 최대 처리 개수. 남은 미분류 행은 다음 사이클에서 이어 처리된다.
    // (Phase 3에서 더 엄격한 페이지네이션 커서로 다듬을 예정)
    private const val BATCH_LIMIT = 500

    suspend fun classifyPending() {
        newSuspendedTransaction(Dispatchers.IO) {
            val pending = AttackLogs
                .selectAll()
                .where { AttackLogs.attackType.isNull() }
                .orderBy(AttackLogs.id, SortOrder.ASC)
                .limit(BATCH_LIMIT)
                .map { row ->
                    PendingRow(
                        id        = row[AttackLogs.id],
                        ip        = row[AttackLogs.ip],
                        path      = row[AttackLogs.path],
                        body      = row[AttackLogs.body] ?: "",
                        timestamp = row[AttackLogs.timestamp],
                    )
                }

            if (pending.isEmpty()) return@newSuspendedTransaction

            for (row in pending) {
                val attackType = classify(row.ip, row.path, row.body, row.timestamp)
                AttackLogs.update({ AttackLogs.id eq row.id }) {
                    it[AttackLogs.attackType] = attackType
                }
            }
            log.debug("classified {} pending rows", pending.size)
        }
    }

    private data class PendingRow(
        val id: Int,
        val ip: String,
        val path: String,
        val body: String,
        val timestamp: String,
    )

    private fun classify(ip: String, path: String, body: String, timestamp: String): String {
        val pathLower = path.lowercase()
        val bodyLower = body.lowercase()
        val combined  = "$pathLower $bodyLower"

        if (sqliPatterns.any { combined.contains(it) }) return "SQLi"
        if (xssPatterns.any { combined.contains(it) }) return "XSS"
        if (scanPaths.any { pathLower.startsWith(it) || pathLower == it }) return "스캔"
        if (isBruteForce(ip, timestamp)) return "브루트포스"

        return "기타"
    }

    /**
     * 같은 IP가 60초 이내 로그인성 경로에 10회 이상 요청했는지 본다.
     *
     * loginPaths OR 조건을 한 번에 묶어 단일 COUNT 쿼리로 실행한다.
     * 한 row의 path가 두 패턴(예: '/admin/login')에 매치되어도 row 자체는 한 번만 카운트되므로
     * 이전 sumOf 방식의 중복 카운트 위험이 없다.
     * (ip, timestamp) 인덱스로 풀스캔이 사라진다.
     */
    private fun isBruteForce(ip: String, timestamp: String): Boolean {
        return try {
            val instant = java.time.Instant.parse(timestamp)
            val windowStart = instant.minusSeconds(60).toString()

            val count = AttackLogs
                .selectAll().where {
                    (AttackLogs.ip eq ip) and
                    (AttackLogs.timestamp greaterEq windowStart) and
                    (
                        (AttackLogs.path like "%login%") or
                        (AttackLogs.path like "%admin%") or
                        (AttackLogs.path like "%signin%") or
                        (AttackLogs.path like "%password%")
                    )
                }
                .count()
                .toInt()
            count >= BRUTE_FORCE_THRESHOLD
        } catch (e: java.time.format.DateTimeParseException) {
            log.warn("isBruteForce: invalid timestamp '{}' ip={}", timestamp, ip)
            false
        }
    }

    private const val BRUTE_FORCE_THRESHOLD = 10
}
