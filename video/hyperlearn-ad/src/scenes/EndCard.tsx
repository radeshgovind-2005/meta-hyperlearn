import React from 'react';
import { AbsoluteFill } from 'remotion';
import { Logo, LOGO_ASPECT } from '../components/Logo';
import { Person } from '../components/Person';
import { easeOut, prog, sceneTimes } from '../lib/anim';
import { C, F, SIZE, type Orientation } from '../lib/tokens';

// GitHub mark from primer/octicons (MIT, public/brand/github-mark-octicons-24.svg).
const GH = 'M10.226 17.284c-2.965-.36-5.054-2.493-5.054-5.256 0-1.123.404-2.336 1.078-3.144-.292-.741-.247-2.314.09-2.965.898-.112 2.111.36 2.83 1.01.853-.269 1.752-.404 2.853-.404 1.1 0 1.999.135 2.807.382.696-.629 1.932-1.1 2.83-.988.315.606.36 2.179.067 2.942.72.854 1.101 2 1.101 3.167 0 2.763-2.089 4.852-5.098 5.234.763.494 1.28 1.572 1.28 2.807v2.336c0 .674.561 1.056 1.235.786 4.066-1.55 7.255-5.615 7.255-10.646C23.5 6.188 18.334 1 11.978 1 5.62 1 .5 6.188.5 12.545c0 4.986 3.167 9.12 7.435 10.669.606.225 1.19-.18 1.19-.786V20.63a2.9 2.9 0 0 1-1.078.224c-1.483 0-2.359-.808-2.987-2.313-.247-.607-.517-.966-1.034-1.033-.27-.023-.359-.135-.359-.27 0-.27.45-.471.898-.471.652 0 1.213.404 1.797 1.235.45.651.921.943 1.483.943.561 0 .92-.202 1.437-.719.382-.381.674-.718.944-.943';

export const EndCardBody: React.FC<{ o: Orientation; t?: number; t0?: number; still?: boolean }> = ({ o, t = 99, t0 = 0, still }) => {
  const { w: W, h: H } = SIZE[o];
  const at = (a: number, b: number) => (still ? 1 : prog(t, t0 + a, t0 + b, easeOut));
  const h = o === 'h';
  const logoW = h ? 1900 : 1640;
  const u = h ? 1 : 0.95;
  const rise = (k: number) => ({ opacity: k, transform: `translateY(${(1 - k) * 40}px)` });
  const pulse = still ? 0 : prog(t, t0 + 0.5, t0 + 1.4);
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', fontFamily: F.ui, paddingTop: h ? 400 : 700 }}>
      <div style={{ position: 'relative', ...rise(at(0, 0.5)) }}>
        <Logo width={logoW} wipe={at(0.1, 0.7)} />
        {pulse > 0 && pulse < 1 && (
          <div style={{ position: 'absolute', left: logoW * 0.118 - 60, top: (logoW / LOGO_ASPECT) * 0.39 - 60, width: 120, height: 120, borderRadius: 999, border: `8px solid ${C.blue}`, opacity: 1 - pulse, transform: `scale(${1 + pulse * 2.4})` }} />
        )}
      </div>
      <div style={{ marginTop: 90 * u, fontSize: 150 * u, fontWeight: 700, color: C.ink, letterSpacing: -2, ...rise(at(0.35, 0.85)) }}>Keep learning, your way.</div>
      <div style={{ marginTop: 70 * u, fontSize: 84 * u, fontWeight: 700, color: C.blue, ...rise(at(0.55, 1.05)) }}>hyperlearn.radesh-govind.com</div>
      <div style={{ marginTop: 26 * u, display: 'flex', flexDirection: h ? 'row' : 'column', alignItems: 'center', gap: h ? 44 : 30, ...rise(at(0.7, 1.2)) }}>
        <div style={{ fontSize: 60 * u, fontWeight: 600, color: C.body }}>Try it <span style={{ color: C.input }}>•</span> Explore the code</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, fontSize: 60 * u, fontWeight: 600, color: C.ink }}>
          <svg width={64 * u} height={64 * u} viewBox="0 0 24 24"><path d={GH} fill={C.ink} /></svg>
          radeshgovind-2005/meta-hyperlearn
        </div>
      </div>
      <div style={{ position: 'absolute', bottom: h ? 330 : 720, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18, ...rise(at(0.95, 1.45)) }}>
        <div style={{ fontSize: 46 * u, fontWeight: 600, color: C.body }}>Built during the Meta Global AI Developer Hackathon</div>
        <div style={{ fontSize: 42 * u, fontWeight: 500, color: C.muted }}>Built with Meta AI <span style={{ color: C.input }}>•</span> Powered by Cloudflare</div>
      </div>
      {!h && (['learner-stand', 'student-go', 'worker-stand', 'teacher-stand'] as const).map((k, i) => {
        const kk = at(0.8 + i * 0.08, 1.3 + i * 0.08);
        return <Person key={k} k={k} x={330 + i * 500} y={2860 + (1 - kk) * 40} h={k === 'student-go' ? 760 : 720} t={t} phase={i} opacity={kk} />;
      })}
      <div style={{ position: 'absolute', width: W, height: H, pointerEvents: 'none' }} />
    </div>
  );
};

export const EndCard: React.FC<{ t: number; o: Orientation }> = ({ t, o }) => {
  const t0 = sceneTimes().end[0];
  return (
    <AbsoluteFill style={{ background: C.white, opacity: prog(t, t0 - 0.1, t0 + 0.3) }}>
      <EndCardBody o={o} t={t} t0={t0 + 0.1} />
    </AbsoluteFill>
  );
};
