# UK Season 3 controlled rehearsal

This is the operating checklist for making Love Is Blind UK Season 3 behave as though it begins on **August 29, 2026**, then running a four-account season simulation across August 29–30.

This rehearsal is intentionally independent of the real August 19 release. Nothing in the publisher follows Netflix automatically: the app changes only when the private season publisher writes a new `seasons/love-is-blind-uk-3` snapshot.

## Evidence and safety

The labels in this document distinguish evidence from planned work:

- **Observed** means a read-only check was actually run against production or the public source sheet on August 21, 2026.
- **Code-derived** means the behaviour follows from the checked-in app, functions, publisher, or runbooks. It has not yet been exercised in this rehearsal.
- **Operator action** means a production change or manual test to perform later. No production write described here was performed while this document was written.

Production writes require Patrick's approval. Before the rehearsal, obtain one explicit approval covering the test accounts' ordinary production mutations: notification preferences, pools, invitations, picks, progress, Heat Check data, link resets, leaving/deleting disposable pools, and deletion of the designated disposable account. Keep a separate stop for each **Publish to the app**, app-config repair, rollback, or manual mail-document deletion. Never edit a live Firestore season document by hand.

Do not add or test anonymous pre-auth play in this rehearsal. Do not start Phase 3 compliance.

## Fixed identifiers and phase map

Record these at the top of the rehearsal log:

| Item | Value |
| --- | --- |
| Firebase project | `lib-oauth` |
| Season ID | `love-is-blind-uk-3` |
| Source spreadsheet ID | `10lXVUtRSNpd4yBCIxHHZiM65abQMCu9LXYoJ22r7ifY` |
| Published snapshot | `seasons/love-is-blind-uk-3` |
| Rehearsal release label | `First episodes drop August 29, 2026` |

**Observed:** the source sheet and production snapshot currently use these spans:

| Phase | Start | Scoring/end boundary | Player prediction windows | Closes after watching |
| --- | ---: | ---: | --- | ---: |
| Pods | 1 | 5 | after Episodes 1, 2, 3, and 4 | Episode 5 |
| Retreats | 5 | 7 (`RETREAT_START_EP=5`, `RETREAT_END_EP=7`) | after Episodes 5 and 6 | Episode 7 |
| Weddings | 7 | 11 | after Episodes 7, 8, 9, and 10 | Episode 11 |
| Reunion | 11 | 12 | after Episode 11 only | Episode 12 |

Keep these exact settings throughout the rehearsal:

```text
PODS_START_EP=1
PODS_END_EP=5
DATING_START_EP=5
DATING_END_EP=7
RETREAT_START_EP=5
RETREAT_END_EP=7
WEDDINGS_START_EP=7
WEDDINGS_END_EP=11
REUNION_START_EP=11
REUNION_END_EP=12
```

The product label **Retreats** maps to the internal phase ID `dating`. Firestore and mail IDs therefore use `phasePicks/dating__{uid}`, `phaseStatus/dating`, and `_dating_`; there is no `retreats` phase document.

**Code-derived:** phase starts meet the previous phase ends. They do not create a dual-board crossover window here, because the next board opens at the same watched episode at which the previous phase closes. A player must complete the old phase and select **Continue** before the next board opens.

The counter must therefore move from **1 through 12** to open and close all four phases. Availability does not move a player automatically; it only raises the ceiling they may reach. Even if the counter jumps several episodes, a rolling-phase player advances one watched episode per lock/finish cycle. A jump also generates only one new-episode nudge for the final published number, so use the one-by-one sequence below.

## Gate 0 — the current data is not playable

Do not begin the device or gameplay checklist until this gate passes.

**Observed in production on August 21:**

- `seasons/love-is-blind-uk-3` was last published August 8 at 10:04:31 PM Mountain time.
- Its top-level status is `upcoming`.
- Its settings say `SEASON_STATUS=comingSoon`, `AVAILABLE_THROUGH_EP=0`, `BOUNDARIES_LIVE=TRUE`, and every `*_BOUNDARY_FINAL` and `*_RESULTS_READY` value is `FALSE`.
- The Cast, Couples, Dating Results, and Reunion Results tabs contain headers only. The public source sheet is also still empty on those tabs.
- `appConfig/public` does not exist. The checked-in UK3 fallback still routes the app to UK3, but the rehearsal should create explicit default-season routing rather than depend on that fallback.

