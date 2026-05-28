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
