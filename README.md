# Through the Wall

An unofficial social prediction-pool app for friends watching *Love Is Blind*. It includes asynchronous checkpoints, spoiler-aware standings, historical seasons, and optional Heat Check ratings.

## Local build

```sh
npm ci
npm run build
```

The deployable static site is written to `dist/`. GitHub Actions publishes that folder to GitHub Pages.

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

Before testing Apple or email-link sign-in, enable those providers in Firebase Authentication and add `patrickmacquarrie.github.io` to Authorized domains. Apple also requires its service ID, team ID, key ID, and private key.

## Season publishing

The app reads the published Firestore `seasons/{seasonId}` snapshot first. Public Google Sheet CSV is a fallback/admin source only. Keep the Firestore snapshot current before episode traffic arrives.

## Public-launch checklist

See `PUBLIC-TEST-CHECKLIST.md`. Do not open a large Global Pool until its subcollection membership and precomputed leaderboard migration is complete.