With no male and female cast rows, `CAST_READY` and `PLAYABLE` are false. Publishing only the settings sequence below would leave every pool on “Season has not started.”

The repository, runbooks, source sheet, and production snapshot do not contain an authoritative UK3 cast/outcome fixture. This procedure therefore cannot name the exact relationship and result rows without inventing spoilers or outcomes. Before rehearsal day, Patrick must designate and approve one complete fixture—either the reviewed real UK3 data or an explicitly documented simulation—and the operator must enter that same fixture in every phase. Do not improvise missing outcomes during the weekend.

### Populate and validate the source data

- [ ] In the private season admin, select `love-is-blind-uk-3` and confirm the paired spreadsheet ID shown above.
- [ ] Add the complete Cast list, using stable, exact names and a valid `M` or `F` value. Do not rename a person after the first live publish.
- [ ] Add every real relationship to Couples with a stable ID and exact Cast names.
- [ ] Fill `engaged_ep` for every Pods engagement. Use the eligibility columns for any later/off-cycle relationship rather than pretending it was a Pods couple.
- [ ] Fill `lock_ep` as soon as the last prediction episode for a wedding outcome is known. A blank value on a live outcome falls back to Episode 11 and only produces a warning.
- [ ] Before Weddings results become ready, fill `wedding` for every Weddings-eligible couple. For `saysNo` or `calledOff`, also fill `who_says_no` with exactly `him` or `her`. Fill breakup/settled episode fields where they remove a couple from a later market.
- [ ] Add every positive Retreats `sex`, `flirt`, and `breakup` event with an episode from 5 through 7. Use the exact couple ID for sex/breakup and the exact Cast name for flirt. Leave judgment calls `confirmed=FALSE` until resolved.
- [ ] Add every positive Reunion result. Missing Reunion rows are treated as negative results, not as pending, so audit every eligible option before marking the phase ready.
- [ ] Add a Retro Events row only for a genuine later correction. It must reveal after the scoring end of the phase it modifies. Do not invent one merely to make the checkbox pass.
- [ ] Keep the fixed phase span values in the table above and set `RELEASE_LABEL` to `First episodes drop August 29, 2026`.
- [ ] Save the draft. This changes only the sheet.
- [ ] Run **Save & preview**. Confirm the season and sheet IDs, non-zero Cast and Couples data rows, the intended results rows, all six tab counts, and a document below 900,000 bytes.
- [ ] Confirm there are no validation warnings that would make a real prediction market ambiguous. In particular, do not waive missing wedding outcomes, missing `who_says_no`, invalid retreat episodes, invalid result targets, or duplicate Retro/Dating events.
- [ ] Export or screenshot the approved fixture and preview summary into the private rehearsal log. Have a second reader sign off the Cast/Couples IDs, positive outcomes, negative-outcome audit, and intended Retro Events before Gate 1.

The current empty dataset is a hard blocker, not a rehearsal failure and not a code defect.

## Gate 1 — publish the parked snapshot

This creates a known-good baseline before the simulated drop.

Set and preview:

```text
SEASON_STATUS=comingSoon
RELEASE_LABEL=First episodes drop August 29, 2026
AVAILABLE_THROUGH_EP=0
BOUNDARIES_LIVE=TRUE
PODS_BOUNDARY_FINAL=FALSE
DATING_BOUNDARY_FINAL=FALSE
WEDDINGS_BOUNDARY_FINAL=FALSE
REUNION_BOUNDARY_FINAL=FALSE
PODS_RESULTS_READY=FALSE
DATING_RESULTS_READY=FALSE
WEDDINGS_RESULTS_READY=FALSE
REUNION_RESULTS_READY=FALSE
```

- [ ] Stop and obtain approval for the production publish.
- [ ] Click **Publish to the app** and record the returned `backupPath`.
- [ ] In Firestore, inspect `seasons/love-is-blind-uk-3`: confirm a new `publishedAt`, top-level `status=upcoming`, the expected `tabRowCounts`, and the exact settings above.
- [ ] UK3 is the publisher's configured fallback default, so this normal publish also creates or refreshes `appConfig/public`. Confirm its `defaultSeasonId` and `globalPoolSeasonId` are both `love-is-blind-uk-3`, with `status=upcoming` and the August 29 release label. Do not look for a separate **Make live/default** button.
- [ ] Open production in a private browser. Sign in, create or open a UK3 pool, and confirm the pool says the season has not started rather than showing a configuration error.
- [ ] Save this parked snapshot's publish backup path and the verified `appConfig/public` values as the rehearsal baseline. Because that document is currently absent, no previous app-config backup is expected on this first synchronized publish.

