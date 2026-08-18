// isomorphic-ws shim.
//
// The indexer provider does `import { WebSocket } from "isomorphic-ws"`, but
// that package's browser build (browser.js) only has a DEFAULT export. Rollup
// reports it as '"WebSocket" is not exported by isomorphic-ws/browser.js' and
// the binding ends up undefined, which would break the contract state
// subscription at runtime rather than at build time.
//
// In a browser there is no need for the isomorphic indirection at all: the
// platform WebSocket is already global. This shim exposes it under both the
// named and default export so either import style resolves.

const ws: typeof globalThis.WebSocket = globalThis.WebSocket;

export { ws as WebSocket };
export default ws;
