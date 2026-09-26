# Live Season Runbook

Use this procedure while updating an active season from the Google Sheet.

## Drop-night rollback

- **Hosting:** In Firebase Console, open Hosting → Release history, select the last known-good release, and roll it back. Firebase CLI 15.25.1 has no version-id rollback command; if the known-good build is preserved on a channel, promote it with `firebase hosting:clone lib-oauth:CHANNEL lib-oauth:live`.
- **Functions:** Check out the previous release commit and redeploy its functions with `firebase deploy --only functions --project lib-oauth`. Never roll Functions behind Firestore rules they depend on; roll the coordinated backend forward or back together.
- **Season data:** In the Season Publisher admin, run Rollback (`rollbackSeasonFromAdmin`). It restores the prior season snapshot. It restores the `appConfig/public` backup only when the rolled-back season is still the current default, which applies to US11.

## Rename an offensive Global leaderboard username

1. Edit `users/{uid}.username`.
2. Edit `pools/global__{seasonId}/trustedPlayers/{uid}.username`. The trusted copy is made when picks lock, so changing only the profile does not change the leaderboard.
3. Trigger a rebuild by merging these fields into `pools/global__{seasonId}/standings/rebuild`: `requestedAt` as the current Firestore timestamp, `requestVersion` incremented by 1, and `reason` set to a short value such as `username-moderation`. The `claimGlobalStandingsRebuild` transaction consumes that request version.

## Email ceiling

The UTC counter is `emailDailyCounts/{YYYY-MM-DD}`. If the invitation ceiling is reached, players see “Email invitations are paused for today. Share the pool link instead.” Counters reset at midnight UTC: 6 p.m. MT through October 31 and 5 p.m. MT after daylight time ends on November 1. Change `MAIL_PROJECT_DAILY_LIMIT` and `INVITE_PROJECT_DAILY_LIMIT` in `functions/index.js` when moving between Resend Free and Pro; the documented Free values are 80 total and 50 invitations.

## Premiere-night watch list

- Watch `clientErrors` categories `global_join_failed`, `invite_send_failed`, and `invite_accept_failed`.
- Watch Resend for bounces and provider-level delivery failures.
- Compare `pools/global__{seasonId}.members.length` with `GLOBAL_JOIN_CEILING` (8,000).

## When new episodes drop

1. Update `AVAILABLE_THROUGH_EP` immediately, before entering any episode results. This is the hard gate on player progress.
2. Enter confirmed results as they become available. Results can be added later without breaking the season; scores appear once the relevant rows exist.
3. For judgment-call Retreats results (`flirt`, `sex`, or `breakup`), set `confirmed=FALSE` while the group decides. Flip the row to `TRUE` after agreement; the app will keep the result pending until then.
4. Set each couple's `lock_ep` as soon as their wedding episode is known. A blank `lock_ep` on a live season produces a quality-control warning and temporarily falls back to `WEDDINGS_END_EP`.
5. Use the Retro Events tab for late reveals about an earlier phase. Add void rows there as well when a previously scored market must be cancelled.
6. Never rename a Cast name or Couples id once `AVAILABLE_THROUGH_EP` is above 0; fix typos by adding a Retro/void row instead.

## Results-ready switches

Never set `PODS_RESULTS_READY`, `DATING_RESULTS_READY`, `WEDDINGS_RESULTS_READY`, or `REUNION_RESULTS_READY` to `TRUE` until every required outcome for that phase has been entered. Incomplete data after a phase is marked ready causes a season-config error and pauses predictions for every player in every pool on that season.

Keep existing and completed seasons on configuration version 1. Use version 2 only for a new season that has been rehearsed on a cloned pool; version 2 makes blank result-readiness and Reunion eligibility fields default to false consistently in the browser and server scorer.

## Staged cast release

Leave `CAST_COMPLETE=FALSE` while cast members may still be added. By default, this keeps predictions closed. For a deliberate staged launch, set `ALLOW_INCOMPLETE_CAST=TRUE`; the season can then open once it is Live and the published cast includes at least one man and one woman.

Adding cast members or couples later changes the available prediction field and may change against-the-grain scoring. After each addition, publish a new snapshot and complete the verification steps below. Turn `ALLOW_INCOMPLETE_CAST` back off when `CAST_COMPLETE` becomes `TRUE` so the override does not remain enabled unnecessarily.

## Phase boundaries

Set the real `PODS`, `DATING`, `WEDDINGS`, and `REUNION` start and end episode values in Settings as soon as the UK Season 3 episode structure is confirmed.

- Leave each `*_BOUNDARY_FINAL` setting `FALSE` while that boundary may still move.
- Flip a boundary to `TRUE` only when it is certain.
- Live seasons default to movable boundaries. If a provisional boundary moves, the app's provisional-completion flow reopens the affected phase for players.

## Publish and verify

Editing the Google Sheet changes nothing in the live app until the Firestore `seasons/{seasonId}` snapshot is published. The app and Cloud Functions use that same published snapshot. Settings must be present. Cast, Couples, Dating Results, and Reunion Results may legitimately be empty before their data is known; Episode 0 keeps predictions closed while allowing pools to form.

If you need to compare the unpublished source sheet while diagnosing a publish problem, append `?adminSeasonSource=sheet` to the app URL. This is an explicit admin-only browser fallback and logs a warning; Cloud Functions still use Firestore. Never send that URL to players, and republish Firestore rather than leaving the fallback in use.

Before publishing, inspect the preview's published-versus-pending values and resolve any unexpected warning. A backward `AVAILABLE_THROUGH_EP` warning is informational, not a hard block, because an intentional rollback may be necessary.

After every publish:

1. Reload the app once.
2. Confirm the available episode and release state match the published values.
3. Confirm there is no season-config error banner.
4. If there is an error, correct the sheet, publish again, and repeat these checks before walking away.

## Post-deploy verification

After every `firebase deploy`, sign in and call `reopenPhase` once against any pool. Confirm the response is a domain error such as `invalid-argument` or `failed-precondition`, not an HTTP 403.

The `lib-oauth` project uses domain-restricted sharing, so `reopenphase` cannot grant the usual Cloud Run `allUsers` invoker role. Its Cloud Run Invoker IAM check must stay disabled instead. If phase reopening starts returning a Cloud Run 403 after a deployment, restore the supported public-ingress setting:

```sh
gcloud run services update reopenphase \
  --project=lib-oauth \
  --region=us-central1 \
  --no-invoker-iam-check
```

This only lets requests reach the callable. `reopenPhase` still requires Firebase sign-in, pool membership, a live season, and a provisional phase boundary.