## Episode publishing plan

Keep `SEASON_STATUS=live`, `BOUNDARIES_LIVE=TRUE`, the fixed spans, budgets, caps, and multipliers unchanged from P1 through P12. A `TRUE` below remains `TRUE` on every later publish.

| Publish | Available | Boundary finals after publish | Results ready after publish | Expected player effect |
| --- | ---: | --- | --- | --- |
| P1 | 1 | none | none | Season opens; Pods board opens after the player confirms Episode 1 watched. |
| P2 | 2 | none | none | One more Pods lock/watch cycle is available. |
| P3 | 3 | none | none | One more Pods cycle is available. |
| P4 | 4 | none | none | Final Pods prediction window is available. |
| P5 | 5 | Pods | Pods | Pods can close; Retreats opens for each player after that player completes Pods. |
| P6 | 6 | Pods | Pods | One more Retreats lock/watch cycle is available. |
| P7 | 7 | Pods, Retreats | Pods, Retreats | Retreats can close; Weddings opens after the player continues. |
| P8 | 8 | Pods, Retreats | Pods, Retreats | One more Weddings cycle is available. |
| P9 | 9 | Pods, Retreats | Pods, Retreats | One more Weddings cycle is available. |
| P10 | 10 | Pods, Retreats | Pods, Retreats | Final Weddings prediction window is available. |
| P11 | 11 | Pods, Retreats, Weddings | Pods, Retreats, Weddings | Weddings can close; the one Reunion prediction window opens. |
| P12 | 12 | all four | all four | Reunion can close and the season-complete screen is reachable. Keep status `live` during the rehearsal. |

At P1 change `SEASON_STATUS` from `comingSoon` to `live`. The publisher rejects `live` with availability below the Pods start, so `live/0` is not a valid staging state.

Suggested weekend split:

- **August 29:** P1, complete the device/invite setup, then P2–P7 and both Pods and Retreats completion-order checks.
- **August 30:** P8–P12, then Weddings, Reunion, Retro if applicable, and destructive-action checks.

Do not advance merely to stay on this clock. A failed verification stops the sequence at the last known-good publish.

Before each publish P1–P12:

- [ ] Update `AVAILABLE_THROUGH_EP` to exactly the table value. Do not skip a number.
- [ ] Enter results exposed by that episode before setting the corresponding results-ready flag. Leave unresolved Retreats rows unconfirmed.
- [ ] At a phase end, set the boundary final only when the fixed end is confirmed and set results ready only after the phase outcome audit is complete.
- [ ] Save and preview. Confirm the exact availability, status, flags, row counts, and document size.
- [ ] Stop for production-write approval.
- [ ] Publish and record the returned `backupPath` beside P1, P2, and so on.
- [ ] In `seasons/love-is-blind-uk-3`, verify `publishedAt`, `status=live`, `tabRowCounts`, and the just-published settings.
- [ ] In one caught-up account, select **Check for season updates**. Confirm the new episode becomes available and no season-config banner appears.
- [ ] Do not edit the sheet again until that publish is verified on desktop and a phone-sized screen.

### Boundary and results traps

These combinations are derived from the current client and callable code:

