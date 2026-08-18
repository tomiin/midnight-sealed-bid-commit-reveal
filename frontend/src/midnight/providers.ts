// providers.ts — the six providers deployContract/findDeployedContract need,
// assembled in the browser from a connected Lace wallet.
//
// The CLI version of this file (deploy/src/providers.ts) builds the same bundle
// from a WalletFacade and a local filesystem. In the browser two of the six have
// to change: ZK assets are fetched over HTTP instead of read from disk, and
// private state lives in memory instead of LevelDB.
//
// ---------------------------------------------------------------------------
// THE PROVING DECISION, AND WHY IT MATTERS MORE HERE THAN IN MOST APPS
// ---------------------------------------------------------------------------
// A proof has to be generated somewhere, and there are three options:
//
//   1. a proof server on localhost      private, but a public demo cannot ask
//                                       every visitor to run Docker
//   2. the public Preprod proof server  works for anyone, but the operator sees
//                                       the proof inputs
//   3. the wallet itself                private, and needs nothing installed
//
// For most contracts option 2 is a reasonable default. For this one it is not.
// The entire claim of a sealed-bid auction is that nobody learns your bid before
// the reveal. Option 2 would hand the bid amount to the proof server operator,
// which defeats the contract in the browser even though the chain behaves
// correctly. So this app delegates proving to Lace.
//
// PROOF_STRATEGY exists so that choice is visible and switchable rather than
// buried. If wallet-delegated proving is unavailable, we fall back and say so
// loudly in the console, because the fallback has a real privacy cost.

import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { FetchZkConfigProvider } from "@midnight-ntwrk/midnight-js-fetch-zk-config-provider";
import { httpClientProofProvider } from "@midnight-ntwrk/midnight-js-http-client-proof-provider";
import { toHex, fromHex } from "@midnight-ntwrk/midnight-js-utils";
import { Transaction } from "@midnight-ntwrk/ledger-v8";
import type {
  WalletProvider,
  MidnightProvider,
} from "@midnight-ntwrk/midnight-js-types";
import type { ConnectedAPI } from "@midnight-ntwrk/dapp-connector-api";

import { inMemoryPrivateStateProvider } from "./private-state.js";
import type { SealedBidPrivateState } from "./witnesses.js";

export const PRIVATE_STATE_ID = "SealedBidAuctionPrivateState";

// Circuit names, used to type the ZK config provider. These are the impure
// circuits in sealed-bid-auction.compact.
export type AuctionCircuits =
  | "placeSealedBid"
  | "openRevealPhase"
  | "revealBid"
  | "endAuction";

export type ProofStrategy = "wallet" | "proof-server";

// Default local proof server. Per Midnight's install guide, a local proof
// server is currently the ONLY option Lace supports (Settings » Midnight »
// Local). Note that the previously documented public Preprod proof server
// (lace-proof-pub.preprod.midnight.network) does not resolve — it is a known
// docs typo reported on the forum — so there is deliberately no public
// fallback here.
const LOCAL_PROOF_SERVER = "http://localhost:6300";

