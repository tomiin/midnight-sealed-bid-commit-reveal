// witnesses.ts — the three private values this contract asks the prover for.
//
// These functions run in the browser, inside the proving step, and their return
// values are fed into the zero-knowledge proof as witness data. Nothing here is
// ever transmitted. The contract's on-chain effects are a nullifier derived from
// secretKey and a commitment derived from (bidAmount, bidSalt); the three raw
// values below stay on this machine.
//
// The names must match the `witness` declarations in sealed-bid-auction.compact
// exactly. This file is a port of the deploy CLI's contract-witnesses.ts, which
// is the version that actually produced the live Preprod deployment.

export type SealedBidPrivateState = {
  secretKey: Uint8Array;
  bidAmount: bigint;
  bidSalt: Uint8Array;
};

export const createPrivateState = (
  secretKey: Uint8Array,
  bidAmount: bigint,
  bidSalt: Uint8Array,
): SealedBidPrivateState => ({ secretKey, bidAmount, bidSalt });

// A fresh identity for this browser session. crypto.getRandomValues is the
// browser equivalent of the CLI's randomBytes.
export const randomBytes32 = (): Uint8Array =>
  crypto.getRandomValues(new Uint8Array(32));

type WitnessContext<T> = { privateState: T };

export const witnesses = {
  localSecretKey: (
    context: WitnessContext<SealedBidPrivateState>,
  ): [SealedBidPrivateState, Uint8Array] => [
    context.privateState,
    context.privateState.secretKey,
  ],
  localBidAmount: (
    context: WitnessContext<SealedBidPrivateState>,
  ): [SealedBidPrivateState, bigint] => [
    context.privateState,
    context.privateState.bidAmount,
  ],
  localBidSalt: (
    context: WitnessContext<SealedBidPrivateState>,
  ): [SealedBidPrivateState, Uint8Array] => [
    context.privateState,
    context.privateState.bidSalt,
  ],
};
