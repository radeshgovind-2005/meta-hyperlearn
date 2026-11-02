import { useId, useMemo, useState } from "react";
import { plotFunction, type PlotParams } from "@shared/widgets";

export function Plot({ params }: { params: PlotParams }) {
  const [vals, setVals] = useState<Record<string, number>>(Object.fromEntries(params.sliders.map((s) => [s.name, s.value])));
  const baseId = useId();
  const W = 420;
  const H = 260;
  const { path, yMin, yMax, error } = useMemo(() => {
    try {
      const f = plotFunction(params.expr, vals);
      const pts: [number, number][] = [];
      const n = 200;
      for (let i = 0; i <= n; i++) {
        const x = params.xMin + ((params.xMax - params.xMin) * i) / n;
        const y = f(x);
        if (Number.isFinite(y)) pts.push([x, y]);
      }
      let lo = Math.min(...pts.map((p) => p[1]));
      let hi = Math.max(...pts.map((p) => p[1]));
      if (lo > 0) lo = Math.min(0, lo);
      if (hi < 0) hi = Math.max(0, hi);
      if (hi - lo < 1e-6) { hi += 1; lo -= 1; }
      const pad = (hi - lo) * 0.08;
      lo -= pad;
      hi += pad;
      const sx = (x: number) => ((x - params.xMin) / (params.xMax - params.xMin)) * W;
      const sy = (y: number) => H - ((y - lo) / (hi - lo)) * H;
      const d = pts.map((p, i) => `${i ? "L" : "M"}${sx(p[0]).toFixed(1)} ${sy(p[1]).toFixed(1)}`).join("");
      return { path: d, yMin: lo, yMax: hi, error: null as string | null };
    } catch (e) {
      return { path: "", yMin: -1, yMax: 1, error: (e as Error).message };
    }
  }, [params, vals]);
  const sx = (x: number) => ((x - params.xMin) / (params.xMax - params.xMin)) * W;
  const sy = (y: number) => H - ((y - yMin) / (yMax - yMin)) * H;
  return (
    <div className="row" style={{ gap: 24, alignItems: "center" }} data-widget-ready>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Plot of y = ${params.expr}`} style={{ flex: "1 1 300px", maxWidth: 440, height: "auto", border: "1px solid var(--border)", borderRadius: 8 }}>
        {yMin < 0 && yMax > 0 && <line x1={0} x2={W} y1={sy(0)} y2={sy(0)} stroke="#D4D9DE" />}
        {params.xMin < 0 && params.xMax > 0 && <line y1={0} y2={H} x1={sx(0)} x2={sx(0)} stroke="#D4D9DE" />}
        <path d={path} fill="none" stroke="#0A5CFF" strokeWidth="2.5" />
        {params.markers.map((m) => {
          try {
            const y = plotFunction(params.expr, vals)(m.x);
            return (
              <g key={m.label}>
                <circle cx={sx(m.x)} cy={sy(y)} r="5" fill="#0A7A3D" />
                <text x={sx(m.x) + 8} y={sy(y) - 8} fontSize="12" fontFamily="Figtree, sans-serif" fill="#1C2B33">{m.label}</text>
              </g>
            );
          } catch {
            return null;
          }
        })}
      </svg>
      <div style={{ flex: "1 1 200px", display: "flex", flexDirection: "column", gap: 12 }}>
        <p style={{ fontSize: 14, color: "var(--body)" }}>y = {params.expr}</p>
        {params.sliders.map((s) => (
          <div key={s.name} className="field">
            <label htmlFor={`${baseId}-${s.name}`} style={{ fontSize: 14, fontWeight: 500 }}>
              {s.name} = {vals[s.name]}
            </label>
            <input id={`${baseId}-${s.name}`} type="range" min={s.min} max={s.max} step={s.step} value={vals[s.name]} onChange={(e) => setVals((v) => ({ ...v, [s.name]: Number(e.target.value) }))} style={{ accentColor: "#0A5CFF" }} />
          </div>
        ))}
        {error && <p className="small err-text">{error}</p>}
        {params.caption && <p className="small muted">{params.caption}</p>}
      </div>
    </div>
  );
}
