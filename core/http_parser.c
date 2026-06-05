/**
 * @file http_parser.c
 * @brief Raw HTTP/1.x 요청을 HttpRequest 로 채우는 최소 파서.
 *
 * 의존성:
 *   - libc string.h (memchr/memcpy/strncasecmp), strings.h
 *   - memmem(3) — GNU 확장. Makefile 의 -D_GNU_SOURCE 로 활성화한다.
 *
 * 설계 방침:
 *   - 표준 호환 파싱이 아니라 "공격자가 보내는 임의 페이로드도 살아남는"
 *     관용 파싱이 목표다. malformed 입력에도 abort/UB 가 없도록 모든
 *     포인터 산술은 길이 기반(memchr/memmem)으로 한다.
 *   - heap 할당 0회. 모든 출력은 HttpRequest 의 고정 배열에만 쓴다.
 *
 * 입력 예 (이 파서가 다뤄야 하는 모양):
 *   POST /login HTTP/1.1\r\n
 *   Host: 192.168.0.1\r\n
 *   User-Agent: sqlmap/1.7\r\n
 *   \r\n
 *   username=admin'--
 *
 * 함정:
 *   - body 가 없는 GET, header-only, 잘린 요청, 끝에 \r\n 없는 요청
 *     모두 정상적으로 통과해야 한다.
 *   - User-Agent 매칭은 case-insensitive (HTTP 헤더 명 규칙).
 */
#include <stddef.h>
#include <string.h>
#include <strings.h>

#include "honeypot.h"

/**
 * @brief @p src 첫 @p src_len 바이트를 @p dst 에 NUL 종료해 복사한다.
 *        용량 초과 시 안전하게 truncate. dst_size==0 이면 no-op.
 */
static void copy_field(char *dst, size_t dst_size,
                       const char *src, size_t src_len) {
    if (dst_size == 0) return;
    if (src_len >= dst_size) src_len = dst_size - 1;
    memcpy(dst, src, src_len);
    dst[src_len] = '\0';
}

/**
 * @brief 헤더 값 앞쪽의 공백/탭 제거 (HTTP "Field-Value" 의 leading OWS).
 *        포인터/길이를 in-place 로 갱신한다.
 */
static void trim_left(const char **s, size_t *len) {
    while (*len > 0 && (**s == ' ' || **s == '\t')) {
        (*s)++;
        (*len)--;
    }
}

/**
 * @brief HTTP 시작줄 "METHOD SP PATH SP VERSION" 에서 METHOD/PATH 만 추출.
 *        VERSION 은 honeypot 분석에 불필요하므로 버린다.
 */
static void parse_request_line(const char *line, size_t line_len,
                               HttpRequest *req) {
    /* 첫 공백 = METHOD 끝. 없으면 malformed → 조용히 포기. */
    const char *sp1 = memchr(line, ' ', line_len);
    if (!sp1) return;

    size_t method_len = (size_t)(sp1 - line);
    copy_field(req->method, sizeof(req->method), line, method_len);

    const char *path_start = sp1 + 1;
    size_t remain = line_len - (size_t)(path_start - line);
    /* 두 번째 공백이 없으면(=HTTP 버전 누락) 줄 끝까지를 path 로 본다. */
    const char *sp2 = memchr(path_start, ' ', remain);
    size_t path_len = sp2 ? (size_t)(sp2 - path_start) : remain;
    copy_field(req->path, sizeof(req->path), path_start, path_len);
}

/**
 * @brief raw HTTP 요청 바이트열을 파싱해 @p req 의 필드를 채운다.
 *
 * 알고리즘 (단일 패스, allocation 0):
 *   1) 첫 "\r\n\r\n" 위치로 헤더/바디 경계 분리.
 *   2) 첫 "\r\n" 으로 request-line 분리 → method/path 추출.
 *   3) 남은 헤더를 "\r\n" 단위로 순회하며 User-Agent 만 추출.
 *      (Host/Cookie 등은 의도적으로 무시 — DB 컬럼 없음.)
 *   4) body 가 있으면 buf cap 까지 복사.
 *
 * memmem(3) 을 쓰는 이유: HTTP 헤더에 NUL 이 들어올 수 있고
 * (path injection / null-byte 공격), strstr 류는 NUL 에서 멈춰
 * 후속 헤더를 놓친다. memmem 은 길이 기반이라 안전하다.
 *
 * @param raw     recv() 가 채운 바이트열. NUL 종료 불필요.
 * @param raw_len @p raw 의 유효 길이.
 * @param req     [out] 호출자가 memset(0) 후 timestamp/ip 만 채워서 넘긴다.
 */
void http_parse(const char *raw, size_t raw_len, HttpRequest *req) {
    if (!raw || raw_len == 0 || !req) return;

    /* 헤더/바디 경계. 못 찾으면 전부 헤더로 간주하고 body 는 비어 있다. */
    const char *header_end = memmem(raw, raw_len, "\r\n\r\n", 4);
    size_t headers_len = header_end ? (size_t)(header_end - raw) : raw_len;

    const char *body_start = header_end ? header_end + 4 : NULL;
    size_t body_len = body_start ? (raw_len - (size_t)(body_start - raw)) : 0;

    /* request-line = 첫 \r\n 까지. */
    const char *first_line_end = memmem(raw, headers_len, "\r\n", 2);
    size_t first_line_len = first_line_end
        ? (size_t)(first_line_end - raw)
        : headers_len;
    parse_request_line(raw, first_line_len, req);

    /* 두 번째 줄부터 헤더 영역 끝까지 순회. */
    const char *cursor = first_line_end ? first_line_end + 2 : raw + headers_len;
    const char *headers_end_ptr = raw + headers_len;
    while (cursor < headers_end_ptr) {
        const char *next = memmem(cursor,
                                  (size_t)(headers_end_ptr - cursor),
                                  "\r\n", 2);
        size_t hdr_len = next
            ? (size_t)(next - cursor)
            : (size_t)(headers_end_ptr - cursor);

        /* "User-Agent:" 는 11바이트. case-insensitive 비교는 HTTP 명세 요구. */
        if (hdr_len >= 11 && strncasecmp(cursor, "User-Agent:", 11) == 0) {
            const char *val = cursor + 11;
            size_t val_len = hdr_len - 11;
            trim_left(&val, &val_len);
            copy_field(req->user_agent, sizeof(req->user_agent), val, val_len);
        }

        if (!next) break;       /* 마지막 헤더(끝 \r\n 없음)에서 종료. */
        cursor = next + 2;      /* "\r\n" 건너뛰고 다음 헤더로. */
    }

    /* Content-Length 를 신뢰하지 않고 recv 가 준 양만큼만 본다 —
     * truncated body 도 그대로 저장. 분석 단계에서 잘렸음을 판단하면 된다. */
    if (body_start && body_len > 0) {
        copy_field(req->body, sizeof(req->body), body_start, body_len);
    }
}
