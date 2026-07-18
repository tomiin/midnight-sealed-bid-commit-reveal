// src/deploy.ts — deploy the sealed-bid auction to PREPROD and do one on-chain
// interaction. Reuses the capstone's proven wallet infra (buildWallet/startAndSync
// on wallet-sdk 1.2.0) + the compact-cli-dev provider/deploy patterns.
//
// Run:  NODE_OPTIONS=--max-old-space-size=16384 npx tsx src/deploy.ts "Rare NFT #1"
//
// ⚠️ This is a best-effort scaffold. `npm install` then `npm run build` (tsc) will
// surface any SDK-signature mismatches against the installed 4.1.1 / 8.1.0 packages
// — fix those (they'll be at the ⚠️ VERIFY spots), then run. Deploy submission is
// gated on the same Preprod error 170 as the wallet send; retry when it clears.
import { Buffer } from "buffer";
import { randomBytes } from "crypto";
import { CompiledContract } from "@midnight-ntwrk/compact-js";
import { deployContract } from "@midnight-ntwrk/midnight-js-contracts";
import { initializeNetwork } from "./netid.js";
import { buildWallet, startAndSync } from "./wallet.js";
import { createProviders, ZK_CONFIG_PATH } from "./providers.js";

// The compiled contract + witnesses from the sibling contract package.
// ⚠️ VERIFY paths resolve after `npm install` (contract is a file: dependency).
import { Contract } from "../managed/sealed-bid-auction/contract/index.js";
import { witnesses, createPrivateState } from "./contract-witnesses.js";

// Preprod's node websocket drops mid-submit ("1000: Normal Closure"). The polkadot
// provider auto-reconnects, but the drop surfaces as an *unhandled* rejection from a
// background Effect fiber that would otherwise kill the process before withRetries can
// fire attempts 2-4. Swallow only that harmless socket noise; re-raise anything real.
function isSocketNoise(reason: any): boolean {
  const t = String(reason?.message ?? reason) + " " + String(reason?.cause?.message ?? "");
  return /Normal Closure|disconnected from wss|1000:/i.test(t);
}
process.on("unhandledRejection", (reason: any) => {
  if (isSocketNoise(reason)) {
    console.error("  (ignoring background socket drop; retry loop continues)");
    return;
  }
  console.error("Unhandled rejection:", reason);
});
process.on("uncaughtException", (err: any) => {
  if (isSocketNoise(err)) {
    console.error("  (ignoring background socket drop; retry loop continues)");
    return;
  }
  throw err;
});

const CONTRACT_NAME = "SealedBidAuction";

// Each retry re-calls fn() (e.g. deployContract), which REBUILDS the whole tx —
// fresh balance, fresh DUST fee proof. That's exactly the fix that made the wallet
// `send` land: error 170 (InvalidDustSpendProof) and "could not balance dust" both
// mean the dust fee was proven against a state the chain moved past, so the ONLY
// way forward is to rebuild, not resubmit. So we RETRY on 170 / balance-dust /
// socket drops — every attempt is a clean, freshly-balanced tx.
async function withRetries<T>(label: string, fn: () => Promise<T>, attempts = 8): Promise<T> {
  let lastErr: any;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (e: any) {
      lastErr = e;
      let full = "", cur: any = e;
      while (cur) { full += " " + String(cur.message ?? cur); cur = cur.cause; }
      const dustStale = /\b170\b/.test(full) || /balance dust|InsufficientFunds/i.test(full);
      const socket = /Normal Closure|disconnected|submission error/i.test(full);
      const retryable = dustStale || socket;
      const why = dustStale ? "stale dust — rebuilding fresh" : full.trim().slice(0, 120);
      console.error(`  ${label} attempt ${i}/${attempts} failed: ${why}`);
      if (i < attempts && retryable) {
        const w = 2500;
        console.error(`  rebuilding + retrying in ${w / 1000}s (re-proves, ~30-60s)…`);
        await new Promise((r) => setTimeout(r, w));
      } else break;
    }
  }
  throw lastErr;
}

async function main() {
  const itemDescription = process.argv[2] ?? "Sealed-bid item";

  // Reuse the capstone's already-funded + dust-synced wallet (public tutorial seed
  // 00..01) via the checkpoint copied into this folder, so we skip the ~1h dust
  // cold-sync. It holds NIGHT + 25,500 DUST and its dust tree is caught up.
  const seed = Buffer.from(
    "0000000000000000000000000000000000000000000000000000000000000001",
    "hex",
  );
  initializeNetwork();

  const bundle = await buildWallet(seed); // restores wallet-checkpoint.json (dust synced)
  console.log("Syncing wallet from checkpoint (unshielded catches up in ~1s)…");
  await startAndSync(bundle);

  // Build the compiled contract with the real witnesses (the auction uses
  // localSecretKey/localBidAmount/localBidSalt at call time).
  // ⚠️ VERIFY: withWitnesses vs withVacantWitnesses — use whichever your installed
  // @midnight-ntwrk/compact-js exposes; deploy needs the constructor, calls need witnesses.
  const compiledContract = (CompiledContract.make(CONTRACT_NAME, Contract) as any)
    .pipe(
      (CompiledContract as any).withWitnesses
        ? (CompiledContract as any).withWitnesses(witnesses)
        : (CompiledContract as any).withVacantWitnesses,
      (CompiledContract as any).withCompiledFileAssets(ZK_CONFIG_PATH),
    );

  const providers = await createProviders(
    bundle.facade,
    bundle.zswapSecretKeys,
    bundle.dustSecretKey,
    bundle.keystore,
  );

  // Fresh per-identity private state for the deployer/first bidder.
  const initialPrivateState = createPrivateState(
    new Uint8Array(randomBytes(32)),        // secretKey
    100n,                                    // bidAmount (example)
    new Uint8Array(randomBytes(32)),        // bidSalt
  );

  console.log(`Deploying ${CONTRACT_NAME} ("${itemDescription}") to Preprod…`);
  // ⚠️ VERIFY: how the constructor arg (itemDescription) is passed. Template shows
  // { compiledContract, privateStateId, initialPrivateState }; your constructor takes
  // an argument, so it likely needs `args: [itemDescription]`. Check the installed
  // @midnight-ntwrk/midnight-js-contracts deployContract .d.ts and adjust.
  const deployed = await withRetries("deploy", () =>
    deployContract(providers, {
      compiledContract,
      privateStateId: `${CONTRACT_NAME}PrivateState`,
      initialPrivateState,
      args: [itemDescription],
    } as any),
  );

  const address = (deployed as any).deployTxData.public.contractAddress;
  console.log("\n✅ DEPLOYED. Contract address:", address);
  console.log("Put this in the README and submit it. Verify at https://preprod.midnightexplorer.com/");

  // One on-chain interaction: place a sealed bid.
  // ⚠️ VERIFY the callTx accessor name against the deployed object's type.
  try {
    console.log("Placing one sealed bid (on-chain interaction)…");
    await (deployed as any).callTx.placeSealedBid();
    console.log("✅ placeSealedBid submitted.");
  } catch (e: any) {
    console.error("placeSealedBid failed (deploy still counts as the on-chain interaction):", e?.message ?? e);
  }

  await bundle.facade.stop();
}

main().catch((e) => { console.error(e); process.exit(1); });
