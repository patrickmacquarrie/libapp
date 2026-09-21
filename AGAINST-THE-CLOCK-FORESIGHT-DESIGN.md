# Against-the-Clock foresight policy

**Status:** Revised and approved by Patrick on August 28, 2026
**Supersedes:** the release-frontier join-floor policy anchored at `a304f93`

## Decision to approve

For Global Pool scoring, define a player's authoritative prediction window as:

```text
w = playerWatchedThrough
```

The server holds this value in `pools/{poolId}/trustedPlayers/{uid}`:

- `watchedThrough` is an integer that can only increase through the existing `openGlobalPool` callable.
- `joinedAtEp` remains temporarily as a zero-valued schema-readiness marker. It does not feed scoring.

Season status, the release frontier, and join time never scale Against-the-Clock. `joinedAtEp` starts at `0`. A direct join may initialize `watchedThrough` from the player's self-reported watch position, clamped only to the published episode ceiling; later confirmed watch advances can only raise it.

The client-supplied `w` on a pick remains untrusted. At lock time, the server replaces it with confirmed `watchedThrough`. Reunion remains exempt.

## Why this policy

Players watch at their own pace, so joining later is not a reason to receive different rules. A player who has watched through Episode 1 should receive more foresight credit than one who has watched through Episode 5, regardless of how many episodes are public or when either player joined. The monotonic ledger prevents a player from moving confirmed progress backward.

The free beta intentionally accepts the remaining self-reporting surface. Any player—not only a late joiner—could under-report watch progress, read public results elsewhere, and submit perfect picks. Join time cannot prove what someone knows, so a release-based join penalty would inconvenience honest asynchronous players without closing the real integrity gap. There are no financial stakes, and social accountability is the practical deterrent.

## Join-time watch position

When episodes are already available, a player joining the Global Pool directly is asked, “How many episodes have you watched?” The answer initializes `watchedThrough` in the same player-relative scale used by later watch confirmations. It is clamped to `[0, AVAILABLE_THROUGH_EP]`, while `joinedAtEp` remains the zero-valued schema marker.

This question improves accuracy for honest late joiners: someone already through Episode 3 starts in window 3 instead of receiving Episode 0 foresight. It does not create a stronger anti-cheating claim. The answer remains self-reported, a player may understate it, and the free beta continues to operate on the honour-system principle approved above.

Pre-premiere joins skip the question and start at `0`. Mirror-linked joins also start at `0` without prompting because the friend pool already owns the player's watch flow; normal mirror synchronization and `advanceGlobalWatch` move the trusted Global ledger forward afterward. Once recorded, watch progress remains monotonic and cannot move backward.

This decision must change if a paid tier ever attaches money, prizes, or other stakes to the shared leaderboard. Self-reported watch progress would then be insufficient. Paid competition should use release-based scoring or a separately designed verifiable commitment/access model; the free-tier ledger must not silently become a money-bearing trust boundary.

## Preserve both policy inputs on picks

Record both values on every newly locked non-Reunion pick:

- `w`: the resolved ledger value used for scoring;
- `releasedThroughAtLock`: `AVAILABLE_THROUGH_EP` at lock time.

This keeps today's release-based reference alongside the scored value, so a later policy review can compare or re-evaluate new picks without reconstructing historical season state. Existing locked picks remain byte-identical and are never recomputed or restamped during ordinary joins, saves, or locks.

### Controlled historical repair exception

The administrator-only `relaxHistoricalJoinFloor` action is the sole exception. On a live or completed Global season, it may set existing trusted members' `joinedAtEp` to `0`, restore `watchedThrough` from confirmed linked-player progress, re-stamp only non-Reunion locked-pick `w` values from that confirmed position, mirror those values to the public receipt documents, discard the frozen standings snapshot, and recompute it. The action preserves pick content and stakes, completion timestamps, and Reunion picks. It remains protected by administrator, membership, member-count, and write-count checks.

## Migration and rollout

For legacy Global Pool members missing ledger fields, backfill `joinedAtEp: 0` and `watchedThrough: 0`. The zero join marker is a schema default, not a claim about when the player joined.

The migration merges these fields into existing trusted documents and preserves all locked picks. A standings recompute follows rollout. Future direct joins may initialize `watchedThrough` from the bounded join-time answer; `joinedAtEp`, pre-premiere joins, and mirror-linked joins start at zero. Future watch advances still clamp to the published release ceiling and apply `max(existing, submitted)`, so confirmed `watchedThrough` cannot move backward.

Run `scripts/migrate-global-watch-ledger.js` first without `--apply` and record its member count. The apply run requires a short-lived `FIREBASE_ACCESS_TOKEN`, a private backup path, and that exact count through `--expected-count`. The script refuses the production write if the count changes, preserves every non-ledger field, and verifies the result. Recompute standings after the backend deploy; the next trusted Global lock or completion also recomputes them.

## Approval

Patrick approved the same player-relative rules regardless of join time and accepted the free-tier self-reporting surface in exchange for scoring honest asynchronous viewers correctly. This trust model remains explicitly excluded from any future paid or prize-bearing leaderboard.
