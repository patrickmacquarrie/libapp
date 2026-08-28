# Against-the-Clock foresight policy

**Status:** Approved by Patrick on August 27, 2026  
**Anchor:** `a304f93`

## Decision to approve

For Global Pool scoring, define a player's authoritative prediction window as:

```text
w = max(playerWatchedThrough, releasedWhenPlayerJoinedThisPool)
```

Both inputs will be held by the server in `pools/{poolId}/trustedPlayers/{uid}`:

- `watchedThrough` is an integer that can only increase through the existing `openGlobalPool` callable.
- `joinedAtEp` is the published `AVAILABLE_THROUGH_EP` captured when the player first joins the Global Pool and is never rewritten.

For a fully released season, `joinedAtEp` resolves to `0` instead. Once every scoring episode is public, the app is being played as a historical simulation: using the final release episode as the floor would permanently erase every Against-the-Clock bonus. Live and partially released seasons continue using the current `AVAILABLE_THROUGH_EP` floor.

The client-supplied `w` on a pick remains untrusted. At lock time, the server will continue replacing it, but with the resolved per-player value above instead of the season-wide release position. Reunion remains exempt.

## Why this policy

Scoring every player at the current release position is resistant to false watch claims, but it breaks the product promise for honest asynchronous viewers. A player who has watched through Episode 1 should receive more foresight credit than one who has watched through Episode 5, even when five episodes are publicly available. The join floor prevents someone arriving after Episode 5 from claiming Episode-0 foresight about already-aired outcomes, while the monotonic ledger prevents a player from moving their watch position backward and farming the same advantage again.

I recommend accepting the remaining cheat surface for the free beta. An early joiner can leave `watchedThrough` at zero, read public season results, and submit perfect picks with maximum foresight. The app's free-tier threat model already accepts that outcomes are readable by a determined player; there are no financial stakes, and social accountability is the practical deterrent. Keeping honest asynchronous play correct is more valuable here than pretending the server can verify what someone watched.

This decision must change if a paid tier ever attaches money, prizes, or other stakes to the shared leaderboard. Self-reported watch progress would then be insufficient. Paid competition should use release-based scoring or a separately designed verifiable commitment/access model; the free-tier ledger must not silently become a money-bearing trust boundary.

## Preserve both policy inputs on picks

Record both values on every newly locked non-Reunion pick:

- `w`: the resolved ledger value used for scoring;
- `releasedThroughAtLock`: `AVAILABLE_THROUGH_EP` at lock time.

This keeps today's release-based reference alongside the scored value, so a later policy review can compare or re-evaluate new picks without reconstructing historical season state. Existing locked picks remain byte-identical and are never recomputed or restamped during ordinary joins, saves, or locks.

### Controlled historical repair exception

The administrator-only `relaxHistoricalJoinFloor` action is the sole exception. On a fully released Global test season, it may set existing trusted members' `joinedAtEp` to `0`, re-stamp only non-Reunion locked-pick `w` values from each member's repaired monotonic ledger, mirror those values to the public receipt documents, discard the frozen standings snapshot, and recompute it. The action preserves watch progress, pick content and stakes, completion timestamps, and Reunion picks. It is a narrowly scoped data repair for a previously incorrect ceiling floor, not a general mechanism for rewriting locked predictions.

## Migration and rollout

For existing Global Pool members in the controlled UK S3 test, backfill `joinedAtEp: 0` and `watchedThrough: 0`. This treats them as genuine early joiners and makes the choice explicit rather than inferring a later join from the deployment date. It also accepts the same early-join cheat surface described above.

The migration will merge these fields into existing trusted documents and preserve all locked picks. A standings recompute follows rollout. Future joins capture the current published release position once. Future watch advances clamp to the published release ceiling and apply `max(existing, submitted)`, so neither ledger field can move backward.

Run `scripts/migrate-global-watch-ledger.js` first without `--apply` and record its member count. The apply run requires a short-lived `FIREBASE_ACCESS_TOKEN`, a private backup path, and that exact count through `--expected-count`. The script refuses the production write if the count changes, preserves every non-ledger field, and verifies the result. Recompute standings after the backend deploy; the next trusted Global lock or completion also recomputes them.

## Approval

Patrick approved the early-join/free-tier cheat surface in exchange for scoring honest asynchronous viewers correctly and confirmed that there are no plans to add prizes. This trust model remains explicitly excluded from any future paid or prize-bearing leaderboard.
