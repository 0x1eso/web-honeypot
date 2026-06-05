/**
 * LogTable — 요청 로그 테이블 + 공격 유형 필터 + 페이지네이션.
 *
 * 표시 자체는 props 로 받지만 (logs/total/pageSize), 필터 UI 와 현재 페이지는
 * 로컬 상태로 보관한다. 필터/페이지가 바뀌면 onFilterChange 콜백으로 부모(App)에
 * "다음 쿼리 파라미터" 를 전달하고, 부모가 재페치 → 새 props 가 내려오는 구조.
 *
 * 왜 fetch 를 자식이 직접 안 하는가:
 *  - stats / top-ips 와 갱신 타이밍을 묶기 위해
 *  - 자동 폴링 로직을 한 곳에 집중하기 위해
 */
import { useState } from "react";
import "./LogTable.css";

// "전체" 는 UI 전용 sentinel — 백엔드에는 type 자체를 보내지 않는 것으로 처리한다.
const TYPES = ["전체", "SQLi", "XSS", "브루트포스", "스캔", "기타"];

/**
 * @param {object} props
 * @param {Array<object>} props.logs       현재 페이지의 로그 행
 * @param {number} props.total             전체 로그 수 (페이지 계산용)
 * @param {number} props.pageSize          한 페이지 행 수
 * @param {(q: { type?: string, offset: number }) => void} props.onFilterChange
 *        필터/페이지 변경 시 호출. type 은 undefined 면 "전체".
 */
export default function LogTable({ logs, total, pageSize, onFilterChange }) {
  const [filter, setFilter] = useState("전체");
  const [page, setPage]     = useState(0);

  /**
   * 필터 변경 → 페이지를 0으로 리셋 (다른 필터의 마지막 페이지에 남는 사고 방지).
   * "전체" 선택 시 type 을 undefined 로 변환해서 API 쿼리에서 빠지게 한다.
   */
  const handleFilter = (type) => {
    const next = type === "전체" ? undefined : type;
    setFilter(type);
    setPage(0);
    onFilterChange({ type: next, offset: 0 });
  };

  /**
   * 페이지 변경 → offset = page * pageSize 로 환산해 부모에 전달.
   * filter 가 "전체" 인 경우만 type 을 undefined 로 (백엔드는 falsy 검사).
   */
  const handlePage = (next) => {
    setPage(next);
    onFilterChange({ type: filter === "전체" ? undefined : filter, offset: next * pageSize });
  };

  // total/pageSize 의 천장값 → 마지막 페이지 인덱스 계산 / 페이저 표시 여부 판단.
  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="logtable-card">
      <div className="logtable-card__header">
        <h3 className="logtable-card__title">요청 로그</h3>
        <div className="logtable-filters">
          {/*
            data-type / data-active 속성 기반 스타일링.
            클래스 토글 대신 attribute selector 로 CSS 가 활성 색을 결정
            (.logtable-filter[data-active="true"][data-type="SQLi"] { ... }).
            덕분에 JS 에서 색상 매핑 테이블을 들 필요가 없고, 타입이 추가돼도
            CSS 만 늘면 된다.
          */}
          {TYPES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => handleFilter(t)}
              data-type={t}
              data-active={filter === t}
              className="logtable-filter"
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="logtable-scroll">
        <table className="logtable">
          <thead>
            <tr>
              {["시각", "IP", "메서드", "경로", "공격 유형", "User-Agent"].map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 ? (
              <tr>
                <td colSpan={6} className="logtable__empty">
                  데이터 없음
                </td>
              </tr>
            ) : (
              logs.map((log) => (
                <tr key={log.id}>
                  {/* timestamp 는 ISO-8601 ("2025-01-30T12:34:56...") 가정.
                      0..19 슬라이스로 초 단위까지 자르고 T 를 공백으로 치환해
                      "2025-01-30 12:34:56" 가독 포맷으로 변환. 타임존 변환은 하지 않음. */}
                  <td>{log.timestamp?.slice(0, 19).replace("T", " ")}</td>
                  <td className="logtable__mono">{log.ip}</td>
                  <td>
                    <span className="method-pill" data-method={log.method}>{log.method}</span>
                  </td>
                  <td className="logtable__path">{log.path}</td>
                  <td>
                    {log.attackType ? (
                      <span className="attack-pill" data-type={log.attackType}>
                        {log.attackType}
                      </span>
                    ) : (
                      <span className="attack-pending">분류 중...</span>
                    )}
                  </td>
                  <td className="logtable__ua">{log.userAgent ?? "-"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="logtable-pager">
          <button
            type="button"
            onClick={() => handlePage(page - 1)}
            disabled={page === 0}
            className="logtable-pager__btn"
          >
            이전
          </button>
          <span className="logtable-pager__info">{page + 1} / {totalPages}</span>
          <button
            type="button"
            onClick={() => handlePage(page + 1)}
            disabled={page >= totalPages - 1}
            className="logtable-pager__btn"
          >
            다음
          </button>
        </div>
      )}
    </div>
  );
}
