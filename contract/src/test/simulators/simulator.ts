import { createLogger } from "../../logger.js";
import { LogicTestingConfig } from "../../config.js";
import { deployerCoinPublicKey } from "../sealed-bid-auction.test.js";

import {
  Contract,
  type Ledger,
  ledger,
  pureCircuits
} from "../../managed/sealed-bid-auction/contract/index.js";
import {
  type SealedBidPrivateState,
  createPrivateState,
  witnesses
} from "../../witnesses.js";

import {
  type CircuitContext,
  QueryContext,
  sampleContractAddress,
  createConstructorContext,
  CostModel,
  CircuitResults,
  ContractAddress
} from "@midnight-ntwrk/compact-runtime";

const config = new LogicTestingConfig();
export const logger = await createLogger(config.logDir);

// Off-chain mirrors of the contract's pure circuits. Identical to the on-chain
// computation, so a test (or a dApp) can pre-compute the same values.
export const deriveBidNullifier = (secretKey: Uint8Array): Uint8Array =>
  pureCircuits.bidNullifier(secretKey);

export const deriveAuctioneerId = (secretKey: Uint8Array): Uint8Array =>
  pureCircuits.auctioneerId(secretKey);

export const computeCommitment = (amount: bigint, salt: Uint8Array): Uint8Array =>
  pureCircuits.makeCommitment(amount, salt);

// A tiny in-memory harness around the generated contract. It tracks one private
// state per participant; `as(name)` swaps the active caller so that
// `callerNullifier()` inside the contract resolves to that participant.
export class SealedBidAuctionSimulator {
  readonly contract: Contract<SealedBidPrivateState>;
  circuitContext: CircuitContext<SealedBidPrivateState>;
  userPrivateStates: Record<string, SealedBidPrivateState>;
  updateUserPrivateState: (newPrivateState: SealedBidPrivateState) => void;
  contractAddress: ContractAddress;

  constructor(item: string, privateState: SealedBidPrivateState) {
    this.contract = new Contract<SealedBidPrivateState>(witnesses);
    this.contractAddress = sampleContractAddress();
    const {
      currentPrivateState,
      currentContractState,
      currentZswapLocalState
    } = this.contract.initialState(
      createConstructorContext(privateState, deployerCoinPublicKey),
      item
    );
    this.circuitContext = {
      currentPrivateState,
      currentZswapLocalState,
      currentQueryContext: new QueryContext(
        currentContractState.data,
        this.contractAddress
      ),
      costModel: CostModel.initialCostModel()
    };
    // Whoever deploys is the auctioneer.
    this.userPrivateStates = { ["auctioneer"]: currentPrivateState };
    this.updateUserPrivateState = (_newPrivateState: SealedBidPrivateState) => {};
  }

  // The auctioneer deploys. They need an identity key; a bid is optional, so it
  // defaults to a throwaway zero bid.
  static deploy(
    item: string,
    auctioneerSecretKey: Uint8Array,
    auctioneerBid: bigint = 0n,
    auctioneerSalt: Uint8Array = new Uint8Array(32)
  ): SealedBidAuctionSimulator {
    return new SealedBidAuctionSimulator(
      item,
      createPrivateState(auctioneerSecretKey, auctioneerBid, auctioneerSalt)
    );
  }

  // Register a bidder with their identity key and their (secret) bid.
  registerBidder(
    name: string,
    secretKey: Uint8Array,
    bidAmount: bigint,
    bidSalt: Uint8Array
  ): void {
    this.userPrivateStates[name] = createPrivateState(secretKey, bidAmount, bidSalt);
  }

  private buildTurnContext(
    currentPrivateState: SealedBidPrivateState
  ): CircuitContext<SealedBidPrivateState> {
    return { ...this.circuitContext, currentPrivateState };
  }

  private updateUserPrivateStateByName =
    (name: string) =>
    (newPrivateState: SealedBidPrivateState): void => {
      this.userPrivateStates[name] = newPrivateState;
    };

  // Switch the active caller.
  as(name: string): SealedBidAuctionSimulator {
    const ps = this.userPrivateStates[name];
    if (!ps) {
      throw new Error(
        `No private state found for '${name}'. Register them with registerBidder first.`
      );
    }
    this.circuitContext = this.buildTurnContext(ps);
    this.updateUserPrivateState = this.updateUserPrivateStateByName(name);
    return this;
  }

  public getLedger(): Ledger {
    return ledger(this.circuitContext.currentQueryContext.state);
  }

  public getPrivateState(): SealedBidPrivateState {
    return this.circuitContext.currentPrivateState;
  }

  private updateStateAndGetLedger<T>(
    results: CircuitResults<SealedBidPrivateState, T>
  ): Ledger {
    this.circuitContext = results.context;
    this.updateUserPrivateState(results.context.currentPrivateState);
    return this.getLedger();
  }

  // ---- State-changing circuits (return the resulting ledger) ----

  public placeSealedBid(): Ledger {
    const results = this.contract.impureCircuits.placeSealedBid(this.circuitContext);
    logger.info({ section: "placeSealedBid", gasCost: results.gasCost });
    return this.updateStateAndGetLedger(results);
  }

  public openRevealPhase(): Ledger {
    const results = this.contract.impureCircuits.openRevealPhase(this.circuitContext);
    logger.info({ section: "openRevealPhase", gasCost: results.gasCost });
    return this.updateStateAndGetLedger(results);
  }

  public revealBid(): Ledger {
    const results = this.contract.impureCircuits.revealBid(this.circuitContext);
    logger.info({ section: "revealBid", gasCost: results.gasCost });
    return this.updateStateAndGetLedger(results);
  }

  public endAuction(): Ledger {
    const results = this.contract.impureCircuits.endAuction(this.circuitContext);
    logger.info({ section: "endAuction", gasCost: results.gasCost });
    return this.updateStateAndGetLedger(results);
  }

  // ---- Read circuits (return the computed value) ----

  public currentPhase(): bigint {
    const results = this.contract.impureCircuits.currentPhase(this.circuitContext);
    this.circuitContext = results.context;
    return results.result;
  }

  public isBidPlaced(nullifier: Uint8Array): boolean {
    const results = this.contract.impureCircuits.isBidPlaced(this.circuitContext, nullifier);
    this.circuitContext = results.context;
    return results.result;
  }
}
