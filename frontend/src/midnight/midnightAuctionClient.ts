// midnightAuctionClient.ts — the real on-chain AuctionClient.
//
// The UI has always talked to the `AuctionClient` interface, and until now the
// only implementation was LocalAuctionClient, which simulated the whole flow in
// the browser with SHA-256. This file is the other implementation: same
// interface, but every method builds a zero-knowledge proof and submits a
// transaction to Midnight Preprod.
//
// WHERE THE PRIVATE DATA LIVES
// ----------------------------
// The bid amount and its salt are held in this module's private state and are
// read by the `localBidAmount` / `localBidSalt` witnesses at proving time. They
// are never put into React state, never rendered, and never sent anywhere. What
// reaches the chain is:
//
//   commitment = makeCommitment(amount, salt)     hides the amount
//   nullifier  = bidNullifier(secretKey)          identifies the bid, not you
//
// The amount only becomes public when the bidder chooses to reveal it, which is
// the entire point of a commit-reveal auction.

import { deployContract, findDeployedContract } from "@midnight-ntwrk/midnight-js-contracts";
import { CompiledContract } from "@midnight-ntwrk/compact-js";

import {
  Contract,
  ledger as readLedger,
  pureCircuits,
} from "../managed/sealed-bid-auction/contract/index.js";

import { witnesses, randomBytes32 } from "./witnesses.js";
import type { SealedBidPrivateState } from "./witnesses.js";
import { PRIVATE_STATE_ID } from "./providers.js";
import {
  Phase,
  type AuctionClient,
  type AuctionPublicState,
  type PublicBid,
} from "../auction/types";

const CONTRACT_NAME = "SealedBidAuction";

// The compiled contract, wired to the witnesses above. withCompiledFileAssets
// points the verifier-key reader at the managed output; in the browser the
// proving assets themselves are fetched over HTTP by FetchZkConfigProvider.
function buildCompiledContract() {
  return (CompiledContract.make(CONTRACT_NAME, Contract) as any).pipe(
    (CompiledContract as any).withWitnesses(witnesses),
    (CompiledContract as any).withCompiledFileAssets("managed/sealed-bid-auction"),
  );
}

const toHexStr = (b: Uint8Array): string =>
  Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");

const shortId = (hex: string): string => `${hex.slice(0, 8)}…${hex.slice(-4)}`;

export class MidnightAuctionClient implements AuctionClient {
  private state: AuctionPublicState;
  private listeners = new Set<() => void>();
  private unsubscribe: (() => void) | null = null;

  // Session identity. Generated once, kept in memory, never displayed.
  private readonly secretKey: Uint8Array;
  // The salt used for the bid currently committed, needed again at reveal time.
  private bidSalt: Uint8Array | null = null;
  private bidAmount: bigint | null = null;

  private constructor(
    private readonly providers: any,
    private readonly deployed: any,
    secretKey: Uint8Array,
    public readonly contractAddress: string,
  ) {
    this.secretKey = secretKey;
    this.state = {
      item: "(loading from chain…)",
      phase: Phase.Bidding,
      auctioneer: "",
      bids: [],
      bidCount: 0,
      highestBid: 0n,
      highestNullifier: null,
      hasWinner: false,
    };
  }

  /** My own nullifier, computed locally from my secret key. */
  get myNullifier(): string {
    return toHexStr(pureCircuits.bidNullifier(this.secretKey));
  }

  /**
   * My auctioneer id. The constructor stores auctioneerId(localSecretKey()) of
   * whoever deployed, and assertAuctioneer() re-derives it from the caller's
   * key. Computing it here lets the UI disable the auctioneer-only actions
   * instead of letting the user hit an on-chain assert.
   *
   * Note this uses a DIFFERENT domain tag ("sbid:v1:owner") from the bid
   * nullifier ("sbid:v1:nullifier"), so the auctioneer id cannot be linked to
   * any bid — including the auctioneer's own.
   */
  get myAuctioneerId(): string {
    return toHexStr(pureCircuits.auctioneerId(this.secretKey));
  }

  /** True when this browser session deployed the auction it is looking at. */
  get isAuctioneer(): boolean {
    return (
      this.state.auctioneer !== "" &&
      this.state.auctioneer === this.myAuctioneerId
    );
  }

  static async join(providers: any, contractAddress: string): Promise<MidnightAuctionClient> {
    const secretKey = randomBytes32();
    const initialPrivateState: SealedBidPrivateState = {
      secretKey,
      bidAmount: 0n,
      bidSalt: new Uint8Array(32),
    };
    const deployed = await findDeployedContract(providers, {
      contractAddress,
      compiledContract: buildCompiledContract(),
      privateStateId: PRIVATE_STATE_ID,
      initialPrivateState,
    } as any);
    const client = new MidnightAuctionClient(providers, deployed, secretKey, contractAddress);
    await client.watch();
    return client;
  }

