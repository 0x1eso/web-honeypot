import { useState } from "react";
import "./LogTable.css";

const TYPES = ["전체", "SQLi", "XSS", "브루트포스", "스캔", "기타"];

export default function LogTable({ logs, total, pageSize, onFilterChange }) {
  const [filter, setFilter] = useState("전체");
  const [page, setPage]     = useState(0);

  const handleFilter = (type) => {
    const next = type === "전체" ? undefined : type;
    setFilter(type);
    setPage(0);
    onFilterChange({ type: next, offset: 0 });
  };

  const handlePage = (next) => {
    setPage(next);
    onFilterChange({ type: filter === "전체" ? undefined : filter, offset: next * pageSize });
  };

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="logtable-card">
      <div className="logtable-card__header">
        <h3 className="logtable-card__title">요청 로그</h3>
        <div className="logtable-filters">
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
