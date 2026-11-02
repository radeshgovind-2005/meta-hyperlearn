import { useId, useMemo, useRef, useState } from "react";
import { niceTicks, plotFunction, plotGoalMet, plotRange, type PlotParams } from "@shared/widgets";

const W = 460;
const H = 280;
const L = 52; // room for y tick labels
const B = 40; // room for x tick labels and axis name
const T = 12;
const R = 14;

function fmt(n: number): string {
  if (!Number.isFinite(n)) return "–";
  const a = Math.abs(n);
  if (a >= 1000 || (a > 0 && a < 0.01)) return n.toPrecision(3);
  return String(Math.round(n * 100) / 100);
}

/**
 * y = f(x) with sliders. The axes stay fixed over every slider setting, so moving a slider
 * visibly moves the curve; the faint dashed curve is where it started. The probe follows x.
 */
export function Plot({ params }: { params: PlotParams }) {
  const initial = useMemo(() => Object.fromEntries(params.sliders.map((s) => [s.name, s.value])), [params]);
  const [vals, setVals] = useState<Record<string, number>>(initial);
  const [x, setX] = useState(params.xStart ?? params.xMin + (params.xMax - params.xMin) * 0.4);
  const baseId = useId();
  const svgRef = useRef<SVGSVGElement>(null);
  const { yMin, yMax } = useMemo(() => plotRange(params), [params]);
  const sx = (v: number) => L + ((v - params.xMin) / (params.xMax - params.xMin)) * (W - L - R);
  const sy = (v: number) => T + (1 - (Math.min(Math.max(v, yMin - (yMax - yMin)), yMax + (yMax - yMin)) - yMin) / (yMax - yMin)) * (H - T - B);

  const curve = (scope: Record<string, number>) => {
    const f = plotFunction(params.expr, scope);
    let d = "";
    let pen = false;
    for (let i = 0; i <= 240; i++) {
      const xv = params.xMin + ((params.xMax - params.xMin) * i) / 240;
      const y = f(xv);
      if (!Number.isFinite(y)) { pen = false; continue; }
      d += `${pen ? "L" : "M"}${sx(xv).toFixed(1)} ${sy(y).toFixed(1)}`;
      pen = true;
    }
    return d;
  };

  const { path, ghost, y, error } = useMemo(() => {
    try {
      const moved = params.sliders.some((s) => vals[s.name] !== initial[s.name]);
      return { path: curve(vals), ghost: moved ? curve(initial) : "", y: plotFunction(params.expr, vals)(x), error: null as string | null };
    } catch (e) {
      return { path: "", ghost: "", y: NaN, error: (e as Error).message };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, vals, x, yMin, yMax]);

  const xTicks = niceTicks(params.xMin, params.xMax, 6);
  const yTicks = niceTicks(yMin, yMax, 5);
  const reached = params.goal ? plotGoalMet(params, vals, x) : false;
  const xStep = (params.xMax - params.xMin) / 200;

  const probeFromPointer = (clientX: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const px = ((clientX - rect.left) / rect.width) * W;
    const v = params.xMin + ((px - L) / (W - L - R)) * (params.xMax - params.xMin);
    setX(Math.min(params.xMax, Math.max(params.xMin, Math.round(v / xStep) * xStep)));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }} data-widget-ready>
      {params.goal && (
        <p className={`widget-goal${reached ? " done" : ""}`} aria-live="polite">
          {reached ? params.goal.done : params.goal.text}
        </p>
      )}
      <div className="row" style={{ gap: 24, alignItems: "flex-start" }}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`Plot of ${params.yLabel} = ${params.expr}. At ${params.xLabel} = ${fmt(x)}, ${params.yLabel} = ${fmt(y)}.`}
          className="plot-svg"
          onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); probeFromPointer(e.clientX); }}
          onPointerMove={(e) => e.buttons === 1 && probeFromPointer(e.clientX)}
        >
          {yTicks.map((t) => (
            <g key={`y${t}`}>
              <line x1={L} x2={W - R} y1={sy(t)} y2={sy(t)} className={t === 0 ? "plot-axis" : "plot-grid"} />
              <text x={L - 6} y={sy(t) + 4} textAnchor="end" className="plot-tick">{fmt(t)}</text>
            </g>
          ))}
          {xTicks.map((t) => (
            <g key={`x${t}`}>
              <line y1={T} y2={H - B} x1={sx(t)} x2={sx(t)} className={t === 0 ? "plot-axis" : "plot-grid"} />
              <text x={sx(t)} y={H - B + 16} textAnchor="middle" className="plot-tick">{fmt(t)}</text>
            </g>
          ))}
          <text x={(L + W - R) / 2} y={H - 4} textAnchor="middle" className="plot-name">{params.xLabel}</text>
          <text x={12} y={(T + H - B) / 2} textAnchor="middle" className="plot-name" transform={`rotate(-90 12 ${(T + H - B) / 2})`}>{params.yLabel}</text>
          {ghost && <path d={ghost} fill="none" className="plot-ghost" />}
          <path d={path} fill="none" stroke="#0A5CFF" strokeWidth="2.5" />
          {params.markers.map((m) => {
            try {
              const my = plotFunction(params.expr, vals)(m.x);
              return (
                <g key={`${m.label}-${m.x}`}>
                  <circle cx={sx(m.x)} cy={sy(my)} r="4.5" fill="#0A7A3D" />
                  <text x={sx(m.x) + 7} y={sy(my) - 7} className="plot-tick" style={{ fill: "#1C2B33" }}>{m.label}</text>
                </g>
              );
            } catch {
              return null;
            }
          })}
          {Number.isFinite(y) && (
            <g>
              <line x1={sx(x)} x2={sx(x)} y1={T} y2={H - B} className="plot-probe-line" />
              <circle cx={sx(x)} cy={sy(y)} r="6" fill={reached ? "#0A7A3D" : "#1C2B33"} stroke="#fff" strokeWidth="2" />
            </g>
          )}
        </svg>
        <div style={{ flex: "1 1 200px", display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
          <p className="plot-readout" aria-live="polite">
            {params.xLabel} = <strong>{fmt(x)}</strong> → {params.yLabel} = <strong>{fmt(y)}</strong>
          </p>
          <div className="field">
            <label htmlFor={`${baseId}-x`} style={{ fontSize: 14, fontWeight: 500 }}>Move {params.xLabel}</label>
            <input id={`${baseId}-x`} type="range" min={params.xMin} max={params.xMax} step={xStep} value={x} onChange={(e) => setX(Number(e.target.value))} style={{ accentColor: "#1C2B33" }} />
          </div>
          {params.sliders.map((s) => (
            <div key={s.name} className="field">
              <label htmlFor={`${baseId}-${s.name}`} style={{ fontSize: 14, fontWeight: 500 }}>
                {s.label ? `${s.label} (${s.name})` : s.name} = {fmt(vals[s.name])}
              </label>
              <input id={`${baseId}-${s.name}`} type="range" min={s.min} max={s.max} step={s.step} value={vals[s.name]} onChange={(e) => setVals((v) => ({ ...v, [s.name]: Number(e.target.value) }))} style={{ accentColor: "#0A5CFF" }} />
            </div>
          ))}
          <p className="small muted">{params.yLabel} = {params.expr}</p>
          {ghost && <button type="button" className="link-btn" style={{ alignSelf: "flex-start", fontSize: 13 }} onClick={() => setVals(initial)}>Reset sliders</button>}
          {error && <p className="small err-text">{error}</p>}
          {params.caption && <p className="small muted">{params.caption}</p>}
        </div>
      </div>
    </div>
  );
}
