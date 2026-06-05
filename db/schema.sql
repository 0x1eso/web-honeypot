-- =============================================================================
-- attack_logs : honeypot 의 단일 진실원(single source of truth) 테이블.
-- =============================================================================
-- 2-phase write 패턴:
--   (1) core (C raw-socket 서버) 가 요청을 받자마자 raw 로그를 INSERT.
--       이때 attack_type 은 NULL — 분류는 동기 경로에서 하지 않는다.
--       (왜? core 는 응답 지연을 최소화해야 attacker 가 의심하지 않음.)
--   (2) api (Kotlin/Ktor 분류기 루프) 가 NULL row 를 주기적으로 가져와
--       AttackClassifier 결과로 attack_type 컬럼만 UPDATE.
--
-- 길이 CHECK 제약은 core/honeypot.h 의 HttpRequest 고정 크기 필드와 동일.
-- → 양쪽이 일치해야 core 에서 잘린 입력이 DB CHECK 에 안 걸려서 사일런트 drop 되는 일이 없음.
-- → core/logger.c 와 api/Database.kt 가 같은 CREATE TABLE 문자열을 들고 있으니
--    이 파일을 수정하면 그쪽 두 곳도 같이 수정.
CREATE TABLE IF NOT EXISTS attack_logs (
    -- AUTOINCREMENT: 삭제된 id 재사용 금지 → 외부에서 id 참조 시 안전 (감사 추적 용도).
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    -- timestamp: ISO 8601 UTC ("YYYY-MM-DDTHH:MM:SSZ"), core 가 INSERT 시점에 strftime 으로 생성.
    --   32 = ISO 8601 + microseconds + timezone 여유분. 실제 사용은 20자.
    timestamp   TEXT    NOT NULL  CHECK (LENGTH(timestamp) <= 32),
    -- ip: IPv4("xxx.xxx.xxx.xxx" 15자) + IPv6("...%scope" 최대 45자) 둘 다 수용.
    --   INET_ADDRSTRLEN(16) 과 INET6_ADDRSTRLEN(46) 의 표준값 기준.
    ip          TEXT    NOT NULL  CHECK (LENGTH(ip)        <= 45),
    -- method: HTTP 표준 메소드 최장 = "CONNECT"(7자). 비표준 verb 는 core 파서가 reject.
    method      TEXT    NOT NULL  CHECK (LENGTH(method)    <= 7),
    -- path: 1024 = nginx/apache 의 기본 request URI 한도와 동급.
    --   honeypot 특성상 비정상 긴 path(LFI/RFI 탐지용) 도 살리되 비현실적 거대 입력은 컷.
    path        TEXT    NOT NULL  CHECK (LENGTH(path)      <= 1024),
    -- user_agent: 512 = 실 환경 User-Agent 헤더 P99 길이 기준 + 여유.
    --   NULL 허용: 헤더 누락 요청(스캐너) 도 그대로 기록해야 분류 신호로 활용.
    user_agent  TEXT              CHECK (user_agent  IS NULL OR LENGTH(user_agent)  <= 512),
    -- body: 4096 = POST body 의 일반적 상한. SQLi/XSS payload 보존이 목적이라
    --   너무 작게 잡으면 페이로드가 잘려 분류 정확도 ↓.
    body        TEXT              CHECK (body        IS NULL OR LENGTH(body)        <= 4096),
    -- attack_type: 분류기 결과("SQLi","XSS","브루트포스" 등). NULL = 아직 미분류 (정상 상태).
    --   32 = 한글 분류명("디렉터리 트래버설" 등) UTF-8 인코딩 후 여유.
    attack_type TEXT              CHECK (attack_type IS NULL OR LENGTH(attack_type) <= 32)
);

-- =============================================================================
-- 인덱스 — 각각 특정 쿼리 한 개를 가속하도록 의도적으로 설계.
-- =============================================================================
-- idx_logs_attack_type: 대시보드 "공격 유형별 분포" 차트의 GROUP BY attack_type 가속.
--   WHERE attack_type IS NOT NULL + GROUP BY 패턴 (Routing.kt:130).
--   카디널리티 낮음(공격 유형 ~10종) 이지만 NULL 비율이 높아 부분 인덱스 효과가 크다.
CREATE INDEX IF NOT EXISTS idx_logs_attack_type  ON attack_logs(attack_type);

-- idx_logs_ip_timestamp: AttackClassifier.isBruteForce 의 COUNT 쿼리 가속.
--   "WHERE ip = ? AND timestamp BETWEEN ? AND ? AND path IN (...login paths)"
--   → composite index 의 leading column 이 ip 라 ip 로 먼저 필터, 그 다음 timestamp range scan.
--   순서 (ip, timestamp) 가 (timestamp, ip) 보다 유리: 단일 IP 로 좁히면 row 수가 압도적으로 줄어듦.
CREATE INDEX IF NOT EXISTS idx_logs_ip_timestamp ON attack_logs(ip, timestamp);

-- idx_logs_timestamp: 대시보드 최근 로그 ORDER BY timestamp DESC LIMIT N 가속.
--   SQLite 는 인덱스로 ORDER BY 를 만족하면 별도 sort 단계를 생략 (covering scan).
CREATE INDEX IF NOT EXISTS idx_logs_timestamp    ON attack_logs(timestamp);

-- WAL 모드: writer (core 의 INSERT) 와 reader (api 의 SELECT/UPDATE) 가 동시 작동해도
--   reader 가 writer 를 블로킹하지 않음. honeypot 처럼 write 빈도 높은 워크로드의 표준 선택.
--   trade-off: WAL 파일(-wal, -shm) 이 동반 생성되어 백업 시 셋트로 묶어야 함.
PRAGMA journal_mode=WAL;
