# Public beta hardening plan

This plan uses an honour-system threat model. Through the Wall is a social prediction pool, not a prize or wagering platform. It should prevent accidental corruption and casual in-app snooping, but it does not promise spoiler-proof or tamper-proof competition.

## Accepted risks

- Players can find episode spoilers outside the app.
- Friend pools depend primarily on trust between their members.
- A determined technical user may inspect published browser data or make unusual requests.
- Published season results are not confidential after their intended release.

These risks do not justify complex controls that make ordinary prediction, watching, saving, or scoring unreliable.

## Minimum locks

- Require sign-in and pool membership for pool data.
- Keep normal edits closed after a checkpoint is completed.
- Do not expose opponents' exact Global Pool picks before the viewer has locked the same checkpoint.
- Route Global Pool locking through one tested server operation.
- Reject malformed data at trusted release and scoring boundaries.
- Log repeated failures and unusual direct-write attempts without blocking normal play.

## UK Season 3 production freeze

Until the friends test finishes on September 17, 2026:

- Do not deploy scoring, pick-storage, Firestore-rule, membership-model, or shared configuration-default changes.
- Do not make the source Google Sheet private until the replacement publishing/build path is verified.
- Do not rename season, cast, couple, phase, or result identifiers.
- Prepare changes on a separate branch and exercise them against emulators or copied data only.
- Deploy before the freeze ends only to correct an active availability or scoring incident.

Before the first post-test deployment:

1. Export Firestore data for the UK3 season, pool, phase statuses, picks, and standings.
2. Record every effective UK3 setting, including values currently supplied by defaults.
3. Preserve UK3 on its existing scoring version and configuration interpretation.
4. Rehearse the release against a cloned season and pool.
5. Release operational changes separately from scoring and storage changes.

## Work batches

### Batch 1: prepare during the freeze

- Add execution-level publisher regression tests.
- Fix the default-season rollover crash off-production.
- Add same-preview release safeguards and publisher validation tests.
- Correct monitoring and release documentation.
- Record the accepted honour-system model and production-freeze guardrails.

### Batch 2: immediately after the friends test

- Snapshot UK3 and explicitly retain its scoring/configuration version.
- Deploy publisher, rollback, monitoring, and configuration-consistency fixes.
- Remove the live browser's dependency on public Google Sheets, verify the published snapshot path, and then restrict sheet access.
- Repair Global standings recomputation ordering and Retro Event handling.

### Batch 3: beta canary

- Introduce corrected friend-pool validation and scoring only under a new scoring version.
- Apply lightweight Global Pool pick-read and write protections.
- Add pool-size limits and bounded notification processing.
- Run a canary pool before opening the public beta more broadly.

## Release rule

Never combine a scoring-version change, storage migration, and security-rule tightening in one production release. Each needs a separate rollback point and verification pass.
