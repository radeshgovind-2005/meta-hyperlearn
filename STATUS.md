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

## Reader fixes (2026-11-02)
- Removed the "Show as" toggle and its `/view` route.
- Command bar is pinned to the bottom of the viewport on every screen (sticky dock).
- Mutations save as soon as they pass verification (no Keep step); later requests build on the saved version; Undo and Try another way commit the previous blocks back.
- Verified on production (Worker version `02dfa257-edc5-4fb5-9162-58819c4d40b5`) with Playwright on the demo course: two stacked changes persisted across reload, Undo restored the original, and the test overlay was removed afterwards.

## Last deploy
2026-11-02, Worker version `14503c8f-92ad-4000-b98d-14aa4136c0fb` (Listen reads with Kokoro-82M on WebGPU in the browser; verified in the production reader: download progress, "Kokoro voice on this device", plays block to block; the in-app test browser could not cache the 330 MB model, so caching in Chrome/Safari is unverified). Before it `b772032c-df52-44f4-a852-e1761755b11e` (voice input: mic frames forwarded as binary; Meta had rejected them as "Malformed message"). Before it `0ffacfa6-7f19-4fb7-a3da-8da5be5f57c8` (sign-in social buttons fix; before it `4bc9dfce`, voice input handshake fix). Earlier: 2026-11-02 ~20:45 UTC, Worker version `6b0dc3c7-df33-4993-ac21-d6768951fa34` (widgets, question types, waiting, Listen). Previous: 2026-11-02 19:05 UTC (version 02dfa257) · Worker `meta-hyperlearn` on https://hyperlearn.radesh-govind.com (Workers Free plan) and `hyperlearn-widgets` on https://hyperlearn-widgets.radesh-govind.com · `/api/health` ok (D1, R2, Vectorize, Meta API, quota) · demo course `crs_qdhs2ck5wt` seeded (4 sources, 8 sections).

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
