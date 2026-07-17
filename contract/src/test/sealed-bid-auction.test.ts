import {
  SealedBidAuctionSimulator,
  deriveBidNullifier,
  deriveAuctioneerId,
  computeCommitment,
  logger
} from "./simulators/simulator.js";
import { describe, it, expect } from "vitest";
import * as utils from "./utils/utils";

// Coin public key used only as deployment plumbing - authorization in the
// contract is witness/nullifier-based, so this is not a security boundary.
export const deployerCoinPublicKey = utils.toHexPadded("auctioneer");

const ITEM = "Rare painting: 'Midnight over Nassau'";

// Phases (mirror the Uint<8> in the contract).
const BIDDING = 0n;
const REVEAL = 1n;
const ENDED = 2n;

// Identities (each is a 32-byte secret key).
const skAuctioneer = utils.randomBytes(32);
const skAlice = utils.randomBytes(32);
const skBob = utils.randomBytes(32);
const skCarol = utils.randomBytes(32);

// Secret salts, one per bidder.
const saltAlice = utils.randomBytes(32);
const saltBob = utils.randomBytes(32);
const saltCarol = utils.randomBytes(32);

// Bid amounts.
const ALICE_BID = 100n;
const BOB_BID = 250n;
const CAROL_BID = 175n;

// Pre-computed bid nullifiers (the on-chain pseudonymous id of each bidder).
const aliceNf = deriveBidNullifier(skAlice);
const bobNf = deriveBidNullifier(skBob);
const carolNf = deriveBidNullifier(skCarol);

// Fresh auction: auctioneer deploys (no bid of their own); three bidders are
// registered with their secret bids.
function newAuction(): SealedBidAuctionSimulator {
  const sim = SealedBidAuctionSimulator.deploy(ITEM, skAuctioneer);
  sim.registerBidder("alice", skAlice, ALICE_BID, saltAlice);
  sim.registerBidder("bob", skBob, BOB_BID, saltBob);
  sim.registerBidder("carol", skCarol, CAROL_BID, saltCarol);
  return sim;
}

