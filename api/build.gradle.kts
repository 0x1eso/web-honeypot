plugins {
    kotlin("jvm") version "2.0.0"
    kotlin("plugin.serialization") version "2.0.0"
    id("io.ktor.plugin") version "2.3.12"
    application
}

group = "com.honeypot"
version = "0.0.1"

application {
    mainClass.set("com.honeypot.ApplicationKt")
}

repositories {
    mavenCentral()
}

dependencies {
    // Ktor server
    implementation("io.ktor:ktor-server-core-jvm")
    implementation("io.ktor:ktor-server-cio-jvm")
    implementation("io.ktor:ktor-server-content-negotiation-jvm")
    implementation("io.ktor:ktor-server-cors-jvm")
    implementation("io.ktor:ktor-serialization-kotlinx-json-jvm")

    // SQLite
    implementation("org.xerial:sqlite-jdbc:3.46.0.0")

    // Exposed ORM
    implementation("org.jetbrains.exposed:exposed-core:0.52.0")
    implementation("org.jetbrains.exposed:exposed-dao:0.52.0")
    implementation("org.jetbrains.exposed:exposed-jdbc:0.52.0")

    // Logging
    implementation("ch.qos.logback:logback-classic:1.5.6")

    // Testing (base entries kept for backward compat; junit5 entries below take precedence)
    testImplementation("io.ktor:ktor-server-test-host-jvm")

    // Extended test dependencies (JUnit 5)
    testImplementation("io.ktor:ktor-server-test-host-jvm:2.3.12")
    testImplementation("io.ktor:ktor-client-content-negotiation:2.3.12")
    testImplementation("io.ktor:ktor-serialization-kotlinx-json:2.3.12")
    testImplementation("org.jetbrains.kotlin:kotlin-test")
    testImplementation("org.jetbrains.kotlin:kotlin-test-junit5")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.8.0")
    testImplementation("org.junit.jupiter:junit-jupiter:5.10.2")
    testRuntimeOnly("org.junit.jupiter:junit-jupiter-engine:5.10.2")
}

tasks.test {
    useJUnitPlatform()
}
