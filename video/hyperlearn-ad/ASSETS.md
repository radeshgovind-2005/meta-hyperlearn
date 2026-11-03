# Asset manifest

| Asset | Local path | Origin | Licence / terms | Usage notes |
|---|---|---|---|---|
| HyperLearn logo (raster) | `public/brand/logo.png`, `icon.png`, `icon-white.png` | `design/assets/` in this repo | HyperLearn's own | Source for the vector trace; never redrawn by an image model |
| HyperLearn logo (vector trace) | `src/lib/logo-paths.json` | `scripts/trace-logo.mjs` (potrace of `logo.png`, 6× Lanczos + smoothed mask) | HyperLearn's own | Used for every logo appearance so it stays crisp at 4K. Colours #0A5CFF / #1C2B33 per AGENTS.md. Small trace softening at corners is below display resolution |
| Figtree | `public/fonts/Figtree.ttf` | github.com/google/fonts `ofl/figtree` | SIL OFL 1.1 (`OFL-Figtree.txt`) | All UI typography |
| Source Serif 4 | `public/fonts/SourceSerif4.ttf` | github.com/google/fonts `ofl/sourceserif4` | SIL OFL 1.1 (`OFL-SourceSerif4.txt`) | Course text in the graph's source card |
| GitHub mark | `public/brand/github-mark-octicons-24.svg` | github.com/primer/octicons `icons/mark-github-24.svg` | MIT (`octicons-LICENSE.txt`) | End card repository line, unmodified shape |
| Symbol icons on the orbits | `lucide-react` (npm) | lucide.dev | ISC | Generic tool symbols (book, laptop, chip …); no brand marks |
| World land shapes | `world-atlas/land-110m.json` (npm) | Natural Earth via world-atlas | Public domain (Natural Earth) / ISC (package) | Real orthographic rotation with d3-geo |
| Characters (lineup + 6 poses) | `public/gen/*.png` (raw), `public/cut/*.png` (keyed) | Muse Image `muse-image-1.0`, Meta Model API, 2026-11-03 | Generated for this project | Prompts in `scripts/02-characters.mjs`, art direction from Muse Spark in `docs/storyboard-spark.json`. Poses used the lineup sheet as a reference image (`/images/edits`). No text or logos requested. Native 1280×1920 (poses) and 2240×1120 (lineup); always displayed at or below native size |
| App footage | `public/captures/*.mp4` | `video/cl/*.mp4` — CDP screencasts of hyperlearn.radesh-govind.com, recorded 2026-11-03 by `video/clip*.mjs` | HyperLearn's own | Genuine recordings, unaltered content. Cropped at x ≥ 300 (removes the sidebar with account usage) and upscaled once, 1.9× Lanczos (2160×1350 → 3534×2565). Speed changes labelled on screen |
| Narration | `audio/elevenlabs/take1.mp3` → `audio/wyman/v*.wav` | ElevenLabs Text to Speech, voice "Wyman – The Storyteller" (ElevenLabs voice library), model Eleven v4, generated in the owner's ElevenLabs account | ElevenLabs terms for the owner's account | Not a clone of a real person. Split at natural pauses, no time-stretch. Take 2 kept as an alternate |
| Music + sound design | `audio/stems-*.wav`, `audio/mix.wav` | Synthesised by `scripts/07-audio.py` (numpy, seeded) | Original, made for this project | No samples or third-party audio |

## Not used, on purpose

- **Meta logo.** meta.com/brand/resources/meta/company-brand says the logo needs written approval through Meta's Brand Review before use. The credit is set in text. `src/scenes/EndCard.tsx` has no logo slot to switch on; add one only after approval.
- **Cerebral Valley logo.** No published usage guidance was found; it is left out alongside the Meta logo so the credit stays consistent and HyperLearn dominant.
- **Model logos.** No official per-model marks; product names are text.
