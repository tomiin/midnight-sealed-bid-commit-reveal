# Sealed-Bid Auction (Commit-Reveal)

A small sealed-bid auction I built on the **Midnight** network, written in
Compact. The whole point is privacy during bidding: while the auction is open,
nobody — not other bidders, not even the auctioneer — can see what anyone bid.
When bidding closes, people reveal their numbers, the contract checks each one
against what was locked in earlier, and the highest honest bid wins.

Think of it as everyone dropping a number into a sealed envelope. While the
envelopes are shut, nobody can peek. When it's time, each person opens their own
envelope, and the biggest number takes it. The clever part is that Midnight lets
the contract prove nobody swapped the paper inside their envelope after the fact.

This is a fresh take on the idea, and the thing I actually wanted to get right
this time is the **nullifier**: a one-way, per-bidder fingerprint that blocks
anyone from bidding twice without ever putting their identity on chain.

## Deployed on Midnight Preprod

This contract is live on Midnight **Preprod**:

- **Contract address:** `ad08e233a172874748b05ab40a30c9217699650115aa5650c3c671accfee4244`
- **Network:** Preprod (`rpc.preprod.midnight.network`)
- **On-chain interaction:** deployed and then exercised with a `placeSealedBid`
  call — both submitted from the CLI in [`deploy/`](deploy/).

The [`deploy/`](deploy/) folder is the deployment + interaction interface: a small
TypeScript CLI (`npm run deploy -- "<item description>"`) that builds the wallet,
proves the transaction, and submits the deploy plus the first on-chain interaction
to Preprod. Read or extend it from there.

> Deploying to Preprod can hit error 170 (`InvalidDustSpendProof`) when the wallet's
> DUST fee state is a step behind the chain tip. The deploy CLI handles it by
> *rebuilding and re-balancing* the transaction on each retry instead of resubmitting
> a stale one — the same fix I worked out building my Midnight wallet CLI.

Full deploy gotchas (error 170, stale DUST, the private-state password): [`deploy/ROADBLOCKS.md`](deploy/ROADBLOCKS.md).

## How it works (in plain English)

The auction is a little state machine with three stages: **Bidding → Reveal →
Ended**. Only the auctioneer can move it forward.

1. **Bidding.** You pick an amount. Your browser scrambles it together with a
   random secret (a "salt") into a fingerprint called a *commitment*, and only
   that fingerprint gets stored on chain. Your real number never leaves your
   device. At the same time, the contract derives your *nullifier* from your
   secret key and uses it to file your bid. If you try to bid again, you produce
   the exact same nullifier — which is already on record — so the second bid is
   rejected. One identity, one bid.
2. **Reveal.** The auctioneer closes bidding. Now anyone who bid can show their
   real number. The contract re-scrambles it and checks it matches the
   fingerprint from before, so you can't reveal a different number than the one
   you committed to. Each valid reveal that beats the current best becomes the
   new highest bid. If someone never bothers to reveal, their bid just stays
   secret forever and doesn't count.
3. **Ended.** The auctioneer closes the auction. The final highest revealed bid
   and its (pseudonymous) winner are the public result, and anyone can check them.

## The nullifier, and why it matters

Compact has no built-in "who's calling" — there's no `msg.sender`. So a caller
proves who they are by knowing a secret key that stays on their own machine. From
that key the contract derives a **nullifier**: a one-way hash that's the same
every time for the same key, but tells you nothing about the key itself.

Two details make it a *real* nullifier and not just an ID hash:

- It's **domain-separated**. The hash is tagged (`"sbid:v1:nullifier"`), so a
  bidder's auction nullifier can never be confused with any other hash built from
  the same key — including the auctioneer's identity, which uses a different tag.
- It's the **double-bid guard**. The nullifier is the key your commitment is
  filed under, so a repeat bid collides with one that's already there and bounces.

## What's private, and what isn't (the honest part)

I think most "private auction" demos gloss over this, so:

- **Private:** every bid amount while bidding is open, and any bid that's never
  revealed. Your secret key is never disclosed.
- **Public:** the nullifier of anyone who bids, the commitments, and — once
  someone reveals — their winning amount and winning nullifier.

So this is a first-price auction with **private bids and one-bid-per-identity**,
not a fully secret tally. A design where even the winning amount stays hidden is
a bigger, different animal.

## What's in here

- **`contract/`** — the actual Compact smart contract, its TypeScript witnesses,
  and a Vitest suite that runs the whole thing start to finish (place sealed
  bids, open reveal, reveal out of order, pick the winner, reject double bids and
  bad reveals). This is the real heart of the project.
- **`frontend/`** — a small React page that runs the same commit-reveal logic
  right in the browser, so you can click through the full experience — place
  secret bids, reveal them, watch the winner update — without setting up a wallet
  or a node. There's a clearly marked seam (`frontend/src/auction/midnightClient.ts`)
  for wiring the same UI to a live on-chain deployment.

## Running it

You'll need [Node.js](https://nodejs.org) (I used version 24) and Midnight's
Compact toolchain (`compact`). See the
[Midnight docs](https://docs.midnight.network) for installing the compiler.

**Contract — compile and test:**

```bash
cd contract
npm install
npm run compact     # compiles the Compact contract (full ZK keys)
npm test            # runs the Vitest suite against the compiled contract
```

**Frontend — play with it in the browser:**

```bash
cd frontend
npm install
npm run dev         # then open http://localhost:5173
```

## Going on-chain

The frontend talks to a single `AuctionClient` interface. The bundled version
runs everything locally so the demo needs no setup. To run the identical UI
against a real deployment, implement that interface against the compiled contract
and Midnight providers — the steps are written out at the top of
`frontend/src/auction/midnightClient.ts`.

## Attribution

This project is built on and for the **[Midnight](https://midnight.network)**
network, using the **[Compact](https://docs.midnight.network)** smart-contract
language. The contract package layout and the in-memory test harness follow the
conventions of the Midnight example projects and the Edda Labs contract template.

## License

Apache-2.0 — see [LICENSE](./LICENSE).
