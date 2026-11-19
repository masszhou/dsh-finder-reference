import test from 'node:test';
import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, writeFile, symlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createProtocol, ProtocolError } from '../src/host-protocol.mjs';

const NONCE = '01234567-89ab-cdef-0123-456789abcdef';
const SESSION = 'session-one';
const PATH = '/Users/example/report.txt';
const file = (extra = {}) => ({ name: 'report.txt', size: 7, lastModified: 1234, ...extra });
const payload = (extra = {}) => ({ sessionId: SESSION, clientNonce: NONCE, files: [file()], ...extra });
const metadata = (extra = {}) => ({
  dev: 1n, ino: 2n, size: 7n, mtimeNs: 1_234_900_000n,
  ctimeNs: 1_200_000_000n, mode: 33188n, nlink: 1n,
  isSymbolicLink: () => false, isFile: () => true, ...extra,
});
const snap = (paths = [PATH], extra = {}) => ({ protocolVersion: 1, changeCount: 4, paths, ...extra });
const approval = (preview, extra = {}) => ({ sessionId: SESSION, clientNonce: NONCE, ticket: preview.ticket, ...extra });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
function harness(overrides = {}) {
  let time = 100_000;
  let serial = 0;
  let snapshotCalls = 0;
  const statCalls = [];
  const protocol = createProtocol({
    snapshot: async () => { snapshotCalls++; return snap(); },
    stat: async (...args) => { statCalls.push(args); return metadata(); },
    now: () => time,
    randomToken: () => (++serial).toString(16).padStart(48, '0'),
    ...overrides,
  });
  return {
    ...protocol,
    advance: milliseconds => { time += milliseconds; },
    snapshotCalls: () => snapshotCalls,
    statCalls,
  };
}
function errorCode(expected) {
  return error => {
    assert.ok(error instanceof ProtocolError);
    assert.equal(error.code, expected);
    assert.equal(error.message, expected);
    assert.equal(error.cause, undefined);
    assert.equal(error.message.includes('/Users/'), false);
    assert.equal(error.stack, `ProtocolError: ${expected}`);
    return true;
  };
}
const rejects = (promise, code) => assert.rejects(promise, errorCode(code));
const throws = (fn, code) => assert.throws(fn, errorCode(code));

// No test uses a real pasteboard. All real filesystem fixtures stay here.
test('default BigInt lstat accepts a real regular fixture without reading contents', async () => {
  const root = fileURLToPath(new URL('./artifacts/', import.meta.url));
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, 'host-protocol-'));
  const path = join(directory, 'regular.txt');
  await writeFile(path, 'fixture');
  const info = await lstat(path, { bigint: true });
  let calls = 0;
  const protocol = createProtocol({ snapshot: async () => { calls++; return snap([path]); } });
  const preview = await protocol.resolve(payload({ files: [file({
    name: 'regular.txt', size: Number(info.size), lastModified: Number(info.mtimeNs / 1_000_000n),
  })] }));
  assert.match(preview.ticket, /^[a-f0-9]{48}$/);
  assert.deepEqual(await protocol.confirm(approval(preview)), { paths: [path] });
  assert.equal(calls, 1);
  protocol.dispose();
  const link = join(directory, 'link.txt');
  await symlink(path, link);
  const links = createProtocol({ snapshot: async () => snap([link]) });
  await rejects(links.resolve(payload({ files: [file({ name: 'link.txt' })] })), 'UNSUPPORTED_FILE');
  links.dispose();
});

test('resolve previews all paths, confirm uses no second snapshot and tickets are one-use', async () => {
  const h = harness();
  const preview = await h.resolve(payload());
  assert.deepEqual(preview, { ticket: '1'.padStart(48, '0'), expiresAt: 160_000, paths: [PATH] });
  assert.deepEqual(h.statCalls, [[PATH, { bigint: true }]]);
  assert.deepEqual(await h.confirm(approval(preview)), { paths: [PATH] });
  assert.equal(h.snapshotCalls(), 1);
  assert.equal(h.statCalls.length, 2);
  await rejects(h.confirm(approval(preview)), 'INVALID_TICKET');
});

test('NFC basename matching is one-to-one, returns browser order and preserves raw paths', async () => {
  const paths = ['/Users/example/b.txt', '/Users/example/cafe\u0301.txt'];
  const h = harness({ snapshot: async () => snap(paths) });
  const preview = await h.resolve(payload({ files: [file({ name: 'caf\u00e9.txt' }), file({ name: 'b.txt' })] }));
  assert.deepEqual(preview.paths, [paths[1], paths[0]]);
  preview.paths[0] = '/changed-by-browser.txt';
  assert.deepEqual(await h.confirm(approval(preview)), { paths: [paths[1], paths[0]] });
});

