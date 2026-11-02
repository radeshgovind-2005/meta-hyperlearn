# Status

**Current step:** v1.0.0 shipped. Remaining for the human: record the 3-minute video, post on X, submit before Wed Nov 4, 9:00 PM ET.

Verified locally against the real Meta API (2026-11-02): ingest of 4 sources (PDF positions, ASR turns, exam style) → course build (45/45 sentences supported) → mutate simplify + widget (5/5 sentences, mathjs claims, Keep → v2) → practice grading (caught the ad+bc sign error) → adapt (Wonder inserted a 4-min review, 9/9 sentences, Keep → v3).

## Done (code complete, lint + types + 28 unit tests green)
- Steps 1–8 implemented in code: auth, BYOK, ingest, course build, reader with citations, mutate with verify loop and Keep/Undo, history, practice + adapt, audio citations, voice input, Listen mode, open-weight verifier client, share/follow/copy/updates, command bar, research.
- Seed material generated in `seed/`.

## Next
1. `scripts/provision.sh`: create D1, R2, Vectorize (+ metadata index), apply migrations, push secrets.
2. `wrangler dev` + Playwright pass over every screen vs `design/screens/`.
3. Deploy main Worker + widget Worker to the custom domains; `npm run seed:prod`.
4. LangSmith eval (18 mutation requests) → README score.
5. README, tag v1.0.0.

## Last deploy
2026-11-02 17:09 UTC · Worker `meta-hyperlearn` on https://hyperlearn.radesh-govind.com (Workers Free plan) and `hyperlearn-widgets` on https://hyperlearn-widgets.radesh-govind.com · `/api/health` ok (D1, R2, Vectorize, Meta API, quota) · demo course `crs_qdhs2ck5wt` seeded (4 sources, 8 sections).

## Live UI pass (2026-11-02, signed in on production)
Checked against design/screens: Sign in, Onboarding key, Empty library, Outline, Course reader (citations + source highlight), Mutate (ask → live steps → done with vector2d widget → Keep as overlay), Practice (grading → adapt re-plan → Keep), adapted Outline, History, Share (non-owner copy + owner invite), Invite (public), Settings AI and usage, Source, Palette.
Not exercised in the browser: uploading a new file through the UI, Editor, Research page, Updates diff, voice input, Listen mode.
Eval: 82/88 rewritten sentences supported (93.2%), 18 requests.
