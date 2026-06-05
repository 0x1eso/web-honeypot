/**
 * TopIps — 요청 수 상위 공격자 IP 를 가로 막대로 보여주는 카드.
 *
 * 가로 막대(layout="vertical") 를 쓰는 이유: IP 문자열(예: 192.168.10.42)이
 * 세로축 라벨이 되어 등폭 폰트로 정렬돼 비교가 쉽고, 항목 수가 늘어도
 * 세로 공간만 추가하면 되어 반응형에 유리하다.
 *
 * 색상 규칙: 1위=빨강(--color-sqli), 2위=주황(--color-xss), 그 외=파랑(--color-scan).
 * 시각적 위계로 "주의해야 할 IP" 를 즉시 식별하게 한다. recharts SVG 한계로
 * CSS variable 대신 hex 직접 지정 — tokens.css 와 값 동기화 필요.
 */
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import "./TopIps.css";

/**
 * @param {object} props
 * @param {Array<{ ip: string, count: number }>} props.data  카운트 내림차순 정렬된 IP 목록.
 */
export default function TopIps({ data }) {
  // 로딩 중 또는 빈 응답 가드.
  if (!data || data.length === 0) {
    return (
      <div className="topips-card topips-card--empty">
        데이터 없음
      </div>
    );
  }

  return (
    <div className="topips-card">
      <h3 className="topips-card__title">상위 공격자 IP</h3>
      <ResponsiveContainer width="100%" height={260}>
        {/* layout="vertical" 이면 X = 값(숫자), Y = 카테고리(IP). 막대는 가로 방향. */}
        <BarChart data={data} layout="vertical" margin={{ left: 20, right: 20 }}>
          <XAxis type="number" tick={{ fill: "#888", fontSize: 11 }} />
          <YAxis
            type="category"
            dataKey="ip"
            // width=110 — IPv4 등폭 폰트 기준 충분한 라벨 공간. 짧으면 IP 가 잘린다.
            width={110}
            tick={{ fill: "#ccc", fontSize: 11, fontFamily: "monospace" }}
          />
          <Tooltip
            contentStyle={{ background: "#1e1e2e", border: "1px solid #333", borderRadius: 6 }}
            formatter={(value) => [value.toLocaleString() + "건", "요청 수"]}
          />
          {/* radius=[0,4,4,0] — 막대의 우측만 둥글게. 가로 막대라 "끝" 이 오른쪽. */}
          <Bar dataKey="count" radius={[0, 4, 4, 0]}>
            {data.map((_, i) => (
              <Cell key={i} fill={i === 0 ? "#ef4444" : i === 1 ? "#f97316" : "#3b82f6"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