for (const mismatch of [{ sessionId: 'session-two' }, { clientNonce: 'ffffffff-ffff-ffff-ffff-ffffffffffff' }]) {
  test(`cross-binding confirm consumes ticket: ${Object.keys(mismatch)[0]}`, async () => {
    const h = harness();
    const preview = await h.resolve(payload());
    await rejects(h.confirm(approval(preview, mismatch)), 'INVALID_TICKET');
    await rejects(h.confirm(approval(preview)), 'INVALID_TICKET');
    assert.equal(h.statCalls.length, 1);
  });
}

test('TTL boundary, lazy expiration and expired replay', async () => {
  const h = harness();
  const preview = await h.resolve(payload());
  h.advance(59_999);
  assert.deepEqual(await h.confirm(approval(preview)), { paths: [PATH] });
  const expired = await h.resolve(payload());
  h.advance(60_000);
  await rejects(h.confirm(approval(expired)), 'INVALID_TICKET');
  await rejects(h.confirm(approval(expired)), 'INVALID_TICKET');
});

test('TTL is checked again after asynchronous confirmation', async () => {
  const gate = deferred();
  let calls = 0;
  const h = harness({ stat: async () => ++calls === 1 ? metadata() : gate.promise });
  const preview = await h.resolve(payload());
  const confirmation = h.confirm(approval(preview));
  h.advance(60_000);
  gate.resolve(metadata());
  await rejects(confirmation, 'INVALID_TICKET');
});

test('clock rollback cannot restore expiration or bypass rate cap', async () => {
  const h = harness();
  const preview = await h.resolve(payload());
  h.advance(60_000);
  await rejects(h.confirm(approval(preview)), 'INVALID_TICKET');
  h.advance(-60_000);
  const next = await h.resolve(payload());
  assert.equal(next.expiresAt, 220_000);
});

for (const item of [file({ size: 8 }), file({ lastModified: 1236 }), file({ lastModified: 234 }), file({ name: 'unrelated.txt' })]) {
  test(`metadata mismatch rejects without leaking snapshot names: ${JSON.stringify(item)}`, async () => {
    const h = harness();
    await rejects(h.resolve(payload({ files: [item] })), 'METADATA_MISMATCH');
  });
}

test('floor milliseconds permits only +/-1ms, including fractional nanoseconds', async () => {
  for (const mtimeNs of [1_233_000_000n, 1_234_999_999n, 1_235_999_999n]) {
    const h = harness({ stat: async () => metadata({ mtimeNs }) });
    await h.resolve(payload());
  }
  for (const mtimeNs of [1_232_999_999n, 1_236_000_000n]) {
    const h = harness({ stat: async () => metadata({ mtimeNs }) });
    await rejects(h.resolve(payload()), 'METADATA_MISMATCH');
  }
});

test('extra or missing snapshot files are never silently ignored', async () => {
  const h = harness({ snapshot: async () => snap([PATH, '/private/unrelated.txt']) });
  await rejects(h.resolve(payload()), 'METADATA_MISMATCH');
  assert.equal(h.statCalls.length, 0);
});

test('duplicate browser names, including NFC aliases, fail before snapshot', async () => {
  const h = harness();
  for (const names of [['report.txt', 'report.txt'], ['cafe\u0301.txt', 'caf\u00e9.txt']]) {
    await rejects(h.resolve(payload({ files: names.map(name => file({ name })) })), 'AMBIGUOUS_FILES');
  }
  assert.equal(h.snapshotCalls(), 0);
});

test('same basenames in different directories and NFC aliases are ambiguous', async () => {
  for (const paths of [[PATH, '/private/report.txt'], ['/one/cafe\u0301.txt', '/two/caf\u00e9.txt']]) {
    const h = harness({ snapshot: async () => snap(paths) });
    await rejects(h.resolve(payload()), 'AMBIGUOUS_FILES');
    assert.equal(h.statCalls.length, 0);
  }
});

for (const extra of [
  { isSymbolicLink: () => true }, { isFile: () => false },
]) {
  test(`symlink or nonregular file rejected: ${extra.isSymbolicLink ? 'link' : 'directory'}`, async () => {
    const h = harness({ stat: async () => metadata(extra) });
    await rejects(h.resolve(payload()), 'UNSUPPORTED_FILE');
  });
}

