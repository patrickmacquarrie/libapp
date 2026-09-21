# Batch A notes

## What changed

- Mirror-linked pool entry now loads only the signed-in player's document, that player's four pick documents, and the four phase-status documents. It no longer reads every player and every pick in the source pool.
- Signed-in season discovery now prefers the compact `appConfig/seasonCatalog` document and safely falls back to the existing `seasons` collection while Batch C's read rule is not yet deployed.
- Season publish and rollback transactions update the compact catalog atomically with the season and routing documents. `rebuildSeasonCatalog` provides the one-off backfill for existing seasons.
- Trusted Global standings now include per-phase pick-owner counts and active-player counts. The shared scoring engine can use that server context for the viewer's receipts and Against-the-Grain display without exposing other players' picks.
- The Global standings listener renders at most once every five seconds, disconnects while the page is hidden, and performs one catch-up read before resubscribing when the page becomes visible.

## What was tested

- `npm run test:engine` passed, including a Global receipt whose points match the trusted full-player score.
- `npm run test:operations` passed, including executable mirror-read, catalog fallback/backfill, publisher rollback, and listener throttling tests.
- Firestore emulator assertions passed. In this Codex sandbox the Firebase CLI subsequently returned a process-control error while shutting down its successful emulator run.
- The production build completed from the shared scoring-engine source.
- `git diff --check` and Node syntax checks passed.
- The browser smoke runner could not keep system Chrome open in this sandbox (`kill EPERM`); the draft PR's CI check remains the authoritative smoke result.

## Still required

- Do not deploy this batch by itself as the final catalog rollout. Merge Batch C's `appConfig/seasonCatalog` read rule before removing the compatibility fallback.
- After the publisher and Batch C rule are deployed, run `rebuildSeasonCatalog` once from the Season Publisher project and confirm the catalog contains every published season.
- No UK3 season document, pool, or configuration version was changed.
