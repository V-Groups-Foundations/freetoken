import { build } from "esbuild";

const common = { bundle: true, platform: "node", target: "node22", format: "cjs", sourcemap: true, logLevel: "warning" };
await build({ ...common, entryPoints: ["src/main/main.ts"], outfile: "dist/main/main.js",
  external: ["electron", "@vscode/ripgrep-*"] });
await build({ ...common, entryPoints: ["src/preload/preload.ts"], outfile: "dist/preload/preload.js", external: ["electron"] });
await build({ ...common, entryPoints: ["src/preload/freetoken-bridge.ts"], outfile: "dist/preload/freetoken-bridge.js", external: ["electron"] });
console.log("main + preload built");
