// src/providers.ts — the 6-provider bundle deployContract/findDeployedContract need,
// pointed at PREPROD. Adapted from the compact-cli-dev template.
//
// KEY PREPROD ADAPTATION: the template waits for `state.isSynced` before building
// the wallet provider. On Preprod that flag never flips (the dust wallet never
// reports "strictly complete" on a long-lived chain), so we take the first state
// emission instead — by the time we call this, startAndSync + the dust sync have
// already caught the wallet up.
import * as ledger from "@midnight-ntwrk/midnight-js-protocol/ledger";
import { httpClientProofProvider } from "@midnight-ntwrk/midnight-js-http-client-proof-provider";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { levelPrivateStateProvider } from "@midnight-ntwrk/midnight-js-level-private-state-provider";
import { NodeZkConfigProvider } from "@midnight-ntwrk/midnight-js-node-zk-config-provider";
import * as Rx from "rxjs";
import { fileURLToPath } from "node:url";
import { networkConfig } from "./config.js";

// Absolute path to the compiled contract's managed output (keys/ + zkir/).
export const ZK_CONFIG_PATH = fileURLToPath(
  new URL("../managed/sealed-bid-auction", import.meta.url),
);

export async function createWalletProvider(
  facade: any,
  zswapSecretKeys: ledger.ZswapSecretKeys,
  dustSecretKey: ledger.DustSecretKey,
) {
  // First emission — not filtered on isSynced (see note above).
  const state: any = await Rx.firstValueFrom(facade.state());
  return {
    getCoinPublicKey: () => state.shielded.coinPublicKey.toHexString(),
    getEncryptionPublicKey: () => state.shielded.encryptionPublicKey.toHexString(),
    async balanceTx(tx: any, ttl?: Date) {
      const recipe = await facade.balanceUnboundTransaction(
        tx,
        { shieldedSecretKeys: zswapSecretKeys, dustSecretKey },
        { ttl: ttl ?? new Date(Date.now() + 30 * 60 * 1000) },
      );
      return facade.finalizeRecipe(recipe);
    },
    submitTx: (tx: any) => facade.submitTransaction(tx),
  };
}

export async function createProviders(
  facade: any,
  zswapSecretKeys: ledger.ZswapSecretKeys,
  dustSecretKey: ledger.DustSecretKey,
  keystore: any,
  privateStateStoreName = "sealed-bid-preprod",
) {
  const walletProvider = await createWalletProvider(facade, zswapSecretKeys, dustSecretKey);
  const zkConfigProvider = new NodeZkConfigProvider(ZK_CONFIG_PATH);

  // accountId scopes the encrypted private-state store to this wallet.
  // ⚠️ VERIFY on install: the template uses keystore.getBech32Address().toString();
  // if that method name differs in your installed wallet-sdk, use the unshielded
  // address string instead.
  const accountId =
    typeof keystore.getBech32Address === "function"
      ? keystore.getBech32Address().toString()
      : String(keystore.getPublicKey?.() ?? "sealed-bid-account");

  return {
    privateStateProvider: levelPrivateStateProvider({
      privateStateStoreName,
      privateStoragePasswordProvider: () => "SealedBid-Dev-2026!",  // >=3 char classes (SDK now enforces this)
      accountId,
    }),
    publicDataProvider: indexerPublicDataProvider(
      networkConfig.indexerHttpUrl,
      networkConfig.indexerWsUrl,
    ),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(networkConfig.proofServer, zkConfigProvider),
    walletProvider,
    midnightProvider: walletProvider,
  } as any;
}
