# Status

**Current step:** Course-build free-tier fix deployed; Parallel Computing rebuilt successfully from its existing sources.

Verified locally against the real Meta API (2026-11-02): ingest of 4 sources (PDF positions, ASR turns, exam style) → course build (45/45 sentences supported) → mutate simplify + widget (5/5 sentences, mathjs claims, Keep → v2) → practice grading (caught the ad+bc sign error) → adapt (Wonder inserted a 4-min review, 9/9 sentences, Keep → v3).

## Done (code complete, lint + types + 37 Workers tests green)
- Steps 1–8 implemented in code: auth, BYOK, ingest, course build, reader with citations, mutate with verify loop and Keep/Undo, history, practice + adapt, audio citations, voice input, Listen mode, open-weight verifier client, share/follow/copy/updates, command bar, research.
- Seed material generated in `seed/`.

## Next
Record the 3-minute video, post on X, and submit before Wed Nov 4, 9:00 PM ET. Existing external limitations remain listed in BLOCKERS.md.

## Last deploy
2026-11-02 18:43 UTC · Worker `meta-hyperlearn` on https://hyperlearn.radesh-govind.com (Workers Free plan) and `hyperlearn-widgets` on https://hyperlearn-widgets.radesh-govind.com · `/api/health` ok (D1, R2, Vectorize, Meta API, quota) · demo course `crs_qdhs2ck5wt` seeded (4 sources, 8 sections).

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
