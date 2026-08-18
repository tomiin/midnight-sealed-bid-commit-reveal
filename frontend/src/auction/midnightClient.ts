// midnightClient.ts — superseded.
//
// This file used to be a stub that documented how to go on-chain and threw if
// called. That work is now done: the real implementation lives at
// ../midnight/midnightAuctionClient.ts and implements this same AuctionClient
// interface against the contract deployed on Preprod.
//
// Re-exported here so the original seam still resolves.
export { MidnightAuctionClient } from "../midnight/midnightAuctionClient";
export { createBrowserProviders } from "../midnight/providers";
