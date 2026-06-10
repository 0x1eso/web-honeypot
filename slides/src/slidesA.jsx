import { ATTACKS, Kicker, Chip, Rv } from "./parts.jsx";

/* ============================================================================
 * slidesA — 1~6장: 타이틀 / 문제 정의 / 아키텍처 / 협업 인터페이스 /
 *                  REST 엔드포인트 / 공격 분류 엔진.
 * 모든 수치·정책은 레포 코드/문서에서 검증된 값만 사용.
 * ==========================================================================*/

/* 01 — 타이틀 */
function S01() {
  return (
    <>
      <div className="glow tr" />
      <div style={{ marginTop: 96 }}>
        <Rv d={0}>
          <div className="kicker" style={{ marginBottom: 36 }}>
            <span className="no">TEAM ZERAXIS</span>웹 해킹 트래픽 수집 프로젝트
          </div>
        </Rv>
        <Rv d={0.08}>
          <h1 className="display">
            Web Honeypot<span className="acc">.</span>
          </h1>
        </Rv>
        <Rv d={0.18}>
          <p className="lead dim" style={{ marginTop: 26 }}>
            공격자를 유인하고 — 전부 기록하고 — 자동으로 분류한다
          </p>
        </Rv>
      </div>
      <Rv d={0.3} className="footnote" style={{ borderTop: "1px solid var(--line)" }}>
        <span style={{ display: "flex", gap: 8 }}>
          {ATTACKS.map((a) => (
            <span key={a.label} className="dot" style={{
              width: 12, height: 12, borderRadius: "50%",
              background: a.color, display: "inline-block",
            }} />
          ))}
        </span>
        <span><b style={{ color: "var(--ink)" }}>발표 도현서</b> — 담당 api (Kotlin/Ktor) · dashboard (React)</span>
        <span className="mono" style={{ marginLeft: "auto" }}>C · Kotlin · React · SQLite · Docker</span>
      </Rv>
    </>
  );
}

/* 02 — 문제 정의 */
function S02() {
  const steps = [
    ["유인", "취약해 보이는 미끼 엔드포인트 노출", "/.env · /wp-admin · /admin — 가짜 200 응답으로 체류 유도"],
    ["수집", "유입되는 모든 HTTP 요청을 기록", "IP · 메서드 · 경로 · User-Agent · 바디 · 수신 시각"],
    ["분석", "공격 유형 자동 분류 + 실시간 시각화", "SQLi / XSS / 스캔 / 브루트포스 / 기타 — 대시보드로 관찰"],
  ];
  return (
    <>
      <Kicker no="02">Problem</Kicker>
      <Rv d={0.06} as="h2" className="headline">
        실제 공격은 어떤 모습으로 들어오는가?
      </Rv>
      <Rv d={0.12}>
        <p className="body dim" style={{ marginBottom: 40, maxWidth: 860 }}>
          보안 수업의 공격 기법을 <b style={{ color: "var(--ink)" }}>방어자의 눈</b>으로 다시 보기 —
          저상호작용 허니팟을 직접 만들어 실 공격 트래픽의 패턴을 데이터로 수집한다.
        </p>
      </Rv>
      <div className="cols">
        {steps.map(([t, d, s], i) => (
          <Rv key={t} d={0.18 + i * 0.08} className="card">
            <div className="mono acc" style={{ fontSize: 13, letterSpacing: ".14em", marginBottom: 10 }}>
              0{i + 1}
            </div>
            <div className="cardTitle">{t}</div>
            <div className="cardBody"><b>{d}</b><br />{s}</div>
          </Rv>
        ))}
      </div>
    </>
  );
}

/* 03 — 시스템 아키텍처 (SVG 흐름도) */
function Node({ x, w, title, sub, mine, ghost }) {
  const stroke = mine ? "var(--accent)" : ghost ? "var(--muted)" : "var(--line)";
  return (
    <g>
      <rect x={x} y={70} width={w} height={112} rx={16}
        fill={mine ? "var(--accent-weaker)" : "#fff"}
        stroke={stroke} strokeWidth={mine ? 2 : 1.4}
        strokeDasharray={ghost ? "6 6" : "none"} />
      <text x={x + w / 2} y={118} textAnchor="middle"
        fontSize="19" fontWeight="700" fill={ghost ? "var(--muted)" : "var(--ink)"}>{title}</text>
      <text x={x + w / 2} y={146} textAnchor="middle"
        fontSize="13" fill="var(--muted)" fontFamily="var(--mono)">{sub}</text>
      {mine && (
        <text x={x + w / 2} y={62} textAnchor="middle" fontSize="12"
          fontWeight="700" fill="var(--accent)" letterSpacing="2">발표 범위</text>
      )}
    </g>
  );
}

