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

The committed fixture contains public source-sheet Settings only. It deliberately excludes pool, player, pick, and standings data. Before deployment, compare it with the authenticated Firestore export and complete the clone rehearsal.
