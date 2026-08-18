import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";
import { nodePolyfills } from "vite-plugin-node-polyfills";
// Named export, not default: the package exposes viteCommonjs/esbuildCommonjs
// and has no default export. Importing it as default yields undefined and
// fails with "commonjs is not a function". (The official midnight-dapp-dev
// scaffold gets this wrong.)
import { viteCommonjs } from "@originjs/vite-plugin-commonjs";

// The Midnight SDK is not a plain browser library. Three things have to be true
// before it will bundle, and each plugin below buys exactly one of them:
//
//   wasm()            the proving and ledger primitives ship as WebAssembly
//   viteCommonjs()    parts of the dependency tree are still CJS
//   nodePolyfills()   the SDK expects Buffer, process and crypto to exist
//
// There is deliberately NO vite-plugin-top-level-await here. That plugin exists
// to rewrite top-level await for targets that lack it, and it does so with a
// bundled SWC that cannot print Rollup 4's output ("missing field `type`").
// Since build.target is esnext, Vite emits top-level await natively and the
// plugin is not just unnecessary but actively breaks the build.
export default defineConfig({
  plugins: [
    react(),
    wasm(),
    viteCommonjs(),
    nodePolyfills({
      include: ["buffer", "process", "util", "crypto", "stream"],
    }),
  ],
  resolve: {
    alias: {
      // See src/shims/isomorphic-ws.ts — the upstream browser build has no
      // named WebSocket export, which the indexer provider relies on.
      "isomorphic-ws": fileURLToPath(
        new URL("./src/shims/isomorphic-ws.ts", import.meta.url),
      ),
    },
  },
  server: { port: 5173 },
  build: {
    // esnext is required: top-level await cannot be downlevelled.
    target: "esnext",
    // The wasm glue does not survive aggressive mangling.
    minify: false,
  },
});
