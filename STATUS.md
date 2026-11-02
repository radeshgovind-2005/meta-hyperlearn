# Status

**Current step:** waiting for the human checklist (Cloudflare login, Clerk keys, Meta/LangSmith/open-weight keys) to run locally and deploy.

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
None yet.
