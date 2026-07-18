// src/keys.ts — derive role keys from a seed (path m/44'/2400'/0'/<role>/0)
import { HDWallet, Roles } from '@midnight-ntwrk/wallet-sdk';

function deriveKey(seed: Buffer, role: typeof Roles[keyof typeof Roles]): Uint8Array {
  const hd = HDWallet.fromSeed(seed);
  if (hd.type !== 'seedOk') throw new Error('Invalid seed for HD wallet');
  const d = hd.hdWallet.selectAccount(0).selectRole(role).deriveKeyAt(0);
  if (d.type === 'keyOutOfBounds') throw new Error('Key derivation out of bounds');
  return d.key;
}

export const deriveShieldedSeed = (s: Buffer) => deriveKey(s, Roles.Zswap);
export const deriveUnshieldedSeed = (s: Buffer) => deriveKey(s, Roles.NightExternal);
export const deriveDustSeed = (s: Buffer) => deriveKey(s, Roles.Dust);
