// The shared contract between the UI and any auction backend.
//
// The app only ever talks to an `AuctionClient`. The bundled implementation
// (LocalAuctionClient) runs the whole commit-reveal flow in the browser so the
// demo works with no backend. To go on-chain you implement the same interface
// against the compiled Compact contract + Midnight providers (see
// midnightClient.ts). The vocabulary here mirrors the contract exactly:
// phases, commitments, and per-bidder nullifiers.

export enum Phase {
  Bidding = 0,
  Reveal = 1,
  Ended = 2
}

export const phaseLabel = (p: Phase): string =>
  p === Phase.Bidding ? "Bidding" : p === Phase.Reveal ? "Reveal" : "Ended";

// One bid as seen in PUBLIC state. During bidding, all anyone can see is the
// bidder's nullifier and their commitment; the amount is null until that bidder
// chooses to reveal.
export interface PublicBid {
  name: string;         // local display name (never leaves the browser)
  nullifier: string;    // hex of the domain-separated per-bidder nullifier
  commitment: string;   // hex of hash(amount, salt) - binds the bid, hides it
  revealed: boolean;
  amount: bigint | null; // null while still sealed
}

// The public, on-ledger view of the auction.
export interface AuctionPublicState {
  item: string;
  phase: Phase;
  auctioneer: string;      // the auctioneer's identity id (hex)
  bids: PublicBid[];
  bidCount: number;
  highestBid: bigint;
  highestNullifier: string | null; // the winning bidder's nullifier
  hasWinner: boolean;
}

export interface AuctionClient {
  getState(): AuctionPublicState;
  deploy(item: string, auctioneerName: string): Promise<void>;
  placeSealedBid(name: string, amount: bigint): Promise<void>;
  openRevealPhase(callerName: string): Promise<void>;
  revealBid(name: string): Promise<void>;
  endAuction(callerName: string): Promise<void>;
}