function Arrow({ x1, x2, label, below, dir = 1 }) {
  const y = 126;
  return (
    <g>
      <line className="flow" x1={dir > 0 ? x1 : x2} y1={y} x2={dir > 0 ? x2 : x1} y2={y}
        stroke="var(--accent)" strokeWidth="1.8"
        markerEnd="url(#arr)" />
      <text x={(x1 + x2) / 2} y={below ? 158 : 102} textAnchor="middle"
        fontSize="12.5" fill="var(--muted)" fontFamily="var(--mono)">{label}</text>
    </g>
  );
}

function S03() {
  return (
    <>
      <Kicker no="03">System Architecture</Kicker>
      <Rv d={0.06} as="h2" className="headline">
        한 줄 흐름 — 공격이 데이터가 되기까지
      </Rv>
      <Rv d={0.16}>
        <svg viewBox="0 0 1120 230" style={{ width: "100%", marginTop: 14 }}>
          <defs>
            <marker id="arr" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto">
              <path d="M0,0 L9,4.5 L0,9 z" fill="var(--accent)" />
            </marker>
          </defs>
          <Node x={6} w={120} title="공격자" sub="HTTP" ghost />
          <Arrow x1={130} x2={196} label="공격 트래픽" />
          <Node x={200} w={172} title="core · C" sub=":8080 공개 / 팀원 담당" />
          <Arrow x1={376} x2={442} label="INSERT" below />
          <Node x={446} w={180} title="SQLite" sub="/data · WAL 모드" />
          <Arrow x1={630} x2={696} label="분류 UPDATE" />
          <Node x={700} w={186} title="api · Ktor" sub=":8081 내부 전용" mine />
          <Arrow x1={890} x2={956} label="10초 폴링" dir={-1} below />
          <Node x={960} w={156} title="dashboard" sub=":3000 · nginx" mine />
        </svg>
      </Rv>
      <Rv d={0.3} className="footnote">
        <span>core 는 요청 원문을 <b style={{ color: "var(--ink)" }}>attack_type=NULL</b> 로 적재만 한다</span>
        <span>api 가 5초 주기로 분류해 채운다</span>
        <span style={{ marginLeft: "auto" }}>nginx 가 <code className="inline">/api</code> 를 api 컨테이너로 프록시</span>
      </Rv>
    </>
  );
}

/* 04 — 협업 인터페이스 */
function S04() {
  return (
    <>
      <Kicker no="04">Interface Contract</Kicker>
      <Rv d={0.06} as="h2" className="headline">
        모듈 간 계약은 DB 하나로 끝낸다
      </Rv>
      <div className="cols" style={{ alignItems: "stretch" }}>
        <Rv d={0.14} className="card tint" style={{ flex: 1.25 }}>
          <div className="cardTitle">2-Phase Write</div>
          <div className="cardBody" style={{ fontSize: 17.5, lineHeight: 1.8 }}>
            <b>① core (C)</b> — 원문 그대로 <code className="inline">INSERT</code>,
            attack_type 은 <code className="inline">NULL</code><br />
            <b>② api (Kotlin)</b> — 미분류 행을 읽어 분류 후 <code className="inline">UPDATE</code><br />
            <span className="dim">C 와 Kotlin 이 서로의 존재를 몰라도 된다 — 결합점은 스키마뿐</span>
          </div>
        </Rv>
        <Rv d={0.22} className="card">
          <div className="cardTitle">공유 계약 3가지</div>
          <div className="cardBody" style={{ fontSize: 16.5, lineHeight: 1.9 }}>
            <b className="mono">/data/honeypot.db</b> — Docker named volume 공유<br />
            <b className="mono">ISO 8601 UTC</b> — timestamp 포맷 통일<br />
            <b>CHECK 제약 3-way 일치</b> — schema.sql · core · api
          </div>
        </Rv>
      </div>
      <Rv d={0.3} style={{ marginTop: 22 }}>
        <div className="tableRow" style={{ borderTop: "1px solid var(--line)" }}>
          <span className="method"><span className="verb">PORT</span>8080</span>
          <span className="tableDesc">core — 허니팟 본 목적상 호스트 공개</span>
          <span className="tableShape">격리망 전용</span>
        </div>
        <div className="tableRow">
          <span className="method"><span className="verb">PORT</span>8081</span>
          <span className="tableDesc">api — 내부 네트워크 expose 만 (호스트 비공개)</span>
          <span className="tableShape">nginx 경유</span>
        </div>
        <div className="tableRow">
          <span className="method"><span className="verb">PORT</span>3000</span>
          <span className="tableDesc">dashboard — nginx-unprivileged (컨테이너 8080)</span>
          <span className="tableShape">3000 → 8080</span>
        </div>
      </Rv>
    </>
  );
}

