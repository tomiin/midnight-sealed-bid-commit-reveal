// LocalAuctionClient — an in-browser mirror of the Compact contract's rules.
//
// This runs the entire commit -> reveal -> ended state machine client-side so
// the UI is fully playable with no wallet, proof server, or node. It reproduces
// the contract's SEMANTICS faithfully:
//
//   * each participant has a secret key that never leaves this object;
//   * a domain-separated nullifier = H("sbid:v1:nullifier" || secretKey) is the
//     only per-bidder value that appears in "public" state, and it blocks
//     double-bidding exactly as the on-chain nullifier does;
//   * a commitment = H(amountLE || salt) seals a bid; the amount stays local
//     until reveal, when the commitment is recomputed and checked.
//
// It uses SHA-256 (via Web Crypto) rather than Compact's persistentHash, so the
// hex values here are NOT byte-identical to the chain — this mirrors the flow,
// not the field arithmetic. The on-chain client in midnightClient.ts is where
// the real hashes live.

import {
  AuctionClient,
  AuctionPublicState,
  Phase,
  PublicBid
} from "./types";

const enc = new TextEncoder();

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

const sha256 = async (data: Uint8Array): Promise<string> => {
  // Copy into a fresh ArrayBuffer-backed view so the type is BufferSource
  // (not the SharedArrayBuffer-permitting ArrayBufferLike).
  const copy = new Uint8Array(data.length);
  copy.set(data);
  const digest = await crypto.subtle.digest("SHA-256", copy.buffer);
  return toHex(new Uint8Array(digest));
};

const concat = (...parts: Uint8Array[]): Uint8Array => {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
};

const u64le = (value: bigint): Uint8Array => {
  const out = new Uint8Array(8);
  let v = value;
  for (let i = 0; i < 8; i++) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
};

// Everything a participant keeps privately: identity + their sealed bid.
interface Participant {
  name: string;
  secretKey: Uint8Array;
  salt: Uint8Array;
  amount: bigint | null;
}

// One row of the PUBLIC ledger mirror, keyed by nullifier.
interface PublicRecord {
  name: string; // demo convenience; the real public value is the nullifier
  nullifier: string;
  commitment: string;
  revealed: boolean;
  amount: bigint | null;
}

export class LocalAuctionClient implements AuctionClient {
  private item = "";
  private phase: Phase = Phase.Bidding;
  private auctioneer = "";
  private bidCount = 0;
  private highestBid = 0n;
  private highestNullifier: string | null = null;
  private hasWinner = false;

  // Public ledger mirror, in bid order.
  private records: PublicRecord[] = [];
  private byNullifier = new Map<string, PublicRecord>();

  // Private state kept per participant name (never surfaced publicly).
  private participants = new Map<string, Participant>();

  private ensure(name: string): Participant {
    let p = this.participants.get(name);
    if (!p) {
      p = {
        name,
        secretKey: crypto.getRandomValues(new Uint8Array(32)),
        salt: crypto.getRandomValues(new Uint8Array(32)),
        amount: null
      };
      this.participants.set(name, p);
    }
    return p;
  }

  private nullifierOf(name: string): Promise<string> {
    const p = this.ensure(name);
    return sha256(concat(enc.encode("sbid:v1:nullifier"), p.secretKey));
  }

  private identityOf(name: string): Promise<string> {
    const p = this.ensure(name);
    return sha256(concat(enc.encode("sbid:v1:owner"), p.secretKey));
  }

  private commitmentOf(amount: bigint, salt: Uint8Array): Promise<string> {
    return sha256(concat(u64le(amount), salt));
  }

  async deploy(item: string, auctioneerName: string): Promise<void> {
    this.item = item;
    this.phase = Phase.Bidding;
    this.auctioneer = await this.identityOf(auctioneerName);
    this.bidCount = 0;
    this.highestBid = 0n;
    this.highestNullifier = null;
    this.hasWinner = false;
    this.records = [];
    this.byNullifier.clear();
  }

  async placeSealedBid(name: string, amount: bigint): Promise<void> {
    if (this.phase !== Phase.Bidding) throw new Error("bidding is closed");
    const nf = await this.nullifierOf(name);
    if (this.byNullifier.has(nf)) throw new Error("this nullifier has already bid");

    const p = this.ensure(name);
    p.amount = amount;
    p.salt = crypto.getRandomValues(new Uint8Array(32));
    const commitment = await this.commitmentOf(amount, p.salt);

    const record: PublicRecord = {
      name,
      nullifier: nf,
      commitment,
      revealed: false,
      amount: null
    };
    this.records.push(record);
    this.byNullifier.set(nf, record);
    this.bidCount += 1;
  }

  async openRevealPhase(callerName: string): Promise<void> {
    const id = await this.identityOf(callerName);
    if (id !== this.auctioneer) throw new Error("caller is not the auctioneer");
    if (this.phase !== Phase.Bidding) throw new Error("can only open reveal from bidding");
    this.phase = Phase.Reveal;
  }

  async revealBid(name: string): Promise<void> {
    if (this.phase !== Phase.Reveal) throw new Error("not in the reveal phase");
    const nf = await this.nullifierOf(name);
    const record = this.byNullifier.get(nf);
    if (!record) throw new Error("no sealed bid found for this nullifier");
    if (record.revealed) throw new Error("this nullifier has already revealed");

    const p = this.ensure(name);
    if (p.amount === null) throw new Error("no local bid to reveal");
    const recomputed = await this.commitmentOf(p.amount, p.salt);
    if (recomputed !== record.commitment) {
      throw new Error("reveal does not match your sealed bid");
    }

    record.revealed = true;
    record.amount = p.amount;
    if (p.amount > this.highestBid) {
      this.highestBid = p.amount;
      this.highestNullifier = nf;
      this.hasWinner = true;
    }
  }

  async endAuction(callerName: string): Promise<void> {
    const id = await this.identityOf(callerName);
    if (id !== this.auctioneer) throw new Error("caller is not the auctioneer");
    if (this.phase !== Phase.Reveal) throw new Error("can only end from the reveal phase");
    this.phase = Phase.Ended;
  }

  getState(): AuctionPublicState {
    const bids: PublicBid[] = this.records.map((r) => ({
      name: r.name,
      nullifier: r.nullifier,
      commitment: r.commitment,
      revealed: r.revealed,
      amount: r.amount
    }));

    return {
      item: this.item,
      phase: this.phase,
      auctioneer: this.auctioneer,
      bids,
      bidCount: this.bidCount,
      highestBid: this.highestBid,
      highestNullifier: this.highestNullifier,
      hasWinner: this.hasWinner
    };
  }
}
