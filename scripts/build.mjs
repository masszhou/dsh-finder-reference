import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
if (process.platform !== 'darwin') throw new Error('The native Finder helper requires macOS.');
for (const directory of ['lib', 'bin', 'tests/artifacts/native-module-cache']) await mkdir(path.join(root, directory), { recursive: true });
const sources = ['src/client-core.mjs', 'src/client-entry.js'];
const source = (await Promise.all(sources.map(file => readFile(path.join(root, file), 'utf8'))))
  .map(text => text.replace(/^export /gm, '')).join('\n');
// These two self-contained sources have no imports. Only React is resolved from DSH.
if (/^import\s/m.test(source)) throw new Error('Unexpected client dependency; review the bundle boundary.');
const bundle = `window.__ModuleLoader__.load({id:"dsh-finder-reference",factory:(require)=>{\nconst React=require("react");\n${source}\nreturn {apply,inject};\n}});\n`;
await writeFile(path.join(root, 'lib/client.js'), bundle);
execFileSync('xcrun', ['swiftc', '-O', '-module-cache-path', path.join(root, 'tests/artifacts/native-module-cache'), path.join(root, 'native/DragSnapshot.swift'), '-o', path.join(root, 'bin/drag-snapshot')], { cwd: root, stdio: 'inherit' });
const files = ['package.json', 'index.js', 'cordis.patch.yml', 'src/host-protocol.mjs', 'src/host-adapter.mjs', ...sources, 'native/DragSnapshot.swift', 'lib/client.js', 'bin/drag-snapshot'];
const hashes = Object.fromEntries(await Promise.all(files.map(async file => [file, createHash('sha256').update(await readFile(path.join(root, file))).digest('hex')])));
await writeFile(path.join(root, 'lib/build-info.json'), JSON.stringify({ version: '0.1.0', platform: process.platform, arch: process.arch, hashes }, null, 2) + '\n');
console.log('Built client bundle and native helper without installation hooks or a server restart.');
