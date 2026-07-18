// src/config.ts — network endpoints, network ID, and token scales
import { NetworkId } from '@midnight-ntwrk/wallet-sdk';

export const NETWORK_ID = NetworkId.NetworkId.PreProd;

export const networkConfig = {
  indexerHttpUrl: 'https://indexer.preprod.midnight.network/api/v4/graphql',
  indexerWsUrl: 'wss://indexer.preprod.midnight.network/api/v4/graphql/ws',
  node: 'wss://rpc.preprod.midnight.network',
  proofServer: 'http://localhost:6300',
};

// Token scales
export const MICRO_NIGHT = 1_000_000n;             // 1 NIGHT = 1,000,000 micro-NIGHT
export const DUST_SPECKS = 1_000_000_000_000_000n; // 1 DUST = 10^15 specks
