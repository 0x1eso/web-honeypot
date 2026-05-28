/* server.c - raw socket HTTP 서버. accept 루프 + 연결당 스레드. */
#include <arpa/inet.h>
#include <errno.h>
#include <netinet/in.h>
#include <pthread.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/time.h>
#include <time.h>
#include <unistd.h>

#include "honeypot.h"

typedef struct {
    int  client_fd;
    char client_ip[46];
} ClientCtx;

/* ISO 8601 UTC: "YYYY-MM-DDTHH:MM:SSZ" 형식으로 현재 시각 기록 */
static void iso8601_utc_now(char *out, size_t out_size) {
    struct timespec ts;
    if (clock_gettime(CLOCK_REALTIME, &ts) != 0) {
        snprintf(out, out_size, "1970-01-01T00:00:00Z");
        return;
    }
    struct tm tm_utc;
    if (!gmtime_r(&ts.tv_sec, &tm_utc)) {
        snprintf(out, out_size, "1970-01-01T00:00:00Z");
        return;
    }
    strftime(out, out_size, "%Y-%m-%dT%H:%M:%SZ", &tm_utc);
}

static void *handle_client(void *arg) {
    ClientCtx *ctx = (ClientCtx *)arg;
    int fd = ctx->client_fd;

    /* recv/send 타임아웃: 슬로우로리스 류 방지 */
    struct timeval tv = { .tv_sec = 5, .tv_usec = 0 };
    setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));
    setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &tv, sizeof(tv));

    char buf[BUF_SIZE];
    ssize_t n = recv(fd, buf, sizeof(buf) - 1, 0);

    HttpRequest req;
    memset(&req, 0, sizeof(req));
    iso8601_utc_now(req.timestamp, sizeof(req.timestamp));
    snprintf(req.ip, sizeof(req.ip), "%s", ctx->client_ip);

    if (n > 0) {
        buf[n] = '\0';
        http_parse(buf, (size_t)n, &req);
    }

    /* 파싱이 실패해도 로그는 남긴다. */
    if (req.method[0] == '\0') snprintf(req.method, sizeof(req.method), "?");
    if (req.path[0]   == '\0') snprintf(req.path,   sizeof(req.path),   "/");

    log_request(&req);
    send_fake_response(fd, req.path);

    close(fd);
    free(ctx);
    return NULL;
}

void server_start(int port) {
    int srv = socket(AF_INET, SOCK_STREAM, 0);
    if (srv < 0) {
        perror("[honeypot] socket");
        exit(1);
    }

    int one = 1;
    setsockopt(srv, SOL_SOCKET, SO_REUSEADDR, &one, sizeof(one));

    struct sockaddr_in addr;
    memset(&addr, 0, sizeof(addr));
    addr.sin_family      = AF_INET;
    addr.sin_addr.s_addr = htonl(INADDR_ANY);
    addr.sin_port        = htons((uint16_t)port);

    if (bind(srv, (struct sockaddr *)&addr, sizeof(addr)) < 0) {
        perror("[honeypot] bind");
        exit(1);
    }
    if (listen(srv, BACKLOG) < 0) {
        perror("[honeypot] listen");
        exit(1);
    }

    fprintf(stdout, "[honeypot] listening on 0.0.0.0:%d\n", port);

    for (;;) {
        struct sockaddr_in cli;
        socklen_t cli_len = sizeof(cli);
        int cfd = accept(srv, (struct sockaddr *)&cli, &cli_len);
        if (cfd < 0) {
            if (errno == EINTR) continue;
            perror("[honeypot] accept");
            continue;
        }

        ClientCtx *ctx = malloc(sizeof(*ctx));
        if (!ctx) {
            close(cfd);
            continue;
        }
        ctx->client_fd = cfd;
        inet_ntop(AF_INET, &cli.sin_addr, ctx->client_ip, sizeof(ctx->client_ip));

        pthread_t tid;
        if (pthread_create(&tid, NULL, handle_client, ctx) != 0) {
            perror("[honeypot] pthread_create");
            close(cfd);
            free(ctx);
            continue;
        }
        pthread_detach(tid);
    }
}
