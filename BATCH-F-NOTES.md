# Batch F notes

## What changed

- A direct Global Pool join now asks how many published episodes the player has watched when at least one episode is available. The control starts at zero and shows the current published episode ceiling.
- The join sends `initialWatchedThrough` to the trusted callable. The server clamps it to `[0, AVAILABLE_THROUGH_EP]`, initializes only a missing ledger, and leaves `joinedAtEp` at zero.
- Pre-premiere joins skip the question and start at zero.
- Mirror-linked joins hide the question and start the Global ledger at zero; their existing synchronization path advances confirmed progress afterward.
- The foresight design document now records the join-time question and explicitly preserves the honour-system threat model.

## What was tested

- `npm run test:engine` passed, including an Episode 3 join, a server-side clamp to the Episode 5 release ceiling, preservation of an existing ledger, and a subsequent monotonic advance from 3 to 4.
- `npm run test:operations` passed, including executable client-selection checks for direct, pre-premiere, mirror-linked, and out-of-range joins.
- `npm run test:global-emulator` passed a two-account walkthrough against the Auth, Firestore, and Functions emulators: direct joins, an Episode 3 ledger, two Pods locks inside the coalescing window with one standings write, phase completion, receipt-versus-personal-row equality, and leave/rejoin ledger initialization.
- The operations audit now fails if any Global path calls the friend-pool player collection loader. Global live standings continue to use the single trusted standings document and the viewer's own bounded row.
- The Functions package now explicitly installs the Firebase app peers required by the current Admin SDK runtime. App Check remains enforced in deployed environments and is disabled only when `FUNCTIONS_EMULATOR=true`, because the emulator cannot mint App Check tokens.
- `node --check functions/index.js`, `node --check functions/shared/global-watch-ledger.js`, and `git diff --check` passed.

## Remaining constraints

- This question improves honest late-join accuracy; it does not prevent a player from understating what they watched or looking up public spoilers. That is an accepted free-beta limitation.
- No scoring formula, existing locked pick, UK3 season document, pool, or configuration version was changed. Nothing was deployed.
