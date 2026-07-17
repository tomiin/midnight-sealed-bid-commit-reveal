import { useEffect, useMemo, useState } from "react";
import { LocalAuctionClient } from "./auction/localClient";
import {
  AuctionClient,
  AuctionPublicState,
  Phase,
  phaseLabel
} from "./auction/types";

const AUCTIONEER = "auctioneer";
const short = (hex: string) => (hex ? hex.slice(0, 10) + "…" : "—");

export default function App() {
  // One client for the session. Swap for a Midnight-backed client to go on-chain.
  const client = useMemo<AuctionClient>(() => new LocalAuctionClient(), []);
  const [state, setState] = useState<AuctionPublicState | null>(null);
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string>("");

  const [item, setItem] = useState("Rare painting: 'Midnight over Nassau'");
  const [bidder, setBidder] = useState("alice");
  const [amount, setAmount] = useState("100");

  const refresh = () => setState({ ...client.getState() });

  const run = async (label: string, fn: () => Promise<void>) => {
    setError("");
    try {
      await fn();
      setStatus(label);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  // Seed a fresh auction on first load.
  useEffect(() => {
    void run("Deployed a fresh auction.", () => client.deploy(item, AUCTIONEER));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!state) return <div className="app">Loading…</div>;

  const phase = state.phase;

  return (
    <div className="app">
      <header>
        <h1>Sealed-Bid Auction</h1>
        <p className="sub">
          commit → reveal, with per-bidder nullifiers · built on{" "}
          <strong>Midnight</strong>
        </p>
      </header>

      <section className="card">
        <div className="row">
          <label>
            Item
            <input value={item} onChange={(e) => setItem(e.target.value)} />
          </label>
          <button
            onClick={() =>
              run("Deployed a fresh auction.", () =>
                client.deploy(item, AUCTIONEER)
              )
            }
          >
            Reset auction
          </button>
        </div>
        <div className="badges">
          <span className={`badge phase-${phase}`}>
            Phase: {phaseLabel(phase)}
          </span>
          <span className="badge">Bids: {state.bidCount}</span>
          <span className="badge">Auctioneer: {short(state.auctioneer)}</span>
        </div>
      </section>

      <section className="card">
        <h2>1 · Bidding phase</h2>
        <p className="muted">
          Each bid is stored as a commitment only. The amount never leaves the
          browser until reveal. Bidding twice with the same name reuses the same
          nullifier and is rejected.
        </p>
        <div className="row">
          <label>
            Bidder
            <input
              value={bidder}
              onChange={(e) => setBidder(e.target.value.trim())}
              placeholder="alice"
            />
          </label>
          <label>
            Amount
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ""))}
              inputMode="numeric"
            />
          </label>
          <button
            disabled={phase !== Phase.Bidding || !bidder || !amount}
            onClick={() =>
              run(`${bidder} placed a sealed bid.`, () =>
                client.placeSealedBid(bidder, BigInt(amount || "0"))
              )
            }
          >
            Place sealed bid
          </button>
        </div>
        <button
          className="ghost"
          disabled={phase !== Phase.Bidding}
          onClick={() =>
            run("Reveal phase opened.", () =>
              client.openRevealPhase(AUCTIONEER)
            )
          }
        >
          Auctioneer: open reveal phase →
        </button>
      </section>

      <section className="card">
        <h2>2 · Reveal phase</h2>
        <p className="muted">
          Bidders reveal by re-supplying their amount. The commitment is
          recomputed and checked; the running highest bid updates live. Anyone
          who never reveals keeps their bid private forever.
        </p>
        <div className="row">
          <label>
            Bidder
            <input
              value={bidder}
              onChange={(e) => setBidder(e.target.value.trim())}
            />
          </label>
          <button
            disabled={phase !== Phase.Reveal || !bidder}
            onClick={() =>
              run(`${bidder} revealed their bid.`, () =>
                client.revealBid(bidder)
              )
            }
          >
            Reveal bid
          </button>
          <button
            className="ghost"
            disabled={phase !== Phase.Reveal}
            onClick={() =>
              run("Auction ended.", () => client.endAuction(AUCTIONEER))
            }
          >
            Auctioneer: end auction ▪
          </button>
        </div>
      </section>

      <section className="card">
        <h2>Public ledger</h2>
        <table>
          <thead>
            <tr>
              <th>Bidder</th>
              <th>Nullifier</th>
              <th>Commitment</th>
              <th>Status</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            {state.bids.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  No sealed bids yet.
                </td>
              </tr>
            )}
            {state.bids.map((b) => (
              <tr key={b.nullifier}>
                <td>{b.name}</td>
                <td className="mono">{short(b.nullifier)}</td>
                <td className="mono">{short(b.commitment)}</td>
                <td>
                  {b.revealed ? (
                    <span className="tag revealed">revealed</span>
                  ) : (
                    <span className="tag sealed">sealed</span>
                  )}
                </td>
                <td>{b.amount === null ? "—" : b.amount.toString()}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="winner">
          {state.hasWinner ? (
            <>
              <strong>Highest revealed bid:</strong> {state.highestBid.toString()}{" "}
              by <span className="mono">{short(state.highestNullifier ?? "")}</span>
              {phase === Phase.Ended && " · FINAL"}
            </>
          ) : (
            <span className="muted">No revealed bids yet — no winner.</span>
          )}
        </div>
      </section>

      <footer>
        {error && <div className="error">⚠ {error}</div>}
        {!error && status && <div className="ok">✓ {status}</div>}
        <p className="fine">
          This page runs the commit-reveal logic in your browser. The real rules
          live in the Compact contract under <code>contract/</code>; see{" "}
          <code>frontend/src/auction/midnightClient.ts</code> to run the same UI
          on-chain.
        </p>
      </footer>
    </div>
  );
}
