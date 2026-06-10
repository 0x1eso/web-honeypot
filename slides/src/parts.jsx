/**
 * parts.jsx — 슬라이드 공용 부품.
 * 공격 유형 색은 dashboard/src/styles/tokens.css 값과 동일하게 고정.
 */

/* 분류 우선순위 순서 그대로 (AttackClassifier: SQLi → XSS → 스캔 → 브루트포스 → 기타) */
export const ATTACKS = [
  { label: "SQLi", color: "var(--c-sqli)" },
  { label: "XSS", color: "var(--c-xss)" },
  { label: "스캔", color: "var(--c-scan)" },
  { label: "브루트포스", color: "var(--c-brute)" },
  { label: "기타", color: "var(--c-etc)" },
];

/** 좌상단 모노 캡션 — 슬라이드 번호 + 영문 섹션명 */
export function Kicker({ no, children }) {
  return (
    <div className="kicker rv">
      <span className="no">{no}</span>
      {children}
    </div>
  );
}

/** 공격 유형 칩 — 색 점 + 라벨 */
export function Chip({ label, color, style }) {
  return (
    <span className="chip" style={style}>
      <span className="dot" style={{ background: color }} />
      {label}
    </span>
  );
}

/** 등장 모션 래퍼 — d 초 뒤에 상승 등장 */
export function Rv({ d = 0, as: Tag = "div", className = "", children, ...rest }) {
  return (
    <Tag className={`rv ${className}`} style={{ "--d": `${d}s` }} {...rest}>
      {children}
    </Tag>
  );
}