for (const [key, value] of [['dev', 99n], ['ino', 99n], ['size', 8n], ['mtimeNs', 1_234_900_001n], ['ctimeNs', 99n], ['mode', 0n], ['nlink', 2n]]) {
  test(`confirmation rejects changed ${key} and consumes ticket`, async () => {
    let current = metadata();
    const h = harness({ stat: async () => current });
    const preview = await h.resolve(payload());
    current = metadata({ [key]: value });
    await rejects(h.confirm(approval(preview)), 'FILE_CHANGED');
    await rejects(h.confirm(approval(preview)), 'INVALID_TICKET');
  });
}

test('confirmation rejects symlink replacement and removed files without details', async () => {
  for (const replacement of ['symlink', 'missing']) {
    let changed = false;
    const h = harness({ stat: async () => {
      if (!changed) return metadata();
      if (replacement === 'missing') throw new Error(`ENOENT private secret ${PATH}`);
      return metadata({ isSymbolicLink: () => true });
    } });
    const preview = await h.resolve(payload());
    changed = true;
    await rejects(h.confirm(approval(preview)), replacement === 'missing' ? 'FILE_UNAVAILABLE' : 'UNSUPPORTED_FILE');
  }
});

test('helper exception has a fixed safe error and counts toward snapshot rate', async () => {
  let calls = 0;
  const h = harness({ snapshot: async () => { calls++; throw new Error('exec secret /Users/private/secret'); } });
  for (let i = 0; i < 4; i++) await rejects(h.resolve(payload()), 'SNAPSHOT_FAILED');
  await rejects(h.resolve(payload()), 'RATE_LIMITED');
  assert.equal(calls, 4);
});

test('malformed snapshot versions, fields and collection shapes fail closed', async () => {
  const values = [null, {}, snap([], {}), snap([PATH], { protocolVersion: 2 }),
    snap([PATH], { changeCount: -1 }), snap([PATH], { extra: 1 }), snap([PATH, PATH]),
    snap(Array.from({ length: 33 }, (_, i) => `/private/${i}.txt`)),
    snap(Object.assign([PATH], { unexpected: true })),
    Object.assign(Object.create({ inherited: true }), snap()),
  ];
  for (const value of values) {
    const h = harness({ snapshot: async () => value });
    await rejects(h.resolve(payload()), 'SNAPSHOT_INVALID');
    assert.equal(h.statCalls.length, 0);
  }
});

test('single helper lock lasts through metadata validation, not only snapshot', async () => {
  const gate = deferred();
  const h = harness({ stat: async () => gate.promise });
  const first = h.resolve(payload());
  await rejects(h.resolve(payload()), 'BUSY');
  assert.equal(h.snapshotCalls(), 1);
  gate.resolve(metadata());
  await first;
});

test('rolling 4-per-second snapshot rate limit allows exactly the boundary', async () => {
  const h = harness();
  for (let i = 0; i < 4; i++) await h.resolve(payload());
  await rejects(h.resolve(payload()), 'RATE_LIMITED');
  h.advance(999);
  await rejects(h.resolve(payload()), 'RATE_LIMITED');
  h.advance(1);
  await h.resolve(payload());
  assert.equal(h.snapshotCalls(), 5);
});

test('8-ticket cap blocks before helper and lazy TTL cleanup restores capacity', async () => {
  const h = harness();
  for (let i = 0; i < 8; i++) {
    if (i === 4) h.advance(1000);
    await h.resolve(payload());
  }
  h.advance(1000);
  await rejects(h.resolve(payload()), 'TICKET_LIMIT');
  assert.equal(h.snapshotCalls(), 8);
  h.advance(60_000);
  await h.resolve(payload());
  assert.equal(h.snapshotCalls(), 9);
});

test('cancel permits only matching binding, then prevents confirm and replay', async () => {
  const h = harness();
  const preview = await h.resolve(payload());
  throws(() => h.cancel(approval(preview, { sessionId: 'wrong' })), 'INVALID_TICKET');
  throws(() => h.cancel(approval(preview, { clientNonce: 'a'.repeat(16) })), 'INVALID_TICKET');
  assert.deepEqual(h.cancel(approval(preview)), { cancelled: true });
  await rejects(h.confirm(approval(preview)), 'INVALID_TICKET');
  throws(() => h.cancel(approval(preview)), 'INVALID_TICKET');
});

