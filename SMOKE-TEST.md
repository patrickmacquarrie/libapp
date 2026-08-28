# Through the Wall friends beta smoke test

Run this two-account checklist against production before the August 19, 2026 UK3 launch. Budget 25 minutes. Use two separate browser profiles so Account A and Account B stay signed in at the same time. Use a throwaway Account C only for account deletion.

## Before starting (2 minutes)

- [ ] Open the app in two browser profiles and sign in as Account A and Account B.
- [ ] Confirm the production response includes the CSP and other security headers from `firebase.json`, with no blocked app scripts in the browser console.
- [ ] Start Google sign-in and confirm the app uses a full-page redirect without opening a popup or displaying a Firebase error code.
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

## Feedback and support

- [ ] From Account A, open **Settings → Feedback & support**, choose each category once across test runs, and send a non-sensitive test message.
- [ ] Confirm the app shows the success state and the message arrives in the maintainer inbox from **Through the Wall Support**, with Reply-To set to Account A’s verified email.
- [ ] Confirm the message body is not visible in PostHog event properties or session replay. The submission event should include only the category and screen.
- [ ] Confirm a signed-out visitor can open the `support@throughthewall.ca` email link from the landing page.

## Auth cutover device matrix (repeat before each public launch)

**Recorded result — PASS (August 24, 2026).** Patrick reported that the full four-row device matrix passed against the production build then live. Read-only release verification identified that build as main commit `b8f9d80f4d869c30ced55c30223cfb0f161dcb3d`, deployed by GitHub Actions run `32541755756` on August 21 at 6:54 PM Mountain time. That revision contains `cf1afbe` through merge commit `4d8e7c1`, and the fetched production app contains the expiring `localStorage` fallback for `?join=`. The result therefore covers the invitation round trip across Google redirect, not only bare sign-in. Do not repeat this matrix for the current release; retain the checklist below for the next public launch.

Prepare one throwaway friend pool and copy its full `https://throughthewall.ca/?join=<pool>.<code>` invitation link. Use an account that is not yet in that pool. For each test below, the pass condition is: the link opens on `throughthewall.ca`, Google sign-in replaces the whole page rather than opening a popup, the app returns to `throughthewall.ca`, the intended pool is joined, and no Firebase error code or CSP violation appears. Do not reuse the same account after it joins; reset the invite link or use another throwaway account.

### iOS Safari

- [ ] Paste the invitation link directly into Safari and confirm it is not running inside another app's embedded browser.
- [ ] Tap **Sign in with Google**, finish the account chooser, and confirm Safari returns to the same Through the Wall invitation.
- [ ] Confirm the pool opens at Episode 1 and the `join` value survives the auth redirect, then disappears after the app processes the invitation.
- [ ] In Plausible, confirm this attempt produced `app_arrival` with `browserContext=browser` and `platform=ios`, followed by `sign_in_started` and `sign_in_redirect_success`.

### Android Chrome

- [ ] Paste the invitation link directly into Chrome.
- [ ] Tap **Sign in with Google**, finish the account chooser, and confirm Chrome returns to the same Through the Wall invitation.
- [ ] Confirm the pool opens at Episode 1 and the `join` value survives the auth redirect, then disappears after the app processes the invitation.
- [ ] In Plausible, confirm `app_arrival` has `browserContext=browser` and `platform=android`, followed by `sign_in_started` and `sign_in_redirect_success`.

### Instagram in-app browser

- [ ] Send the invitation link in an Instagram DM and open it without choosing **Open in external browser**.
- [ ] Confirm `app_arrival` appears with `browserContext=instagram_in_app` and the Google button starts a full-page redirect.
- [ ] Complete Google sign-in. Confirm the app returns, joins the intended pool, and does not strand the user on the signed-out screen.
- [ ] If it fails, record whether the app shows “Sign-in returned to the app but could not be completed.” Confirm Plausible contains `sign_in_redirect_failure` with an auth `code` and an `app_error` with `category=startup_failed`.

### Messenger in-app browser

- [ ] Send the invitation link in Messenger and open it without choosing **Open in browser**.
- [ ] Confirm `app_arrival` appears with `browserContext=messenger_in_app` and the Google button starts a full-page redirect.
- [ ] Complete Google sign-in. Confirm the app returns, joins the intended pool, and does not strand the user on the signed-out screen.
- [ ] If it fails, record whether the app shows the redirect-specific error. Confirm Plausible contains `sign_in_redirect_failure` with an auth `code` and an `app_error` with `category=startup_failed`.

For any failed in-app-browser attempt, repeat the same invitation with that app's **Open in browser** action. Record whether the external-browser attempt succeeds; this separates an embedded-webview failure from a general Firebase configuration failure.

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

## Global/friend pick mirroring

- [ ] Join the Global Pool, make at least one unlocked pick, then return to the lobby and start a friend pool for the same season.
- [ ] Confirm “Link my Global Pool game” appears only for that matching season. Select it and create the pool.
- [ ] Confirm the new friend pool adopts the existing Global picks and confirmed watch progress without moving either pool backward.
- [ ] Before completing the friend-pool checkpoint, change the pick in the Global Pool and confirm the matching friend-pool pick updates. Confirm a completed friend-pool checkpoint remains immutable.
- [ ] With a separate friend pool selected while joining Global, advance that friend pool through Episode 3 and leave Global linked to it. Open Global and confirm it also shows Episode 3 as watched, while the friend pool remains the selected pick source.
- [ ] Lock an imported Global pick made after Episode 3. Confirm its Global receipt says **Locked after Episode 3**, not the episode when the player first joined Global. Picks made before Global membership must still be floored at the Global join episode.
- [ ] Advance a linked Global source and confirm its friend-pool target advances too. Then advance a linked friend source and confirm Global advances. Neither direction may move a player backward.
- [ ] Complete Pods in either linked source. Confirm Pods closes in the target pool as well and neither pool allows another Pods prediction.
- [ ] In a fully released historical Global test, use the admin-only simulation reset. Confirm it clears Global test picks/progress/scores, preserves established friend-pool sync links, clears only each linked tester’s game state in the paired friend pool (not other members or pool settings), refuses a partially released season, and causes new Global receipts to display the server-credited episode used for scoring.
- [ ] Delete a throwaway friend pool that is still selected as a Global mirror source. Reopen Global and confirm it opens, preserves its already-copied picks and progress, removes the stale link, and explains that Global is now independent.

## Pass criteria

The beta is ready only if every box above passes, no callable returns a platform/Cloud Run 403, the UK3 season stays `upcoming`, and both accounts' budgets and privacy behaviour match.
