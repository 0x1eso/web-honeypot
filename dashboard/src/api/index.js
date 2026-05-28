import axios from "axios";

// BASE는 항상 "API root 전체"를 의미한다 (/api 포함).
// Docker: VITE_API_URL=/api (nginx가 api 컨테이너로 프록시)
// dev:    http://localhost:8081/api (Ktor 직접 호출)
const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8081/api";

export const fetchLogs = ({ limit = 100, offset = 0, type } = {}) => {
  const params = { limit, offset };
  if (type) params.type = type;
  return axios.get(`${BASE}/logs`, { params }).then((r) => r.data);
};

export const fetchStats = () =>
  axios.get(`${BASE}/stats`).then((r) => r.data);

export const fetchTopIps = (limit = 10) =>
  axios.get(`${BASE}/top-ips`, { params: { limit } }).then((r) => r.data);
