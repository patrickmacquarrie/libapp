# Batch C notes

## What changed

- Direct browser updates can no longer append a user to a Global Pool. Global joins must pass through the trusted callable, which enforces the temporary membership ceiling and creates the server-owned scoring records.
- Signed-in users may fetch the single compact `appConfig/seasonCatalog` document. Collection listing, signed-out reads, and all browser writes remain denied.
- A Global Pool member may fetch only their own `standingsRows/{uid}` document. Other users' rows, collection listing, non-member reads, and all browser writes remain denied.

## What was tested

- Firestore emulator assertions passed for the new allowed reads and every adjacent denial, including a direct Global Pool self-append attempt.
- The Firebase CLI subsequently returned its known process-control error while shutting down the already-successful emulator run in this Codex sandbox. Draft-PR CI remains the authoritative complete command result.
- `git diff --check` passed.

## Deployment order

- Keep this batch undeployed until the stacked A and B changes are reviewed together.
- Deploy the Functions and hosting changes that use these rules in the same release window as the rules. Do not remove Batch A's catalog fallback until the publisher has rebuilt the catalog successfully.
- No UK3 season document, pool, or configuration version was changed.