| Combination | Effect | Required response |
| --- | --- | --- |
| Player reaches a phase end while its boundary is false | The player remains on the locked watch screen with “This phase is still provisional.” | Publish that boundary `TRUE`, then have the player refresh season data and complete the phase. |
| Boundary true, results false | The player can complete. Pods/Weddings/Reunion scores stay hidden; Retreats shows only confirmed points as provisional. | This is recoverable, but do not call the phase verified until results are ready. |
| Results true before outcomes are complete | Dating or Weddings can throw a season-data error; semantically incomplete Pods/Reunion data can silently score missing positives as misses. All pools use the same snapshot. | Never publish. Correct the data and preview again. |
| `WEDDINGS_RESULTS_READY=FALSE` when a player enters Reunion | Relationship-status choices that depend on resolved wedding outcomes are unavailable. | Make Weddings results ready at P11 before allowing the Reunion board to open. |
| `SEASON_STATUS=comingSoon` with a positive availability | The season remains unplayable despite the counter. | Use `live` for P1–P12. |
| `SEASON_STATUS=completed` with a false boundary | The automatic provisional repair requires a live season, and `reopenPhase` also refuses a completed season. | Never publish this combination; it can strand a player permanently. |
| A boundary is final in the current snapshot | `reopenPhase` refuses while it remains final. If a later live publish makes the player's current phase provisional again, a player still on that phase's close screen can auto-reopen; a player who already continued to a later phase is not rewound. | Do not use boundary changes as a rewind mechanism. Treat completion plus **Continue** as irreversible for this rehearsal. |
| `BOUNDARIES_LIVE=FALSE` while existing pools have frozen rules | Those pools can retain old starts/spans instead of receiving the new boundary map. | Keep `BOUNDARIES_LIVE=TRUE` for the entire rehearsal. |
| Availability is later reduced | Pool/player documents are not rewound. | Use a fresh pool for a clean restart; do not assume snapshot rollback resets players. |

## Notification dedupe audit and procedure

**Observed:** a read-only Firestore query for document IDs greater than or equal to
`episodes_love-is-blind-uk-3_` and less than or equal to that prefix plus `U+F8FF` returned **0 matching mail documents** on August 21. No UK3 episode number is currently consumed by the real August 19 release.

That observation expires as soon as another UK3 publish or test occurs. Immediately before P1:

- [ ] Repeat the same read-only mail-ID range query and record the total and per-episode counts in the private log.
- [ ] Query every `pools` document with `season.id=love-is-blind-uk-3`; record every member UID. Episode publishes target opted-in members of **all** of those pools, not only the rehearsal pool.
- [ ] Query `notificationPreferences` for `newSeasons=true` and inventory the P1 audience. The season-drop trigger is global to opted-in accounts and does not require UK3 pool membership.
- [ ] Calculate the exact expected recipient count for P1 and P2. If an unexpected account could be mailed, stop and choose an approved response: turn off that disposable account's preference, knowingly accept the message, or move the notification test to an isolated season. Do not publish first and explain the blast radius afterward.
- [ ] If any UK3 episode ID now exists, stop and choose one of the four dedupe responses below before P1.

**Code-derived:** the exact episode ID is:

```text
mail/episodes_love-is-blind-uk-3_{availableThroughEpisode}_{recipientUid}
```

`sendNewEpisodeNudges` runs only when availability increases. It queues the final new counter value, not every skipped value. `queueNudge` uses document creation and treats `ALREADY_EXISTS` as success, so a repeated season/episode/recipient ID produces no new email and no visible error.

Prepare the four accounts before P1:

- [ ] In Settings, set **New episodes drop** on for all intended recipients. Verify `notificationPreferences/{uid}.newEpisodes=true` for each.
- [ ] Turn **A new season drops** on for at least one account and off for another. On P1, inspect `mail/season_love-is-blind-uk-3_{uid}` only for opted-in accounts. The four-player pool does not exist yet, so Episode 1 mail is not part of this run.
- [ ] After P2, inspect each expected `mail/episodes_love-is-blind-uk-3_2_{uid}`. Confirm `delivery.state=SUCCESS`, no delivery error, and actual mailbox receipt.
- [ ] Repeat a spot check at P5, P7, P11, and P12. A missing document means preference, pool membership, user email, or trigger execution is wrong; an existing successful document with no second email means dedupe is working as coded.

Friend phase locks have their own IDs:

```text
mail/phase_{poolId}_{phase}_{lockerUid}_{recipientUid}
mail/complete_{poolId}_reunion_{lockerUid}_{recipientUid}
```

The first requires `friendPhaseLocks=true`; the Reunion completion form requires `friendPoolCompletions=true`. Global-pool locks do not send these nudges.

If this exact rehearsal is repeated later, the episode IDs created this weekend will be a real dedupe trap. Choose explicitly:

1. Preferred for another UK3 notification test: obtain approval, export the matching IDs for the four test UIDs, then delete only those exact `mail/episodes_love-is-blind-uk-3_{episode}_{uid}` documents. Deleting mail is a production write and account deletion may already have removed some recipient mail.
2. For phase-lock mail, use a fresh friend pool. The pool ID changes every dedupe key without deleting delivery history.
3. If delivery itself is not under test, keep the documents and record that repeat nudges are knowingly suppressed.
4. Use another season only if the goal changes from “UK3 behaves as an August 29 drop.” It is not the preferred solution for this rehearsal.

