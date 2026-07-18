// src/netid.ts — set the SDK network id to Preprod before building providers.
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
export function initializeNetwork() {
  // ⚠️ VERIFY the exact enum/string the installed network-id package expects for Preprod.
  setNetworkId("preprod" as any);
}