/* 05 — REST 엔드포인트 */
function S05() {
  const rows = [
    ["/api/logs", "limit · offset · type 필터, 최신순 페이지", "{ total, logs[] }"],
    ["/api/stats", "유형별 집계 — 미분류 행은 byType 에서 제외", "{ total, byType }"],
    ["/api/top-ips", "공격 횟수 상위 IP (COUNT 내림차순)", "[{ ip, count }]"],
    ["/healthz", "DB ping 통과 시에만 200 — 실패는 503", '{ status, db: "ok" }'],
  ];
  return (
    <>
      <Kicker no="05">API · Endpoints</Kicker>
      <Rv d={0.06} as="h2" className="headline">
        REST 4개 — 작지만 전부 방어적으로
      </Rv>
      <div>
        {rows.map(([p, d, s], i) => (
          <Rv key={p} d={0.14 + i * 0.07} className="tableRow">
            <span className="method"><span className="verb">GET</span>{p}</span>
            <span className="tableDesc">{d}</span>
            <span className="tableShape">{s}</span>
          </Rv>
        ))}
      </div>
      <Rv d={0.46} className="footnote">
        <span>limit <code className="inline">coerceIn(1, 500)</code></span>
        <span>음수 offset <code className="inline">coerceAtLeast(0)</code> 클램프</span>
        <span style={{ marginLeft: "auto" }}>
          모든 핸들러 <code className="inline">newSuspendedTransaction(Dispatchers.IO)</code>
        </span>
      </Rv>
    </>
  );
}

/* 06 — 공격 분류 엔진 */
function S06() {
  const rules = [
    ["SQLi", "var(--c-sqli)", "20개 substring 패턴", "union · sleep( · 1=1 · ' or …"],
    ["XSS", "var(--c-xss)", "14개 패턴", "<script · onerror= · javascript: …"],
    ["스캔", "var(--c-scan)", "민감 경로 19종 prefix", "/.env · /wp-admin · /etc/passwd …"],
    ["브루트포스", "var(--c-brute)", "동일 IP · 60초 윈도우", "로그인성 경로 10회 이상"],
    ["기타", "var(--c-etc)", "어디에도 안 걸리면", "fallback 레이블"],
  ];
  return (
    <>
      <Kicker no="06">API · Attack Classifier</Kicker>
      <Rv d={0.06} as="h2" className="headline">
        우선순위 매칭 — 먼저 걸리는 유형으로 확정
      </Rv>
      <Rv d={0.14} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 34 }}>
        {ATTACKS.map((a, i) => (
          <span key={a.label} style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Chip label={a.label} color={a.color} />
            {i < ATTACKS.length - 1 && <span className="dim" style={{ fontSize: 20 }}>→</span>}
          </span>
        ))}
      </Rv>
      <div>
        {rules.map(([t, c, d, ex], i) => (
          <Rv key={t} d={0.22 + i * 0.06} className="tableRow"
            style={{ gridTemplateColumns: "190px 320px 1fr" }}>
            <span style={{ fontWeight: 700, display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ width: 10, height: 10, borderRadius: "50%", background: c }} />{t}
            </span>
            <span className="tableDesc">{d}</span>
            <span className="tableShape" style={{ textAlign: "left" }}>{ex}</span>
          </Rv>
        ))}
      </div>
      <Rv d={0.55} className="footnote">
        <span><b style={{ color: "var(--ink)" }}>5초 주기</b> 코루틴 루프</span>
        <span>사이클당 최대 <b style={{ color: "var(--ink)" }}>500행</b> (BATCH_LIMIT)</span>
        <span style={{ marginLeft: "auto" }}>허니팟에선 놓치는 비용 &gt; 오탐 비용 — 의도적으로 느슨한 매칭</span>
      </Rv>
    </>
  );
}

export const SLIDES_A = [S01, S02, S03, S04, S05, S06];
