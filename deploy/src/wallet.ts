// src/wallet.ts — build the facade and sync safely
import * as ledger from "@midnight-ntwrk/midnight-js-protocol/ledger";
import {
  WalletFacade, ShieldedWallet, DustWallet, UnshieldedWallet, PublicKey,
  createKeystore, InMemoryTransactionHistoryStorage, TransactionHistoryStorage,
} from "@midnight-ntwrk/wallet-sdk";
import * as rx from "rxjs";
import { NETWORK_ID, networkConfig } from "./config";
import { deriveShieldedSeed, deriveUnshieldedSeed, deriveDustSeed } from "./keys";
import { loadCheckpoint } from "./checkpoint";

/**
 * Build the wallet facade.
 *
 * If a checkpoint file exists (written by the `sync` command), the DUST and
 * unshielded wallets are RESTORED from it instead of starting a cold scan from
 * index 0. On Preprod the DUST wallet has to walk ~1.3M historical generation
 * events; restoring from a checkpoint is what makes that survivable across runs.
 * The shielded wallet has no restore path in this SDK, but we never block on it.
 */
export async function buildWallet(seed: Buffer, opts: { useCheckpoint?: boolean } = {}) {
  const { useCheckpoint = true } = opts;
  const zswapSecretKeys = ledger.ZswapSecretKeys.fromSeed(deriveShieldedSeed(seed));
  const dustSecretKey = ledger.DustSecretKey.fromSeed(deriveDustSeed(seed));
  const keystore = createKeystore(deriveUnshieldedSeed(seed), NETWORK_ID);

  const checkpoint = useCheckpoint ? loadCheckpoint() : null;
  if (checkpoint) {
    const when = new Date(checkpoint.savedAt).toLocaleTimeString();
    console.error(`[checkpoint] restoring wallet from ${when}` +
      (checkpoint.dustIndex ? ` (dust index ~${checkpoint.dustIndex})` : ""));
  }

  const configuration = {
    networkId: NETWORK_ID,
    indexerClientConnection: {
      indexerHttpUrl: networkConfig.indexerHttpUrl,
      indexerWsUrl: networkConfig.indexerWsUrl,
    },
    costParameters: { additionalFeeOverhead: 300_000_000_000_000n, feeBlocksMargin: 5 },
    txHistoryStorage: new InMemoryTransactionHistoryStorage(
      TransactionHistoryStorage.TransactionHistoryCommonSchema,
    ),
    provingServerUrl: new URL(networkConfig.proofServer),
    relayURL: new URL(networkConfig.node),
  };

  const facade = await WalletFacade.init({
    configuration,
    shielded: (cfg) => ShieldedWallet(cfg).startWithSecretKeys(zswapSecretKeys),
    unshielded: (cfg) => checkpoint
      ? UnshieldedWallet(cfg).restore(checkpoint.unshielded)
      : UnshieldedWallet(cfg).startWithPublicKey(PublicKey.fromKeyStore(keystore)),
    dust: (cfg) => checkpoint
      ? DustWallet(cfg).restore(checkpoint.dust)
      : DustWallet(cfg).startWithSecretKey(
          dustSecretKey,
          ledger.LedgerParameters.initialParameters().dust,
        ),
  });

  return { facade, keystore, zswapSecretKeys, dustSecretKey };
}

/**
 * Per-wallet sync check — we wait for the UNSHIELDED wallet only.
 *
 * We deliberately DON'T block on the shielded wallet (it scans the whole chain
 * and trial-decrypts every shielded output just to confirm this wallet has none)
 * nor on the dust wallet (its full generation-event scan takes hours on Preprod;
 * see the `sync` command for that). The DUST balance is readable regardless.
 */
function isReallySynced(state: any): boolean {
  const p = state?.unshielded?.progress;
  if (!p) return false;
  const applied = Number(p.appliedId ?? p.appliedIndex ?? 0);
  const highest = Number(p.highestTransactionId ?? p.highestIndex ?? 0);
  return highest > 0 && applied >= highest;
}

/**
 * Start the facade and wait until the unshielded wallet is caught up.
 * Redraws progress every second and fails loudly on timeout.
 */
export async function startAndSync(
  bundle: Awaited<ReturnType<typeof buildWallet>>,
  timeoutMs = 600_000,
) {
  const { facade, zswapSecretKeys, dustSecretKey } = bundle;
  await facade.start(zswapSecretKeys, dustSecretKey);

  return new Promise<any>((resolve, reject) => {
    const startedAt = Date.now();
    let lastApplied = 0;
    let lastHighest = 0;

    const draw = () => {
      const secs = Math.floor((Date.now() - startedAt) / 1000);
      process.stdout.write(
        `\r  syncing… ${Math.min(lastApplied, lastHighest)}/${lastHighest} transactions (${secs}s)`,
      );
    };
    const heartbeat = setInterval(draw, 1000);

    let sub: rx.Subscription;
    const timeout = setTimeout(() => {
      clearInterval(heartbeat);
      sub?.unsubscribe();
      reject(new Error(
        `Sync timed out after ${timeoutMs / 1000}s. Run the command again; ` +
        `the indexer resumes from where it left off.`,
      ));
    }, timeoutMs);

    sub = facade.state().subscribe((state: any) => {
      const p = state.unshielded?.progress;
      if (p) {
        lastApplied = Number(p.appliedId);
        lastHighest = Number(p.highestTransactionId);
        draw();
      }
      if (isReallySynced(state)) {
        clearInterval(heartbeat);
        clearTimeout(timeout);
        sub.unsubscribe();
        process.stdout.write("\n");
        resolve(state);
      }
    });
  });
}
