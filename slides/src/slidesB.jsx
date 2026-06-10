import { ATTACKS, Kicker, Rv } from "./parts.jsx";

/* ============================================================================
 * slidesB — 7~12장: 동시성·안정성 / dashboard / 보안 설계 / 테스트 /
 *                   트러블슈팅 / 회고·향후 계획.
 * ==========================================================================*/

/* 07 — 동시성 · 안정성 */
function S07() {
  const cards = [
    ["WAL + busy_timeout 5000ms", "core 의 INSERT 와 api 의 UPDATE 가 같은 SQLite 파일에 동시 접근 — WAL 모드로 reader/writer 분리, 잠금 경합은 5초 대기로 흡수"],
    ["BATCH_LIMIT 500", "분류 트랜잭션이 길어지면 core 의 INSERT 가 굶는다 — 한 사이클 500행으로 끊고 나머지는 다음 사이클로"],
    ["단일 OR COUNT + 복합 인덱스", "브루트포스 판정을 쿼리 1번으로 — (ip, timestamp) 인덱스로 풀스캔 제거, 중복 카운트 원천 차단"],
    ["SupervisorJob + graceful shutdown", "ApplicationStopping 구독 → 종료 신호에 분류 루프 코루틴을 안전하게 cancel"],
  ];
  return (
    <>
      <Kicker no="07">API · Concurrency &amp; Reliability</Kicker>
      <Rv d={0.06} as="h2" className="headline">
        한 파일을 두 프로세스가 쓴다 — 그래서
      </Rv>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        {cards.map(([t, d], i) => (
          <Rv key={t} d={0.14 + i * 0.07} className="card">
            <div className="cardTitle mono" style={{ fontSize: 18 }}>{t}</div>
            <div className="cardBody">{d}</div>
          </Rv>
        ))}
      </div>
      <Rv d={0.45} className="footnote">
        <span>
          핸들러·분류기 전부 <code className="inline">newSuspendedTransaction(Dispatchers.IO)</code>
        </span>
        <span style={{ marginLeft: "auto" }}>JDBC 블로킹이 Ktor 이벤트루프를 막지 않게 격리</span>
      </Rv>
    </>
  );
}

/* 08 — dashboard 컴포넌트 (좌: 미니 목업, 우: 설명) */
function S08() {
  const pie = "conic-gradient(var(--c-sqli) 0 24%, var(--c-xss) 0 40%, var(--c-scan) 0 62%, var(--c-brute) 0 84%, var(--c-etc) 0 100%)";
  const bars = [86, 64, 42, 28];
  const items = [
    ["StatCard × 5", "유형별 카운트 — tokens.css 색 시스템"],
    ["StatsChart", "recharts PieChart — 유형 비율"],
    ["TopIps", "BarChart 가로 막대 — 상위 공격자"],
    ["LogTable", "type 필터 + 페이지네이션 (PAGE_SIZE 20)"],
  ];
  return (
    <>
      <Kicker no="08">Dashboard · Components</Kicker>
      <Rv d={0.06} as="h2" className="headline">
        10초마다 살아 움직이는 관제 화면
      </Rv>
      <div className="cols" style={{ alignItems: "stretch" }}>
        <Rv d={0.16} className="card" style={{ flex: 1.15, padding: 18 }}>
          {/* 미니 목업 — 실제 대시보드 레이아웃 축소판 */}
          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            {ATTACKS.map((a) => (
              <div key={a.label} style={{
                flex: 1, border: "1px solid var(--line)", borderRadius: 10,
                padding: "8px 10px", fontSize: 11.5, color: "var(--muted)",
                borderTop: `3px solid ${a.color}`,
              }}>
                {a.label}<br />
                <b style={{ color: "var(--ink)", fontSize: 15 }}>—</b>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
            <div style={{
              width: 108, height: 108, borderRadius: "50%", background: pie, flex: "0 0 auto",
            }} />
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
              {bars.map((w, i) => (
                <div key={i} style={{
                  height: 13, width: `${w}%`, borderRadius: 6,
                  background: i === 0 ? "var(--accent)" : "var(--accent-line)",
                }} />
              ))}
            </div>
          </div>
          <div style={{ marginTop: 14 }}>
            {[0, 1, 2].map((r) => (
              <div key={r} style={{
                height: 17, borderBottom: "1px solid var(--line-soft)",
                display: "flex", gap: 10, alignItems: "center",
              }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: ATTACKS[r].color }} />
                <span style={{ flex: 1, height: 5, background: "var(--line-soft)", borderRadius: 3 }} />
              </div>
            ))}
          </div>
        </Rv>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 14 }}>
          {items.map(([t, d], i) => (
            <Rv key={t} d={0.24 + i * 0.07} className="card" style={{ padding: "16px 22px" }}>
              <div className="cardTitle" style={{ fontSize: 18, marginBottom: 3 }}>{t}</div>
              <div className="cardBody" style={{ fontSize: 15.5 }}>{d}</div>
            </Rv>
          ))}
        </div>
      </div>
      <Rv d={0.55} className="footnote">
        <span><code className="inline">Promise.all</code> 로 stats · top-ips · logs 병렬 fetch</span>
        <span style={{ marginLeft: "auto" }}>REFRESH_MS = 10초 자동 폴링</span>
      </Rv>
    </>
  );
}

