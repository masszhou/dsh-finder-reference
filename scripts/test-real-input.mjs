// Build and run the offline integration against the existing DSH checkout.
// No new dependencies, live sessions, browser state, or pasteboard are used.
import { build } from '/Users/zhiliangzhou/devel/deepseek-harness/node_modules/.pnpm/esbuild@0.28.2/node_modules/esbuild/lib/main.js';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const outfile = path.join(root, 'tests/artifacts/real-input.integration-bundle.mjs');
await build({
  entryPoints: [path.join(root, 'tests/real-input.integration.mjs')], outfile,
  bundle: true, platform: 'node', format: 'esm', loader: { '.css': 'empty' },
  banner: { js: 'import {createRequire as fixtureRequire} from "node:module"; const require=fixtureRequire(import.meta.url);' },
});
execFileSync(process.execPath, [outfile], { cwd: root, stdio: 'inherit', timeout: 15000 });
