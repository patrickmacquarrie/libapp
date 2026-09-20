# Batch B notes

## What changed

- Global pick locks and checkpoint completions commit first, then queue a standings rebuild marker. A marker failure returns success with `standingsStale: true`; the client shows a soft standings notice instead of falsely claiming that nothing changed.
- The `rebuildGlobalStandings` trigger claims at most one rebuild per pool every 20 seconds and runs with a 300-second timeout and 512 MiB memory.
- Leave, reopen, and account-deletion paths request a rebuild instead of synchronously rebuilding the leaderboard. Season updates and administrator repair/reset paths still recompute directly.
- The shared standings document now contains the top 500 ranked rows plus `rowCount` and `truncated`. Every scored player also receives a private `standingsRows/{uid}` row in batches of 400, preserving frozen phase scores outside the top 500.
- The client reads the viewer's private row when they are outside the top 500 and shows the real total player count.
- New-season and new-episode email nudges resolve opted-in recipients first, bulk-load Authentication users, and create mail in chunks of 50. The season trigger timeout is 540 seconds.
- Global joins stop at `GLOBAL_JOIN_CEILING = 8000` with a friendly temporary-capacity message. Existing members can still reopen the pool. Global join and completion transactions retry Firestore `ABORTED` contention up to three times with jitter.

## What was tested

- `npm run test:engine` passed.
- `npm run test:operations` passed.
- Executable release-contract checks cover the 20-second rebuild claim, the top-500 truncation, personal row fallback, 50-user notification chunks, the 8,000-member join ceiling, and contention retry.
- `node --check functions/index.js` and `git diff --check` passed.
- Full emulator and browser smoke execution remains delegated to draft-PR CI because this Codex sandbox cannot terminate the Firebase/Chrome child processes cleanly.

## Still required

- Batch C must add the own-row Firestore read rule before the personal-row path is available in production. Until then the client safely falls back to the top-500 document.
- `GLOBAL_JOIN_CEILING` is a temporary guard, not the membership solution. Complete the subcollection membership plus sharded-count migration before the pool approaches 8,000 members.
- Deploy the Functions changes only after Batch C is ready, then monitor rebuild-marker errors, trigger duration, standings truncation, and mail volume.
- No UK3 season document, pool, or configuration version was changed.
