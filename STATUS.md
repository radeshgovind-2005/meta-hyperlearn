# Status

**Current step:** Widget fix, 25 practice question types, non-blocking waits and the Listen script are deployed (Worker version `9ee303d8-37e2-4597-bb5c-f812b46cb32a` plus a feedback-punctuation fix).

Verified locally against the real Meta API (2026-11-02): ingest of 4 sources (PDF positions, ASR turns, exam style) → course build (45/45 sentences supported) → mutate simplify + widget (5/5 sentences, mathjs claims, Keep → v2) → practice grading (caught the ad+bc sign error) → adapt (Wonder inserted a 4-min review, 9/9 sentences, Keep → v3).

## Done (code complete, lint + types + 37 Workers tests green)
- Steps 1–8 implemented in code: auth, BYOK, ingest, course build, reader with citations, mutate with verify loop and Keep/Undo, history, practice + adapt, audio citations, voice input, Listen mode, open-weight verifier client, share/follow/copy/updates, command bar, research.
- Seed material generated in `seed/`.

## Next
Record the 3-minute video, post on X, and submit before Wed Nov 4, 9:00 PM ET. Existing external limitations remain listed in BLOCKERS.md.

## Widgets, question types, waiting, Listen (2026-11-02)
- Plot widgets: fixed y-range over all slider settings, labelled ticks, dashed starting curve, draggable probe with live readout, optional goal checked in code. Vector widget: drag the arrow, counts eigen-directions found. Structural checks (unused slider, unreachable goal) and a browser check that each slider changes the screenshot feed the mutate retry loop.
- Practice: 25 types in `src/shared/questions.ts`; 21 graded in code (`gradeResponse`), 4 by Muse Spark. Solutions never reach the browser before an answer. Migration 0003 (plan, writing lock, qtype, spec, confidence, response) applied remotely.
- Rounds open instantly; `/practice/:id/write` writes 1 question, then the rest; broken specs get one repair call, then are dropped.
- `Working` (elapsed + usual time) and skeletons replace "Loading…"; Listen fetches a cached Muse Spark script (`/sections/:id/listen`, R2 `listen/<sha>.json`) with Pause/Resume and Ask by voice.
- Verified: 54 Workers tests, typecheck, lint; production via the seed API: 4 rounds covered all 25 types, all 23 code-graded answer keys self-check, session opens in 0.3–0.9 s, first question 4–9 s, code grading 0.2 s, Spark grading ~5 s, Listen script 7.6 s first / 0.4 s cached. Widgets checked in the browser on `/embed/widget` (goal turns green, ghost curve, drag).
- Not exercised: the signed-in Practice page, reader Listen bar and Ask by voice in a browser (needs the owner's sign-in).

## Pictures (2026-11-02)
- Muse Image (`POST /images/generations`, webp, 16:9-ish, ~10 s, $0.01) draws a hero figure (`generated: true`, first block) for every section: in `BuildSectionWorkflow` (best effort step `illustrate`), lazily via `POST /api/courses/:id/sections/:sid/illustrate` for older pages, and from the mutate graph (`addImage` intent, or widget template `illustration`; a selected picture is replaced in place). Kill switch: `ILLUSTRATIONS=off`.
- Tests: 76 Workers tests (new `tests/image.test.ts`, hero cases in `tests/build.test.ts`).

## Reader fixes (2026-11-02)
- Removed the "Show as" toggle and its `/view` route.
- Command bar is pinned to the bottom of the viewport on every screen (sticky dock).
- Mutations save as soon as they pass verification (no Keep step); later requests build on the saved version; Undo and Try another way commit the previous blocks back.
- Verified on production (Worker version `02dfa257-edc5-4fb5-9162-58819c4d40b5`) with Playwright on the demo course: two stacked changes persisted across reload, Undo restored the original, and the test overlay was removed afterwards.

## Math pages (2026-11-03)
- Formulas are typeset with KaTeX (`Md.tsx`): `$inline$` and `$$display$$` on its own line, stacked fractions, subscripts, and a "where:" legend (`- $T_1$ is ...`) that says what each symbol is.
- Writers (`MATH_RULES` in `build.ts`, used by course build and mutate) produce that shape; `normalizeMath` fixes `\[ \]` and multi-line formulas. The verifier checks the formula and each legend line as its own unit; dropping an unsupported sentence keeps the lines intact (`dropSentences`).
- Interactive example by default for math: course build has a best-effort `interact` step (`course/interactive.ts`, tested like mutate widgets: params, mathjs claims, browser run), and "Change this" on a formula paragraph adds one unless the next block already is one (`applyMathDefaults`).
- Demo course `crs_qdhs2ck5wt`: all 8 pages rewritten through the real mutate graph on production (versions 10–25): formula on its own line, symbol legend, interactive example on every page (plot, vector2d or custom). Legends are uneven in places (some lines are thin). A user's own courses keep their old plain text until rebuilt or changed with Change this. Verified: 93 Workers tests, typecheck, lint, KaTeX render checked in the browser via `/embed/widget`; not exercised: a new course build or a mutation on production with the real Meta API.

## Listen audio is pre-generated (2026-11-03)
- Listen no longer runs a voice model in the browser (Kokoro and its 330 MB download are gone). MeloTTS on Workers AI makes WAV clips (~1 s per 450-character clip, 44.1 kHz mono) stored in R2 as `listen/audio/melo-en-v1/<sha256 of the words>.wav`; the Muse Spark script stays cached as `listen/<sha>.json`.
- Made in the background on every change: mutate (via `defer` into the Course DO's `waitUntil`), Editor save/Undo, picture added, adapt-inserted sections, and a `narrate` step at the end of each section build workflow (the build does not wait for it). Unchanged paragraphs and Undo reuse existing clips. `POST /sections/:id/listen` returns signed clip URLs and makes whatever is missing, so it is also the backfill; `POST /api/voice/speak` speaks command bar answers in the same voice. Kill switch: `NARRATION=off`.
- Production (Worker version `8edcd314-904b-428a-8237-121337de0fe6`): demo course `crs_qdhs2ck5wt` backfilled, 8 of 8 sections (6-9 clips each). Cold section 15-22 s once; warm 0.8 s. A clip decodes in the browser (3.5 s, non-silent). 103 Workers tests, typecheck, lint.
- Not exercised: the signed-in reader's Listen button and the command bar answer playback in a browser (needs the owner's sign-in); a brand-new course build running the `narrate` step; voice quality is MeloTTS, a step below Kokoro. Clips are not deleted when a page changes (old ones stay for Undo); WAV is ~90 KB/s, about 16 MB for a 3-minute page.

## Last deploy
2026-11-03, Worker version after the operator-name fix (see `wrangler deployments list`); before it `b03a049c-758d-440e-98a8-d74f98ef025a` (legend rules), `4b51c23a-b015-4eb2-9ebe-69c4fa05d750` (matrices), `1276c0a2-bcf5-483e-b317-0bfbb912c064` (math pages: KaTeX formulas, legend, default interactive). 2026-11-02, Worker version `85a37c92-a6c4-4154-9e6c-2b022daf00f5` (pictures: hero image on every page, redraw and analogy pictures through Change this; demo course backfilled, 8 of 8 pages; verified in the production reader with Playwright-style browser checks: hero on 1.1, on-first-view draw on 2.1 with the user's own version, redraw via Change this with the green changed outline and Undo). Not verified: a brand-new course build drawing heroes in the workflow (covered by Workers tests only), mobile layout of the hero. 2026-11-02, Worker version `dcfe2d91-a92f-4e94-8145-ce6d5fbfa728` (Listen no longer hangs: Kokoro loading shows its step and falls back to the browser voice after 5 s without a WebGPU adapter or 20 s without progress; owner's Safari 26.6 had stuck on "Preparing narration", root cause there not yet confirmed). Before it `14503c8f-92ad-4000-b98d-14aa4136c0fb` (Listen reads with Kokoro-82M on WebGPU in the browser; verified in the production reader: download progress, "Kokoro voice on this device", plays block to block; the in-app test browser could not cache the 330 MB model, so caching in Chrome/Safari is unverified). Before it `b772032c-df52-44f4-a852-e1761755b11e` (voice input: mic frames forwarded as binary; Meta had rejected them as "Malformed message"). Before it `0ffacfa6-7f19-4fb7-a3da-8da5be5f57c8` (sign-in social buttons fix; before it `4bc9dfce`, voice input handshake fix). Earlier: 2026-11-02 ~20:45 UTC, Worker version `6b0dc3c7-df33-4993-ac21-d6768951fa34` (widgets, question types, waiting, Listen). Previous: 2026-11-02 19:05 UTC (version 02dfa257) · Worker `meta-hyperlearn` on https://hyperlearn.radesh-govind.com (Workers Free plan) and `hyperlearn-widgets` on https://hyperlearn-widgets.radesh-govind.com · `/api/health` ok (D1, R2, Vectorize, Meta API, quota) · demo course `crs_qdhs2ck5wt` seeded (4 sources, 8 sections).

## Live UI pass (2026-11-02, signed in on production)
Checked against design/screens: Sign in, Onboarding key, Empty library, Outline, Course reader (citations + source highlight), Mutate (ask → live steps → done with vector2d widget → Keep as overlay), Practice (grading → adapt re-plan → Keep), adapted Outline, History, Share (non-owner copy + owner invite), Invite (public), Settings AI and usage, Source, Palette.
Not exercised in the browser: uploading a new file through the UI, Editor, Research page, Updates diff, voice input, Listen mode.
Eval: 82/88 rewritten sentences supported (93.2%), 18 requests.

## Course-build request budget fix (2026-11-02)
- Parent Workflow now coordinates independent section Workflows; each section batches its text verification and retains one repair/recheck attempt.
- D1 section jobs are isolated by build attempt; publication is atomic, guarded against stale attempts, and idempotent. Failed owners can use Retry build without uploading sources again.
- Verified: typecheck, lint (one pre-existing React-hook warning), 37 Workers tests, Vite build and Wrangler deploy dry-run. The regression completes 145 model HTTP requests across six children, 24 per child, including API retries, JSON repair and content repair.
- Production: migration 0002 applied, `hyperlearn-build-section` bound, Worker version `c25c3b3a-58c9-483d-9da8-6bba1c2635a9` deployed. Rollback Worker version before this change: `46b2ce28-331e-4679-8a15-019c45e45e92`; migration is additive and compatible with the prior Worker.
- Owner Retry build clicked in Playwright: course `crs_rvtt32adyo`, attempt `run_1g1z0s5fd9`, original goal retained, all 7 sources retained, 18/18 section jobs done, exactly one course version (v1). Final verifier totals: 109/112 supported; unsupported sentences removed.
- Production `/api/health` is healthy for D1, R2, Vectorize, Meta and quotas. Open-weight endpoint remains the existing labelled Muse Spark fallback.

- Final Playwright pass on production: all 18 sections returned readable content, at most six text blocks and one exercise each; 83 teaching blocks and 248 citation links checked. Clicking a citation opened the source pane with the correct page and highlighted region. Temporary verification sessions revoked. Screenshots in ignored `test-results/production-outline.png` and `test-results/production-citation.png`.
