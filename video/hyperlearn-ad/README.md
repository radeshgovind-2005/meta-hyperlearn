# HyperLearn: 30-second film

A 30 s promotional film for HyperLearn. It opens on an animated world and routes, shows genuine app footage, explains the agent workflow, and closes on an end card. The project is self-contained in `video/hyperlearn-ad/` (Remotion + TypeScript, numpy audio, FFmpeg).

## Deliverables (`deliverables/`)

| File | What |
|---|---|
| `hyperlearn-ad-4k.mp4` | 3840×2160, 30 fps, 30.0 s, H.264 High yuv420p + AAC 320k, faststart, burned-in captions |
| `hyperlearn-ad-4k-clean.mp4` | Same, no burned-in captions |
| `hyperlearn-ad-vertical-4k.mp4` | 2160×3840 adaptation (own layouts, not a crop), burned-in captions |
| `hyperlearn-ad-vertical-4k-clean.mp4` | Vertical, no burned-in captions (extra) |
| `hyperlearn-ad.srt` | Captions timed to the measured narration (sentence-level) |
| `hyperlearn-ad-thumbnail-h.jpg`, `-v.jpg` | 3840×2160 and 2160×3840 thumbnails |
| `contact-sheet-h.jpg`, `contact-sheet-v.jpg` | One frame per second, decoded from the delivered MP4s |

Local ProRes 422 HQ masters (silent) are kept in `out/master-*.mov`; `audio/mix.wav` is the 24-bit master mix. These generated intermediates, render previews, API caches and the Python environment are ignored by git; the finished MP4s, source and input assets are committed.

## Story and timing (narration-driven)

| s | Narration (ElevenLabs, Wyman) | Picture |
|---|---|---|
| 0.3 | The world never stops. It keeps changing. | Vector globe in real orthographic rotation; tool symbols ride three orbits and change each time they pass behind it; four people (Muse Image) in front |
| 3.7 | Those who don't learn to adapt risk being left behind. | Orbits flatten and fall into three routes; people walk their own routes |
| 7.05 | Don't let that happen to you. | The student pauses at a missing segment; other ways forward appear |
| 8.8 | Meet HyperLearn. | A path with a node bridges the gap and becomes the HyperLearn mark, then the wordmark |
| 10.45 | Your material. Your learning path. | Real course outline → real citation click; a blue line joins the sentence to the highlighted slide region |
| 13.15 | Agents generate, verify, and repair. | Real "Change this" request (3× speed), then the agent graph: Context → Text ‖ Widget → Verify → Save, Repair loop |
| 16.15 | Simplify an explanation. Explore an interactive example. | The graph's checks for this run, then the real rewritten paragraph and the plot widget dragged to zero |
| 20.3 | Practice, adapt your path, and share it with a friend, a colleague, or your students. | Real practice answer → "About 2 minutes later" re-planned path with Keep / Undo → real Share dialog (follow / copy) → the path branches to the people from the opening |
| 26.2 | HyperLearn. Keep learning, your way. | End card: logo, URL, "Try it • Explore the code", GitHub repo, hackathon credit |

## Rerender

```sh
cd video/hyperlearn-ad
npm ci && python3 -m venv .venv && .venv/bin/pip install numpy scipy pillow soundfile

# optional, only to regenerate inputs (all are cached / committed in public/ and audio/)
node scripts/trace-logo.mjs                 # vector logo from design/assets/logo.png
node scripts/01-storyboard.mjs              # Muse Spark art direction (cached)
node scripts/02-characters.mjs lineup && node scripts/02-characters.mjs poses   # Muse Image (cached)
.venv/bin/python scripts/03-cutout.py       # key characters
./scripts/04-footage.sh                     # crop + 1.9× Lanczos of ../cl/*.mp4
node scripts/06-voice.mjs take1             # split the ElevenLabs take, check with Muse Voice Transcribe (cached)

# timing, captions, audio
node scripts/05-measure.mjs                 # audio/cues.json + line lengths → src/lib/narration.json, out/hyperlearn-ad.srt
.venv/bin/python scripts/07-audio.py        # music + sound design + mix → audio/mix.wav (−16 LUFS, −1.5 dBTP ceiling)

# picture
npx remotion render src/index.ts Horizontal      out/master-h.mov       --codec=prores --prores-profile=hq --concurrency=6
npx remotion render src/index.ts HorizontalClean out/master-h-clean.mov --codec=prores --prores-profile=hq --concurrency=6
npx remotion render src/index.ts Vertical        out/master-v.mov       --codec=prores --prores-profile=hq --concurrency=6
npx remotion render src/index.ts VerticalClean   out/master-v-clean.mov --codec=prores --prores-profile=hq --concurrency=6
npx remotion still  src/index.ts ThumbH out/thumbH.png && npx remotion still src/index.ts ThumbV out/thumbV.png

./scripts/09-encode.sh                      # MP4s, thumbnails, SRT → deliverables/
```

`npx remotion studio src/index.ts` opens the editable timeline. Scene times derive from `audio/cues.json`, so a new voice take only needs new cue starts plus `05-measure` and `07-audio`.

Source layout: `src/lib` (tokens, fonts, timing), `src/components` (Globe, Person, Logo, Footage, Captions), `src/scenes` (Opening, AppStory, AgentGraph, EndCard, Thumbnail). Horizontal and vertical share every component and differ only in their layout tables.

## Models and services used