test('dispose clears existing tickets and prohibits every operation', async () => {
  const h = harness();
  const preview = await h.resolve(payload());
  h.dispose();
  h.dispose();
  await rejects(h.resolve(payload()), 'DISPOSED');
  await rejects(h.confirm(approval(preview)), 'DISPOSED');
  throws(() => h.cancel(approval(preview)), 'DISPOSED');
  assert.equal(h.snapshotCalls(), 1);
});

test('dispose during helper returns promptly and never creates a late ticket', async () => {
  const gate = deferred();
  let tokens = 0;
  const h = harness({ snapshot: async () => gate.promise, randomToken: () => { tokens++; return 'a'.repeat(48); } });
  const pending = h.resolve(payload());
  h.dispose();
  await rejects(pending, 'DISPOSED');
  gate.resolve(snap());
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(tokens, 0);
  assert.equal(h.statCalls.length, 0);
  await rejects(h.confirm(approval({ ticket: 'a'.repeat(48) })), 'DISPOSED');
});

test('dispose during stat also prevents ticket storage', async () => {
  const gate = deferred();
  const entered = deferred();
  let tokens = 0;
  const h = harness({ stat: async () => { entered.resolve(); return gate.promise; }, randomToken: () => { tokens++; return 'b'.repeat(48); } });
  const pending = h.resolve(payload());
  await entered.promise;
  h.dispose();
  await rejects(pending, 'DISPOSED');
  gate.resolve(metadata());
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(tokens, 0);
});

test('abort before resolve never reads pasteboard', async () => {
  const h = harness();
  const controller = new AbortController();
  controller.abort();
  await rejects(h.resolve(payload(), controller.signal), 'ABORTED');
  assert.equal(h.snapshotCalls(), 0);
});

test('abort during helper returns promptly but retains lock until underlying completion', async () => {
  const gate = deferred();
  let calls = 0;
  const h = harness({ snapshot: async signal => { calls++; assert.ok(signal); return gate.promise; } });
  const controller = new AbortController();
  const pending = h.resolve(payload(), controller.signal);
  controller.abort();
  await rejects(pending, 'ABORTED');
  await rejects(h.resolve(payload()), 'BUSY');
  assert.equal(calls, 1);
  gate.resolve(snap());
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.statCalls.length, 0);
});

test('abort during stat prevents tickets; pre-aborted confirm consumes ticket', async () => {
  const gate = deferred();
  const entered = deferred();
  const h = harness({ stat: async () => { entered.resolve(); return gate.promise; } });
  const controller = new AbortController();
  const pending = h.resolve(payload(), controller.signal);
  await entered.promise;
  controller.abort();
  await rejects(pending, 'ABORTED');
  gate.resolve(metadata());
  await new Promise(resolve => setImmediate(resolve));
  const next = harness();
  const preview = await next.resolve(payload());
  await rejects(next.confirm(approval(preview), controller.signal), 'ABORTED');
  await rejects(next.confirm(approval(preview)), 'INVALID_TICKET');
});

test('abort at ticket delivery removes an allocated but undisclosed ticket', async () => {
  const controller = new AbortController();
  const ticket = 'c'.repeat(48);
  const h = harness({ randomToken: () => {
    queueMicrotask(() => controller.abort());
    return ticket;
  } });
  await rejects(h.resolve(payload(), controller.signal), 'ABORTED');
  await rejects(h.confirm(approval({ ticket })), 'INVALID_TICKET');
});

test('abort and dispose during confirm never return authorized paths', async () => {
  for (const action of ['abort', 'dispose']) {
    const gate = deferred();
    let calls = 0;
    const h = harness({ stat: async () => ++calls === 1 ? metadata() : gate.promise });
    const preview = await h.resolve(payload());
    const controller = new AbortController();
    const pending = h.confirm(approval(preview), controller.signal);
    if (action === 'abort') controller.abort(); else h.dispose();
    await rejects(pending, action === 'abort' ? 'ABORTED' : 'DISPOSED');
    gate.resolve(metadata());
    await new Promise(resolve => setImmediate(resolve));
  }
});

