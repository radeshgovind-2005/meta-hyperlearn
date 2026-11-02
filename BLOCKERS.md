# Blockers and stubs

| # | What | Why | Fallback in place | Status |
|---|---|---|---|---|
| 1 | Cloudflare deploy (D1, R2, Vectorize, Workflows, DOs, Browser Rendering, custom domain) | `wrangler whoami`: token expired; needs `wrangler login` by the human | Everything is coded and type-checked; resources are created by `scripts/provision.sh` once logged in | Waiting on human |
| 2 | Clerk keys | Not in `.dev.vars` yet | Sign-in UI is built with `@clerk/clerk-react`; nothing works without keys | Waiting on human |
| 3 | `META_API_KEY`, `LANGSMITH_API_KEY`, `OPEN_MODEL_*` | Not in `.dev.vars` yet | Open-weight verifier falls back to Muse Spark behind the same interface (labelled in the UI trace) | Waiting on human |
| 4 | Muse Code as a model | dev.meta.ai lists no API model id for Muse Code (it is a CLI product) | Custom widgets are written by `muse-spark-1.3` and served from the sandbox origin | Permanent; noted in README |
| 5 | Embeddings | The Meta Model API has no embeddings endpoint | Workers AI `@cf/baai/bge-base-en-v1.5` (768 dims) | Permanent; noted in README |
| 6 | Web search for Research mode | Responses API `web_search` tool is not documented for the Model API | Research tries it; if it fails, it answers from the library only and says so in the trace | Verify after keys |
| 7 | Seed material | No real lecture files provided | Original CC BY 4.0 slides + sample exam + synthetic narration (macOS `say`) in `seed/` | Done |
| 8 | Uploads of PowerPoint / images | Ingest reads PDFs and audio only | Upload copy says "PDF or audio"; export slides to PDF | Accepted for v1 |
