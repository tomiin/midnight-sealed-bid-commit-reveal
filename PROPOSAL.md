# Product Proposal

## What is the product, and who uses it?

[I WILL FILL THIS IN]

<!-- Prompts, delete before submitting:
     Who runs the auction, who bids, and what is being sold? Procurement,
     spectrum/permit allocation, art, freelance bidding, supplier tenders?
     Name the party that is harmed today by bids being visible. -->

## Why Midnight specifically?

[I WILL FILL THIS IN — what does Midnight do that a transparent
chain could not do well for this product?]

<!-- Prompts, delete before submitting:
     On a transparent chain a sealed bid is not sealed: the amount is in the
     calldata, so the last bidder wins by reading the others. The usual
     workarounds are a trusted auctioneer holding bids off-chain, or a
     commit-reveal where the reveal is public anyway.
     Midnight lets the amount stay a private witness while the contract still
     proves the rules were followed. Say which of those two failure modes you
     care about. -->

## Data Model

| Data Point | Type | Disclosed To |
|------------|------|--------------|
| [example]  | Public ledger  | Everyone |
| [example]  | Private witness| No one   |

[I WILL FILL IN THE ROWS]

<!-- Prompts, delete before submitting. What the contract actually holds:
     PUBLIC ledger    auctioneer, item, phase, commitments map,
                      revealedNullifiers, highestBid, highestBidder,
                      hasWinner, bidCount
     PRIVATE witness  localSecretKey, localBidAmount, localBidSalt -->

## Mainnet Feasibility

[I WILL FILL THIS IN — is this realistic to reach Mainnet by Level 6?]

<!-- Prompts, delete before submitting:
     Honest points in favour: the contract is deployed and working on Preprod,
     the circuits are modest (placeSealedBid k=15), no oracle or bridge is
     needed, and the trust model needs no custodian.
     Honest points against: settlement of the actual payment is out of scope,
     the auctioneer still controls phase transitions, and private state is
     session-scoped so a bidder who loses their salt cannot reveal. -->
