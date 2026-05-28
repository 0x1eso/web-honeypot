-- attack_logs : core(C 모듈)가 INSERT, api(Kotlin 분류기)가 attack_type UPDATE.
-- 길이 CHECK 제약은 core의 HttpRequest 고정 크기 필드와 동일하게 맞춘 것.
-- core/logger.c 와 api/Database.kt 가 같은 CREATE TABLE 정의를 들고 있어야 한다.
CREATE TABLE IF NOT EXISTS attack_logs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp   TEXT    NOT NULL  CHECK (LENGTH(timestamp) <= 32),
    ip          TEXT    NOT NULL  CHECK (LENGTH(ip)        <= 45),
    method      TEXT    NOT NULL  CHECK (LENGTH(method)    <= 7),
    path        TEXT    NOT NULL  CHECK (LENGTH(path)      <= 1024),
    user_agent  TEXT              CHECK (user_agent  IS NULL OR LENGTH(user_agent)  <= 512),
    body        TEXT              CHECK (body        IS NULL OR LENGTH(body)        <= 4096),
    attack_type TEXT              CHECK (attack_type IS NULL OR LENGTH(attack_type) <= 32)
);

-- 분류기/대시보드 쿼리용 인덱스
CREATE INDEX IF NOT EXISTS idx_logs_attack_type  ON attack_logs(attack_type);
CREATE INDEX IF NOT EXISTS idx_logs_ip_timestamp ON attack_logs(ip, timestamp);
CREATE INDEX IF NOT EXISTS idx_logs_timestamp    ON attack_logs(timestamp);

PRAGMA journal_mode=WAL;
