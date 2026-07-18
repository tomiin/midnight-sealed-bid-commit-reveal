# Deploying to Preprod — roadblocks and fixes

Honest notes on what it actually took to land this contract on Midnight Preprod,
so the next person (or me, next time) doesn't lose the hours I did. Everything
here is a wall I actually hit, in the order I hit it. None of it was the contract
itself — the Compact compiled and tested fine; this was all the deploy path.

## 1. Error 170 on submit — `InvalidDustSpendProof`

The deploy would build, prove, and submit, and the node would reject it with
`1010: Invalid Transaction: Custom error: 170`. Every time.

170 is **not** about the contract. It's the **DUST fee** leg. On Midnight you pay
fees in DUST, and the wallet balances a little DUST to cover the fee and proves
that spend. 170 means the node rejected *that fee proof*, because it was built
against a dust state the chain has already moved past.

Two things had to be true to get past it, and I needed both:

### Rebuild the transaction on every retry — don't resubmit the same one

My first retry loop resubmitted the *exact same* proven transaction on each try.
That can never work for a 170: the stale DUST proof is baked into that transaction,
so re-sending it just re-presents the same dead proof. The blocks keep coming, so
it's stale the moment it's built. The fix (`src/deploy.ts` → `withRetries`) is to
**rebuild the whole thing** — re-balance the DUST and re-prove — on every attempt,
so each try carries a fresh proof. That's the "don't reuse a stale balanced tx"
advice from the Midnight team, in code.

### Keep the wallet's DUST synced to the current tip

Even with the rebuild loop, if the wallet's DUST state is *hours* behind the chain
it can't balance the fee at all — you get instant `could not balance dust` failures
instead of 170. My deploy wallet was restoring from a checkpoint saved earlier in
the day, and the chain had moved on. Fix: re-sync the wallet's DUST to the current
tip first (I used my wallet CLI's `sync`, then copied the fresh
`wallet-checkpoint.json` into this folder), *then* deploy. With current DUST + the
rebuild loop, it went through on the second attempt.

**The tell:** if retries fail *instantly* (no ~30–60s proving pause), it's stale
DUST — go re-sync. If they fail *after* proving with a `170`, it's the block-advance
race and the rebuild loop will ride through it.

## 2. Private-state password must have 3+ character classes

Once the DUST was sorted, the deploy got all the way to storing private state and
died with `PasswordValidationError: Password must contain at least 3 of: uppercase
letters, lowercase letters, digits, special characters. Found: 2`. The
`levelPrivateStateProvider` encrypts local private state with a password, and the
installed SDK now enforces at least 3 of those 4 classes. My dev password had 2.
Fix in `src/providers.ts` — use something like `SealedBid-Dev-2026!` (upper +
lower + digit + symbol). It's a local dev store, so the exact value doesn't matter,
only that it passes the check.

## 3. The node websocket drops on submit — "Normal Closure"

Preprod's public RPC node likes to drop the connection right as you submit, with a
clean `1000: Normal Closure`. It's not an error in your transaction — the socket
just hangs up. The retry loop handles it (the provider reconnects on its own), and
there's a process-level guard in `src/deploy.ts` so a background socket-close can't
crash the run before the retries fire.

## What finally made it click

Reproducing the 170 on a **local devnet** — where the indexer sits right at the
node's tip with zero lag — and watching it 170 there *too*. That ruled out "it's
just Preprod being slow" and proved the problem was in how the transaction was
built and retried, which was mine to fix. When a public network keeps telling you
"it's infra," reproduce it somewhere you fully control before you believe it.
