# Product Proposal

## What is the product, and who uses it?

A sealed-bid tender system for public procurement in small jurisdictions.

A government agency posts a contract: road resurfacing, IT equipment, a ferry
route. Contractors submit bids. Today, in a lot of places, that process runs on
sealed paper envelopes opened in a room, or on a portal where the procurement
officer can see every bid as it arrives. Both depend entirely on trusting the
people holding the envelopes.

Three parties use it:

- **The issuing agency** runs the auction. It opens the reveal phase and closes
  the tender, but it cannot read a bid before reveal any more than the public can.
- **Contractors** submit a sealed bid and later reveal it. A contractor who
  loses can decline to reveal and their number stays private permanently.
- **Auditors and the public** can verify afterwards that the declared winner
  really was the best revealed bid, without ever being handed a database of
  everyone's pricing.

Small jurisdictions are the sharp end of this. The pool of contractors is small,
everyone knows everyone, and the procurement officer is somebody's cousin. That
is exactly where an "everyone must trust the envelope holder" process fails, and
exactly where a cryptographic guarantee is worth more than a policy document.

## Why Midnight specifically?

On a transparent chain a sealed bid is not sealed. The amount sits in the
transaction data, so anyone watching the mempool reads every bid as it lands and
the last contractor to submit wins by simply bidding one dollar less. That is
not a sealed-bid auction, it is an open auction with extra steps.

The two normal workarounds both give something up:

- **Trust a custodian.** Hold bids off-chain until the deadline. This works, and
  it is what most portals do, but it just moves the problem: now the operator is
  the single point of failure, and bid rigging in procurement is usually an
  inside job rather than an outside attack.
- **Commit-reveal on a transparent chain.** Publish a hash, reveal later. This
  hides the bid during bidding, but at reveal every amount becomes public
  forever, so losing contractors permanently expose their cost structure to
  their competitors. That is a real commercial harm and a reason firms refuse to
  bid.

Midnight removes the custodian without forcing that disclosure. The bid amount
is a private witness, so it is never transmitted. The contract still proves the
rules held: that the bidder is entitled to bid, that they have not bid twice,
and at reveal that the amount disclosed is the one originally committed to. A
contractor who never reveals keeps their number private for good.

There is a second reason, and it is the one most people miss because it sits
outside the contract entirely: **how the fee gets paid.**

On Ethereum you pay gas in ETH from the address that sends the transaction. That
address has a funding history, and that history usually leads back to an
exchange with your name on it. So even a flawless zero-knowledge circuit can be
undone by the payment that carried it. For a tender this is fatal in a very
ordinary way: a contractor's bid is cryptographically sealed, but the gas
payment says which company submitted it, and in a jurisdiction with nine
construction firms, knowing *who bid* is most of what a rigger needs.

Midnight separates the two. You hold NIGHT, which continuously generates DUST,
and DUST is what pays fees. DUST is non-transferable, it decays when
disassociated from the NIGHT that produced it, and it is consumed rather than
sent. Because it is shielded, paying a fee does not reveal the sender or the
transaction, which removes fee-based transaction analysis as an attack.

That matters here more than it would for most applications. A sealed-bid auction
has a small, known set of participants, so the anonymity set is tiny and any
side channel collapses it. Sealing the bid amount is not enough on its own; the
act of bidding has to be unlinkable too, and the fee is the channel that
normally gives it away. It also has a practical benefit for the agency: because
holding NIGHT grants ongoing transaction capacity rather than being spent down,
running tenders does not mean repeatedly buying tokens to cover gas, which is
its own procurement problem.

The property I care about most is the double-bid check. The contract proves you
have already bid without learning who you are. On a transparent chain you would
enforce that with an address allowlist, which means publishing exactly who is
bidding on which tender. Here the nullifier does the same job while the identity
stays private.

## Data Model

| Data Point | Type | Disclosed To |
|------------|------|--------------|
| `auctioneer` (issuing agency id) | Public ledger | Everyone |
| `item` (tender description) | Public ledger | Everyone |
| `phase` (Bidding / Reveal / Ended) | Public ledger | Everyone |
| `commitments` (nullifier to commitment) | Public ledger | Everyone |
| `revealedNullifiers` | Public ledger | Everyone |
| `bidCount` | Public ledger | Everyone |
| `highestBid` (after reveal only) | Public ledger | Everyone |
| `highestBidder` (winning nullifier) | Public ledger | Everyone |
| `hasWinner` | Public ledger | Everyone |
| `localSecretKey` (contractor identity) | Private witness | No one |
| `localBidAmount` (the bid) | Private witness | No one |
| `localBidSalt` (seals the commitment) | Private witness | No one |

An observer sees that a tender exists, how many firms bid, and eventually the
winning number. They do not see who bid, what any losing firm bid, or whether
two nullifiers belong to the same company.

## Mainnet Feasibility

Realistic to reach Mainnet by Level 6 as a working pilot, not as a system a
government would run a real tender on.

In favour: the contract is already deployed and working on Preprod, and the
whole flow runs from a browser against a live chain. The circuits are modest
(`placeSealedBid` is k=15), so proving is seconds on a laptop rather than
something needing special hardware. There is no oracle, no bridge and no
off-chain component to secure, which is usually where this kind of project dies.
The trust model needs no custodian, which is the entire point.

Honestly against, and I would rather write it down than have a reviewer find it:

- **Settlement is out of scope.** The contract picks a winner. It does not move
  money or bind anyone to a contract. That is a legal instrument, not a circuit.
- **The agency still controls the phases.** It can open reveal early or refuse
  to end the auction. Bids stay private throughout, so it cannot cheat on
  pricing, but it can stall. A block-height deadline would fix this and is not
  built yet.
- **Private state is session-scoped.** The amount and salt live in the browser
  tab. Lose them and you cannot reveal, which for a real tender is unacceptable.
  This is a deliberate privacy choice today and would need an encrypted export
  before real use.
- **One identity is one bid, not one company is one bid.** A firm with two keys
  can submit two bids. Fixing that needs an issued credential, which is a
  different contract and a real registration process behind it.

So the honest scope for Mainnet is a pilot: a real agency, a low-value tender,
running alongside their existing process rather than replacing it, to show the
guarantee holds. Everything above is a known gap with a known shape, which is
different from an unknown one.
