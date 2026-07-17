// Public entry point for the sealed-bid-commit-reveal contract package.
//
// After running `npm run compact`, the generated contract (the Compact ->
// TypeScript output, including `Contract`, `ledger`, and `pureCircuits`) lives
// under `src/managed/sealed-bid-auction/contract`. A dApp imports the contract
// module from there, and imports the witnesses + private-state helpers below.
export * from "./witnesses.js";
