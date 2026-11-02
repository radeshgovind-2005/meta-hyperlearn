import { useState } from "react";
import { Md } from "../components/Md";

export function Stepper({ steps }: { steps: { title: string; md: string }[] }) {
  const [n, setN] = useState(1);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }} data-widget-ready>
      <ol style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 10 }}>
        {steps.slice(0, n).map((s, i) => (
          <li key={i}>
            <p style={{ fontWeight: 600, fontSize: 14 }}>{s.title}</p>
            <p className="serif" style={{ fontSize: 17, lineHeight: 1.55 }}>
              <Md text={s.md} />
            </p>
          </li>
        ))}
      </ol>
      <div className="row">
        <button type="button" className="btn btn-sm" disabled={n >= steps.length} onClick={() => setN((x) => x + 1)}>
          {n >= steps.length ? "All steps shown" : `Show step ${n + 1} of ${steps.length}`}
        </button>
        {n > 1 && <button type="button" className="link-btn muted" onClick={() => setN(1)}>Start over</button>}
      </div>
    </div>
  );
}
