# Batch 2 rollback and configuration tests

This branch prepares tests only. It must not be deployed before September 19, 2026.

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

## Remaining red release-contract test

`npm run test:release-contract` executes the current browser, Functions, and rollback behavior rather than searching for source strings. It remains deliberately outside the normal CI gate. The three remaining failures cover:

- explicitly repairing or scheduling Global standings after rollback;
- using the same missing `RESULTS_READY` default in the browser and Cloud Functions;
- using the same blank `reunion_status_eligible` default.

The publisher now restores matching routing metadata atomically, and the Season Admin defaults match the browser and Functions defaults. Those behaviors are covered by executable regression tests.

The configuration assertions define defaults for new beta seasons. UK3 must retain its recorded effective configuration and scoring version rather than being silently reinterpreted under these defaults.

Before converting the red contract into the normal CI gate, add a fixture made from the final UK3 Settings snapshot and prove that it retains the same effective values.
