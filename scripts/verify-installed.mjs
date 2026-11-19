import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

// Verify only this plugin's declared runtime files. Do not inspect profile settings,
// browser data, credentials, or any pasteboard.
const root = fileURLToPath(new URL('../', import.meta.url));
const installed = process.argv[2];
if (!installed || !path.isAbsolute(installed)) throw new Error('Pass the absolute installed plugin directory.');
const expected = JSON.parse(await readFile(path.join(root, 'lib/build-info.json'), 'utf8'));
const files = ['package.json', 'index.js', 'cordis.patch.yml', 'src/host-protocol.mjs', 'src/host-adapter.mjs', 'native/DragSnapshot.swift', 'lib/client.js', 'bin/drag-snapshot'];
const verified = {};
for (const file of files) {
  const actual = createHash('sha256').update(await readFile(path.join(installed, file))).digest('hex');
  if (actual !== expected.hashes[file]) throw new Error(`Installed hash mismatch: ${file}`);
  verified[file] = actual;
}
const { nativeAvailable } = await import(pathToFileURL(path.join(installed, 'src/host-adapter.mjs')).href);
const result = { observedAt: new Date().toISOString(), version: expected.version, arch: expected.arch,
  runtimeFilesVerified: files.length, nativeExecutableAvailable: await nativeAvailable(),
  pasteboardRead: false, browserVerified: false, hashes: verified };
await mkdir(path.join(root, 'tests/artifacts'), { recursive: true });
await writeFile(path.join(root, 'tests/artifacts/installed-verification.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({version: result.version, runtimeFilesVerified: files.length, nativeExecutableAvailable: result.nativeExecutableAvailable, pasteboardRead: false}));
