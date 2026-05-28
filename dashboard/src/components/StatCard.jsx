import "./StatCard.css";

const TYPE_COLORS = {
  SQLi:       "var(--color-sqli)",
  XSS:        "var(--color-xss)",
  브루트포스: "var(--color-brute)",
  스캔:       "var(--color-scan)",
  기타:       "var(--color-other)",
  전체:       "var(--color-total)",
};

export default function StatCard({ label, value }) {
  const color = TYPE_COLORS[label] ?? "var(--color-total)";
  return (
    <div className="stat-card" style={{ "--stat-color": color }}>
      <div className="stat-card__label">{label}</div>
      <div className="stat-card__value">{value?.toLocaleString() ?? 0}</div>
    </div>
  );
}
