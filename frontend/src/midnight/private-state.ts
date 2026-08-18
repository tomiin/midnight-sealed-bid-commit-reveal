// private-state.ts — a session-scoped PrivateStateProvider.
//
// The CLI uses levelPrivateStateProvider, which is LevelDB and therefore not
// available in a browser. The browser alternative is to hold private state in
// memory for the life of the tab.
//
// That is a deliberate choice here rather than a shortcut. This app's private
// state is a bid: a value that is meaningful for one auction and should not
// outlive it. Persisting it to IndexedDB would leave a losing bid recoverable
// from the machine long after the auction ended, which is the opposite of what
// a sealed-bid auction promises. Reloading the tab loses the bid, and for this
// application that is the correct trade.

import type { PrivateStateProvider } from "@midnight-ntwrk/midnight-js-types";
import type { ContractAddress, SigningKey } from "@midnight-ntwrk/compact-runtime";

export function inMemoryPrivateStateProvider<
  PSI extends string,
  PS,
>(): PrivateStateProvider<PSI, PS> {
  const states = new Map<PSI, PS>();
  const signingKeys = new Map<ContractAddress, SigningKey>();

  return {
    setContractAddress: () => {},
    set: async (id, state) => {
      states.set(id, state);
    },
    get: async (id) => states.get(id) ?? null,
    remove: async (id) => {
      states.delete(id);
    },
    clear: async () => {
      states.clear();
    },
    setSigningKey: async (address, key) => {
      signingKeys.set(address, key);
    },
    getSigningKey: async (address) => signingKeys.get(address) ?? null,
    removeSigningKey: async (address) => {
      signingKeys.delete(address);
    },
    clearSigningKeys: async () => {
      signingKeys.clear();
    },
    // An ephemeral store has nothing meaningful to hand out or take in.
    exportPrivateStates: async () => {
      throw new Error("in-memory private state cannot be exported");
    },
    importPrivateStates: async () => {
      throw new Error("in-memory private state cannot be imported");
    },
    exportSigningKeys: async () => {
      throw new Error("in-memory signing keys cannot be exported");
    },
    importSigningKeys: async () => {
      throw new Error("in-memory signing keys cannot be imported");
    },
  };
}