## Four-account rehearsal

Run this section **after P1 is verified and before P2 is published**. Use four separate browser profiles and four disposable accounts. Record their emails and Firebase UIDs privately; do not put them in this repository.

| Account | Role | Intended pace |
| --- | --- | --- |
| A | Main pool owner | Fast early; deliberately finishes Reunion last |
| B | Joins by email | Slow in Pods; finishes Retreats first |
| C | Joins by link | Middle pace; finishes Weddings first |
| D | Joins by link; later deleted | Slow early; finishes Reunion first |

For every UI save, wait for **saved** before navigating. Keep Firestore and four mailboxes open. Record a screenshot, time, account, phase, screen, and expected/actual result for every failure.

### Prerequisite link/auth device gate

This gate is part of the rehearsal. Do it before entering season picks because the first operational act is sharing a real link.

- [ ] Account A creates a disposable friend pool named `UK3 Device Gate` and copies its full `https://throughthewall.ca/?join={poolId}.{joinCode}` URL.
- [ ] In `pools/{gatePoolId}`, record `joinCode`; confirm `rulesSnapshot.version=5` and the fixed UK3 starts/spans.
- [ ] Test cross-device email-link sign-in once as B. Request B's link in one profile and open it in a signed-out second device/profile. Expect sign-in without an email prompt, Firebase action parameters removed, and `join` preserved until the pool join is processed. Leave the gate pool and sign out afterward.
- [ ] Run the four rows below. Use an account not currently in the gate pool. After each successful join, confirm the Firestore evidence, leave the pool, reset the link, and use the new link for the next row.

| Context/account | Actions | Unambiguous pass condition |
| --- | --- | --- |
| iOS Safari — B | Sign B out first. Paste the link directly into Safari; use Google redirect sign-in. | Full-page redirect returns to `throughthewall.ca`, joins the intended pool at Episode 1, removes `join`, and shows no Firebase/CSP error. Plausible records `app_arrival` with `browserContext=browser`, `platform=ios`, then `sign_in_started` and `sign_in_redirect_success`. |
| Android Chrome — C | Sign C out first. Paste the newly reset link directly into Chrome; use Google redirect sign-in. | Same join result; Plausible uses `browserContext=browser`, `platform=android`. |
| Instagram in-app browser — D | Sign D out first. Send the newly reset link in an Instagram DM and open it without choosing an external browser. | `browserContext=instagram_in_app`; full-page redirect returns and joins. On failure, record the redirect error plus `sign_in_redirect_failure` and `app_error category=startup_failed`, then repeat once with **Open in browser**. |
| Messenger in-app browser — B | After B has left and A has reset the link again, sign B out. Send the new link in Messenger and open it inside Messenger. | `browserContext=messenger_in_app`; full-page redirect returns and joins. On failure, record the same telemetry and repeat once externally. |

For each successful row inspect `pools/{gatePoolId}`: the UID is in `members`, `lastJoinUid` is that UID, and `lastJoinProof` matches the link code used. After leaving, confirm the UID and all pool-scoped documents listed in the destructive-action section are gone.

- [ ] Account A deletes `UK3 Device Gate`. Confirm the pool path no longer exists before creating the evidence pool.
- [ ] Stop the rehearsal if Safari or Android Chrome fails. An embedded-browser failure may be logged and accepted only if its external-browser retry passes and Patrick explicitly accepts the limitation.

### Create the evidence pool and join three ways

- [ ] Account A creates `UK3 Aug 29 Rehearsal`. Record `{poolId}` and its initial link.
- [ ] Inspect `pools/{poolId}`. Expect A in `members`, `membershipClosed=false`, the UK3 season ID, and `rulesSnapshot.version=5` with the phase map above.
- [ ] A sends B an email invitation. Inspect `invites/{poolId}__{bLowercaseEmail}` for `status=pending`, and the matching `mail/invite_{poolId}__{encodedEmail}_{UTC-date}_{sendNumber}` for `delivery.state=SUCCESS`. Confirm the received message names the pool and UK3.
- [ ] B accepts from the invitation UI. Expect the invite status to become `accepted`, B in `pools/{poolId}.members`, and B to start at the Pods intro rather than A's watch position.
- [ ] C opens the ordinary share link and joins. No `invites` document should be created; C should be added to `members` and start at the Pods intro.
- [ ] D independently opens the same share link and joins with the same expected result.
- [ ] Confirm all four `pools/{poolId}/players/{uid}` documents exist after each player first enters the pool. Picks must not be embedded in these public player documents.

