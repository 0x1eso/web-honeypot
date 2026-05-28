CC      = gcc
CFLAGS  = -Wall -Wextra -O2 -D_GNU_SOURCE -pthread
LDFLAGS = -lsqlite3 -lpthread
TARGET  = honeypot
SRCS    = main.c server.c http_parser.c logger.c response.c
OBJS    = $(SRCS:.c=.o)

all: $(TARGET)

$(TARGET): $(OBJS)
	$(CC) $(CFLAGS) -o $@ $^ $(LDFLAGS)

%.o: %.c honeypot.h
	$(CC) $(CFLAGS) -c $<

clean:
	rm -f $(OBJS) $(TARGET)

.PHONY: all clean