| Service | Used for | Calls | Cost |
|---|---|---|---|
| Muse Spark `muse-spark-1.3` | Storyboard refinement, art direction, the shared style sentence and character briefs (`docs/storyboard-spark.json`); two reviews of full-timeline contact sheets (`docs/spark-review-r1.json`, `-final.json`) | 3 | $0.088 (provider-reported tokens × $1.25 / $4.25 per M) |
| Muse Image `muse-image-1.0` | Character lineup (`/images/generations`) and 6 poses with the lineup as reference (`/images/edits`) | 7 | $0.070 ($0.01 each, dev.meta.ai/docs/image-generation) |
| Muse Voice Transcribe `muse-voice-transcribe-1.0` | Checking the take, each split line and the final mix against the script (speech to text, not TTS) | 11 | $0.004 ($0.18 per audio hour) |
| ElevenLabs (owner's account) | Narration, voice "Wyman – The Storyteller", Eleven v4, 2 takes | 2 generations | 415 credits (5,984 → 5,569) |

Meta API total: **about $0.16**, under the $3 cap. This is an estimate: provider-reported tokens and audio length (`cache/usage.jsonl`) times published prices. The API returns no invoice amount per call. One `/images/generations` call with a reference image was rejected (400, `unknown parameter images`) before generation and is not counted; the docs route reference images through `/images/edits`. Muse Spark does not make video. Everything was animated and composited locally.

## Truthfulness and limitations

- **App footage is archived, genuine and upscaled.** All app shots come from screen recordings of production made on 2026-11-03 (`video/cl/`, scripts `video/clip*.mjs`). A fresh, higher-resolution capture was not made: minting a sign-in token for the production account was declined by the session's permission policy. The recordings are 2160×1350 and are **upscaled 1.9× (Lanczos + light unsharp)**, so app close-ups are not native 4K. Everything else (vector art, type, diagram, logo) is rendered natively at output resolution.
- **Edits are labelled.** The typing is 3×, the widget drag 1.3×, practice 1.5× and share 1.8×. The path re-plan really took about 130 s and is shown after an "About 2 minutes later" cut. No UI state was invented.
- **Agent graph.** The graph diagrams `src/server/graphs/mutate.ts`: `writeText` and `buildWidget` run in parallel, `verify` checks each sentence against its cited chunk, recomputes widget claims with mathjs and loads the widget in a browser, and failures go back to the writers (`MAX_RETRIES = 2`). Repair is drawn as a dashed possibility ("only if a check fails"), never as something this run did. The three "This run" results (10/10 sentences matched, 3/3 claims hold, browser 0 errors) are copied from that run's own "How this was decided" panel.
- **No claims the film can't back.** The film does not name the verifier model; in production it is hosted Muse Spark, not an open-weight model. There are no claims of guaranteed correctness or learning gains, no SAM or Muse Code claims, and no endorsement implied. "Built with Meta AI • Powered by Cloudflare" and "Built during the Meta Global AI Developer Hackathon" are text credits.
- **Logos.** Meta's published brand page requires written Brand Review approval to use the Meta logo, so neither the Meta nor the Cerebral Valley logo is placed (see `ASSETS.md`).
- **Demo course.** The course was built from the repo's seed material: original CC BY 4.0 slides, a sample exam and synthetic lecture audio.
- **Privacy.** Crops exclude the sidebar that shows the account's spend and avatar. The captured invite field shows only the placeholder `ana@university.edu`. No keys, tokens or signed URLs appear in frames, logs or files (`scripts/meta.mjs` reads `.dev.vars` server-side and never prints it).
- **Captions.** The last line is not burned in because the end card sets the same words. It is in the SRT.
- **Annotation over footage.** The blue curve and outline in the citation shot are an editorial overlay (the film's route line), not app UI. The yellow source highlight underneath is the app's own.
- **People.** The four characters are generated illustrations, not real people. They are shown at or below their generated resolution.

## Quality control (final files, 2026-11-03)

| Check | Result |
|---|---|
| Format | All four MP4s: H.264 High, yuv420p, BT.709 tags, 30/1 fps, 900 frames, 30.000 s, AAC LC 48 kHz stereo 320k, `moov` before `mdat` (faststart) |
| Resolution | 3840×2160 and 2160×3840, rendered natively by Remotion (ProRes HQ masters), not scaled up from 1080p |
| Loudness | −16.0 LUFS integrated, −1.5 dBTP true peak (ebur128 on the delivered files). Speech sits 14.4 dB above the music and 17.4 dB above the effects |
| Black frames | None (blackdetect) |
| Colour | White decodes to Y = 235 (true white). An earlier encode shifted it to 233; fixed by declaring the master BT.709 limited range |
| Captions | All 13 SRT cues contain their speech (checked against voice-activity spans). Text matches Muse Voice Transcribe of every line |
| Intelligibility | Muse Voice Transcribe on the delivered mix (with music): 1.6% WER against the script; one trailing "way" doubled in the music tail |
| Secrets | Every key/secret/token value from `.dev.vars` searched across the project: 0 hits |
| Visual | Contact sheets of both deliveries plus full-res crops of the citation, graph checks, widget, end card and characters. Fixed: logo/card overlap, empty cards during graph transitions, double exposure between same-clip cuts, sliced-glyph logo wipe, vertical graph line through text |

Muse Spark reviewed the contact sheets twice. Accepted: feathered logo wipe, larger graph type, no ghosting between beats, branch timing, balanced captions. Declined, with reasons:
- "Illegible" app text and widget: legible at 4K (checked at 1:1). Enlarging further would add a second resample.
- "Cropped" vertical logo and "sliced" title: mid-wipe or mid-pan frames.
- Removing the citation connector: kept and disclosed above.

**Not done:** I could not listen to the audio. The soundtrack was checked with loudness and true-peak meters, waveforms, speech/bed ratios and machine transcription, not by ear. Give it one listen before posting.
