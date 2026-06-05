/**
 * @file response.c
 * @brief 가짜 HTTP 응답 생성기. "취약한 진짜 서버"로 위장한다.
 *
 * 의존성:
 *   - POSIX send(2), libc string.h / stdio.h
 *
 * 디자인 철학:
 *   - 모든 응답 본문은 컴파일 타임 상수 (static const char *).
 *     외부 입력이 응답에 단 한 글자도 반영되지 않으므로 reflection 기반
 *     XSS / SSRF / command injection 표면이 구조적으로 0이다.
 *   - 알 수 없는 path 도 404 가 아닌 200 "Apache default" 페이지로 응답한다.
 *     스캐너가 빠르게 떠나지 않고 후속 페이로드를 던지도록 유도하기 위함.
 *   - Server 헤더는 "Apache/2.4.41 (Ubuntu)" 로 위장. Nmap/스캐너의
 *     fingerprint 매칭을 끌어들이는 미끼.
 *
 * 함정:
 *   - path 매칭은 strstr 기반 substring 매치다. 정확한 라우팅이 아니라
 *     "/wp-admin?x=1" 같은 변형까지 폭넓게 잡으려는 의도. 의도된 동작.
 */
#include <stddef.h>
#include <stdio.h>
#include <string.h>
#include <sys/socket.h>
#include <unistd.h>

#include "honeypot.h"

/* 평범한 관리자 로그인 폼. autofocus 까지 넣어 진짜처럼 보이게. */
static const char *LOGIN_BODY =
    "<!doctype html>\n"
    "<html><head><meta charset=\"utf-8\">"
    "<title>Sign in</title></head>"
    "<body><h2>Administrator Login</h2>"
    "<form method=\"POST\" action=\"/login\">"
    "<label>Username <input name=\"username\" autofocus></label><br>"
    "<label>Password <input type=\"password\" name=\"password\"></label><br>"
    "<button type=\"submit\">Sign in</button>"
    "</form></body></html>\n";

/* WordPress wp-login.php 클론. 봇들이 wp-admin 을 끊임없이 두드리므로 별도 미끼. */
static const char *WP_BODY =
    "<!doctype html>\n"
    "<html><head><title>Log In &lsaquo; WordPress</title></head>"
    "<body class=\"login\"><div id=\"login\"><h1>WordPress</h1>"
    "<form name=\"loginform\" action=\"/wp-login.php\" method=\"POST\">"
    "<label>Username <input name=\"log\"></label>"
    "<label>Password <input type=\"password\" name=\"pwd\"></label>"
    "<button type=\"submit\">Log In</button>"
    "</form></div></body></html>\n";

/* 가짜 .env 노출. 자격증명/호스트는 의도적으로 실제 서비스에서 쓰이지 않는
 * 미끼 값만 둔다. attacker 가 이 값으로 실제 시스템에 접속을 시도하면 즉시
 * "decoy 사용 시도" 로 분류 가능. */
static const char *ENV_BODY =
    "APP_ENV=production\n"
    "APP_DEBUG=false\n"
    "DB_CONNECTION=mysql\n"
    "DB_HOST=127.0.0.1\n"
    "DB_PORT=3306\n"
    "DB_DATABASE=app\n"
    "DB_USERNAME=app\n"
    "DB_PASSWORD=decoy-not-real-please-ignore\n";

/* catch-all 응답: Ubuntu Apache 의 친숙한 기본 페이지를 모사.
 * 정책 — 404 를 받은 scanner 는 빨리 떠나버려서 후속 페이로드 수집 기회가
 * 줄어든다. 모든 unknown path 도 200 + 그럴듯한 페이지로 응답해 체류시간을
 * 늘리고 더 많은 페이로드를 수집한다. */
