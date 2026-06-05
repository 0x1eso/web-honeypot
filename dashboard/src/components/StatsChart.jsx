/**
 * StatsChart — 공격 유형별 비율을 보여주는 파이 차트.
 *
 * recharts 의 PieChart 는 children 으로 도형/툴팁/범례를 받는 컴포지션 API.
 * Cell 색은 prop(fill) 으로만 지정 가능해서 CSS variable 이 아닌
 * 하드코딩 hex 를 쓴다(recharts 가 SVG 를 직접 렌더하므로
 * CSS custom property 가 inheritance 체인에서 적용되지 않음).
 * — tokens.css 의 --color-sqli 등과 같은 값을 유지해야 시각적 일관성이 깨지지 않는다.
 */
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from "recharts";
import "./StatsChart.css";

// tokens.css 의 --color-* 와 1:1 동기화. 변경 시 둘 다 갱신.
const COLORS = {
  SQLi:       "#ef4444",
  XSS:        "#f97316",
  브루트포스: "#eab308",
  스캔:       "#3b82f6",
  기타:       "#6b7280",
};

/**
 * @param {object} props
 * @param {Record<string, number>|undefined} props.byType
 *        공격 유형 이름 → 카운트. undefined(로딩 중) 면 빈 객체로 폴백.
 */
export default function StatsChart({ byType }) {
  // recharts 는 [{ name, value }] 배열을 요구 → entries 로 변환.
  const data = Object.entries(byType ?? {}).map(([name, value]) => ({ name, value }));

  // 빈 객체 가드 — 첫 로드 직후나 트래픽이 0건일 때 차트 자리는 유지하되 메시지만 표시.
  if (data.length === 0) {
    return (
      <div className="chart-card chart-card--empty">
        데이터 없음
      </div>
    );
  }

  return (
    <div className="chart-card">
      <h3 className="chart-card__title">공격 유형 분포</h3>
      {/* ResponsiveContainer — 부모 flex 박스 크기에 맞춰 SVG viewport 를 자동 조정.
          width="100%" height=숫자 가 가장 안정적 (height % 는 부모 height 가
          명시되지 않으면 0으로 collapse). */}
      <ResponsiveContainer width="100%" height={260}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            outerRadius={90}
            // label 함수는 각 슬라이스의 외부 라벨을 그린다. percent 는 0~1 범위.
            label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
            labelLine={true}
          >
            {/* Cell 은 슬라이스 단위 스타일. data 순서대로 fill 매칭. */}
            {data.map((entry) => (
              <Cell key={entry.name} fill={COLORS[entry.name] ?? "#6b7280"} />
            ))}
          </Pie>
          <Tooltip
            // contentStyle 은 recharts 가 SVG 외부 div 로 그리는 툴팁의 인라인 스타일.
            // CSS 클래스로 지정하려면 wrapperClassName 을 써야 한다 — 여기선 단순화.
            contentStyle={{ background: "#1e1e2e", border: "1px solid #333", borderRadius: 6 }}
            formatter={(value) => [value.toLocaleString() + "건", ""]}
          />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