### Heat Check live update

- [ ] Keep A and C on the Heat Check tab in separate profiles.
- [ ] A rates at least two cast members and enables friend sharing. Inspect `castRatingProfiles/{A}/seasons/love-is-blind-uk-3` and `pools/{poolId}/castRatings/{A}`; the latter must have `shared=true` and the saved ratings.
- [ ] Without reloading A, C saves a distinctly different shared scorecard. Expect A's Heat Check to refresh automatically and its counts/averages to change. Inspect the equivalent two C documents.
- [ ] B saves ratings with friend sharing off. Expect `pools/{poolId}/castRatings/{B}.shared=false`; B's individual values must not appear in the friend view.
- [ ] Turn C's sharing off. Expect C's pool document to become `shared=false` and C's individual scorecard to disappear from the friend view while C's private profile remains.

### Stagger the episode watches

Use this pace before the phase-end catch-up. `w` below is the watched episode stored in `pools/{poolId}/players/{uid}`.

| After publish | A | B | C | D |
| --- | ---: | ---: | ---: | ---: |
| P1 / available 1 | 1 | 1 | 1 | 1 |
| P2 / available 2 | 2 | 1 | 1 | 1 |
| P3 / available 3 | 3 | 1 | 2 | 1 |
| P4 / available 4 | 4 | 2 | 3 | 1 |
| P6 / available 6, after Pods catch-up | 5 | 6 | 5 | 5 |
| P8 / available 8, after Retreats catch-up | 7 | 7 | 8 | 7 |
| P9 / available 9 | 7 | 7 | 9 | 8 |
| P10 / available 10 | 8 | 7 | 10 | 9 |

At each move:

- [ ] Make a recognisable, legal pick before locking. Use different picks or stakes across accounts so Against-the-Grain changes are visible.
- [ ] Confirm the lock summary names the correct board(s), remaining Hearts, and next episode.
- [ ] Inspect `pools/{poolId}/phasePicks/{phase}__{uid}` for the saved phase and picks, and `pools/{poolId}/players/{uid}` for `w`, `watchThrough`, `phase`, `screen`, and no embedded picks.
- [ ] Before the slower player completes a phase, verify that player cannot read another player's phase picks through the UI. After the viewer completes, the locked peers' picks should become visible.

### Complete every phase in a different player order

At each boundary publish, let all four accounts catch up, but register completion in this exact order:

| Phase end | Completion order |
| --- | --- |
| P5 — Pods after Episode 5 | A, C, B, D |
| P7 — Retreats after Episode 7 | B, A, D, C |
| P11 — Weddings after Episode 11 | C, D, A, B |
| P12 — Reunion after Episode 12 | D, B, C, A |

For every individual completion:

- [ ] Expect the phase-complete screen, no retry error, and the UID appended to `pools/{poolId}/phaseStatus/{phase}.completedMembers`.
- [ ] Confirm `pools/{poolId}/players/{uid}.completed.{phase}=true`, with the phase end in `w` and `watchThrough`.
- [ ] For Pods, Retreats, and Weddings, select **Continue**, verify the next phase intro, and inspect `players/{uid}.phase` for the new phase. After Reunion, select **Finish the season** and verify the Season complete screen with `screen=final`.
- [ ] On an account that has already completed that phase, keep Standings open. Within about a second, expect the newly completed player to appear without a manual page reload. Scores and position may move as the Against-the-Grain pool changes.
- [ ] Confirm the viewer who has not completed the phase still sees other picks/scores hidden.
- [ ] Inspect `mail/phase_{poolId}_{phase}_{lockerUid}_{recipientUid}` for one opted-in recipient after a Pods, Retreats, or Weddings completion. Expect `delivery.state=SUCCESS` and mailbox delivery.

Additional end-specific checks:

- [ ] At P5, Pods scores appear because `PODS_RESULTS_READY=TRUE`. If they do not, stop before P6.
- [ ] At P7, no Retreats row is pending and the provisional-results notice disappears once `DATING_RESULTS_READY=TRUE`.
- [ ] At P11, every resolved wedding outcome scores and the Reunion relationship-status options are present.
- [ ] At P12, the final account reaches **Season complete**. For D's first-place completion, inspect `mail/complete_{poolId}_reunion_{D}_{recipientUid}` with `friendPoolCompletions=true` on the recipient.
- [ ] Close the friend pool to new players only after the intended membership is final. In `pools/{poolId}`, expect `membershipClosed=true`. Once all four are complete and all results are ready, expect Final standings and Wrapped rather than a permanently live leaderboard.

There is no trusted leaderboard document to inspect. Friend standings are computed in each client from `phaseStatus`, locked `phasePicks`, and the published season snapshot. Firestore proves the inputs, while agreement across the four UIs is the integration check.

### Conditional Retro Events test

Run this section only if the final UK3 source data contains a genuine Retro Events row.

- [ ] Before its reveal, make a matching pick in the row's `applies_phase` with at least one account and a non-matching pick with another.
- [ ] Inspect the row in `seasons/love-is-blind-uk-3` → `Retro Events`: verify `market`, `target`, optional `voidMarket`, `appliesPhase`, `revealedEp`, note, and `confirmed`.
- [ ] Keep one account below `revealedEp`; its Standings must not reveal the correction.
- [ ] Move another account through `revealedEp`. Expect the explanatory card with a `retro` chip; an unconfirmed row must also show pending/placeholder treatment.
- [ ] After that account completes the phase owning the reveal, expect the Retro column and total adjustment. Reconcile it against the original `phasePicks/{appliesPhase}__{uid}` and the season row; there is no separate adjustment document.
- [ ] Before P12 is accepted as final, resolve the row and publish `confirmed=TRUE`, or remove it from the approved fixture if it was not a real event. An unconfirmed Retro row is compatible with a pending-path check, not with finalized standings/Wrapped.

If there is no legitimate row, record **N/A — no UK3 retro event in the published data**. Adding test-only fake outcome data is not an acceptable workaround.

## Destructive-action finish

Do these only after the gameplay evidence has been captured.

### Reset invite link, then leave and rejoin

- [ ] If the main pool was closed for the Final standings check, A reopens it. Confirm `pools/{poolId}.membershipClosed=false` before testing links.
- [ ] Record the main pool's old `joinCode` and URL.
- [ ] A selects **Reset invite link** and confirms. Inspect `pools/{poolId}.joinCode`; it must change immediately while `members` stays unchanged.
- [ ] D selects **Leave pool**. Expect D removed from `members`, and confirm these pool-scoped documents are deleted or scrubbed:
  - `pools/{poolId}/players/{D}` deleted;
  - `pools/{poolId}/castRatings/{D}` deleted;
  - `pools/{poolId}/phasePicks/pods__{D}`, `dating__{D}`, `weddings__{D}`, and `reunion__{D}` deleted;
  - D removed from every `pools/{poolId}/phaseStatus/{phase}.completedMembers` array.
- [ ] As D, open the old link. Expect a clear rejection and no membership change.
- [ ] Open the new link. Expect D to join and start fresh at Episode 1; the previous picks/progress must not return.
- [ ] Have D leave once more and recheck the cleanup above.

### Delete a pool

- [ ] B creates a separate pool named `DELETE ME — UK3 rehearsal`, adds one pending email invitation, and records its pool ID.
- [ ] B deletes that pool by typing its exact name.
- [ ] Confirm `pools/{deletePoolId}` and every subcollection are absent, and every `invites` document with that pool ID is gone. The already queued invitation `mail` document is intentionally retained; pool deletion does not erase delivery history. Keep the main evidence pool until the rehearsal report is complete.

### Delete an account

- [ ] D confirms no irreplaceable data remains and selects **Delete my account**.
- [ ] Expect the app to sign out after the callable succeeds.
- [ ] In Authentication, confirm D's current UID is gone.
- [ ] Confirm `users/{D}`, `notificationPreferences/{D}`, `castRatingProfiles/{D}` and its subcollections, `clientErrors/{D}`, D's invite/rate-limit documents, recipient-addressed `mail` documents, and D's membership/data in every pool are gone.
- [ ] Do not use “cannot ever sign in again” as the pass condition. Google or email-link authentication can create a fresh UID for the same identity later; permanent identity blocking is not implemented.