for (const path of [
  'relative.txt', 'file:///Users/example/report.txt', '/', '//server/report.txt',
  '/Users/../report.txt', '/Users/./report.txt', '/Users//report.txt', '/Users/report.txt/',
  '/Users/report\u0000.txt', '/Users/report\n.txt', '/Users/report\u007f.txt', '/Users/report\u0085.txt',
  '/Users/report\u202e.txt', '/Users/re"port.txt', '/Users/re\\port.txt',
  '/Users/\ud800.txt', `/${'x'.repeat(8193)}`,
]) {
  test(`malicious or unrepresentable path rejected (${JSON.stringify(path).slice(0, 70)})`, async () => {
    const h = harness({ snapshot: async () => snap([path]) });
    await rejects(h.resolve(payload()), 'SNAPSHOT_INVALID');
    assert.equal(h.statCalls.length, 0);
  });
}

test('invalid payloads never trigger helper, including prototype, accessor and symbol attacks', async () => {
  let getterCalled = false;
  const accessor = payload();
  Object.defineProperty(accessor, 'files', { enumerable: true, get() { getterCalled = true; return [file()]; } });
  const accessorFile = file();
  Object.defineProperty(accessorFile, 'name', { enumerable: true, get() { getterCalled = true; return 'report.txt'; } });
  const sparse = Array(1);
  const accessorArray = [file()];
  Object.defineProperty(accessorArray, '0', { enumerable: true, get() { getterCalled = true; return file(); } });
  const invalid = [null, [], {}, 'json', payload({ path: PATH }), payload({ sessionId: '' }),
    payload({ sessionId: ' '.repeat(2) }), payload({ sessionId: 'x'.repeat(129) }),
    payload({ clientNonce: 'short' }), payload({ clientNonce: 'x'.repeat(129) }),
    payload({ files: [] }), payload({ files: Array(33).fill(file()) }), payload({ files: sparse }),
    payload({ files: Object.assign([file()], { extra: true }) }), payload({ files: accessorArray }),
    payload({ files: [file({ path: PATH })] }), payload({ files: [accessorFile] }), accessor,
    payload({ [Symbol('extra')]: true }),
    Object.assign(Object.create({ attacker: true }), payload()),
    JSON.parse(`{"sessionId":"${SESSION}","clientNonce":"${NONCE}","files":[],"__proto__":{}}`),
  ];
  for (const name of ['', '.', '..', '../report.txt', 'a/b', 'a\\b', 'a\u0000b', 'a\nb', 'a"b'])
    invalid.push(payload({ files: [file({ name })] }));
  for (const value of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '7', 7n, null]) {
    invalid.push(payload({ files: [file({ size: value })] }));
    invalid.push(payload({ files: [file({ lastModified: value })] }));
  }
  for (const value of invalid) {
    const h = harness();
    await rejects(h.resolve(value), 'INVALID_PAYLOAD');
    assert.equal(h.snapshotCalls(), 0);
  }
  assert.equal(getterCalled, false);
});

test('null-prototype records are safe, own constructor/prototype fields are not', async () => {
  const h = harness();
  const data = Object.assign(Object.create(null), payload());
  data.files = [Object.assign(Object.create(null), file())];
  await h.resolve(data);
  for (const key of ['constructor', 'prototype', '__proto__']) {
    const data = payload();
    Object.defineProperty(data, key, { enumerable: true, value: {} });
    await rejects(h.resolve(data), 'INVALID_PAYLOAD');
  }
});

test('invalid confirm/cancel fields and browser paths never authorize a ticket', async () => {
  const h = harness();
  const preview = await h.resolve(payload());
  for (const extra of [{ paths: [PATH] }, { ticket: 'not-a-token' }, { clientNonce: 123 }, { extra: true }]) {
    await rejects(h.confirm(approval(preview, extra)), 'INVALID_PAYLOAD');
    throws(() => h.cancel(approval(preview, extra)), 'INVALID_PAYLOAD');
  }
  assert.deepEqual(await h.confirm(approval(preview)), { paths: [PATH] });
});

test('payload mutation while helper waits cannot change binding or file metadata', async () => {
  const gate = deferred();
  const h = harness({ snapshot: async () => gate.promise });
  const input = payload();
  const pending = h.resolve(input);
  input.sessionId = 'attacker';
  input.clientNonce = 'a'.repeat(16);
  input.files[0].size = 99;
  gate.resolve(snap());
  const preview = await pending;
  assert.deepEqual(await h.confirm(approval(preview)), { paths: [PATH] });
});

