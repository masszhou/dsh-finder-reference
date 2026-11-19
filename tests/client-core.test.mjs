import test from 'node:test';
import assert from 'node:assert/strict';
import { formatMention, fileMetadata, installDropGuard, createDropController } from '../src/client-core.mjs';

const paths = ['/Users/test/中文 a.txt', '/Users/test/b.png'];
const files = [{ name: '中文 a.txt', size: 4, lastModified: 1000 }, { name: 'b.png', size: 8, lastModified: 2000 }];
function harness(options = {}) {
  const calls = [], views = [], inserted = [];
  let rev = 3, position = 5, live = true;
  const facade = {
    state: { getSnapshot: () => ({ phase: options.phase ?? 'plain', draftRev: rev, draft: 'An existing @chip plus text' }) },
    insertReference: (ref, span) => {
      if (span.draftRev !== rev || inserted.length === options.rejectAt) return false;
      inserted.push({ ref, span }); rev++; position = span.start + 2; return true;
    },
    focus: () => calls.push(['focus']),
  };
  const request = async (operation, payload, signal) => {
    calls.push([operation, payload, signal]);
    if (options.request) return options.request(operation, payload, signal);
    if (operation === 'resolve') return { ticket: 'ticket-unique', expiresAt: 61000, paths };
    if (operation === 'confirm') return { paths };
    return { cancelled: true };
  };
  const ctrl = createDropController({ sessionId: 'session-a', clientNonce: 'nonce-for-this-browser', request,
    capture: options.noCapture ? undefined : () => ({ start: position, end: position + (options.selectionLength ?? 0), draftRev: rev }),
    input: () => facade, valid: () => live, show: value => views.push(value), now: () => options.now ?? 1000,
  });
  return { ctrl, calls, views, inserted, edit: () => rev++, leave: () => { live = false; } };
}

test('native mention grammar preserves absolute paths and quotes whitespace', () => {
  assert.equal(formatMention('/a/b.txt'), '@/a/b.txt');
  assert.equal(formatMention(paths[0]), '@"/Users/test/中文 a.txt"');
  assert.equal(formatMention('/a/@x.txt'), '@/a/@x.txt');
  for (const bad of ['relative', '/', '/a/../b', '/a/./b', '/a/"b', '/a/\nb', '/a/\u0000b', '/a/\u0085b']) assert.throws(() => formatMention(bad));
});

test('drop preview performs no insertion; only trusted confirmation inserts native chips', async () => {
  const h = harness();
  await h.ctrl.drop(files);
  assert.equal(h.views.at(-1).phase, 'preview');
  assert.equal(h.inserted.length, 0);
  await h.ctrl.confirm(false);
  assert.equal(h.inserted.length, 0);
  await h.ctrl.confirm(true);
  assert.equal(h.inserted.length, 2);
  assert.equal(h.inserted[0].ref.source, 'reference');
  assert.equal(h.inserted[0].ref.ref, formatMention(paths[0]));
  assert.equal(h.inserted[1].ref.appearance, 'file');
  assert.equal(h.inserted[1].span.start, 7);
  assert.equal(h.views.at(-1).phase, 'done');
  await h.ctrl.confirm(true);
  assert.equal(h.inserted.length, 2);
});

test('drop preserves selected text instead of replacing it', async () => {
  const h = harness({ selectionLength: 10 });
  await h.ctrl.drop(files); await h.ctrl.confirm(true);
  assert.deepEqual(h.inserted[0].span, { start: 15, end: 15, draftRev: 3 });
});

test('changing draft before confirmation cancels without clobbering edits', async () => {
  const h = harness(); await h.ctrl.drop(files); h.edit(); await h.ctrl.confirm(true);
  assert.equal(h.inserted.length, 0);
  assert.equal(h.views.at(-1).code, 'DRAFT_CHANGED');
  assert.equal(h.calls.some(([name]) => name === 'confirm'), false);
});

test('Session switch invalidates the pending preview', async () => {
  const h = harness(); await h.ctrl.drop(files); h.leave(); await h.ctrl.confirm(true);
  assert.equal(h.inserted.length, 0); assert.equal(h.views.at(-1).code, 'SESSION_CHANGED');
});

test('expired preview is not submitted', async () => {
  const h = harness({ now: 61000 }); await h.ctrl.drop(files); await h.ctrl.confirm(true);
  assert.equal(h.inserted.length, 0); assert.equal(h.views.at(-1).code, 'EXPIRED');
});

test('busy or incompatible runtime fails before native request', async () => {
  for (const options of [{ phase: 'sending' }, { noCapture: true }]) {
    const h = harness(options); await h.ctrl.drop(files);
    assert.equal(h.calls.length, 0); assert.equal(h.views.at(-1).phase, 'error');
  }
});

