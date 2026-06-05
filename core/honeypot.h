/**
 * @file honeypot.h
 * @brief 허니팟 코어(C)의 공유 헤더 — 모듈 간 ABI 단일 진실 공급원.
 *
 * 4개 .c 모듈(server / http_parser / logger / response)이 공통으로 사용하는
 * 상수, 자료구조, 함수 시그니처를 모은다. 헤더 자체는 외부 라이브러리에
 * 의존하지 않고 stddef.h(size_t)만 끌어온다. 구현부 .c 에서 sqlite3,
 * pthread, POSIX 소켓 등을 각자 include 하므로, 이 헤더만 본 소비자는
 * libc 외 dependency 없이 컴파일 가능하다.
 *
 * 보안/운영 정책:
 *  - 모든 입력 cap 은 HttpRequest 의 고정 배열 크기로 강제된다. malloc
 *    기반 가변 길이 버퍼를 쓰지 않으므로 일관된 메모리 상한을 보장한다.
 *  - DB_PATH 는 컨테이너 볼륨 마운트 지점(/data)을 가정한다. 로컬 실행
 *    시에는 해당 경로에 쓰기 권한이 필요하다.
 */
#ifndef HONEYPOT_H
#define HONEYPOT_H

#include <stddef.h>

/* SQLite WAL DB 파일 경로. Dockerfile 의 VOLUME /data 와 짝을 이룬다. */
#define DB_PATH  "/data/honeypot.db"
/* 리스닝 포트. Kotlin/Ktor 대시보드(8081)와 충돌하지 않게 8080 고정. */
#define PORT     8080
/* recv() 한 번에 받을 수 있는 raw 요청의 최대 길이. 헤더 + 바디 합산. */
#define BUF_SIZE 8192
/* listen() backlog. 동시 SYN 대기열 깊이. */
#define BACKLOG  64

/**
 * @brief 파싱 결과를 담는 고정 크기 HTTP 요청 컨테이너.
 *
 * 의도적으로 모든 필드를 char[N] 로 둔다:
 *   1) malloc/free 가 없어 누수 가능성 제거
 *   2) 필드 크기 자체가 입력 길이 cap 으로 동작 (DoS 표면 축소)
 *   3) SQLite CHECK 제약(LENGTH(...) <= N)과 1:1 매칭되어
 *      DB 스키마와 C 구조체가 동시에 동일한 상한을 강제한다.
 *
 * 한 가지 trade-off: sizeof(HttpRequest) ≈ 5.7KB 라서 스레드 스택에
 * 올리기에는 적당하지만 글로벌 캐시 라인 단위로 다루기엔 크다.
 * 현재 구조에서는 connection 당 스택 변수로만 쓰이므로 문제없음.
 */
typedef struct {
    char timestamp[32];    /**< ISO 8601 UTC, 예: "2024-01-01T12:00:00Z" */
    char ip[46];           /**< IPv4/IPv6 textual address (INET6_ADDRSTRLEN) */
    char method[8];        /**< GET / POST / PUT / DELETE / ... */
    char path[1024];       /**< 요청 path + query string */
    char user_agent[512];  /**< 헤더에서 추출. 없으면 빈 문자열 */
    char body[4096];       /**< POST/PUT 본문. recv buffer 가 잘리면 truncated */
} HttpRequest;

/* ── server.c ──────────────────────────────────────────────────────────── */

/**
 * @brief 블로킹 accept 루프 시작 (반환하지 않음, 단 fatal 에서 exit).
 * @param port 0 < port < 65536
 */
void server_start(int port);

/* ── http_parser.c ─────────────────────────────────────────────────────── */

/**
 * @brief raw HTTP 요청 바이트열을 파싱해 @p req 를 채운다.
 *
 * 잘린/불완전 요청에도 abort 하지 않고 best-effort 로 채운다.
 *
 * @param raw     recv() 로 받은 바이트열 (NUL 종료 보장 안 됨)
 * @param raw_len @p raw 의 유효 길이
 * @param req     [out] 호출 전 memset(0) 권장. NULL 금지.
 */
void http_parse(const char *raw, size_t raw_len, HttpRequest *req);

/* ── logger.c ──────────────────────────────────────────────────────────── */

/**
 * @brief SQLite DB 를 열고 attack_logs 스키마 + prepared INSERT 를 준비한다.
 *        실패 시 exit(1) (서버 부팅 실패 신호).
 */
void logger_init(const char *db_path);

/**
 * @brief 한 요청을 attack_logs 에 INSERT. 스레드 안전.
 *        DB 미초기화 / NULL 입력 시 silent no-op.
 */
void log_request(const HttpRequest *req);

/**
 * @brief prepared statement finalize + DB close. 이중 호출 안전.
 */
void logger_shutdown(void);

/* ── response.c ────────────────────────────────────────────────────────── */

/**
 * @brief path 패턴에 맞춰 가짜 200 응답을 송신하고 즉시 종료.
 *        외부 입력은 응답 본문에 반영되지 않는다 (XSS reflection 차단).
 */
void send_fake_response(int client_fd, const char *path);

#endif /* HONEYPOT_H */
