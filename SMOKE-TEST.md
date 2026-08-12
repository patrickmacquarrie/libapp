# Through the Wall friends beta smoke test

Run this two-account checklist against production before the August 19, 2026 UK3 launch. Budget 25 minutes. Use two separate browser profiles so Account A and Account B stay signed in at the same time. Use a throwaway Account C only for account deletion.

## Before starting (2 minutes)

- [ ] Open the app in two browser profiles and sign in as Account A and Account B.
- [ ] Confirm the production response includes the CSP and other security headers from `firebase.json`, with no blocked app scripts in the browser console.
- [ ] Block pop-ups, then start Google sign-in and confirm the app automatically continues with redirect sign-in without displaying a Firebase error code.
- [ ] Open the app inside one common in-app browser and confirm Google sign-in uses the full-page redirect flow. If an invite link contains `?join=`, confirm it still joins the intended pool after sign-in.
- [ ] Request an email sign-in link in Account A's browser, open it in Account B's browser profile or another device, and confirm sign-in completes without asking for the email address. Confirm the address and Firebase action parameters disappear from the address bar while any `join` parameter remains.
- [ ] Keep the Firebase console open to Firestore Database for project `lib-oauth`.
- [ ] Confirm `seasons/love-is-blind-uk-3` exists and its top-level `status` is `upcoming`, not `live`. **Pre-verified in production on August 8:** the document exists with `status=upcoming`; all six tab fields are arrays of row maps. Stored row counts (including header rows) are Cast 1, Couples 1, Dating Results 1, Reunion Results 1, Settings 38, and Retro Events 0.
- [ ] Use Brazil Season 1 for the live-season walkthrough while it is being entered episode by episode. Choose a completed historical season for any later-phase checks Brazil has not reached yet. Use a season with at least one `*_BOUNDARY_FINAL = FALSE` setting for the successful `reopenPhase` check; do not temporarily mark UK3 live.

## Pool, invite, and join (5 minutes)

- [ ] Account A creates a private UK3 pool and records its pool ID and join code.
- [ ] In `pools/{poolId}`, confirm `rulesSnapshot.version` is exactly `5`. Do not edit the document. **Pre-verified in the deployed code:** the client writes version 5; the green production build asserts that the rules accept versions 3–5, and the deployed rules compiled successfully.
- [ ] Account A sends Account B an email invite.
- [ ] Confirm the Resend-delivered email arrives, names the pool/season, and its join link opens the app with the expected pool invitation.
- [ ] In the other browser profile, Account B joins through the ordinary share link/join-code flow.
- [ ] Confirm Account B lands at Episode 1 rather than inheriting Account A's watch position.

## Pods picks, privacy, receipts, and budgets (7 minutes)

- [ ] Both accounts make Pods picks. Include one deliberate junk pair made from two real cast members who never become a couple, and wager a memorable amount on it.
- [ ] Account A locks/completes Pods. If UK3 is still upcoming, do this in the historical-season pool selected above.
- [ ] Before Account B completes Pods, view the pool as Account B and confirm Account A's Pods picks remain hidden.
- [ ] Account B locks/completes Pods, then confirm both players' picks become visible according to the normal reveal rules.
- [ ] In each account's receipts, find the junk pair and confirm the exact outcome is a miss labelled “did not get engaged.” **Pre-verified in code:** the engine audit covers a known-cast pair absent from Couples, checks that label, stake, and pool-size participation, and prevents a duplicate miss.
- [ ] Reconcile each Pods budget: starting budget = spent Hearts + unspent Hearts, and the sum of receipt stakes equals spent Hearts. Confirm the junk-pair stake is charged once.

## Callable boundaries and account cleanup (6 minutes)

- [ ] **Pre-verified in production:** unauthenticated callable-protocol requests reached `reopenPhase`, `leavePool`, `sendPoolInvite`, `openGlobalPool`, and `deleteMyAccount`; each returned the expected application-level `401 UNAUTHENTICATED`. No callable returned a platform/Cloud Run 403. This verifies public ingress, not the authenticated success/refusal cases below.
- [ ] On the live-status test season, complete a phase whose boundary is not final. Arrange the same provisional-completion state the app repairs (`completed=true`, close screen, member listed in `phaseStatus/{phase}.completedMembers`), then reload or invoke `reopenPhase`. Confirm the callable succeeds, removes only that user's UID from `completedMembers`, leaves picks intact, and returns the player to the watch screen.
- [ ] Against a completed/historical season, invoke the same `reopenPhase` path and confirm it refuses with “Only a live season phase can reopen.”
- [ ] From Account B, leave the test pool and confirm the `leavePool` callable returns successfully, removes B from `members`, and removes B's pool-scoped player data.
- [ ] Sign in as throwaway Account C, create no irreplaceable data, run Delete My Account, and confirm the `deleteMyAccount` callable succeeds and C can no longer sign in.

## Reunion lock privacy (when reachable)

- [ ] Account A saves and locks Reunion picks. Before Account B locks, confirm B cannot see A's Reunion picks even if B refreshes on the Reunion watch screen.
- [ ] Account B locks Reunion picks, then confirm A and B can see one another's locked picks.
- [ ] Return Account B to the prediction board or retry the save and confirm the locked Reunion picks cannot be changed. Identical network retries should still succeed.

## Global-to-friend pick mirroring

- [ ] Join the Global Pool, make at least one unlocked pick, then return to the lobby and start a friend pool for the same season.
- [ ] Confirm “Mirror my Global Pool picks” appears only for that matching season. Select it and create the pool.
- [ ] Confirm the new friend pool starts at Episode 1 with the existing Global Pool pick copied in.
- [ ] Before completing the friend-pool checkpoint, change the pick in the Global Pool and confirm the matching friend-pool pick updates. Confirm a completed friend-pool checkpoint remains immutable.

## Pass criteria

The beta is ready only if every box above passes, no callable returns a platform/Cloud Run 403, the UK3 season stays `upcoming`, and both accounts' budgets and privacy behaviour match.
