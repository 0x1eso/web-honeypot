/* main.c - 진입점. logger 초기화 후 소켓 서버를 블로킹 실행한다. */
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>

#include "honeypot.h"

static void shutdown_handler(int sig) {
    (void)sig;
    /* async-signal-safe만 사용한다 (write/_exit). logger flush는 OS에 맡긴다. */
    const char msg[] = "[honeypot] shutdown signal received\n";
    (void)!write(2, msg, sizeof(msg) - 1);
    _exit(0);
}

int main(void) {
    /* 컨테이너 로그가 라인 단위로 flush 되게 한다 */
    setvbuf(stdout, NULL, _IOLBF, 0);
    setvbuf(stderr, NULL, _IOLBF, 0);

    /* SIGPIPE 무시: client가 일찍 끊을 때 프로세스 죽지 않게 */
    signal(SIGPIPE, SIG_IGN);
    signal(SIGINT,  shutdown_handler);
    signal(SIGTERM, shutdown_handler);

    fprintf(stdout, "[honeypot] starting (port=%d, db=%s)\n", PORT, DB_PATH);
    logger_init(DB_PATH);
    server_start(PORT);   /* blocking */
    logger_shutdown();
    return 0;
}