/* 09 — 보안 설계 */
function S09() {
  const cards = [
    ["non-root 컨테이너 × 3", "core honeypot user · api app user · nginx uid 101 — 침투해도 root 가 없다"],
    ["보안 헤더 5종", "CSP · X-Content-Type-Options · X-Frame-Options · Referrer-Policy · Permissions-Policy"],
    ["CORS 화이트리스트", "anyHost() 금지 — ALLOWED_ORIGINS env CSV 로만 확장"],
    ["반사 표면 0", "허니팟 응답은 전부 정적 문자열 — 입력이 응답에 한 글자도 반영 안 됨"],
  ];
  return (
    <>
      <Kicker no="09">Security Design</Kicker>
      <Rv d={0.06} as="h2" className="headline">
        공격을 부르는 시스템일수록 안쪽은 단단하게
      </Rv>
      <Rv d={0.14} className="card tint" style={{ marginBottom: 20 }}>
        <div className="cardTitle">위협 모델 — 운영 경계 (README 최상단 명문화)</div>
        <div className="cardBody">
          <b>격리된 사설망 / VLAN / 로컬 Docker 전용.</b>{" "}
          공인 IP 직접 노출 · 운영망 동일 서브넷 · 인증 없는 대시보드 공개 게시 — 전부 금지.
        </div>
      </Rv>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
        {cards.map(([t, d], i) => (
          <Rv key={t} d={0.22 + i * 0.06} className="card" style={{ padding: "18px 24px" }}>
            <div className="cardTitle" style={{ fontSize: 18, marginBottom: 4 }}>{t}</div>
            <div className="cardBody" style={{ fontSize: 15.5 }}>{d}</div>
          </Rv>
        ))}
      </div>
    </>
  );
}

/* 10 — 테스트 */
function S10() {
  const nums = [
    ["7", "Ktor 통합", "testApplication — 엔드포인트 전수"],
    ["5", "분류기 단위", "유형별 패턴 + fallback"],
    ["2", "Playwright e2e", "오프라인 모킹 smoke"],
  ];
  const guards = [
    ["이중 prefix 회귀", "요청 URL 전수 캡처 — /api/api/ 포함 0건을 단언"],
    ["경계값 잠금", "음수 offset → 200 첫 페이지 (coerceAtLeast 회귀 방지)"],
    ["정책 잠금", "stats byType 의 미분류 제외 · healthz db:\"ok\" 명시"],
  ];
  return (
    <>
      <Kicker no="10">Tests</Kicker>
      <Rv d={0.06} as="h2" className="headline">
        테스트는 숫자보다 — 결정을 잠그는 장치
      </Rv>
      <div style={{ display: "flex", gap: 56, alignItems: "flex-end", marginBottom: 36 }}>
        {nums.map(([n, t, d]) => (
          <Rv key={t} d={0.14}>
            <div className="bignum">{n}</div>
            <div style={{ fontWeight: 700, fontSize: 18, marginTop: 6 }}>{t}</div>
            <div className="dim" style={{ fontSize: 14.5 }}>{d}</div>
          </Rv>
        ))}
        <Rv d={0.4} style={{ marginLeft: "auto" }}>
          <div className="card tint" style={{ textAlign: "center", padding: "20px 34px" }}>
            <div className="mono acc" style={{ fontSize: 14, letterSpacing: ".1em" }}>LIVE DOCKER</div>
            <div className="bignum" style={{ fontSize: 56 }}>8/8</div>
            <div className="dim" style={{ fontSize: 14 }}>통합 검증 PASS</div>
          </div>
        </Rv>
      </div>
      <div>
        {guards.map(([t, d], i) => (
          <Rv key={t} d={0.32 + i * 0.07} className="tableRow"
            style={{ gridTemplateColumns: "240px 1fr" }}>
            <span style={{ fontWeight: 700 }}>{t}</span>
            <span className="tableDesc dim">{d}</span>
          </Rv>
        ))}
      </div>
    </>
  );
}