  static async deployNew(providers: any, item: string): Promise<MidnightAuctionClient> {
    const secretKey = randomBytes32();
    const initialPrivateState: SealedBidPrivateState = {
      secretKey,
      bidAmount: 0n,
      bidSalt: new Uint8Array(32),
    };
    const deployed = await deployContract(providers, {
      compiledContract: buildCompiledContract(),
      privateStateId: PRIVATE_STATE_ID,
      initialPrivateState,
      args: [item],
    } as any);
    const address = deployed.deployTxData.public.contractAddress;
    const client = new MidnightAuctionClient(providers, deployed, secretKey, address);
    await client.watch();
    return client;
  }

  /** Subscribe to on-chain state so the UI reflects the ledger, not a guess. */
  private async watch(): Promise<void> {
    const sub = this.providers.publicDataProvider
      .contractStateObservable(this.contractAddress, { type: "latest" })
      .subscribe({
        next: (s: any) => {
          try {
            this.applyLedger(readLedger(s.data));
          } catch (err) {
            console.error("[auction] failed to parse ledger state", err);
          }
        },
        error: (err: unknown) => console.error("[auction] state stream error", err),
      });
    this.unsubscribe = () => sub.unsubscribe();
  }

  private applyLedger(l: any): void {
    const mine = this.myNullifier;

    const bids: PublicBid[] = [];
    for (const [nullifier, commitment] of l.commitments) {
      const nfHex = toHexStr(nullifier);
      const revealed = l.revealedNullifiers.member(nullifier);
      bids.push({
        name: nfHex === mine ? "You" : shortId(nfHex),
        nullifier: nfHex,
        commitment: toHexStr(commitment),
        revealed,
        // A revealed bid's amount is only knowable from chain for the winner;
        // every other revealed amount stays sealed by design. Showing null here
        // is honest rather than convenient.
        amount:
          revealed && toHexStr(l.highestBidder) === nfHex ? l.highestBid : null,
      });
    }

    this.state = {
      item: l.item,
      phase: Number(l.phase) as Phase,
      auctioneer: toHexStr(l.auctioneer),
      bids,
      bidCount: Number(l.bidCount),
      highestBid: l.highestBid,
      highestNullifier: l.hasWinner ? toHexStr(l.highestBidder) : null,
      hasWinner: l.hasWinner,
    };
    this.emit();
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  getState(): AuctionPublicState {
    return this.state;
  }

  async deploy(): Promise<void> {
    throw new Error(
      "Use MidnightAuctionClient.deployNew() or .join() to obtain a client.",
    );
  }

  /**
   * Commit to a bid. The amount goes into private state, gets hashed into a
   * commitment inside the circuit, and never leaves this machine.
   */
  async placeSealedBid(_name: string, amount: bigint): Promise<void> {
    const salt = randomBytes32();
    this.bidSalt = salt;
    this.bidAmount = amount;

    await this.providers.privateStateProvider.set(PRIVATE_STATE_ID, {
      secretKey: this.secretKey,
      bidAmount: amount,
      bidSalt: salt,
    } satisfies SealedBidPrivateState);

    await this.deployed.callTx.placeSealedBid();
  }

  async openRevealPhase(_callerName: string): Promise<void> {
    await this.deployed.callTx.openRevealPhase();
  }

  /**
   * Reveal. This re-supplies the SAME amount and salt used at commit time; the
   * circuit recomputes the commitment and rejects anything that does not match,
   * which is what stops a bidder changing their bid after seeing the others.
   */
  async revealBid(_name: string): Promise<void> {
    if (this.bidAmount === null || this.bidSalt === null) {
      throw new Error(
        "This browser session has no committed bid to reveal. The amount and " +
          "salt are held in memory only, so a page reload loses them.",
      );
    }
    await this.providers.privateStateProvider.set(PRIVATE_STATE_ID, {
      secretKey: this.secretKey,
      bidAmount: this.bidAmount,
      bidSalt: this.bidSalt,
    } satisfies SealedBidPrivateState);

    await this.deployed.callTx.revealBid();
  }

  async endAuction(_callerName: string): Promise<void> {
    await this.deployed.callTx.endAuction();
  }

  dispose(): void {
    this.unsubscribe?.();
    this.listeners.clear();
  }
}
