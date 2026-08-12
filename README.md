# Through the Wall

An unofficial social prediction-pool app for friends watching *Love Is Blind*. It includes asynchronous checkpoints, spoiler-aware standings, historical seasons, and optional Heat Check ratings.

## Local build

```sh
npm ci
npm run build
```

The deployable static site is written to `dist/`. GitHub Actions publishes that folder to Firebase Hosting after the release gate passes. React and ReactDOM are copied into hashed local assets during the build, so the production app does not depend on their public CDN.

## Tests

Install Java 21 as well as Node.js 22, then run the same release gate used by Firebase Hosting:

```sh
npm ci
npm run check
```

The gate runs the prediction-engine audit, starts local Firestore and Authentication emulators for the security-rules tests, and produces the deployable build. Pull requests run the full gate, and a push to `main` deploys only after it passes.

## Firebase deployment

The browser app is static, but security-sensitive cleanup, invitation limiting, account deletion, global Heat Check aggregation, and opt-in comeback nudges use Firebase Functions.

```sh
cd functions
npm install
cd ..
firebase deploy --only firestore:rules,functions
```

Email nudges use the official Firebase **Trigger Email** extension. Install the extension in the `lib-oauth` project, configure its SMTP provider, and keep its mail collection set to `mail`. The app never grants browser access to that collection: trusted Functions atomically create each deterministic mail document once, so a retried trigger cannot replace it or send the same nudge twice.

Two notification events are currently queued:

- a friend locks a Pods, Retreats, Weddings, or Reunion checkpoint;
- a published season snapshot increases `AVAILABLE_THROUGH_EP`.

Before testing Google or email-link sign-in, enable those providers in Firebase Authentication and add both `throughthewall.ca` and `www.throughthewall.ca` to Authorized domains. Apple sign-in is intentionally hidden until its service ID, team ID, key ID, and private key are configured.

The production workflow authenticates without a stored key: GitHub's OIDC token is exchanged through the `github-actions/libapp` Workload Identity provider for the dedicated `github-firebase-hosting` service account. Confirm the custom domain is connected and its certificate is active in Firebase Hosting before merging a release that changes DNS or hosting providers.

## Season publishing

The app reads the published Firestore `seasons/{seasonId}` snapshot first. Public Google Sheet CSV is a fallback/admin source only. Keep the Firestore snapshot current before episode traffic arrives.

Use the reusable publisher in [`scripts/season-publisher`](scripts/season-publisher/README.md) and follow [`SEASON-LAUNCH-RUNBOOK.md`](SEASON-LAUNCH-RUNBOOK.md) for preview, publish, verification, monitoring, and rollback.

## Public-launch checklist

See `PUBLIC-TEST-CHECKLIST.md`. Do not open a large Global Pool until its subcollection membership and precomputed leaderboard migration is complete.
