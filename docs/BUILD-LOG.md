# Build log: what was done at each level

One repository, built up across the Rise In levels rather than restarted. Every
recording and screenshot from earlier levels is kept, so the progression is
visible rather than replaced. This note exists so a reviewer can tell at a
glance which work belongs to which level.

## Level 1 — the contract

A sealed-bid auction in Compact, running as a two-phase state machine: Bidding,
then Reveal, then Ended. A bid is stored only as `persistentHash(amount, salt)`,
so the amount is sealed until its owner chooses to open it. Each bidder derives
a nullifier from their own secret key, domain-separated with the tag
`sbid:v1:nullifier`, and that nullifier rather than the key is what reaches the
chain.

Fourteen tests against an in-memory simulator, deployed to Preprod at
`ad08e233…f5fa`. Evidence: `docs/screenshots/compile-output.png` showing every
circuit's `k` and row count, and `docs/screenshots/deployed-preprod.png`.

The auctioneer's identity uses a deliberately different tag, `sbid:v1:owner`, so
the auctioneer's on-chain id cannot be linked to their own bid. That choice came
from an earlier audit of my own contracts where a shared hash domain leaked more
than intended.

## Level 2 — the frontend, on-chain

The Level 1 frontend was honest about being a simulation: it ran the
commit-reveal flow in the browser with SHA-256 and its on-chain client was a
stub that threw. Level 2 replaced that with a real one.

Six new modules under `frontend/src/midnight/`: wallet connect and disconnect,
browser provider assembly, an in-memory private state provider, the witnesses,
and a client implementing the same interface the UI already spoke to. The app is
wallet-agnostic. It enumerates every wallet injected on `window.midnight` and
feature-detects `getProvingProvider`, so delegated proving is used where a
wallet supports it and a proof server is used otherwise.

Three real bugs had to be fixed to make the SDK run in a browser at all, and all
three are documented in the commit history: Midnight's own DApp scaffold
default-imports a plugin that has no default export; `vite-plugin-top-level-await`
breaks Rollup 4 output and is unnecessary at `target: esnext`; and
`isomorphic-ws` has no named `WebSocket` export in its browser build, which
would have silently killed the contract state subscription. A duplicate
`onchain-runtime-v3` also had to be pinned, since two copies meant two
`_StateValue` classes and every circuit call failed an `instanceof` check.

Evidence: `docs/sealed-bid-demo.mp4`, and a bid transaction verifiable on-chain.

## Level 3 — production-grade

CI on every push and pull request, installing the pinned compiler, compiling and
running the suite. It runs under `pipefail` deliberately: the toolchain installs
via `curl | sh`, which returns success on a failed download without it, so the
badge could otherwise be green having installed nothing.

The bid amount was moved out of React state entirely. It is an uncontrolled
input, read once at submit and cleared from the DOM before proving starts, so
the private value never enters the component tree.

Added this level: `PROPOSAL.md`, a Privacy Model section stating what an
observer can and cannot learn, the CI badge, `docs/screenshots/test-output.png`,
and `docs/l3-demo.mp4`.
