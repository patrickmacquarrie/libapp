# Batch E notes

## What changed

- Configuration-v2 private pools now score Reunion players as soon as their immutable Reunion pick document is locked. A public `screen` value is used only to find bounded candidates; it cannot make a player eligible without a readable `lockedAt` marker or recorded completion.
- Legacy configuration-v1 pools, including UK3, continue to score only players who completed the Reunion checkpoint.
- Opening final standings from the Reunion watch screen in a v2 private pool now asks for spoiler confirmation and finishes the viewer's checkpoint before revealing results.
- Watch-finalization helpers return success/failure so the standings tab cannot open after a cancelled or failed completion.
- The standings table has a 650-pixel minimum width and remains horizontally scrollable on narrow screens.
- The scoring engine exposes the effective configuration version to the browser scoring memo. No scoring formula changed, and existing locked picks are not rewritten.

## What was tested

- `npm run test:engine` passed, including executable legacy-v1 and configuration-v2 propagation checks.
- `npm run test:operations` passed. Its executable Reunion-scoring checks prove v1 scores only completions, v2 includes a verified lock, a public watch screen alone is insufficient, and the spoiler gate is limited to v2 private pools.
- `node --check functions/shared/scoring-engine.js` and `git diff --check` passed.
- The production build completed successfully. Generated season-page cache churn was excluded from the branch.

## Still required

- Exercise the Reunion lock/standings path with two emulator accounts before deployment: one player locks and leaves, the second confirms the spoiler gate, and both locked players appear in the v2 totals.
- The original `stash@{0}: wip-reunion-lock-scoring` remains preserved in the source checkout as a recovery copy. Its intended changes were transferred and refined on this branch; it can be dropped only after this PR is accepted.
- No UK3 season document, pool, locked pick, or configuration version was changed. Nothing was deployed.
