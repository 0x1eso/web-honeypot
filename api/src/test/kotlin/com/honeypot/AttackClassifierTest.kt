package com.honeypot

import kotlinx.coroutines.test.runTest
import org.jetbrains.exposed.sql.selectAll
import org.jetbrains.exposed.sql.transactions.transaction
import org.junit.jupiter.api.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull

/**
 * Unit tests for [AttackClassifier.classifyPending].
 *
 * Each test:
 *   1. Creates an isolated temp DB via [withTestDb].
 *   2. Seeds one (or more) rows with attackType = null.
 *   3. Calls [AttackClassifier.classifyPending] inside [runTest].
 *   4. Reads the updated attackType back from the DB and asserts the label.
 *
 * Labels are the actual Korean strings used in AttackClassifier.kt:
 *   "SQLi", "XSS", "스캔", "브루트포스", "기타"
 */
class AttackClassifierTest {

    // -------------------------------------------------------------------------
    // SQLi
    // -------------------------------------------------------------------------

    /** path 의 `union select` substring 이 SQLi 라벨을 우선순위 최상단에서 잡아내는지 가드 (sqliPatterns 매칭 회귀 방지). */
    @Test
    fun `sqli pattern via UNION SELECT in path is classified as SQLi`() = withTestDb { dbPath ->
        runTest {
            transaction {
                seedLog(
                    path = "/?q=' UNION SELECT 1,2--",
                    attackType = null,
                )
            }

            AttackClassifier.classifyPending()

            val label = transaction {
                AttackLogs.selectAll().firstOrNull()?.get(AttackLogs.attackType)
            }
            assertEquals("SQLi", label)
        }
    }

    // -------------------------------------------------------------------------
    // XSS
    // -------------------------------------------------------------------------

    /** body 의 `<script` 가 XSS 로 잡히는지 가드 — path 가 아닌 body 도 검사 대상이라는 결정(`"$pathLower $bodyLower"` 결합) 의 잠금. */
    @Test
    fun `xss pattern via script tag in body is classified as XSS`() = withTestDb { dbPath ->
        runTest {
            transaction {
                seedLog(
                    body = "<script>alert(1)</script>",
                    attackType = null,
                )
            }

            AttackClassifier.classifyPending()

            val label = transaction {
                AttackLogs.selectAll().firstOrNull()?.get(AttackLogs.attackType)
            }
            assertEquals("XSS", label)
        }
    }

    // -------------------------------------------------------------------------
    // Scan
    // -------------------------------------------------------------------------

    /** `/.env` 같은 scanPaths 항목이 한국어 라벨 "스캔" 으로 분류되는지 가드 (라벨 문자열 변경 시 dashboard 표시도 같이 깨지므로 회귀 잠금). */
    @Test
    fun `scan pattern via dot-env path is classified as scan`() = withTestDb { dbPath ->
        runTest {
            transaction {
                seedLog(
                    path = "/.env",
                    attackType = null,
                )
            }

            AttackClassifier.classifyPending()

            val label = transaction {
                AttackLogs.selectAll().firstOrNull()?.get(AttackLogs.attackType)
            }
            // AttackClassifier returns "스캔" for scan paths
            assertEquals("스캔", label)
        }
    }

    // -------------------------------------------------------------------------
    // Brute force
    // -------------------------------------------------------------------------

    /** 같은 IP 가 60초 윈도우 안에 로그인성 경로로 BRUTE_FORCE_THRESHOLD(=10) 회 이상 찍으면 "브루트포스" 로 분류되는지 가드 (단일 OR 쿼리로 row 중복 카운트 없이 임계치 도달 결정 잠금). */
    @Test
    fun `brute force pattern via repeated login requests is classified as brute force`() =
        withTestDb { dbPath ->
            runTest {
                // isBruteForce checks: same IP, path contains %login%, within 60 seconds,
                // count >= BRUTE_FORCE_THRESHOLD (10). Seed 15 rows all within the same second.
                val ts = "2026-06-01T12:00:00Z"
                transaction {
                    repeat(15) {
                        seedLog(
                            ip = "9.9.9.9",
                            path = "/login",
                            timestamp = ts,
                            attackType = null,
                        )
                    }
                }

                AttackClassifier.classifyPending()

                // All rows for that IP on /login must be classified as brute force
                val labels = transaction {
                    AttackLogs.selectAll().map { it[AttackLogs.attackType] }
                }
                assertNotNull(labels.firstOrNull())
                labels.forEach { label ->
                    assertEquals("브루트포스", label)
                }
            }
        }

    // -------------------------------------------------------------------------
    // No match → fallback
    // -------------------------------------------------------------------------

    /** 어느 패턴에도 안 걸리는 평범한 요청이 fallback "기타" 라벨로 떨어지는지 가드 (분류기가 NULL 을 남겨두지 않는다는 결정 잠금). */
    @Test
    fun `no pattern match results in fallback label 기타`() = withTestDb { dbPath ->
        runTest {
            transaction {
                seedLog(
                    path = "/about",
                    body = null,
                    attackType = null,
                )
            }

            AttackClassifier.classifyPending()

            val label = transaction {
                AttackLogs.selectAll().firstOrNull()?.get(AttackLogs.attackType)
            }
            // AttackClassifier fallback is "기타"
            assertEquals("기타", label)
        }
    }
}
