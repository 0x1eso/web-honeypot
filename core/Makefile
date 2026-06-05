# Makefile — honeypot 코어(C) 빌드 진입점
#
# 산출물: ./honeypot (단일 실행 파일, 정적/동적 링크는 시스템 기본)
# 외부 의존: libsqlite3, libpthread
# 플래그 메모:
#   -D_GNU_SOURCE : http_parser.c 의 memmem(3) (GNU 확장) 활성화
#   -O2           : 가벼운 최적화. 디버깅이 필요하면 -O0 -g 로 교체
#   -pthread      : 컴파일/링크 양쪽에 pthread 환경 설정 (server.c 스레드 모델)
#
# 사용:
#   make           # 빌드
#   make clean     # 산출물 제거

CC      = gcc
CFLAGS  = -Wall -Wextra -O2 -D_GNU_SOURCE -pthread
LDFLAGS = -lsqlite3 -lpthread
TARGET  = honeypot
SRCS    = main.c server.c http_parser.c logger.c response.c
OBJS    = $(SRCS:.c=.o)

all: $(TARGET)

$(TARGET): $(OBJS)
	$(CC) $(CFLAGS) -o $@ $^ $(LDFLAGS)

# honeypot.h 변경 시 전 오브젝트 재빌드 — 헤더가 ABI 단일 진실 공급원이라 의도된 보수성.
%.o: %.c honeypot.h
	$(CC) $(CFLAGS) -c $<

clean:
	rm -f $(OBJS) $(TARGET)

.PHONY: all clean
