# Blockers and stubs

| # | What | Why | Fallback in place | Status |
|---|---|---|---|---|
| 1 | R2 not enabled on the Cloudflare account | API error 10042 "Please enable R2 through the Cloudflare Dashboard" (needs billing acceptance) | D1, Vectorize, migrations done; deploy blocked until the bucket exists | Waiting on human |
| 2 | Clerk keys are a production instance | Frontend API `clerk.radesh-govind.com` needs 5 CNAMEs + Verify in Clerk; wrangler OAuth token is `zone:read` only, so DNS can't be added from here; production keys also refuse localhost | Use development instance keys, or add the CNAMEs and click Verify | Waiting on human |
| 3 | `OPEN_MODEL_*` points at the Meta Model API (`muse-spark-1.3`), not an open-weight endpoint | Modal endpoint not provided | Verifier runs on Muse Spark and is labelled "Muse Spark (verifier)", never "open weights" | Open |
| 9 | Existing Worker named `hyperlearn` in the account (deployed Oct 30 – Nov 1) | Would be overwritten | This project deploys as `meta-hyperlearn`; the old Worker is untouched | Resolved |
| 4 | Muse Code as a model | dev.meta.ai lists no API model id for Muse Code (it is a CLI product) | Custom widgets are written by `muse-spark-1.3` and served from the sandbox origin | Permanent; noted in README |
| 5 | Embeddings | The Meta Model API has no embeddings endpoint | Workers AI `@cf/baai/bge-base-en-v1.5` (768 dims) | Permanent; noted in README |
| 6 | Web search for Research mode | Responses API `web_search` tool is not documented for the Model API | Research tries it; if it fails, it answers from the library only and says so in the trace | Verify after keys |
| 7 | Seed material | No real lecture files provided | Original CC BY 4.0 slides + sample exam + synthetic narration (macOS `say`) in `seed/` | Done |
| 8 | Uploads of PowerPoint / images | Ingest reads PDFs and audio only | Upload copy says "PDF or audio"; export slides to PDF | Accepted for v1 |
