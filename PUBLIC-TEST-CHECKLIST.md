# Public-test checklist

## Ready in this codebase

- Global and friend-pool picks require the viewer to complete/lock the matching checkpoint before another player's picks can be read.
- Reunion picks become immutable as soon as the player's public state enters the locked watch flow.
- Only the pool owner can freeze a validated scoring-rules snapshot.
- Global Cast Chemistry aggregates are written by a trusted Firestore trigger; browser aggregate writes are denied.
- Email invitations are owner-only, capped at 10 per owner per UTC day, and answered invites cannot be reset to pending.
- Shareable friend-pool join links avoid exact email matching.
- Members can leave pools and users can delete their account through trusted callable functions.
- Google, Apple, and email-link authentication UI is present.
- Firestore season snapshots are the primary live data source.
- PWA manifest, app icon, absolute social-preview image, privacy page, terms page, and repository README are included.

## Console activation required

1. Deploy `firestore.rules` and `functions/` together.
2. Enable Apple and Email link providers in Firebase Authentication. Add the GitHub Pages domain to Authorized domains.
3. Register the production domain with Firebase App Check using reCAPTCHA Enterprise, initialize App Check in the client with that site key, then set callable functions to `enforceAppCheck: true`.
4. Add the Firebase Analytics `measurementId` to the public web config and instrument the agreed funnel taxonomy: sign-in started/completed, pool created, invite or link accepted, checkpoint locked/completed, Chemistry saved/shared, and return visit.

## Required before a large Global Pool

The current Global Pool still uses the legacy `members` array and client-computed leaderboard. Do not use it for a multi-thousand-player launch. Complete these two coordinated migrations first:

- Store membership at `pools/{globalPoolId}/members/{uid}` and maintain a sharded/distributed count. Backfill existing array members before removing the legacy field.
- Compute trusted leaderboard entry documents from locked picks and season results. Query only the top page plus the viewer's own entry; do not read every player and every pick in the browser.

These changes require a data migration and a defined server scoring implementation. Switching only the rules or only the client would strand existing members or produce a partially scored leaderboard, so they are intentionally kept behind the public-launch gate.