test('win32 and other platforms reject without helper or stat', async () => {
  for (const platform of ['win32', 'linux']) {
    const h = harness({ platform });
    await rejects(h.resolve(payload()), 'UNSUPPORTED_PLATFORM');
    await rejects(h.confirm(approval({ ticket: 'a'.repeat(48) })), 'UNSUPPORTED_PLATFORM');
    throws(() => h.cancel(approval({ ticket: 'a'.repeat(48) })), 'UNSUPPORTED_PLATFORM');
    assert.equal(h.snapshotCalls(), 0);
    assert.equal(h.statCalls.length, 0);
  }
});

test('token collisions reject live and consumed tokens until their original TTL', async () => {
  const h = harness({ randomToken: () => 'a'.repeat(48) });
  const original = await h.resolve(payload());
  await rejects(h.resolve(payload({ sessionId: 'other-session' })), 'TOKEN_FAILURE');
  assert.deepEqual(await h.confirm(approval(original)), { paths: [PATH] });
  await rejects(h.resolve(payload()), 'TOKEN_FAILURE');
  h.advance(59_999);
  await rejects(h.resolve(payload()), 'TOKEN_FAILURE');
  h.advance(1);
  await rejects(h.confirm(approval(original)), 'INVALID_TICKET');
  // A deliberately broken injected RNG can repeat after history expires.
  // Production relies on fresh unpredictable 192-bit random tokens instead.
  const next = await h.resolve(payload({ sessionId: 'new-session' }));
  assert.equal(next.ticket, original.ticket);
  assert.equal(next.expiresAt, 220_000);
  assert.deepEqual(await h.confirm(approval(next, { sessionId: 'new-session' })), { paths: [PATH] });
});

test('4000 resolve/cancel cycles recycle TTL history without retaining old tokens', async () => {
  let serial = 0;
  const h = harness({ randomToken: () => ((serial++ % 240) + 1).toString(16).padStart(48, '0') });
  for (let i = 0; i < 4000; i++) {
    if (i > 0 && i % 4 === 0) h.advance(1000);
    const preview = await h.resolve(payload());
    assert.deepEqual(h.cancel(approval(preview)), { cancelled: true });
  }
  assert.equal(h.snapshotCalls(), 4000);
});

test('apostrophes are representable in native reference names and original paths', async () => {
  const path = "/Users/example/O'Reilly.txt";
  const h = harness({ snapshot: async () => snap([path]) });
  const preview = await h.resolve(payload({ files: [file({ name: "O'Reilly.txt" })] }));
  assert.deepEqual(preview.paths, [path]);
  assert.deepEqual(await h.confirm(approval(preview)), { paths: [path] });
});

test('random source errors and invalid token formats are sanitized', async () => {
  for (const randomToken of [() => 'weak', () => 'A'.repeat(48), () => Buffer.alloc(24), () => { throw new Error(PATH); }]) {
    const h = harness({ randomToken });
    await rejects(h.resolve(payload()), 'TOKEN_FAILURE');
  }
});

test('simultaneous confirmation consumes before asynchronous stat begins', async () => {
  const gate = deferred();
  let calls = 0;
  const h = harness({ stat: async () => ++calls === 1 ? metadata() : gate.promise });
  const preview = await h.resolve(payload());
  const first = h.confirm(approval(preview));
  await rejects(h.confirm(approval(preview)), 'INVALID_TICKET');
  gate.resolve(metadata());
  assert.deepEqual(await first, { paths: [PATH] });
  assert.equal(calls, 2);
});

test('all 32 distinct files match one-to-one and confirm atomically', async () => {
  const paths = Array.from({ length: 32 }, (_, i) => `/Users/example/${i}.txt`);
  const files = Array.from({ length: 32 }, (_, i) => file({ name: `${i}.txt` }));
  const h = harness({ snapshot: async () => snap([...paths].reverse()) });
  const preview = await h.resolve(payload({ files }));
  assert.deepEqual(preview.paths, paths);
  assert.deepEqual(await h.confirm(approval(preview)), { paths });
  assert.equal(h.statCalls.length, 64);
});

test('bad stat shapes and dependency exceptions never expose local paths', async () => {
  for (const stat of [
    async () => { throw new Error(`EACCES ${PATH}`); },
    async () => metadata({ size: 7 }),
    async () => metadata({ ino: -1n }),
    async () => metadata({ isFile: () => { throw new Error(PATH); } }),
  ]) {
    const h = harness({ stat });
    await rejects(h.resolve(payload()), 'FILE_UNAVAILABLE');
  }
  const h = harness({ now: () => { throw new Error(PATH); } });
  await rejects(h.resolve(payload()), 'INTERNAL_ERROR');
  assert.equal(h.snapshotCalls(), 0);
});
