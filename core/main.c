/**
 * @file main.c
 * @brief 프로세스 진입점. 시그널 핸들러 등록 → logger init → server loop.
 *
 * 의존성:
 *   - POSIX signal(2), unistd write(2), stdio setvbuf(3)
 *
 * 설계 의도:
 *   - 컨테이너(PID 1) 로 직접 실행되는 경우를 가정. SIGTERM 으로
 *     graceful shutdown 신호를 받고, SIGINT 는 개발 중 Ctrl+C 용.
 *   - 로그 라인을 즉시 보고 싶어서 stdout/stderr 를 line-buffered 로 강제.
 *     기본 fully-buffered 면 docker logs 가 종료 시점까지 묶여 나온다.
 */
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>

#include "honeypot.h"

/**
 * @brief SIGINT/SIGTERM 핸들러. async-signal-safe 한 호출만 사용한다.
 *
 * signal-safe 규칙: fprintf/exit 는 금지(내부 락/atexit 호출). 대신
 * write(2) + _exit(2) 만 호출한다. logger_shutdown() 도 mutex 를 잡으니
 * 핸들러에서 직접 부르지 않는다 — 어차피 프로세스 종료 시 OS 가 fd 를
 * 회수해 SQLite WAL 도 다음 부팅에서 자동 복구된다.
 */
static void shutdown_handler(int sig) {
    (void)sig;
    const char msg[] = "[honeypot] shutdown signal received\n";
    /* write() 반환값을 명시적으로 폐기. (void)! 패턴은 -Wunused-result 우회. */
    (void)!write(2, msg, sizeof(msg) - 1);
    _exit(0);
}

int main(void) {
    /* line-buffered: 라인 단위로 flush 되어 docker/journald 로그가 실시간으로 보임. */
    setvbuf(stdout, NULL, _IOLBF, 0);
    setvbuf(stderr, NULL, _IOLBF, 0);

    /* SIGPIPE 무시: 클라이언트가 send() 중간에 끊으면 EPIPE 만 받고 살아남는다.
     * 기본 동작(프로세스 종료)은 honeypot 처럼 다수 short-lived 커넥션을
     * 다루는 서버에서 치명적이다. send() 쪽 MSG_NOSIGNAL 과 이중 방어. */
    signal(SIGPIPE, SIG_IGN);
    signal(SIGINT,  shutdown_handler);
    signal(SIGTERM, shutdown_handler);

    fprintf(stdout, "[honeypot] starting (port=%d, db=%s)\n", PORT, DB_PATH);
    logger_init(DB_PATH);
    server_start(PORT);   /* 블로킹: accept 루프. 정상 경로에서는 반환하지 않음. */
    logger_shutdown();    /* server_start 가 반환하는 경로(미래 확장)를 위한 cleanup. */
    return 0;
}
