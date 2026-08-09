# Live Season Runbook

Use this procedure while updating an active season from the Google Sheet.

## When new episodes drop

1. Update `AVAILABLE_THROUGH_EP` immediately, before entering any episode results. This is the hard gate on player progress.
2. Enter confirmed results as they become available. Results can be added later without breaking the season; scores appear once the relevant rows exist.
3. For judgment-call Retreats results (`flirt`, `sex`, or `breakup`), set `confirmed=FALSE` while the group decides. Flip the row to `TRUE` after agreement; the app will keep the result pending until then.
4. Set each couple's `lock_ep` as soon as their wedding episode is known. A blank `lock_ep` on a live season produces a quality-control warning and temporarily falls back to `WEDDINGS_END_EP`.
5. Use the Retro Events tab for late reveals about an earlier phase. Add void rows there as well when a previously scored market must be cancelled.

## Results-ready switches

Never set `PODS_RESULTS_READY`, `DATING_RESULTS_READY`, `WEDDINGS_RESULTS_READY`, or `REUNION_RESULTS_READY` to `TRUE` until every required outcome for that phase has been entered. Incomplete data after a phase is marked ready causes a season-config error and pauses predictions for every player in every pool on that season.

## Phase boundaries

Set the real `PODS`, `DATING`, `WEDDINGS`, and `REUNION` start and end episode values in Settings as soon as the UK Season 3 episode structure is confirmed.

- Leave each `*_BOUNDARY_FINAL` setting `FALSE` while that boundary may still move.
- Flip a boundary to `TRUE` only when it is certain.
- Live seasons default to movable boundaries. If a provisional boundary moves, the app's provisional-completion flow reopens the affected phase for players.

## Publish and verify

After significant updates, publish the Firestore `seasons/{seasonId}` snapshot. It is the app's primary season-data source; the Google Sheet is the fallback.

After every sheet edit:

1. Reload the app once.
2. Confirm there is no season-config error banner.
3. If there is an error, correct the sheet and verify again before walking away.
