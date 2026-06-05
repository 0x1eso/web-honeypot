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
    // Ktor 서버: core(공통) + CIO 엔진(코루틴 친화, Netty 보다 가벼움) + JSON 직렬화/CORS 플러그인.
    // ktor BOM 이 io.ktor.plugin 에 의해 잡혀 있어 server 모듈은 버전 생략 가능.
    implementation("io.ktor:ktor-server-core-jvm")
    implementation("io.ktor:ktor-server-cio-jvm")
    implementation("io.ktor:ktor-server-content-negotiation-jvm")
    implementation("io.ktor:ktor-server-cors-jvm")
    implementation("io.ktor:ktor-serialization-kotlinx-json-jvm")

    // SQLite JDBC: core 모듈이 쓰는 SQLite 파일을 같은 포맷으로 열기 위함. WAL/busy_timeout 은 런타임에서 PRAGMA.
    implementation("org.xerial:sqlite-jdbc:3.46.0.0")

    // Exposed ORM: SQL DSL + 트랜잭션 관리. dao 는 직접 안 쓰지만 jdbc 모듈이 의존성 그래프상 필요로 한다.
    implementation("org.jetbrains.exposed:exposed-core:0.52.0")
    implementation("org.jetbrains.exposed:exposed-dao:0.52.0")
    implementation("org.jetbrains.exposed:exposed-jdbc:0.52.0")

    // Logback: logback.xml 의 console appender 와 모듈별 logger level 을 구동.
    implementation("ch.qos.logback:logback-classic:1.5.6")

    // 테스트: Ktor testApplication 호스트. 명시 버전과 같이 적힌 아래 줄이 우선이지만,
    // BOM 만으로 잡히는 베이스 라인을 유지하기 위해 버전 없는 줄도 같이 남겨둔다 (호환성 보험).
    testImplementation("io.ktor:ktor-server-test-host-jvm")

    // 확장 테스트 셋: JSON 디코드(client content-negotiation + json), kotlin-test, JUnit 5, coroutines-test.
    // runTest 가 coroutines-test, useJUnitPlatform 이 junit-jupiter-engine 에 의존한다.
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