test('cancelled resolve arriving late cannot insert or display stale paths', async () => {
  let finish;
  const h = harness({ request: operation => operation === 'resolve' ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({}) });
  const work = h.ctrl.drop(files); h.ctrl.cancel();
  finish({ ticket: 'late-ticket', expiresAt: 61000, paths }); await work;
  assert.equal(h.inserted.length, 0); assert.equal(h.views.at(-1).phase, 'idle');
  assert.equal(h.calls.at(-1)[0], 'cancel');
});

test('unmount aborts work and does not publish after disposal', async () => {
  let finish;
  const h = harness({ request: operation => operation === 'resolve' ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({}) });
  const work = h.ctrl.drop(files); h.ctrl.dispose(); const count = h.views.length;
  finish({ ticket: 'late-ticket', expiresAt: 61000, paths }); await work;
  assert.equal(h.views.length, count); assert.equal(h.inserted.length, 0);
  assert.equal(h.calls[0][2].aborted, true);
});

test('draft changes while confirmation is running are preserved', async () => {
  let finish;
  const h = harness({ request: operation => operation === 'resolve' ? Promise.resolve({ ticket: 'ticket', expiresAt: 61000, paths }) : operation === 'confirm' ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({}) });
  await h.ctrl.drop(files); const work = h.ctrl.confirm(true); h.edit(); finish({ paths }); await work;
  assert.equal(h.inserted.length, 0); assert.equal(h.views.at(-1).code, 'DRAFT_CHANGED');
});

test('server cannot substitute a different path after user confirmation', async () => {
  const h = harness({ request: operation => Promise.resolve(operation === 'resolve' ? { ticket: 'ticket', expiresAt: 61000, paths } : { paths: ['/other/a', '/other/b'] }) });
  await h.ctrl.drop(files); await h.ctrl.confirm(true);
  assert.equal(h.inserted.length, 0); assert.equal(h.views.at(-1).code, 'INVALID_RESPONSE');
});

test('partial chip insertion reports exact count and never retries', async () => {
  const h = harness({ rejectAt: 1 }); await h.ctrl.drop(files); await h.ctrl.confirm(true);
  assert.equal(h.views.at(-1).inserted, 1); assert.equal(h.views.at(-1).code, 'INSERT_REJECTED');
  await h.ctrl.confirm(true); assert.equal(h.inserted.length, 1);
});

test('file metadata extraction never reads bytes and rejects folders/empty batches', () => {
  const file = { ...files[0], arrayBuffer: () => assert.fail('must not read bytes'), text: () => assert.fail('must not read content') };
  assert.deepEqual(fileMetadata({ files: [file], items: [] }), [files[0]]);
  assert.throws(() => fileMetadata({ files: [file], items: [{ kind: 'file', webkitGetAsEntry: () => ({ isDirectory: true }) }] }), /DIRECTORY_UNSUPPORTED/);
  assert.throws(() => fileMetadata({ files: [] }), /INVALID_FILES/);
});

test('capture guard prevents upload even outside composer, on errors, and for synthetic drops', () => {
  const listeners = new Map(), errors = [], drops = [];
  const target = { addEventListener: (name, handler, capture) => { assert.equal(capture, true); listeners.set(name, handler); }, removeEventListener: name => listeners.delete(name) };
  const owner = { contains: node => node === 'composer', drop: value => drops.push(value), error: value => errors.push(value) };
  const dispose = installDropGuard(target, new Set([owner]), code => errors.push(code), transfer => transfer.activeOwnerToken === true);
  function event(overrides = {}) {
    return { type: 'drop', isTrusted: true, target: 'composer', dataTransfer: { types: ['Files'], files, items: [] }, stopped: false, prevented: false,
      preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...overrides };
  }
  const normal = event(); listeners.get('drop')(normal);
  assert.equal(normal.stopped, true); assert.equal(normal.prevented, true); assert.equal(drops.length, 1);
  const outside = event({ target: 'outside' }); listeners.get('drop')(outside);
  assert.equal(outside.stopped, true); assert.equal(errors.at(-1), 'DROP_IN_COMPOSER');
  const forged = event({ isTrusted: false }); listeners.get('drop')(forged);
  assert.equal(forged.stopped, true); assert.equal(errors.at(-1), 'UNTRUSTED_DROP');
  const forgedInternal = event({ dataTransfer: { types: ['Files', 'application/x-dsh-file'], files, items: [] } }); listeners.get('drop')(forgedInternal);
  assert.equal(forgedInternal.stopped, true);
  const internal = event({ dataTransfer: { types: ['Files', 'application/x-dsh-file'], activeOwnerToken: true } }); listeners.get('drop')(internal);
  assert.equal(internal.stopped, false);
  dispose(); assert.equal(listeners.size, 0);
});
