/**
 * 백엔드(Ktor) REST API 클라이언트.
 *
 * 매칭되는 백엔드 라우트는 다음과 같다:
 *   GET /api/logs?limit&offset&type   -> { total: number, logs: LogRow[] }
 *   GET /api/stats                    -> { total: number, byType: Record<string, number> }
 *   GET /api/top-ips?limit            -> Array<{ ip: string, count: number }>
 *
 * BASE 결정 정책 (우선순위):
 *  1. import.meta.env.VITE_API_URL  — Docker 빌드 시 `--build-arg` 또는
 *                                     `.env.production` 으로 baked in.
 *                                     운영에선 `/api` (nginx 가 api 컨테이너로 프록시).
 *  2. fallback `http://localhost:8081/api` — `npm run dev` 단독 실행 시
 *                                     Ktor 8081 포트로 직접 호출.
 *
 * 중요한 함정: BASE 는 이미 `/api` 를 포함한다.
 * 따라서 호출 측에서 `${BASE}/api/logs` 처럼 또 prefix 를 붙이면
 * `/api/api/logs` 가 되어 404. 반드시 `${BASE}/logs` 형태 유지.
 * (이 회귀를 막는 e2e 테스트가 tests/e2e/dashboard.spec.js 의 Test A.)
 */
import axios from "axios";

const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8081/api";

/**
 * 페이지네이션된 요청 로그를 가져온다.
 *
 * @param {object} [opts]
 * @param {number} [opts.limit=100] 한 페이지 행 수
 * @param {number} [opts.offset=0]  스킵할 행 수
 * @param {string} [opts.type]      공격 유형 필터(생략 시 전체). falsy 면 쿼리에서 제외.
 * @returns {Promise<{ total: number, logs: object[] }>}
 */
export const fetchLogs = ({ limit = 100, offset = 0, type } = {}) => {
  const params = { limit, offset };
  // type 이 undefined/"" 일 때 쿼리에서 빼야 백엔드가 "필터 없음" 으로 해석한다.
  if (type) params.type = type;
  return axios.get(`${BASE}/logs`, { params }).then((r) => r.data);
};

/**
 * 전체 카운트와 공격 유형별 분포를 가져온다.
 * @returns {Promise<{ total: number, byType: Record<string, number> }>}
 */
export const fetchStats = () =>
  axios.get(`${BASE}/stats`).then((r) => r.data);

/**
 * 요청 수 상위 IP 목록.
 * @param {number} [limit=10]
 * @returns {Promise<Array<{ ip: string, count: number }>>}
 */
export const fetchTopIps = (limit = 10) =>
  axios.get(`${BASE}/top-ips`, { params: { limit } }).then((r) => r.data);