## Rollback and abort procedure

### If the latest publish is bad

- [ ] Stop sheet edits and player activity.
- [ ] In the UK3 private season admin, confirm the selected season ID.
- [ ] Stop for production-write approval.
- [ ] Run **Restore latest backup** / `rollbackSeasonSnapshot`.
- [ ] Record `restoredFrom` and `previousLiveSavedTo`. The failed live document is preserved in the latter rollback backup.
- [ ] In `seasons/love-is-blind-uk-3`, verify the prior `publishedAt`, availability, status, flags, and row counts.
- [ ] The rollback function restores only the season document. If `appConfig/public` no longer matches, confirm the sheet's release label still matches the restored snapshot, stop for approval, then run `setDefaultSeasonFromAdmin` with no argument from the Apps Script editor. UK3 is the configured default, so this refreshes routing without switching seasons. Verify its `status`, release label, default season ID, and Global Pool season ID against the restored snapshot.
- [ ] In a private app session, refresh season data and verify the previous episode ceiling. Lowering availability does not send an episode nudge.

The publisher's latest-backup action restores the immediately previous snapshot. Running it again reverses that rollback; it is not a browser for arbitrary old backups.

### If the rehearsal must be parked

Correct and preview the source data, then publish the Gate 1 parked state again:

```text
SEASON_STATUS=comingSoon
AVAILABLE_THROUGH_EP=0
BOUNDARIES_LIVE=TRUE
all four *_BOUNDARY_FINAL=FALSE
all four *_RESULTS_READY=FALSE
RELEASE_LABEL=First episodes drop August 29, 2026
```

This is a safe app pause, not a player reset. It does not delete pool progress, locked picks, `phaseStatus`, or mail dedupe documents. Do not resume an exact clean run in the same pool; create a new rehearsal pool. A player who has already continued into a later phase cannot be rewound to an earlier completed phase by season rollback.

Do not mark UK3 `completed` as an abort mechanism. The publisher refuses to complete the active default season, completed seasons change client behaviour, and a completed/false-boundary combination can strand players.

## Limitations and steps that cannot be fully verified today

Keep these separate from ordinary rehearsal failures:

1. **Current UK3 data is empty.** Cast, couples, all outcomes, and any genuine retro correction must be entered before the rehearsal. This is a data prerequisite, not a code change.
2. **No legitimate Retro Events row is currently present.** The retro path is N/A unless the real season data supports one.
3. **There is no per-player or per-pool rewind control.** Publishing an earlier season snapshot does not rewind players. A clean repeat requires a new pool; an admin rewind feature would require code.
4. **There is no trusted Firestore standings output.** Standings are client-computed. The source documents and agreement across clients can be verified, but a server leaderboard document does not exist.
5. **Account deletion is erasure, not an identity ban.** The same provider identity can sign in later and create a new account. A durable “can never sign in again” check is impossible without a blocklist/account-state change.
6. **Known public-beta spoiler limitation:** the full Couples dataset, including `engagedEp`, wedding/breakup/outcome fields, and other future information, is loaded into every signed-in client regardless of watch position. Anyone who opens developer tools can read ahead. The UI hides spoilers but the data boundary does not. Do not fix this during the rehearsal; record it in the public-beta go/no-go notes.
7. **Mail delivery is not proved by the app UI.** A notification passes only when the expected `mail/{id}` exists with successful delivery state and the target mailbox receives it.

## Exit criteria

The rehearsal passes only when:

- all device-gate rows have their required result or an explicitly accepted embedded-browser limitation;
- the twelve deliberate availability states were published and verified in order;
- all four players completed every phase in the specified cross-player order;
- picks remained hidden until the viewer's own lock, then Standings updated live as peers completed;
- Heat Check sharing, opt-out, and live refresh matched the Firestore documents;
- one episode nudge and one friend-phase nudge were delivered end to end, plus the Reunion completion nudge if selected;
- every applicable Retro Events expectation passed or was recorded N/A for lack of a legitimate row;
- reset link, leave pool, delete pool, and delete account produced the exact cleanup listed above;
- no season-config banner, repeated save failure, exposed UI pick, callable platform 403, or unexplained mail failure occurred; and
- UK3 is left either at the explicitly approved P12 state or the explicitly approved parked state, with its final backup path recorded.
