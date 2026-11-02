import { useId, useState } from "react";
import { apply2, eigen2, type Vector2dParams } from "@shared/widgets";

const r1 = (n: number) => Math.round(n * 10) / 10;
const fmt = (n: number) => (Math.abs(n - Math.round(n)) < 1e-9 ? String(Math.round(n)) : n.toFixed(2));

/** v turns with a slider; Av is drawn from the same origin. In eigen mode it says when they line up. */
export function Vector2d({ params }: { params: Vector2dParams }) {
  const A = params.A;
  const [theta, setTheta] = useState(params.startAngle ?? 20);
  const id = useId();
  const t = (theta * Math.PI) / 180;
  const v: [number, number] = [Math.cos(t), Math.sin(t)];
  const av = apply2(A, v);
  const S = 45;
  const o = 140;
  const len = Math.hypot(av[0], av[1]);
  const scale = len * S > 125 ? 125 / (len * S) : 1;
  const ax = r1(o + S * av[0] * scale);
  const ay = r1(o - S * av[1] * scale);
  const cross = v[0] * av[1] - v[1] * av[0];
  const aligned = len > 1e-9 ? Math.abs(cross) / len < 0.035 : true;
  const lambda = v[0] * av[0] + v[1] * av[1];
  const eig = eigen2(A);
  const color = params.mode === "eigen" && aligned ? "#0A7A3D" : "#0A5CFF";
  const status =
    params.mode === "eigen"
      ? aligned
        ? `Same line. v is an eigenvector, and λ = ${fmt(Math.round(lambda * 100) / 100)}.`
        : "Av points a different way, so v is not an eigenvector yet."
      : `Av = (${fmt(av[0])}, ${fmt(av[1])}). Length ${len.toFixed(2)}.`;
  // snap the slider to exact eigen-directions so they can actually be found
  const snaps = eig.flatMap((e) => {
    const a = (Math.atan2(e.v[1], e.v[0]) * 180) / Math.PI;
    return [((a % 360) + 360) % 360, ((a + 180) % 360 + 360) % 360];
  });
  const onSlide = (val: number) => {
    const near = snaps.find((s) => Math.abs(s - val) < 2.5);
    setTheta(near !== undefined ? Math.round(near * 10) / 10 : val);
  };
  return (
    <div className="row" style={{ gap: 24, alignItems: "center" }} data-widget-ready>
      <svg viewBox="0 0 280 280" role="img" aria-label={aligned && params.mode === "eigen" ? "v and Av lie on the same line" : "v and Av point in different directions"} style={{ flex: "0 1 260px", maxWidth: 260, height: "auto" }}>
        <path d="M10 140H270M140 10V270" stroke="#E3E6EA" strokeWidth="1" fill="none" />
        <line x1={r1(o - 130 * v[0])} y1={r1(o + 130 * v[1])} x2={r1(o + 130 * v[0])} y2={r1(o - 130 * v[1])} stroke="#A9B1BA" strokeWidth="1" strokeDasharray="4 4" />
        <line x1={o} y1={o} x2={ax} y2={ay} stroke={color} strokeWidth="5" strokeLinecap="round" opacity="0.55" />
        <circle cx={ax} cy={ay} r="5" fill={color} />
        <line x1={o} y1={o} x2={r1(o + S * v[0])} y2={r1(o - S * v[1])} stroke="#1C2B33" strokeWidth="3" strokeLinecap="round" />
        <circle cx={r1(o + S * v[0])} cy={r1(o - S * v[1])} r="4" fill="#1C2B33" />
      </svg>
      <div style={{ flex: "1 1 220px", display: "flex", flexDirection: "column", gap: 12 }}>
        <p style={{ fontSize: 14, color: "var(--body)" }}>
          A = [[{A[0].join(", ")}], [{A[1].join(", ")}]]. Black is v. {params.mode === "eigen" ? "Blue is Av." : "Blue is Av."}
        </p>
        <label htmlFor={id} style={{ fontSize: 14, fontWeight: 500 }}>
          Direction of v: {Math.round(theta)}°
        </label>
        <input id={id} type="range" min={0} max={359} step={1} value={theta} onChange={(e) => onSlide(Number(e.target.value))} onInput={(e) => onSlide(Number((e.target as HTMLInputElement).value))} style={{ accentColor: "#0A5CFF" }} />
        <p aria-live="polite" style={{ fontSize: 15, fontWeight: 500, color: params.mode === "eigen" && aligned ? "#0A7A3D" : "#3E4C59" }}>
          {status}
        </p>
        {params.caption && <p className="small muted">{params.caption}</p>}
      </div>
    </div>
  );
}
