# Batch 2 rollback and configuration tests

This branch prepares tests only. It must not be deployed before September 19, 2026.

## Green regression test

`npm run test:rollback` executes the Apps Script rollback path with an in-memory Firestore substitute. It verifies that:

- the recorded season backup is restored exactly;
- the displaced live season is saved before restoration;
- the rescue copy becomes the next rollback target;
- running rollback again reverses the first rollback; and
- a missing backup pointer fails before a write.

This test is included in `test:operations` because it describes behaviour that already works.

## Red release-contract test

`npm run test:release-contract` describes the remaining intended contract. It currently fails and is deliberately not part of the normal CI gate until the implementation is ready. The failures cover:

- restoring matching default-season routing metadata;
- explicitly repairing or scheduling Global standings after rollback;
- using the same missing `RESULTS_READY` default in the browser and Cloud Functions;
- using the same blank `reunion_status_eligible` default; and
- aligning Season Admin phase defaults with the browser and Cloud Functions.

The configuration assertions define defaults for new beta seasons. UK3 must retain its recorded effective configuration and scoring version rather than being silently reinterpreted under these defaults.

Before converting the red contract into the normal CI gate, add a fixture made from the final UK3 Settings snapshot and prove that it retains the same effective values.
