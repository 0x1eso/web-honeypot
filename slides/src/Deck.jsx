import { useCallback, useEffect, useState } from "react";

/**
 * Deck — 슬라이드 무대 + 내비게이션 엔진.
 *
 * 1280×720 고정 좌표계를 viewport 크기에 맞춰 transform scale 로 축소/확대.
 * 슬라이드는 전부 DOM 에 쌓여 있고 active class 만 옮겨 다닌다
 * (인쇄 시 전체가 그대로 페이지로 떨어지게 하기 위한 구조).
 *
 * 입력:
 *  - ← / → / Space / PageUp·Down / Home / End
 *  - 클릭: 화면 좌측 28% = 이전, 나머지 = 다음
 */
const W = 1280;
const H = 720;

export default function Deck({ slides }) {
  const n = slides.length;
  const [idx, setIdx] = useState(0);
  const [scale, setScale] = useState(1);

  const go = useCallback(
    (d) => setIdx((p) => Math.max(0, Math.min(n - 1, p + d))),
    [n]
  );

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown") {
        e.preventDefault();
        go(1);
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        go(-1);
      } else if (e.key === "Home") {
        setIdx(0);
      } else if (e.key === "End") {
        setIdx(n - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, n]);

  useEffect(() => {
    const fit = () =>
      setScale(Math.min(window.innerWidth / W, window.innerHeight / H));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  const onClick = (e) => {
    go(e.clientX / window.innerWidth < 0.28 ? -1 : 1);
  };

  const pad = (v) => String(v).padStart(2, "0");

  return (
    <div className="viewport" onClick={onClick}>
      <div
        className="stage"
        style={{ transform: `translate(-50%, -50%) scale(${scale})` }}
      >
        {slides.map((S, i) => (
          <section
            key={i}
            className={`slide${i === idx ? " active" : ""}`}
            aria-hidden={i !== idx}
          >
            <S />
          </section>
        ))}
      </div>
      <div className="progress" style={{ width: `${((idx + 1) / n) * 100}%` }} />
      <div className="hint">← → · click</div>
      <div className="pageNum">
        {pad(idx + 1)} <span>/ {pad(n)}</span>
      </div>
    </div>
  );
}
