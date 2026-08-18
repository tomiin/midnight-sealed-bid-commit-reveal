import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LocalAuctionClient } from "./auction/localClient";
import {
  AuctionClient,
  AuctionPublicState,
  Phase,
  phaseLabel
} from "./auction/types";
import { useWallet, describeWallets } from "./midnight/useWallet";
import { createBrowserProviders, type ProofStrategy } from "./midnight/providers";
import { MidnightAuctionClient } from "./midnight/midnightAuctionClient";

const AUCTIONEER = "auctioneer";
const NETWORK_ID = "preprod";

// The auction deployed for the Level 1 submission. Joining this is the default
// on-chain path so the demo needs no deploy and no funding to look at.
const LIVE_CONTRACT =
  "ad08e233a172874748b05ab40a30c9217699650115aa5650c3c671accfee4244";

const short = (hex: string) => (hex ? hex.slice(0, 10) + "…" : "—");

type Mode = "local" | "chain";

export default function App() {
  const [mode, setMode] = useState<Mode>("local");

  const localClient = useMemo(() => new LocalAuctionClient(), []);
  const [chainClient, setChainClient] = useState<MidnightAuctionClient | null>(null);
  const [proofStrategy, setProofStrategy] = useState<ProofStrategy | null>(null);
  const [busy, setBusy] = useState(false);
  const [diag, setDiag] = useState<string | null>(null);

  const [state, setState] = useState<AuctionPublicState | null>(null);
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string>("");

  const [item, setItem] = useState("Rare painting: 'Midnight over Nassau'");
  const [bidder, setBidder] = useState("alice");

  // ---------------------------------------------------------------------
  // THE BID AMOUNT IS DELIBERATELY NOT REACT STATE.
  //
  // Level 2 asks that the private input never be rendered. A controlled input
  // would put the amount in component state, into the React tree, and into
  // every devtools snapshot. Instead the field is uncontrolled: we read it
  // once at submit time, hand it to the circuit, and clear the DOM node
  // immediately. After a commit the amount exists only inside the client's
  // private state, where the witness reads it at proving time.
  // ---------------------------------------------------------------------
  const amountRef = useRef<HTMLInputElement>(null);

  const wallet = useWallet(NETWORK_ID);

  const client: AuctionClient | null = mode === "local" ? localClient : chainClient;

  const refresh = useCallback(() => {
    if (client) setState({ ...client.getState() });
  }, [client]);

  const run = async (label: string, fn: () => Promise<void>) => {
    setError("");
    setBusy(true);
    try {
      await fn();
      setStatus(label);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // Local mode seeds a fresh auction immediately.
  useEffect(() => {
    if (mode !== "local") return;
    void run("Deployed a fresh local auction.", () =>
      localClient.deploy(item, AUCTIONEER),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // On-chain mode re-renders whenever the ledger moves.
  useEffect(() => {
    if (!chainClient) return;
    const off = chainClient.onChange(() => setState({ ...chainClient.getState() }));
    setState({ ...chainClient.getState() });
    return off;
  }, [chainClient]);

  const connectAndJoin = async () => {
    setError("");
    setBusy(true);
    try {
      if (!wallet.api) {
        await wallet.connect();
        setStatus("Connect Lace, then press Join again.");
        return;
      }
      const { providers, proofStrategy: strat } = await createBrowserProviders(wallet.api);
      setProofStrategy(strat);
      const c = await MidnightAuctionClient.join(providers, LIVE_CONTRACT);
      setChainClient(c);
      setStatus(`Joined the auction on ${NETWORK_ID}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const deployOwnAuction = async () => {
    setError("");
    setBusy(true);
    try {
      if (!wallet.api) {
        await wallet.connect();
        setStatus("Connect the wallet, then press Deploy again.");
        return;
      }
      const { providers, proofStrategy: strat } = await createBrowserProviders(
        wallet.api,
      );
      setProofStrategy(strat);
      const c = await MidnightAuctionClient.deployNew(providers, item);
      setChainClient(c);
      setStatus(
        `Deployed your own auction at ${c.contractAddress}. You are the auctioneer.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const disconnectWallet = () => {
    // Tear down in the right order: stop the on-chain state subscription and
    // drop the session identity (secret key, bid amount, salt) BEFORE releasing
    // the wallet. Disconnecting should leave nothing private behind in memory.
    chainClient?.dispose();
    setChainClient(null);
    setProofStrategy(null);
    setState(null);
    wallet.disconnect();
    setStatus("Wallet disconnected. Session identity and bid discarded.");
    setError("");
  };

  const submitBid = () => {
    const raw = amountRef.current?.value ?? "";
    const clean = raw.replace(/[^0-9]/g, "");
    if (!clean) {
      setError("Enter a bid amount.");
      return;
    }
    const value = BigInt(clean);
    // Clear the DOM node before the await, so the amount is gone from the page
    // even while the proof is being generated.
    if (amountRef.current) amountRef.current.value = "";
    void run(
      mode === "chain"
        ? "Sealed bid committed on-chain. The amount stayed in this browser."
        : `${bidder} placed a sealed bid.`,
      () => client!.placeSealedBid(bidder, value),
    );
  };

  const phase = state?.phase ?? Phase.Bidding;
  const onChain = mode === "chain";
  const ready = !!client && !!state;

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
          <button
            className={mode === "local" ? "" : "ghost"}
            onClick={() => setMode("local")}
          >
            Local demo (no wallet)
          </button>
          <button
            className={mode === "chain" ? "" : "ghost"}
            onClick={() => setMode("chain")}
          >
            On-chain · Preprod + Lace
          </button>
        </div>

        {onChain && (
          <div className="chain-panel">
            <div className="badges">
              <span className="badge">Network: {NETWORK_ID}</span>
              <span className="badge">
                Wallet:{" "}
                {wallet.status === "connected"
                  ? (wallet.walletName ?? "connected")
                  : wallet.status}
              </span>
              {proofStrategy && (
                <span
                  className={`badge ${proofStrategy === "wallet" ? "" : "warn"}`}
                >
                  Proving:{" "}
                  {proofStrategy === "wallet"
                    ? "delegated to wallet"
                    : "local proof server"}
                </span>
              )}
            </div>

            {wallet.error && <div className="error">⚠ {wallet.error}</div>}

            {wallet.status === "connected" && (
              <div className="row">
                <button className="ghost" onClick={disconnectWallet} disabled={busy}>
                  Disconnect wallet
                </button>
              </div>
            )}

            <div className="row">
              <button
                className="ghost"
                onClick={() =>
                  setDiag(
                    JSON.stringify(
                      {
                        injectedWallets: describeWallets(),
                        dappConnectorApiPinnedByThisApp: "4.0.1",
                        requestedNetworkId: NETWORK_ID,
                        pageOrigin: window.location.origin,
                        lastConnectError: wallet.rawError ?? "(none yet)",
                      },
                      null,
                      2,
                    ),
                  )
                }
              >
                Run diagnostics
              </button>
            </div>
            {diag && (
              <pre className="diag">{diag}</pre>
            )}

            {!chainClient && (
              <>
                <p className="muted">
                  Joins the auction deployed for this project at{" "}
                  <code className="mono">{short(LIVE_CONTRACT)}</code> on Preprod.
                  Proving happens on this machine against a local proof server,
                  so the bid amount is never sent to a third party.
                  <br />
                  <strong>Requires:</strong> a proof server on{" "}
                  <code className="mono">localhost:6300</code>, and Lace set to
                  Settings » Midnight » Local.
                </p>
                <div className="row">
                  <button onClick={connectAndJoin} disabled={busy}>
                    {wallet.status === "connected"
                      ? "Join the live auction"
                      : "Connect wallet"}
                  </button>
                  <button className="ghost" onClick={deployOwnAuction} disabled={busy}>
                    Deploy my own auction
                  </button>
                </div>
                <p className="muted">
                  Joining lets you bid. The auctioneer-only actions belong to
                  whoever deployed, so deploy your own if you want to run the
                  full commit → reveal → end flow yourself.
                </p>
              </>
            )}

            {chainClient && (
              <p className="muted">
                Joined <code className="mono">{short(chainClient.contractAddress)}</code>.
                Your nullifier is{" "}
                <code className="mono">{short(chainClient.myNullifier)}</code> —
                that is what the chain sees, not your key.
                {!chainClient.isAuctioneer && (
                  <>
                    {" "}
                    You are <strong>not</strong> the auctioneer of this auction,
                    so opening the reveal phase and ending it are correctly
                    refused by the contract. Deploy your own to run the whole
                    flow yourself.
                  </>
                )}
                <div className="row" style={{ marginTop: 10 }}>
                  <button
                    className="ghost"
                    onClick={deployOwnAuction}
                    disabled={busy}
                  >
                    Deploy my own auction
                  </button>
                </div>
              </p>
            )}
          </div>
        )}

        {!onChain && (
          <div className="row">
            <label>
              Item
              <input value={item} onChange={(e) => setItem(e.target.value)} />
            </label>
            <button
              onClick={() =>
                run("Deployed a fresh local auction.", () =>
                  localClient.deploy(item, AUCTIONEER),
                )
              }
            >
              Reset auction
            </button>
          </div>
        )}

        {ready && (
          <div className="badges">
            <span className={`badge phase-${phase}`}>
              Phase: {phaseLabel(phase)}
            </span>
            <span className="badge">Bids: {state!.bidCount}</span>
            <span className="badge">Item: {state!.item}</span>
          </div>
        )}
      </section>

      {ready && (
        <>
          <section className="card">
            <h2>1 · Bidding phase</h2>
            <p className="muted">
              Each bid is stored as a commitment only. The amount is never put in
              page state and is cleared from the input the moment you commit.
              Bidding twice reuses the same nullifier and is rejected.
            </p>
            <div className="row">
              {!onChain && (
                <label>
                  Bidder
                  <input
                    value={bidder}
                    onChange={(e) => setBidder(e.target.value.trim())}
                    placeholder="alice"
                  />
                </label>
              )}
              <label>
                Amount
                <input
                  ref={amountRef}
                  defaultValue=""
                  placeholder="your sealed bid"
                  inputMode="numeric"
                  autoComplete="off"
                />
              </label>
              <button
                disabled={busy || phase !== Phase.Bidding || (!onChain && !bidder)}
                onClick={submitBid}
              >
                {busy ? "Proving…" : "Place sealed bid"}
              </button>
            </div>
            <button
              className="ghost"
              disabled={
                busy ||
                phase !== Phase.Bidding ||
                (onChain && !chainClient?.isAuctioneer)
              }
              title={
                onChain && !chainClient?.isAuctioneer
                  ? "Only the account that deployed this auction can do this."
                  : undefined
              }
              onClick={() =>
                run("Reveal phase opened.", () =>
                  client!.openRevealPhase(AUCTIONEER),
                )
              }
            >
              Auctioneer: open reveal phase →
            </button>
          </section>

          <section className="card">
            <h2>2 · Reveal phase</h2>
            <p className="muted">
              Revealing re-supplies the same amount and salt. The circuit
              recomputes the commitment and rejects any mismatch, so a bid cannot
              be changed after seeing the others. Anyone who never reveals keeps
              their bid private forever.
            </p>
            <div className="row">
              {!onChain && (
                <label>
                  Bidder
                  <input
                    value={bidder}
                    onChange={(e) => setBidder(e.target.value.trim())}
                  />
                </label>
              )}
              <button
                disabled={busy || phase !== Phase.Reveal || (!onChain && !bidder)}
                onClick={() =>
                  run("Bid revealed.", () => client!.revealBid(bidder))
                }
              >
                {busy ? "Proving…" : "Reveal bid"}
              </button>
              <button
                className="ghost"
                disabled={
                  busy ||
                  phase !== Phase.Reveal ||
                  (onChain && !chainClient?.isAuctioneer)
                }
                title={
                  onChain && !chainClient?.isAuctioneer
                    ? "Only the account that deployed this auction can do this."
                    : undefined
                }
                onClick={() =>
                  run("Auction ended.", () => client!.endAuction(AUCTIONEER))
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
                {state!.bids.length === 0 && (
                  <tr>
                    <td colSpan={5} className="muted">
                      No sealed bids yet.
                    </td>
                  </tr>
                )}
                {state!.bids.map((b) => (
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
              {state!.hasWinner ? (
                <>
                  <strong>Highest revealed bid:</strong>{" "}
                  {state!.highestBid.toString()} by{" "}
                  <span className="mono">{short(state!.highestNullifier ?? "")}</span>
                  {phase === Phase.Ended && " · FINAL"}
                </>
              ) : (
                <span className="muted">No revealed bids yet — no winner.</span>
              )}
            </div>
          </section>
        </>
      )}

      <footer>
        {error && <div className="error">⚠ {error}</div>}
        {!error && status && <div className="ok">✓ {status}</div>}
        <p className="fine">
          {onChain
            ? "Every action on this page builds a zero-knowledge proof and submits a transaction to Midnight Preprod."
            : "Local mode runs the commit-reveal logic in your browser with SHA-256, so you can see the flow without a wallet. Switch to on-chain to run it for real."}
        </p>
      </footer>
    </div>
  );
}
