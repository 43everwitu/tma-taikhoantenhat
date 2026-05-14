# P1 — Project tree hygiene

**Date**: 2026-05-14
**Status**: Spec
**Tag on ship**: `v0.30-hygiene`

## Goal

Remove unused code, untracked or wrongly tracked artefacts, and dead env vars so the audit surface for P2 (security) and P3 (TMA perf) is smaller.

## Scope

1. **Delete dead modules** (verified zero or single-deletable refs):
   - `src/bot-legacy.js` — 83 LOC, 0 references.
   - `src/services/sheetSync.js` — 214 LOC. Used by `src/handlers/adminActions.js` only. Goes with handler. Google Sheet sync is dormant.
   - `src/handlers/adminActions.js` — 681 LOC, exactly 1 external ref. Audit caller; if that caller is itself dead or trivially removable, delete the handler.

2. **Drop deprecated env vars** from `src/config.js`: `SEPAY_API_KEY`, `WEBHOOK_PORT`, `GOOGLE_SHEET_ID`, `SHEET_SYNC_INTERVAL`. Delete the corresponding "Deprecated" block already pre-marked in `.env.example`.

3. **Clean stragglers**:
   - `.env.bak` — local backup, should never be committed.
   - `favicon.png` at repo root — duplicate; the public-served favicon lives at `web/public/favicon.png` and `data/uploads/...`.
   - `data/db.sqlite`, `data/db.sqlite.fresh` if still on disk (already documented as stale fork artefacts).
   - WordPress backup directory `taikhoantenhat.com__2026-05-06T15_42_06+0700/` — multi-GB of dead JS. Must be `.gitignore`d. If currently tracked, also `git rm --cached`.

4. **`.gitignore` hardening** — add `*.bak`, `data/uploads/products-inline/`, `taikhoantenhat.com__*/`, `wp-content/`, `*.zip`, `*.tar.gz` if not already there.

## Out of scope

- The refund route follow-up (own work, parked in the pending list).
- Touching message templates, RBAC, payments — anything that runs at runtime.
- Frontend file moves.

## Acceptance

- `git ls-files | xargs du -b | awk '{s+=$1} END {print s}'` drops by ≥1 MB (probably much more if WP dump was tracked).
- `grep -rn "sheetSync\|adminActions\|bot-legacy" src/ --include='*.js'` returns empty.
- API boots clean: `node -e "require('./src/index.js')"` waits ~3 s, no missing-module errors.
- `scripts/verify-message-templates.js` still prints `All 16 templates render cleanly.`
- `.env.example` no longer lists deprecated vars.
- No `process.env.SEPAY_API_KEY|WEBHOOK_PORT|GOOGLE_SHEET_ID|SHEET_SYNC_INTERVAL` references survive in `src/`.

## Risk

- **Audit caller of `adminActions.js` before delete** — if it's reachable via a bot command users still type, deletion silently breaks the command. Verify via `grep -rn "adminActions" src/` and exercise the call path in dev before deleting.
- `sheetSync.js` may still be invoked on boot via timer. Check `src/index.js` for `sheetSync.start()` and delete that wire too.

## Rollback

- Pure file deletions in a single commit per module → `git revert` if anything bot-side regresses.