describe("Sealed-Bid Auction (commit-reveal, nullifiers)", () => {
  it("derives a domain-separated nullifier distinct from the identity hash", () => {
    // The bid nullifier and the auctioneer identity come from the same key but
    // different domain tags, so they must never collide. This is what makes the
    // nullifier a real nullifier and not just a raw identity hash.
    expect(utils.bytesEqual(deriveBidNullifier(skAlice), deriveAuctioneerId(skAlice)))
      .toEqual(false);
    // Different keys -> different nullifiers.
    expect(utils.bytesEqual(deriveBidNullifier(skAlice), deriveBidNullifier(skBob)))
      .toEqual(false);
    // Deterministic: the same key always yields the same nullifier (this is
    // exactly why a repeat bid is caught).
    expect(utils.bytesEqual(deriveBidNullifier(skAlice), deriveBidNullifier(skAlice)))
      .toEqual(true);
  });

  it("opens in the bidding phase, with the item set and no bids or winner", () => {
    const sim = newAuction();
    const l = sim.getLedger();

    expect(l.phase).toEqual(BIDDING);
    expect(l.bidCount).toEqual(0n);
    expect(l.hasWinner).toEqual(false);
    expect(l.highestBid).toEqual(0n);
    expect(l.item).toEqual(ITEM);

    logger.info({ section: "Initial State", phase: l.phase, item: l.item });
  });

  it("stores a sealed bid as a commitment and never leaks the amount", () => {
    const sim = newAuction();
    const l = sim.as("alice").placeSealedBid();

    expect(l.bidCount).toEqual(1n);
    expect(sim.as("alice").isBidPlaced(aliceNf)).toEqual(true);

    // Privacy: placing a bid reveals nothing public about the amount.
    expect(l.highestBid).toEqual(0n);
    expect(l.hasWinner).toEqual(false);

    // What is stored is exactly the commitment hash(amount, salt) - and it
    // matches the correct amount but not a wrong one, proving it binds the bid
    // without revealing it.
    const stored = l.commitments.lookup(aliceNf);
    expect(utils.bytesEqual(stored, computeCommitment(ALICE_BID, saltAlice))).toEqual(true);
    expect(utils.bytesEqual(stored, computeCommitment(ALICE_BID + 1n, saltAlice))).toEqual(false);
  });

  it("rejects a second bid from the same nullifier (double-bid guard)", () => {
    const sim = newAuction();
    sim.as("alice").placeSealedBid();

    expect(() => {
      sim.as("alice").placeSealedBid();
    }).toThrow("already bid");
  });

  it("rejects revealing while still in the bidding phase", () => {
    const sim = newAuction();
    sim.as("alice").placeSealedBid();

    expect(() => {
      sim.as("alice").revealBid();
    }).toThrow("not in the reveal phase");
  });

  it("only lets the auctioneer open the reveal phase", () => {
    const sim = newAuction();
    sim.as("alice").placeSealedBid();

    expect(() => {
      sim.as("alice").openRevealPhase();
    }).toThrow("auctioneer");

    sim.as("auctioneer").openRevealPhase();
    expect(sim.getLedger().phase).toEqual(REVEAL);
  });

  it("rejects new bids once the reveal phase is open", () => {
    const sim = newAuction();
    sim.as("auctioneer").openRevealPhase();

    expect(() => {
      sim.as("alice").placeSealedBid();
    }).toThrow("bidding is closed");
  });

  it("accepts a valid reveal and records the bid as the new highest", () => {
    const sim = newAuction();
    sim.as("alice").placeSealedBid();
    sim.as("auctioneer").openRevealPhase();

    const l = sim.as("alice").revealBid();

    expect(l.highestBid).toEqual(ALICE_BID);
    expect(l.hasWinner).toEqual(true);
    expect(utils.bytesEqual(l.highestBidder, aliceNf)).toEqual(true);
  });

  it("rejects a reveal that does not match the sealed commitment", () => {
    const sim = newAuction();
    sim.as("alice").placeSealedBid();
    sim.as("auctioneer").openRevealPhase();

    // Alice now tries to reveal a DIFFERENT amount than she committed to.
    sim.registerBidder("alice", skAlice, ALICE_BID + 500n, saltAlice);

    expect(() => {
      sim.as("alice").revealBid();
    }).toThrow("does not match");
  });

  it("rejects revealing twice (double-reveal guard)", () => {
    const sim = newAuction();
    sim.as("alice").placeSealedBid();
    sim.as("auctioneer").openRevealPhase();
    sim.as("alice").revealBid();

    expect(() => {
      sim.as("alice").revealBid();
    }).toThrow("already revealed");
  });

  it("rejects a reveal from a nullifier that never sealed a bid", () => {
    const sim = newAuction();
    sim.as("alice").placeSealedBid();
    sim.as("auctioneer").openRevealPhase();

    // Bob never placed a sealed bid, so his nullifier is not in `commitments`.
    expect(() => {
      sim.as("bob").revealBid();
    }).toThrow("no sealed bid found");
  });

  it("picks the highest revealed bid as the winner", () => {
    const sim = newAuction();
    sim.as("alice").placeSealedBid();
    sim.as("bob").placeSealedBid();
    sim.as("carol").placeSealedBid();
    expect(sim.getLedger().bidCount).toEqual(3n);

    sim.as("auctioneer").openRevealPhase();

    // Reveal out of order; the contract should track the running maximum.
    sim.as("alice").revealBid(); // 100
    let l = sim.getLedger();
    expect(l.highestBid).toEqual(ALICE_BID);

    sim.as("carol").revealBid(); // 175 -> new leader
    l = sim.getLedger();
    expect(l.highestBid).toEqual(CAROL_BID);
    expect(utils.bytesEqual(l.highestBidder, carolNf)).toEqual(true);

    l = sim.as("bob").revealBid(); // 250 -> final winner
    expect(l.highestBid).toEqual(BOB_BID);
    expect(utils.bytesEqual(l.highestBidder, bobNf)).toEqual(true);
  });

  it("ignores bids that are never revealed (un-revealed bids stay private)", () => {
    const sim = newAuction();
    sim.as("alice").placeSealedBid();
    sim.as("bob").placeSealedBid(); // highest sealed bid...
    sim.as("carol").placeSealedBid();

    sim.as("auctioneer").openRevealPhase();

    // Bob (the actual highest) never reveals. Only alice and carol do.
    sim.as("alice").revealBid();
    const l = sim.as("carol").revealBid();

    // Carol wins at 175; Bob's 250 was never disclosed and does not count.
    expect(l.highestBid).toEqual(CAROL_BID);
    expect(utils.bytesEqual(l.highestBidder, carolNf)).toEqual(true);
    expect(sim.as("bob").isBidPlaced(bobNf)).toEqual(true); // he did bid...
    // ...but his amount never became public state.
  });

  it("only lets the auctioneer end the auction, and only from the reveal phase", () => {
    const sim = newAuction();
    sim.as("alice").placeSealedBid();

    // Cannot end from the bidding phase.
    expect(() => {
      sim.as("auctioneer").endAuction();
    }).toThrow("reveal phase");

    sim.as("auctioneer").openRevealPhase();
    sim.as("alice").revealBid();

    // A non-owner cannot end it.
    expect(() => {
      sim.as("alice").endAuction();
    }).toThrow("auctioneer");

    // The auctioneer can.
    const l = sim.as("auctioneer").endAuction();
    expect(l.phase).toEqual(ENDED);
    expect(l.highestBid).toEqual(ALICE_BID);
  });
});
