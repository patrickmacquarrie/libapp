# Batch 2 rollback and configuration tests

This branch contains the post-test compatibility checkpoint and operational tests. It remains undeployed until the authenticated backup and clone rehearsal are complete.

## Green regression test

`npm run test:rollback` executes the Apps Script rollback path with an in-memory Firestore substitute. It verifies that:

- the recorded season backup is restored exactly;
- the displaced live season is saved before restoration;
- matching default-season routing metadata is restored in the same atomic commit;
- displaced routing metadata is preserved for a second rollback;
- the rescue copy becomes the next rollback target;
- running rollback again reverses the first rollback; and
- a missing backup pointer fails before a write.

This test is included in `test:operations` because it describes behaviour that already works.

## Green release-contract test

`npm run test:release-contract` executes browser, Functions, and rollback behavior rather than searching for source strings. It is now part of the normal operations gate and verifies:

- rollback explicitly records the Global standings rebuild scheduled by the season write;
- configuration v2 uses the same missing `RESULTS_READY` default in the browser and Cloud Functions;
- configuration v2 uses the same blank `reunion_status_eligible` default; and
- the recorded UK3 Settings fixture retains the exact legacy v1 interpretations that passed the friends test.

The publisher now restores matching routing metadata atomically, and the Season Admin defaults match the browser and Functions defaults. Those behaviors are covered by executable regression tests.

Missing `CONFIG_VERSION` resolves to legacy v1. Existing seasons therefore do not change behavior when the application code changes. New seasons can opt into v2 from Season Admin.

The committed fixture contains the 47 Settings values from the authenticated Firestore checkpoint. It deliberately excludes pool, player, pick, and standings data; those remain in the private local checkpoint outside Git.

## Clone rehearsal

`npm run test:clone-rehearsal` accepts the private checkpoint through `UK3_CHECKPOINT_PATH` and refuses to run unless it is connected to a local Firestore emulator. The completed rehearsal cloned 41 documents across the UK3 season, private pool, Global Pool, player state, phase status, picks, trusted scoring inputs, and standings. The atomic release and exact rollback passed, and every cloned pool document remained unchanged.

Only the non-sensitive counts and checkpoint hash are committed in `scripts/fixtures/uk3-clone-rehearsal.json`.
