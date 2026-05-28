/* honeypot.h - 공유 헤더 (server/parser/logger/response 모듈 공통) */
#ifndef HONEYPOT_H
#define HONEYPOT_H

#include <stddef.h>

#define DB_PATH  "/data/honeypot.db"
#define PORT     8080
#define BUF_SIZE 8192
#define BACKLOG  64

/* HTTP 요청을 표현하는 고정 크기 구조체. 필드 크기가 곧 입력 cap 역할을 한다. */
typedef struct {
    char timestamp[32];    /* ISO 8601 UTC: "2024-01-01T12:00:00Z" */
    char ip[46];           /* IPv4/IPv6 textual address */
    char method[8];        /* GET / POST / ... */
    char path[1024];
    char user_agent[512];
    char body[4096];
} HttpRequest;

/* server.c */
void server_start(int port);

/* http_parser.c */
void http_parse(const char *raw, size_t raw_len, HttpRequest *req);

/* logger.c */
void logger_init(const char *db_path);
void log_request(const HttpRequest *req);
void logger_shutdown(void);

/* response.c */
void send_fake_response(int client_fd, const char *path);

#endif /* HONEYPOT_H */
