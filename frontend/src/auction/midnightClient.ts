// midnightClient.ts — the on-chain seam.
//
// The UI talks only to the `AuctionClient` interface. `LocalAuctionClient`
// implements it entirely in the browser for a zero-setup demo. To run the SAME
// UI against a real deployment, implement `AuctionClient` here using the
// compiled contract and Midnight providers. The wiring below is a sketch of the
// pieces you connect; it is intentionally not executed by the demo.
//
// Steps to go on-chain:
//   1. Build the `contract/` package (`npm run compact && npm run build`) to get
//      the generated `Contract`, `ledger`, `pureCircuits`, and witnesses.
//   2. Stand up providers: a wallet + proof server + indexer (see the Midnight
//      DApp connector docs). Derive each user's secret key locally and feed it
//      through the `localSecretKey` witness — it must never leave the browser.
//   3. Deploy with `@midnight-ntwrk/midnight-js-contracts` `deployContract`, or
//      reconnect with `findDeployedContract`.
//   4. Map each interface method to a circuit call:
//        deploy           -> deployContract(...)
//        placeSealedBid   -> callTx.placeSealedBid()
//        openRevealPhase  -> callTx.openRevealPhase()
//        revealBid        -> callTx.revealBid()
//        endAuction       -> callTx.endAuction()
//      and read public state (phase, commitments, highestBid, highestBidder,
//      hasWinner, bidCount) from the `ledger(...)` view.
//
// Because the interface is identical, swapping `new LocalAuctionClient()` for a
// `new MidnightAuctionClient(providers)` in App.tsx is the only UI change.

import { AuctionClient } from "./types";

export interface MidnightProviders {
  // e.g. wallet, publicDataProvider, zkConfigProvider, proofProvider,
  // privateStateProvider — omitted here to keep the demo dependency-free.
  [key: string]: unknown;
}

export function createMidnightAuctionClient(
  _providers: MidnightProviders
): AuctionClient {
  throw new Error(
    "MidnightAuctionClient is a stub. Wire it to the compiled contract + " +
      "Midnight providers as described at the top of midnightClient.ts."
  );
}
