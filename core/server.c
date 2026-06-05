/**
 * @file server.c
 * @brief Raw TCP 소켓 기반의 HTTP accept 루프. 연결당 detached 스레드.
 *
 * 의존성:
 *   - POSIX sockets, pthread, clock_gettime / gmtime_r (libc)
 *
 * 동시성 모델:
 *   - thread-per-connection. honeypot 트래픽은 일반적으로 burst 가 짧고
 *     RPS 가 낮아 epoll/io_uring 까지 갈 가치가 없다. 단순함 우선.
 *   - 각 스레드는 detached 라 join 불필요. 종료는 OS 가 정리.
 *
 * 보안 메모:
 *   - SO_RCVTIMEO/SO_SNDTIMEO 5초로 slowloris/slow-read 차단.
 *   - 응답 본문은 모두 정적 문자열 (response.c) → reflection 표면 없음.
 */
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

/**
 * @brief 핸들러 스레드로 넘기는 컨텍스트. main thread 가 malloc, worker 가 free.
 */
typedef struct {
    int  client_fd;       /**< accept() 로 받은 클라이언트 소켓 */
    char client_ip[46];   /**< inet_ntop 결과 (textual) */
} ClientCtx;

/**
 * @brief 현재 시각을 ISO 8601 UTC 문자열로 채운다: "YYYY-MM-DDTHH:MM:SSZ".
 *
 * gmtime_r/clock_gettime 둘 다 실패하면 epoch 문자열로 폴백한다.
 * 로깅은 best-effort 이므로 절대 abort 하지 않는다 — 시간이 틀려도
 * 공격 페이로드 자체는 남겨야 한다.
 */
static void iso8601_utc_now(char *out, size_t out_size) {
    struct timespec ts;
    if (clock_gettime(CLOCK_REALTIME, &ts) != 0) {
        snprintf(out, out_size, "1970-01-01T00:00:00Z");
        return;
    }
    struct tm tm_utc;
    /* gmtime_r: 스레드 안전한 reentrant 버전. gmtime() 은 static 버퍼라 금지. */
    if (!gmtime_r(&ts.tv_sec, &tm_utc)) {
        snprintf(out, out_size, "1970-01-01T00:00:00Z");
        return;
    }
    strftime(out, out_size, "%Y-%m-%dT%H:%M:%SZ", &tm_utc);
}

/**
 * @brief 단일 연결 처리. recv → parse → log → fake response → close.
 *
 * 흐름:
 *   1) 5초 recv/send 타임아웃 설정 (slowloris/slow-read 방어)
 *   2) 1회 recv() — HTTP keep-alive 미지원. honeypot 은 한 번 응답하고 끊는다.
 *   3) http_parse 가 실패해도 method/path 에 기본값을 채워 로그는 남긴다.
 *   4) detached 스레드라 반환값은 무의미.
 *
 * @param arg malloc 된 ClientCtx*. worker 가 free 책임.
 */
static void *handle_client(void *arg) {
    ClientCtx *ctx = (ClientCtx *)arg;
    int fd = ctx->client_fd;

    /* 5초 타임아웃: 슬로우로리스/slow-read 류의 connection 고갈 공격 차단.
     * 정상 클라이언트도 200ms 안에 요청을 다 보내므로 5초는 매우 넉넉. */
    struct timeval tv = { .tv_sec = 5, .tv_usec = 0 };
    setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));
    setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &tv, sizeof(tv));

    char buf[BUF_SIZE];
    /* sizeof(buf) - 1 로 잘라 NUL 종료 공간을 확보한다. */
    ssize_t n = recv(fd, buf, sizeof(buf) - 1, 0);

    HttpRequest req;
    memset(&req, 0, sizeof(req));
    iso8601_utc_now(req.timestamp, sizeof(req.timestamp));
    snprintf(req.ip, sizeof(req.ip), "%s", ctx->client_ip);

    if (n > 0) {
        buf[n] = '\0';   /* 안전 가드: 일부 strstr 류가 NUL 종료를 기대한다. */
        http_parse(buf, (size_t)n, &req);
    }

    /* 빈 요청/파싱 실패 케이스에도 placeholder 를 넣어 DB CHECK 제약을 통과시킨다. */
    if (req.method[0] == '\0') snprintf(req.method, sizeof(req.method), "?");
    if (req.path[0]   == '\0') snprintf(req.path,   sizeof(req.path),   "/");

    log_request(&req);
    send_fake_response(fd, req.path);

    close(fd);
    free(ctx);
    return NULL;
}

/**
 * @brief 리스닝 소켓을 만들고 무한 accept 루프를 돈다. fatal 에서만 exit.
 *
 * 설계 결정:
 *   - SO_REUSEADDR: 컨테이너 재시작 시 TIME_WAIT 으로 bind() 실패하는
 *     상황을 피한다. SO_REUSEPORT 까지 가지 않은 이유는 단일 프로세스라서.
 *   - INADDR_ANY: 0.0.0.0 모든 인터페이스. 컨테이너 네트워크 격리에 의존.
 *   - accept 실패 시 EINTR 만 continue, 나머지는 perror 후 다음 라운드.
 *     (커널 자원 부족 / fd 고갈 같은 일시적 실패에서 죽지 않게.)
 *   - pthread_detach: join 안 함. main 이 worker 종료를 기다리지 않는다.
 */
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
            /* EINTR: 시그널에 의해 깨어남. 정상 재시도. */
            if (errno == EINTR) continue;
            perror("[honeypot] accept");
            continue;
        }

        /* worker thread 의 lifetime > 이 스택 프레임이므로 heap 에 둔다. */
        ClientCtx *ctx = malloc(sizeof(*ctx));
        if (!ctx) {
            /* OOM: 이 연결만 포기하고 다음 accept 로. */
            close(cfd);
            continue;
        }
        ctx->client_fd = cfd;
        inet_ntop(AF_INET, &cli.sin_addr, ctx->client_ip, sizeof(ctx->client_ip));

        pthread_t tid;
        if (pthread_create(&tid, NULL, handle_client, ctx) != 0) {
            /* 스레드 생성 실패: ctx/cfd 누수를 막기 위해 즉시 정리. */
            perror("[honeypot] pthread_create");
            close(cfd);
            free(ctx);
            continue;
        }
        /* detach: join 하지 않고 종료 시 OS 가 정리. fire-and-forget 모델. */
        pthread_detach(tid);
    }
}
