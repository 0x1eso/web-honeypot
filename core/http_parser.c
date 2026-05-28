/* http_parser.c - raw HTTP 요청을 HttpRequest 구조체로 채운다.
 *
 * 입력 예:
 *   POST /login HTTP/1.1\r\n
 *   Host: 192.168.0.1\r\n
 *   User-Agent: sqlmap/1.7\r\n
 *   \r\n
 *   username=admin'--
 *
 * 잘린 요청, body 없는 GET, 헤더만 있는 요청도 안전하게 처리한다.
 */
#include <stddef.h>
#include <string.h>
#include <strings.h>

#include "honeypot.h"

static void copy_field(char *dst, size_t dst_size,
                       const char *src, size_t src_len) {
    if (dst_size == 0) return;
    if (src_len >= dst_size) src_len = dst_size - 1;
    memcpy(dst, src, src_len);
    dst[src_len] = '\0';
}

static void trim_left(const char **s, size_t *len) {
    while (*len > 0 && (**s == ' ' || **s == '\t')) {
        (*s)++;
        (*len)--;
    }
}

/* 첫 줄: METHOD SP PATH SP VERSION */
static void parse_request_line(const char *line, size_t line_len,
                               HttpRequest *req) {
    const char *sp1 = memchr(line, ' ', line_len);
    if (!sp1) return;

    size_t method_len = (size_t)(sp1 - line);
    copy_field(req->method, sizeof(req->method), line, method_len);

    const char *path_start = sp1 + 1;
    size_t remain = line_len - (size_t)(path_start - line);
    const char *sp2 = memchr(path_start, ' ', remain);
    size_t path_len = sp2 ? (size_t)(sp2 - path_start) : remain;
    copy_field(req->path, sizeof(req->path), path_start, path_len);
}

void http_parse(const char *raw, size_t raw_len, HttpRequest *req) {
    if (!raw || raw_len == 0 || !req) return;

    /* 헤더/바디 경계: 첫 \r\n\r\n */
    const char *header_end = memmem(raw, raw_len, "\r\n\r\n", 4);
    size_t headers_len = header_end ? (size_t)(header_end - raw) : raw_len;

    const char *body_start = header_end ? header_end + 4 : NULL;
    size_t body_len = body_start ? (raw_len - (size_t)(body_start - raw)) : 0;

    /* 첫 줄 분리 */
    const char *first_line_end = memmem(raw, headers_len, "\r\n", 2);
    size_t first_line_len = first_line_end
        ? (size_t)(first_line_end - raw)
        : headers_len;
    parse_request_line(raw, first_line_len, req);

    /* 나머지 헤더에서 User-Agent 찾기 */
    const char *cursor = first_line_end ? first_line_end + 2 : raw + headers_len;
    const char *headers_end_ptr = raw + headers_len;
    while (cursor < headers_end_ptr) {
        const char *next = memmem(cursor,
                                  (size_t)(headers_end_ptr - cursor),
                                  "\r\n", 2);
        size_t hdr_len = next
            ? (size_t)(next - cursor)
            : (size_t)(headers_end_ptr - cursor);

        if (hdr_len >= 11 && strncasecmp(cursor, "User-Agent:", 11) == 0) {
            const char *val = cursor + 11;
            size_t val_len = hdr_len - 11;
            trim_left(&val, &val_len);
            copy_field(req->user_agent, sizeof(req->user_agent), val, val_len);
        }

        if (!next) break;
        cursor = next + 2;
    }

    if (body_start && body_len > 0) {
        copy_field(req->body, sizeof(req->body), body_start, body_len);
    }
}