static const char *DEFAULT_BODY =
    "<!doctype html>\n"
    "<html><head><meta charset=\"utf-8\">"
    "<title>Apache2 Ubuntu Default Page: It works</title></head>"
    "<body><h1>Apache2 Ubuntu Default Page</h1>"
    "<p>It works! This is the default welcome page used to test the correct "
    "operation of the Apache2 server after installation on Ubuntu systems.</p>"
    "<p>If you are a normal user of this web site and don't know what this page "
    "is about, this probably means that the site is currently unavailable due "
    "to maintenance.</p>"
    "</body></html>\n";

/**
 * @brief send(2) 가 부분 송신할 수 있으므로 전체가 빠질 때까지 루프.
 *        MSG_NOSIGNAL: 끊긴 소켓에 쓸 때 SIGPIPE 대신 EPIPE 반환.
 *        (main.c 의 signal(SIGPIPE, SIG_IGN) 과 이중 방어.)
 *        실패 시 즉시 반환 — 어차피 끊긴 연결, 재시도 의미 없음.
 */
static void send_all(int fd, const char *data, size_t len) {
    size_t sent = 0;
    while (sent < len) {
        ssize_t n = send(fd, data + sent, len - sent, MSG_NOSIGNAL);
        if (n <= 0) return;
        sent += (size_t)n;
    }
}

/**
 * @brief HTTP/1.1 응답 헤더 + body 송신.
 *
 * Connection: close 로 keep-alive 를 끊는다 — honeypot 은 한 응답 후 끊는
 * 단순 모델이라 server.c 의 close(fd) 와 짝을 이룬다.
 *
 * 헤더 버퍼는 512B 스택. 정상 케이스에서는 ~140B 정도라 충분히 여유.
 * snprintf 가 실패(<0) 하면 응답을 통째로 포기.
 */
static void respond(int fd, const char *status,
                    const char *ctype, const char *body) {
    char header[512];
    int header_len = snprintf(header, sizeof(header),
        "HTTP/1.1 %s\r\n"
        "Server: Apache/2.4.41 (Ubuntu)\r\n"
        "Content-Type: %s\r\n"
        "Content-Length: %zu\r\n"
        "Connection: close\r\n"
        "\r\n",
        status, ctype, strlen(body));
    if (header_len <= 0) return;
    send_all(fd, header, (size_t)header_len);
    send_all(fd, body, strlen(body));
}

/**
 * @brief @p path 패턴에 맞춰 가짜 200 응답을 송신.
 *
 * 라우팅 우선순위 (먼저 매칭되는 첫 분기 채택):
 *   1) NULL / 빈 path → default 페이지
 *   2) ".env" 가 path 에 포함 → 가짜 환경 변수 미끼
 *   3) "wp-login" 또는 "wp-admin" → WordPress 로그인 미끼
 *   4) "admin" / "login" / "signin" → 일반 관리자 로그인 미끼
 *   5) 그 외 모든 path → Apache default 페이지 (catch-all 200)
 *
 * 정책 — honeypot 은 가능한 모든 요청에 그럴듯한 200 을 돌려준다.
 * 결과 분류(SQLi/XSS/Recon/...)는 Kotlin 분류기가 DB 의 path/body 컬럼을
 * 보고 후속 단계에서 attack_type 으로 UPDATE 한다.
 */
void send_fake_response(int fd, const char *path) {
    if (!path || !*path) {
        respond(fd, "200 OK", "text/html; charset=utf-8", DEFAULT_BODY);
        return;
    }

    if (strstr(path, "/.env")) {
        respond(fd, "200 OK", "text/plain; charset=utf-8", ENV_BODY);
        return;
    }
    if (strstr(path, "wp-login") || strstr(path, "wp-admin")) {
        respond(fd, "200 OK", "text/html; charset=utf-8", WP_BODY);
        return;
    }
    if (strstr(path, "admin") || strstr(path, "login") || strstr(path, "signin")) {
        respond(fd, "200 OK", "text/html; charset=utf-8", LOGIN_BODY);
        return;
    }

    /* catch-all: 모든 unknown path 도 200 default 페이지로 응답.
     * 404 가 아니라 200 인 이유는 파일 상단 주석 참고. */
    respond(fd, "200 OK", "text/html; charset=utf-8", DEFAULT_BODY);
}
