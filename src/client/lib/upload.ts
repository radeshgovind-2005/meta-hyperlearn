import { api } from "./api";

export type Kind = "slides" | "paper" | "notes" | "exam" | "audio";

export function guessKind(file: File): Kind {
  const n = file.name.toLowerCase();
  if (file.type.startsWith("audio/") || file.type.startsWith("video/") || /\.(m4a|mp3|wav|ogg|webm|mp4|mov)$/.test(n)) return "audio";
  if (/exam|midterm|final|quiz|test_?\d|tentamen/.test(n)) return "exam";
  if (/slide|lecture|^l\d+|week/.test(n)) return "slides";
  if (/note/.test(n)) return "notes";
  return "paper";
}

export function accepted(file: File): boolean {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name) || guessKind(file) === "audio";
}

/**
 * Uploads one file: for PDFs we render page images in the browser (Workers have no
 * canvas); for recordings we decode, resample to 16 kHz mono and cut 9-minute WAV parts
 * (the transcription API takes WAV up to 10 minutes). Then ingest starts on the server.
 */
export async function uploadSource(file: File, kind: Kind, onProgress: (label: string, pct: number) => void, base = "/api/sources"): Promise<string> {
  const { id } = await api<{ id: string }>(base, { body: { filename: file.name, kind, mime: file.type || (kind === "audio" ? "audio/mpeg" : "application/pdf"), size: file.size } });
  if (kind === "audio") {
    onProgress("Preparing audio", 5);
    const segments = await audioSegments(file);
    for (let k = 0; k < segments.length; k++) {
      onProgress(`Uploading part ${k + 1} of ${segments.length}`, 10 + (60 * k) / segments.length);
      await api(`${base}/${id}/segments/${k}?offsetMs=${segments[k].offsetMs}`, { method: "PUT", raw: segments[k].wav, contentType: "audio/wav" });
    }
  } else {
    onProgress("Rendering pages", 5);
    await renderPdfPages(file, async (n, total, png) => {
      onProgress(`Rendering page ${n} of ${total}`, 5 + (60 * n) / total);
      await api(`${base}/${id}/pages/${n}`, { method: "PUT", raw: png, contentType: "image/png" });
    });
  }
  onProgress("Uploading file", 70);
  await api(`${base}/${id}/file`, { method: "PUT", raw: file, contentType: file.type || "application/octet-stream" });
  await api(`${base}/${id}/ingest`, { body: {} });
  onProgress("Queued", 75);
  return id;
}

async function renderPdfPages(file: File, onPage: (n: number, total: number, png: Blob) => Promise<void>) {
  const pdfjs = await import("pdfjs-dist");
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const total = Math.min(doc.numPages, 300);
  for (let n = 1; n <= total; n++) {
    const page = await doc.getPage(n);
    const vp1 = page.getViewport({ scale: 1 });
    const scale = Math.min(2, 1400 / vp1.width);
    const vp = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(vp.width);
    canvas.height = Math.ceil(vp.height);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise;
    const blob = await new Promise<Blob>((res) => canvas.toBlob((b) => res(b!), "image/png"));
    await onPage(n, total, blob);
  }
}

const SEG_SECONDS = 9 * 60;

async function audioSegments(file: File): Promise<{ wav: Blob; offsetMs: number }[]> {
  const ctx = new AudioContext();
  const decoded = await ctx.decodeAudioData(await file.arrayBuffer());
  await ctx.close();
  const rate = 16000;
  const length = Math.ceil(decoded.duration * rate);
  const off = new OfflineAudioContext(1, length, rate);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start();
  const mono = (await off.startRendering()).getChannelData(0);
  const out: { wav: Blob; offsetMs: number }[] = [];
  for (let start = 0; start < mono.length; start += SEG_SECONDS * rate) {
    const slice = mono.subarray(start, Math.min(mono.length, start + SEG_SECONDS * rate));
    out.push({ wav: encodeWav(slice, rate), offsetMs: Math.round((start / rate) * 1000) });
  }
  return out;
}

function encodeWav(samples: Float32Array, rate: number): Blob {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const w = (o: number, s: string) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  w(0, "RIFF");
  v.setUint32(4, 36 + samples.length * 2, true);
  w(8, "WAVE");
  w(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  w(36, "data");
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 0x7fff, true);
  return new Blob([buf], { type: "audio/wav" });
}
