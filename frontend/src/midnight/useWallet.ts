// useWallet.ts — detect and connect a Midnight wallet extension.
//
// Two details worth knowing, both of which are easy to get wrong:
//
// 1. Wallets inject themselves under their own UUID key on window.midnight, not
//    under a fixed name. Lace also installs a convenience alias at
//    window.midnight.mnLace, but keying off that alone would silently ignore
//    every other Midnight wallet. So we enumerate and pick anything exposing
//    connect().
//
// 2. DApp Connector errors are plain objects serialized across the extension
//    boundary, not class instances. `instanceof` always fails on them. They are
//    identified by error.type === "DAppConnectorAPIError" and carry a code.

import { useCallback, useEffect, useState } from "react";
import type { InitialAPI, ConnectedAPI } from "@midnight-ntwrk/dapp-connector-api";

declare global {
  interface Window {
    midnight?: Record<string, InitialAPI>;
  }
}

export type WalletStatus =
  | "no-wallet"
  | "disconnected"
  | "connecting"
  | "connected";

function findWallets(): InitialAPI[] {
  if (typeof window === "undefined") return [];
  const all = Object.values(window.midnight ?? {}).filter(
    (w): w is InitialAPI => w != null && typeof (w as any).connect === "function",
  );
  // Prefer Lace when several wallets are injected, rather than trusting
  // enumeration order.
  const isLace = (w: InitialAPI) =>
    /lace/i.test(String((w as any).name ?? "")) ||
    /lace/i.test(String((w as any).rdns ?? ""));
  return [...all.filter(isLace), ...all.filter((w) => !isLace(w))];
}

/** Everything the page can see about injected wallets, for diagnostics. */
export function describeWallets(): unknown {
  if (typeof window === "undefined") return "no window";
  const raw = window.midnight ?? {};
  return Object.entries(raw).map(([key, w]) => ({
    key,
    name: (w as any)?.name,
    rdns: (w as any)?.rdns,
    apiVersion: (w as any)?.apiVersion,
    hasConnect: typeof (w as any)?.connect === "function",
  }));
}

function describeError(err: unknown): string {
  if (typeof err === "object" && err !== null && "type" in err) {
    const e = err as { type: string; code?: string; reason?: string };
    if (e.type === "DAppConnectorAPIError") {
      switch (e.code) {
        case "PermissionRejected":
          return "You declined the connection request in Lace.";
        case "Disconnected":
          return "Lace disconnected. Reopen the extension and try again.";
        case "InvalidRequest":
          return `Lace rejected the request: ${e.reason ?? "invalid request"}`;
        case "Rejected":
          return `Request rejected: ${e.reason ?? "rejected"}`;
        default:
          return `${e.reason ?? "Wallet error."} (code: ${e.code ?? "none"})`;
      }
    }
  }
  return err instanceof Error ? err.message : "Failed to connect to the wallet.";
}

export function useWallet(networkId: string) {
  const [status, setStatus] = useState<WalletStatus>("disconnected");
  const [api, setApi] = useState<ConnectedAPI | null>(null);
  const [walletName, setWalletName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The unmapped, unformatted error, kept so the page can display it.
  const [rawError, setRawError] = useState<string | null>(null);

  // Extensions inject asynchronously, so a single check on mount can race and
  // report "no wallet" for a wallet that shows up 200ms later. Poll briefly.
  useEffect(() => {
    let tries = 0;
    const id = setInterval(() => {
      if (findWallets().length > 0) {
        setStatus((s) => (s === "no-wallet" ? "disconnected" : s));
        clearInterval(id);
      } else if (++tries > 10) {
        setStatus((s) => (s === "disconnected" ? "no-wallet" : s));
        clearInterval(id);
      }
    }, 200);
    return () => clearInterval(id);
  }, []);

  const connect = useCallback(async () => {
    setError(null);
    const wallets = findWallets();
    if (wallets.length === 0) {
      setStatus("no-wallet");
      setError("No Midnight wallet found. Install the Lace extension to continue.");
      return;
    }
    setStatus("connecting");
    try {
      const wallet = wallets[0];

      // Lace runs its connector in a Chrome MV3 service worker, which the
      // browser suspends when idle. A cold worker rejects the first call with
      // InternalError / "Wallet is unavailable" and then wakes up. Calling
      // connect() is itself what wakes it, so one retry after a short pause
      // turns a spurious failure into a successful connection.
      let connected: Awaited<ReturnType<typeof wallet.connect>> | null = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          connected = await wallet.connect(networkId);
          break;
        } catch (e: unknown) {
          const code =
            typeof e === "object" && e !== null && "code" in e
              ? (e as { code?: string }).code
              : undefined;
          const wakeable = code === "InternalError" || code === "Disconnected";
          if (!wakeable || attempt === 3) throw e;
          console.warn(
            `[wallet] ${code} on attempt ${attempt}; the extension worker was ` +
              `probably asleep. Retrying…`,
          );
          await new Promise((r) => setTimeout(r, 1200 * attempt));
        }
      }
      if (!connected) throw new Error("Could not connect to the wallet.");

      // Confirm the wallet is actually on the network this app targets before
      // letting the user do anything. Connecting to a Preprod dApp from a wallet
      // pointed at Preview fails later with a confusing indexer error.
      const config = await connected.getConfiguration();
      if (config.networkId !== networkId) {
        setStatus("disconnected");
        setError(
          `Lace is on "${config.networkId}" but this app runs on "${networkId}". ` +
            `Switch networks in Lace and reconnect.`,
        );
        return;
      }

      setApi(connected);
      setWalletName((wallet as any).name ?? "Midnight wallet");
      setStatus("connected");
    } catch (err) {
      // Print everything before mapping it to a friendly string: an unmapped
      // code is invisible otherwise, and the connector's errors are plain
      // objects so they do not log usefully by default.
      console.error("[wallet] connect() failed.");
      console.error("[wallet] raw error:", err);
      try {
        console.error("[wallet] error as JSON:", JSON.stringify(err));
      } catch {
        console.error("[wallet] error not JSON-serialisable");
      }
      console.error("[wallet] injected wallets:", describeWallets());
      console.error("[wallet] requested networkId:", networkId);
      try {
        setRawError(
          JSON.stringify(err, Object.getOwnPropertyNames(err ?? {}), 2),
        );
      } catch {
        setRawError(String(err));
      }
      setStatus("disconnected");
      setError(describeError(err));
    }
  }, [networkId]);

  const disconnect = useCallback(() => {
    setApi(null);
    setWalletName(null);
    setStatus("disconnected");
    setError(null);
  }, []);

  return { status, api, walletName, error, rawError, connect, disconnect };
}
