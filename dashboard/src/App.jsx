/**
 * App — 대시보드 루트 컴포넌트.
 *
 * 책임:
 *  - 세 개의 API 엔드포인트(stats / top-ips / logs)를 병렬로 페치
 *  - 일정 간격(REFRESH_MS)으로 자동 폴링
 *  - 로그 테이블 필터(type) 와 페이지(offset) 를 단일 query 상태로 보관
 *  - 자식 컴포넌트(StatCard / StatsChart / TopIps / LogTable)에 props 분배
 *
 * "query 가 App 에 살고, LogTable 은 onFilterChange 콜백으로 위임"하는
 * lifting state up 패턴. LogTable 이 직접 fetch 하지 않는 이유는
 * stats / top-ips 와 갱신 타이밍을 묶기 위해서다.
 */
import { useState, useEffect, useCallback } from "react";
import { fetchLogs, fetchStats, fetchTopIps } from "./api";
import StatCard   from "./components/StatCard";
import StatsChart from "./components/StatsChart";
import TopIps     from "./components/TopIps";
import LogTable   from "./components/LogTable";
import "./App.css";

// 폴링 간격 — 너무 짧으면 백엔드/네트워크 부하, 너무 길면 실시간성이 깨진다.
// 허니팟 트래픽 분석 용도라 10초가 합리적 절충점.
const REFRESH_MS = 10_000;
// 페이지 크기 — LogTable 의 pageSize prop 으로도 전달되어 페이지네이션 계산에 쓰인다.
const PAGE_SIZE  = 20;

export default function App() {
  // stats: null 로 시작해서 "아직 로드 전" 상태를 명시 (0 과 구분하기 위함).
  const [stats,   setStats]   = useState(null);
  const [topIps,  setTopIps]  = useState([]);
  const [logsRes, setLogsRes] = useState({ total: 0, logs: [] });
  // query.type=undefined 는 "필터 없음" 을 의미. fetchLogs 가 falsy 체크로 params 에서 제외.
  const [query,   setQuery]   = useState({ type: undefined, offset: 0 });
  const [lastAt,  setLastAt]  = useState(null);
  const [error,   setError]   = useState(null);

  /**
   * 세 API 를 병렬 호출하고 상태를 한꺼번에 갱신.
   *
   * Promise.all 을 쓰는 이유: 세 요청이 서로 독립적이라 순차 await 하면
   * 불필요하게 직렬화되어 첫 페인트가 느려진다.
   *
   * @param {{ type?: string, offset?: number }} [q] - 명시적으로 넘기지 않으면
   *        클로저의 query 를 그대로 사용. handleFilterChange 처럼 setQuery 직후
   *        호출할 때 next state 를 인자로 넘겨야 stale closure 를 피할 수 있다.
   */
  const load = useCallback(async (q = query) => {
    try {
      const [s, ips, lr] = await Promise.all([
        fetchStats(),
        fetchTopIps(10),
        fetchLogs({ limit: PAGE_SIZE, ...q }),
      ]);
      setStats(s);
      setTopIps(ips);
      setLogsRes(lr);
      setLastAt(new Date().toLocaleTimeString());
      setError(null);
    } catch {
      // 어느 한 요청이라도 실패하면 배너만 띄우고 기존 데이터는 유지 (UX 가 끊기지 않도록).
      setError("API 서버에 연결할 수 없습니다. 서버가 실행 중인지 확인하세요.");
    }
  }, [query]);

  // 최초 로드 — 의존성 배열을 일부러 비워 마운트 시 단 한 번만 실행.
  // (StrictMode 개발 환경에서는 두 번 호출되지만 멱등하므로 안전)
  useEffect(() => { load(); }, []);

  // 자동 갱신 — load 가 query 변경에 따라 재생성되므로 setInterval 도 따라 재등록.
  // 이전 타이머는 cleanup 에서 clearInterval 로 누수 방지.
  useEffect(() => {
    const id = setInterval(() => load(), REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  /**
   * LogTable 의 필터/페이지 변경을 받아서 query 를 머지하고 즉시 재페치.
   * setQuery 는 비동기이므로 q 를 직접 load 에 전달 (stale closure 회피).
   */
  const handleFilterChange = (next) => {
    const q = { ...query, ...next };
    setQuery(q);
    load(q);
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <h1 className="app-title">Web Honeypot</h1>
          <p className="app-subtitle">공격 트래픽 모니터링 대시보드</p>
        </div>
        <div className="app-updated">
          {lastAt ? `마지막 갱신: ${lastAt}` : "로딩 중..."}
        </div>
      </header>

      <main className="app-main">
        {error && (
          <div className="app-error">
            {error}
          </div>
        )}

        {/* 요약 카드 */}
        <div className="app-stat-row">
          <StatCard label="전체"       value={stats?.total} />
          <StatCard label="SQLi"       value={stats?.byType?.["SQLi"]} />
          <StatCard label="XSS"        value={stats?.byType?.["XSS"]} />
          <StatCard label="스캔"       value={stats?.byType?.["스캔"]} />
          <StatCard label="브루트포스" value={stats?.byType?.["브루트포스"]} />
          <StatCard label="기타"       value={stats?.byType?.["기타"]} />
        </div>

        {/* 차트 */}
        <div className="app-chart-row">
          <StatsChart byType={stats?.byType} />
          <TopIps     data={topIps} />
        </div>

        {/* 로그 테이블 */}
        <LogTable
          logs={logsRes.logs}
          total={logsRes.total}
          pageSize={PAGE_SIZE}
          onFilterChange={handleFilterChange}
        />
      </main>
    </div>
  );
}
