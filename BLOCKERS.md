# Blockers and stubs

| # | What | Why | Fallback in place | Status |
|---|---|---|---|---|
| 1 | R2 / Workers on the free plan | Owner wants to stay on free tiers | App-wide quota guard at ~80% of R2, Vectorize, Workers AI and Browser Rendering free limits; uploads pause with a contact@radesh-govind.com message | Resolved |
| 2 | Clerk production instance | Needs DNS + Verify (done by owner); production keys refuse localhost, so local UI tests need a dev instance | Live site works; Google sign-in still in Google "Testing" mode until its branding is published (privacy URL now at /privacy) | Partly open (Google publishing) |
| 3 | `OPEN_MODEL_*` points at the Meta Model API (`muse-spark-1.3`), not an open-weight endpoint | Modal endpoint not provided | Verifier runs on Muse Spark and is labelled "Muse Spark (verifier)", never "open weights" | Open |
| 9 | Existing Worker named `hyperlearn` in the account (deployed Oct 30 – Nov 1) | Would be overwritten | This project deploys as `meta-hyperlearn`; the old Worker is untouched | Resolved |
| 4 | Muse Code as a model | dev.meta.ai lists no API model id for Muse Code (it is a CLI product) | Custom widgets are written by `muse-spark-1.3` and served from the sandbox origin | Permanent; noted in README |
| 5 | Embeddings | The Meta Model API has no embeddings endpoint | Workers AI `@cf/baai/bge-base-en-v1.5` (768 dims) | Permanent; noted in README |
| 6 | Web search for Research mode | Responses API `web_search` tool is not documented for the Model API | Research tries it; if it fails, it answers from the library only and says so in the trace | Verify after keys |
| 7 | Seed material | No real lecture files provided | Original CC BY 4.0 slides + sample exam + synthetic narration (macOS `say`) in `seed/` | Done |
| 8 | Uploads of PowerPoint / images | Ingest reads PDFs and audio only | Upload copy says "PDF or audio"; export slides to PDF | Accepted for v1 |
| 10 | Text-to-speech for Listen | The Meta Model API has no speech synthesis model (Muse Voice Transcribe is speech to text only) | MeloTTS (open weights, MIT) on Workers AI (`@cf/myshell-ai/melotts`, ~1 s per paragraph) reading a Muse Spark script. Clips are made when a page changes (mutate, edit, undo, adapt, course build) and stored in R2 by content hash, so Listen starts at once; a missing clip falls back to the browser `speechSynthesis` voice. Kokoro-82M was tried first (330 MB WebGPU model per student) and dropped: it cannot run inside a Worker | Permanent; noted in README |
