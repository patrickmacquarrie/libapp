# Public-test checklist

## Ready in this codebase

- Global and friend-pool picks require the viewer to complete/lock the matching checkpoint before another player's picks can be read.
- Reunion picks become immutable as soon as the player's public state enters the locked watch flow.
- Only the pool owner can freeze a validated scoring-rules snapshot.
- Global Heat Check aggregates are written by a trusted Firestore trigger; browser aggregate writes are denied.
- Email invitations are owner-only, capped at 20 per owner per UTC day, and answered invites cannot be reset to pending.
- Invitation matching requires a verified provider email address, including the verified Apple relay address when Hide My Email is used.
- Same-day invitation resends create a fresh delivery message instead of colliding with the first send.
- Shareable friend-pool join links avoid exact email matching.
- Pool owners can invalidate an old share link immediately, and only the new link remains valid.
- Pool deletion, leaving pools, and account deletion run through trusted callable functions; account deletion also removes queued mail and bounded client diagnostics.
- Entering a new pool remains usable when one mirrored phase is already locked; the app reports and skips only that phase.
- Phase status has one source of truth (`completedMembers`) and no stale `revealed` flag.
- Required Firestore composite and collection-group indexes are versioned in `firestore.indexes.json`.
- Google and email-link authentication UI is present. Apple remains hidden until its developer credentials are configured.
- Firestore season snapshots are the primary live data source.
- PWA manifest, app icon, absolute social-preview image, privacy page, terms page, and repository README are included.
- Signed-out visitors can play a local prediction taste and inspect a sample reveal before authentication.
- Opt-in email nudge preferences and duplicate-safe notification triggers are implemented.

## Console activation required

1. Deploy `firestore.rules`, `firestore.indexes.json`, and `functions/` together.
2. Install Firebase's Trigger Email extension, point it at the `mail` collection, and configure the production SMTP sender.
3. Enable Google and Email link providers in Firebase Authentication. Add `throughthewall.ca` and `www.throughthewall.ca` to Authorized domains. Keep Apple hidden until its service ID, team ID, key ID, and private key are configured.
4. Connect the production custom domain in Firebase Hosting and wait for its certificate to become active before changing DNS. Confirm the `github-actions/libapp` Workload Identity provider can impersonate the dedicated `github-firebase-hosting` service account; no persistent JSON key or repository secret should exist.
5. Register the production domain with Firebase App Check using reCAPTCHA Enterprise, initialize App Check in the client with that site key, then set callable functions to `enforceAppCheck: true`.
6. Complete `POSTHOG-BETA-RUNBOOK.md`: create the EU Cloud project and `price_variant` flag, set the GitHub production environment variables, deploy Hosting, verify anonymous-to-identified stitching and replay masking, and confirm Plausible still receives events in parallel.

## Post-deploy verification

After every `firebase deploy`, sign in and call `reopenPhase` once against any pool. Confirm the response is a domain error such as `invalid-argument` or `failed-precondition`, not an HTTP 403. If it returns 403, restore the callable's public ingress setting:

Also confirm Google and cross-device email-link sign-in on `throughthewall.ca`; verify Google allows `https://throughthewall.ca/__/auth/handler` as a return URL, redirect sign-in preserves invite links, and the browser console has no CSP violations or missing local React assets. Send two invitations to the same address on the same UTC day and confirm both create delivery attempts. Rotate a friend-pool invite link and confirm the old link is rejected while the new link joins successfully. Run the PostHog release verification in `POSTHOG-BETA-RUNBOOK.md` before opening beta access.

```sh
gcloud run services update reopenphase \
  --project=lib-oauth \
  --region=us-central1 \
  --no-invoker-iam-check
```

## Required before a large Global Pool

The current Global Pool still uses the legacy `members` array and client-computed leaderboard. Do not use it for a multi-thousand-player launch. Complete these two coordinated migrations first:

- Store membership at `pools/{globalPoolId}/members/{uid}` and maintain a sharded/distributed count. Backfill existing array members before removing the legacy field.
- Compute trusted leaderboard entry documents from locked picks and season results. Query only the top page plus the viewer's own entry; do not read every player and every pick in the browser.

These changes require a data migration and a defined server scoring implementation. Switching only the rules or only the client would strand existing members or produce a partially scored leaderboard, so they are intentionally kept behind the public-launch gate.
