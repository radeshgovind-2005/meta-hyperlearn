// Vector trace of HyperLearn's own raster logo (design/assets) so it stays crisp at 4K.
// Colors are sampled, not invented: blue part of the mark and the ink wordmark are traced separately.
import sharp from 'sharp';
import potrace from 'potrace';
import { writeFile } from 'node:fs/promises';
const trace = (buf, opts) => new Promise((res, rej) => potrace.trace(buf, opts, (e, svg) => e ? rej(e) : res(svg)));
async function layer(src, pick, scale) {
  const img = sharp(src); const { width, height } = await img.metadata();
  const { data, info } = await img.resize(width * scale, height * scale, { kernel: 'lanczos3' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.alloc(info.width * info.height);
  for (let i = 0; i < out.length; i++) { const [r, g, b, a] = data.subarray(i * 4, i * 4 + 4); out[i] = a > 128 && pick(r, g, b) ? 0 : 255; }
  const png = await sharp(out, { raw: { width: info.width, height: info.height, channels: 1 } }).blur(5).threshold(128).png().toBuffer();
  const svg = await trace(png, { threshold: 128, turdSize: 100, optTolerance: 0.4, alphaMax: 1.1 });
  return { d: svg.match(/ d="([^"]+)"/)[1], w: info.width, h: info.height };
}
const blue = (r, g, b) => b > 150 && b - r > 80;
const ink = (r, g, b) => r < 140 && b < 150 && b - r < 60;
const logoB = await layer('public/brand/logo.png', blue, 6), logoI = await layer('public/brand/logo.png', ink, 6);
await writeFile('src/lib/logo-paths.json', JSON.stringify({ logo: { w: logoB.w, h: logoB.h, blue: logoB.d, ink: logoI.d } }));
console.log('traced', logoB.w, logoB.h, logoB.d.length, logoI.d.length);
