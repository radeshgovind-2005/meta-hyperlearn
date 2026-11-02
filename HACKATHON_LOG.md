# Hackathon log

All work below was built during the Meta Global AI Developer Hackathon (deadline Wed Nov 4, 9:00 PM ET).

- 2026-11-02 — Verified Meta Model API docs (model ids, ASR, SAM 3.1, pricing); no embeddings endpoint, no Muse Code API id.
- 2026-11-02 — Scaffold: Cloudflare Worker + Hono + React/Vite, D1 schema, content-addressed blocks in R2, patch ops with unit tests.
- 2026-11-02 — BYOK: AES-GCM key encryption bound to the Clerk user id; per-user and demo spend caps in Durable Objects.
- 2026-11-02 — LangGraph.js runs in the Workers runtime; durable checkpointer on DO SQLite so Keep/Undo survives eviction (tested).
- 2026-11-02 — Ingest workflow: PDF text with positions (unpdf) → regions with bboxes, page renders, Muse Spark structuring + exam style, Workers AI embeddings → Vectorize; audio via Muse Voice Transcribe with timestamps.
- 2026-11-02 — buildCourse workflow: outline → source-first sections → exam-style exercises → sentence verification → version 1.
- 2026-11-02 — mutateGraph (hero): classify → context → plan → write text ∥ build widget → verify (open-weight sentence check, mathjs claims, Browser Rendering + screenshot judge) → retry ≤2 → stream → interrupt Keep/Undo → commit.
- 2026-11-02 — adaptGraph: grade → diagnose → Muse Wonder path diff → write review from sources → verify → Keep/Undo.
- 2026-11-02 — Share (follow with overlays, copy with pull updates), command bar router with tool calls, realtime voice proxy, research mode.
- 2026-11-02 — React client for every design screen; widget templates (vector2d, plot, stepper) and sandboxed custom widgets on a separate origin.
- 2026-11-02 — Original CC BY seed material: two lecture decks, a midterm, a synthetic lecture recording.
- 2026-11-02 — Free-tier quota guard (R2 storage/ops, Vectorize, Workers AI, Browser Rendering) with contact message; privacy and terms pages; deployed to the custom domains on the Workers Free plan and seeded the demo course.
- 2026-11-02 — Live UI pass on production; fixes for reader decision placement, practice progress, owner names on invites, follower changes in Recent changes; LangSmith eval 82/88 sentences supported (93.2%); v1.0.0.

- 2026-11-02: Split course builds into section Workflows, batch source-isolated sentence checks, add attempt-scoped D1 results and owner Retry build; 37 Workers tests pass including a 145-request regression.
- 2026-11-02: Deployed the section-workflow fix on Workers Free and rebuilt Parallel Computing via owner Retry build: 18 sections, 7 existing sources, 109/112 sentences supported with the rest removed, exactly one published version.
- 2026-11-02: Reader changes now save automatically and stack (Undo / Try another way afterwards), command bar pinned to the bottom of every screen, removed the Show as toggle; verified on production with Playwright.
- 2026-11-02: Interactive examples fixed (plots had auto-scaling axes, so sliders looked like they did nothing): fixed labelled axes, draggable probe, goals checked in code, a check that every slider changes the screen; draggable vector with an eigen-direction goal.
- 2026-11-02: Practice in 25 question types (21 graded in code, 4 marked by Muse Spark with the exam rubric), confidence ratings, questions streamed one batch at a time with a repair retry; verified on production through the seed API (all 25 types generated, every code-graded answer key self-checks).
- 2026-11-02: Live progress instead of blocking waits (elapsed time and expected duration, skeleton layouts); Listen reads a Muse Spark spoken script with Pause/Resume and Ask by voice.
- 2026-11-02: Voice input fixed: the realtime handshake sent `format` instead of `audioEncoding` (Meta closed every session with 1008); the proxy now waits for Meta's session ack before relaying audio, the client resamples to 16 kHz and waits for the final transcript. Listen picks the best installed English voice.
- 2026-11-02: Sign-in fix: Clerk's "Last used" badge splits social buttons into separate rows, which our 2-column grid squeezed into half width; the grid now auto-fits and the card no longer clips the badge.
- 2026-11-02: Voice input fixed again: on our compatibility date the Worker received mic frames as Blob and relayed them as the text "[object Blob]", which Meta rejected as "Malformed message"; the proxy socket now uses binaryType arraybuffer (reproduced and verified in local workerd against the real Meta endpoint).
