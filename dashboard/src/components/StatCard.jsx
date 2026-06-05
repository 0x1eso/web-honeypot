/**
 * StatCard — 한 카테고리(공격 유형 or 전체)의 카운트를 보여주는 카드.
 *
 * App.jsx 가 stats.byType 의 키마다 한 번씩 렌더하고,
 * label 을 보고 적절한 accent 색을 골라 CSS 에 주입한다.
 *
 * 색을 className(.stat-card--sqli) 으로 분기하지 않고 CSS custom property 로
 * 넘기는 이유: 공격 유형이 늘어나도 CSS 클래스 폭발 없이 토큰만 추가하면 된다.
 * tokens.css 의 --color-sqli, --color-xss 등이 단일 진실 공급원.
 */
import "./StatCard.css";

// label → tokens.css 에 정의된 CSS variable 매핑.
// 미스 시 --color-total(보라) 로 폴백.
const TYPE_COLORS = {
  SQLi:       "var(--color-sqli)",
  XSS:        "var(--color-xss)",
  브루트포스: "var(--color-brute)",
  스캔:       "var(--color-scan)",
  기타:       "var(--color-other)",
  전체:       "var(--color-total)",
};

/**
 * @param {object} props
 * @param {string} props.label  카드 상단 라벨 (TYPE_COLORS 키와 매칭)
 * @param {number|undefined} props.value  표시할 카운트. undefined 면 0 으로 폴백.
 */
export default function StatCard({ label, value }) {
  const color = TYPE_COLORS[label] ?? "var(--color-total)";
  return (
    // inline style 로 --stat-color 를 주입 → CSS 에서 색상/테두리 모두 이 변수를 참조.
    // (StatCard.css 의 border 는 color-mix(--stat-color, transparent 27%) 로 자동 톤다운)
    <div className="stat-card" style={{ "--stat-color": color }}>
      <div className="stat-card__label">{label}</div>
      {/* toLocaleString — 천 단위 콤마 (예: 12,345). null/undefined 일 때 0 표시. */}
      <div className="stat-card__value">{value?.toLocaleString() ?? 0}</div>
    </div>
  );
}
