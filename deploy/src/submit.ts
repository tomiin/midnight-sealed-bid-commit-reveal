// src/submit.ts — resilient node submission.
//
// The Preprod node websocket (wss://rpc.preprod.midnight.network) intermittently
// drops connections mid-submit with "1000: Normal Closure". The transaction is
// already built, signed, and PROVEN by the time we submit, so re-poking the node
// with the same finalized tx is safe — we just retry until the socket holds long
// enough for the node to accept it. The @polkadot provider auto-reconnects
// between attempts.
export async function submitWithRetry(facade: any, finalized: any, attempts = 6): Promise<any> {
  let lastErr: any;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await facade.submitTransaction(finalized);
    } catch (err: any) {
      lastErr = err;
      console.error(`  submit attempt ${i}/${attempts} failed: ${String(err?.message ?? err)}`);
      if (i < attempts) {
        const wait = 3000 * i;
        console.error(`  retrying in ${wait / 1000}s…`);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }
  throw lastErr;
}