async function buildProofProvider(
  api: ConnectedAPI,
  zkConfigProvider: FetchZkConfigProvider<AuctionCircuits>,
): Promise<{ proofProvider: unknown; strategy: ProofStrategy }> {
  // Wallet-delegated proving is the v4 direction, and 1AM implements it. Lace
  // does NOT yet expose getProvingProvider (confirmed by Midnight DevRel on the
  // forum, May 2026), so feature-detect rather than assume. This is the
  // conditional fallback Midnight recommends, and it keeps the app working with
  // both wallets.
  if (typeof (api as any).getProvingProvider === "function") {
    try {
      const mod: any = await import(
        "@midnight-ntwrk/midnight-js-dapp-connector-proof-provider"
      );
      const protocol: any = await import(
        "@midnight-ntwrk/midnight-js-protocol/ledger"
      );
      // VERIFIED against the installed typings rather than guessed:
      // midnight-js-protocol/ledger is `export * from "@midnight-ntwrk/ledger-v8"`,
      // and ledger-v8 declares
      //     export class CostModel {
      //       private constructor();
      //       static initialCostModel(): CostModel;
      //     }
      // The constructor is private, so an INSTANCE can only come from the
      // static factory. Passing the class itself is what produced
      // "expected instance of _CostModel" at submit time.
      const costModel = protocol.CostModel.initialCostModel();

      const proofProvider = await mod.dappConnectorProofProvider(
        api,
        zkConfigProvider,
        costModel,
      );
      console.info("[providers] Proving delegated to the wallet.");
      return { proofProvider, strategy: "wallet" };
    } catch (err) {
      console.warn(
        "[providers] getProvingProvider exists but failed; falling back to a " +
          "proof server.",
        err,
      );
    }
  }

  // Respect the user's configured prover in Lace. proverServerUri is marked
  // @deprecated to signal the eventual move to delegation, but Midnight DevRel
  // confirms it is functional and not auth-gated, and it is the correct way to
  // honour a custom setting.
  let uri = LOCAL_PROOF_SERVER;
  try {
    const { proverServerUri } = await api.getConfiguration();
    if (proverServerUri) uri = proverServerUri;
  } catch {
    /* fall through to the local default */
  }

  console.info(`[providers] Proving via proof server at ${uri}`);
  return {
    proofProvider: httpClientProofProvider<AuctionCircuits>(
      uri,
      zkConfigProvider,
    ),
    strategy: "proof-server",
  };
}

export interface BrowserProviders {
  providers: any;
  networkId: string;
  proofStrategy: ProofStrategy;
}

export async function createBrowserProviders(
  api: ConnectedAPI,
): Promise<BrowserProviders> {
  // Read the endpoints from the wallet rather than hardcoding them, so the app
  // follows whatever network the user actually selected in Lace.
  const config = await api.getConfiguration();
  setNetworkId(config.networkId as any);

  const publicDataProvider = indexerPublicDataProvider(
    config.indexerUri,
    config.indexerWsUri,
  );

  // Serves keys/ and zkir/ from this origin. `npm run sync-contract` copies the
  // compiled output into public/managed/sealed-bid-auction for exactly this.
  const zkConfigProvider = new FetchZkConfigProvider<AuctionCircuits>(
    window.location.origin,
    fetch.bind(window),
  );

  const { proofProvider, strategy } = await buildProofProvider(
    api,
    zkConfigProvider,
  );

  const { shieldedCoinPublicKey, shieldedEncryptionPublicKey } =
    await api.getShieldedAddresses();

  const walletProvider: WalletProvider = {
    getCoinPublicKey: () => shieldedCoinPublicKey,
    getEncryptionPublicKey: () => shieldedEncryptionPublicKey,
    // The DApp Connector speaks serialized hex, so serialize the unbound tx in,
    // let Lace pick fee inputs and bind it, then deserialize what comes back.
    balanceTx: async (tx: any, _ttl?: Date) => {
      const { tx: balancedHex } = await api.balanceUnsealedTransaction(
        toHex(tx.serialize()),
        {},
      );
      return Transaction.deserialize(
        "signature",
        "proof",
        "binding",
        fromHex(balancedHex),
      );
    },
  } as WalletProvider;

  const midnightProvider: MidnightProvider = {
    submitTx: async (tx: any) => {
      // submitTransaction returns void, so the id comes off the tx itself.
      await api.submitTransaction(toHex(tx.serialize()));
      return tx.identifiers()[0];
    },
  } as MidnightProvider;

  return {
    providers: {
      privateStateProvider: inMemoryPrivateStateProvider<
        typeof PRIVATE_STATE_ID,
        SealedBidPrivateState
      >(),
      publicDataProvider,
      zkConfigProvider,
      proofProvider,
      walletProvider,
      midnightProvider,
    },
    networkId: config.networkId,
    proofStrategy: strategy,
  };
}
