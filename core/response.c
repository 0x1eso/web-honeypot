/* response.c - 가짜 응답. 공격자가 진짜 취약 서버로 믿게 만드는 게 목적이다.
 *
 * 페이로드는 모두 정적 문자열이라 외부 입력이 응답에 반영되지 않는다.
 * (XSS reflection / 명령어 주입 표면 차단)
 */
#include <stddef.h>
#include <stdio.h>
#include <string.h>
#include <sys/socket.h>
#include <unistd.h>

#include "honeypot.h"

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

static const char *WP_BODY =
    "<!doctype html>\n"
    "<html><head><title>Log In &lsaquo; WordPress</title></head>"
    "<body class=\"login\"><div id=\"login\"><h1>WordPress</h1>"
    "<form name=\"loginform\" action=\"/wp-login.php\" method=\"POST\">"
    "<label>Username <input name=\"log\"></label>"
    "<label>Password <input type=\"password\" name=\"pwd\"></label>"
    "<button type=\"submit\">Log In</button>"
    "</form></div></body></html>\n";

/* 미끼 값. 실제 서비스/계정에서 사용되지 않는 문자열만 노출한다. */
static const char *ENV_BODY =
    "APP_ENV=production\n"
    "APP_DEBUG=false\n"
    "DB_CONNECTION=mysql\n"
    "DB_HOST=127.0.0.1\n"
    "DB_PORT=3306\n"
    "DB_DATABASE=app\n"
    "DB_USERNAME=app\n"
    "DB_PASSWORD=decoy-not-real-please-ignore\n";

/* 알 수 없는 경로에 대한 catch-all 응답.
 * honeypot 은 attacker 가 "취약한 진짜 서버"로 믿게 만드는 게 목적이라
 * unknown path 도 404 가 아니라 200 + 일반적인 default 페이지로 응답한다.
 * (404 를 받은 scanner 는 빨리 떠나버려서 후속 페이로드 수집 기회가 줄어든다.) */
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

static void send_all(int fd, const char *data, size_t len) {
    size_t sent = 0;
    while (sent < len) {
        ssize_t n = send(fd, data + sent, len - sent, MSG_NOSIGNAL);
        if (n <= 0) return;
        sent += (size_t)n;
    }
}

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

void send_fake_response(int fd, const char *path) {
    /* path 가 비었거나 NULL 이어도 default 페이지로 응답한다 (200).
     * 정책: honeypot 은 가능한 모든 요청에 그럴듯한 200 을 돌려준다. */
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

    /* catch-all: 모든 unknown path 도 200 default 페이지로 응답. */
    respond(fd, "200 OK", "text/html; charset=utf-8", DEFAULT_BODY);
}