/* 11 — 트러블슈팅 */
function S11() {
  const cases = [
    ["Exposed 0.52 API 변경", "구버전 select { } 가 컴파일 에러", "0.52 에서 API 제거됨", "selectAll().where { } 로 전면 마이그레이션"],
    ["/api/api/ 이중 prefix 404", "Docker 배포에서만 대시보드 데이터 실종", "BASE 에도 호출부에도 /api 가 붙어 중복", "BASE 가 /api 를 소유하도록 단일화 + e2e 회귀 가드"],
    ["non-root nginx 크래시", "[emerg] open() permission denied 부팅 루프", "COPY 산출물이 root 소유 — uid 101 이 못 읽음", "COPY --chown=nginx:nginx 로 소유권 명시"],
  ];
  return (
    <>
      <Kicker no="11">Troubleshooting</Kicker>
      <Rv d={0.06} as="h2" className="headline">
        막혔던 세 지점 — 증상 · 원인 · 해결
      </Rv>
      <div className="cols" style={{ alignItems: "stretch" }}>
        {cases.map(([t, sym, cause, fix], i) => (
          <Rv key={t} d={0.16 + i * 0.09} className="card">
            <div className="cardTitle" style={{ fontSize: 18.5 }}>{t}</div>
            <div className="cardBody" style={{ fontSize: 15.5, lineHeight: 1.7 }}>
              <span className="mono" style={{ color: "var(--c-sqli)", fontSize: 12.5 }}>증상</span><br />
              {sym}<br />
              <span className="mono" style={{ color: "var(--c-brute)", fontSize: 12.5 }}>원인</span><br />
              {cause}<br />
              <span className="mono" style={{ color: "var(--c-scan)", fontSize: 12.5 }}>해결</span><br />
              <b>{fix}</b>
            </div>
          </Rv>
        ))}
      </div>
    </>
  );
}

/* 12 — 회고 / 향후 계획 */
function S12() {
  const keep = [
    "DB 하나가 곧 모듈 계약 — C 와 Kotlin 이 서로 몰라도 협업이 굴러갔다",
    "테스트가 결정을 잠근다 — 이중 prefix 같은 회귀가 코드로 차단됨",
    "보안 기본값 — non-root · 화이트리스트 · 정적 응답을 처음부터",
  ];
  const next = [
    "recharts 코드 분할 — 메인 청크 596KB 다이어트",
    "분류 규칙 고도화 — substring → 정규식 · 스코어링",
    "core DB_PATH env 분리 · gradle wrapper 복구",
  ];
  return (
    <>
      <div className="glow bl" />
      <Kicker no="12">Retrospective</Kicker>
      <Rv d={0.06} as="h2" className="headline">
        지킨 것, 다음에 할 것
      </Rv>
      <div className="cols">
        <Rv d={0.16} className="card tint">
          <div className="cardTitle acc">Keep</div>
          <div className="cardBody" style={{ fontSize: 16.5, lineHeight: 2 }}>
            {keep.map((k) => <div key={k}>— {k}</div>)}
          </div>
        </Rv>
        <Rv d={0.26} className="card">
          <div className="cardTitle">Next</div>
          <div className="cardBody" style={{ fontSize: 16.5, lineHeight: 2 }}>
            {next.map((k) => <div key={k}>— {k}</div>)}
          </div>
        </Rv>
      </div>
      <Rv d={0.4} className="footnote" style={{ borderTop: "1px solid var(--line)" }}>
        <span className="mono">감사합니다</span>
        <span style={{ marginLeft: "auto" }}>
          <b style={{ color: "var(--ink)" }}>Team Zeraxis</b> — 발표 도현서
        </span>
      </Rv>
    </>
  );
}

export const SLIDES_B = [S07, S08, S09, S10, S11, S12];
