// Private state for the sealed-bid-commit-reveal contract.
//
// Each participant holds three private values:
//   - secretKey: their identity key. The on-chain value is a domain-separated
//     nullifier derived from it; the key itself is never disclosed.
//   - bidAmount + bidSalt: the secret bid they are placing/revealing. These are
//     only ever used locally to build (and later verify) the commitment. They
//     never touch the ledger until the bidder chooses to reveal.
export type SealedBidPrivateState = {
  secretKey: Uint8Array;
  bidAmount: bigint;
  bidSalt: Uint8Array;
};

export const createPrivateState = (
  secretKey: Uint8Array,
  bidAmount: bigint,
  bidSalt: Uint8Array,
): SealedBidPrivateState => {
  return { secretKey, bidAmount, bidSalt };
};

// Minimal witness-context shape (the runtime passes `{ privateState }`).
type WitnessContext<T> = {
  privateState: T;
};

// Witness implementations - these run locally and feed private data into the
// zero-knowledge proof. Each returns a [nextPrivateState, result] tuple. The
// names must match the `witness` declarations in sealed-bid-auction.compact.
export const witnesses = {
  localSecretKey: (
    context: WitnessContext<SealedBidPrivateState>,
  ): [SealedBidPrivateState, Uint8Array] => {
    return [context.privateState, context.privateState.secretKey];
  },
  localBidAmount: (
    context: WitnessContext<SealedBidPrivateState>,
  ): [SealedBidPrivateState, bigint] => {
    return [context.privateState, context.privateState.bidAmount];
  },
  localBidSalt: (
    context: WitnessContext<SealedBidPrivateState>,
  ): [SealedBidPrivateState, Uint8Array] => {
    return [context.privateState, context.privateState.bidSalt];
  },
};
