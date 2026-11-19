import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoutes } from '../src/host-adapter.mjs';

function setup(options = {}) {
  const calls = [];
  const protocol = Object.fromEntries(['resolve', 'confirm', 'cancel'].map(name => [name, async (...args) => {
    calls.push([name, ...args]);
    if (options.failure) throw options.failure;
    return { ok: true };
  }]));
  return { calls, routes: createRoutes(protocol, { available: async () => true, ...options }) };
}
function request(operation = 'resolve', options = {}) {
  return new Request(`http://127.0.0.1:3080/api/finder-reference/${operation}`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:3080', 'sec-fetch-site': 'same-origin', ...options.headers },
    body: options.body ?? '{}',
  });
}

test('only exact authenticated Fetch routes are declared', () => {
  const { routes } = setup();
  assert.deepEqual(routes.map(route => route.path), ['status', 'resolve', 'confirm', 'cancel'].map(name => `/api/finder-reference/${name}`));
  assert.equal(routes.every(route => route.requestBody === 'buffered'), true);
});

test('DSH bridge internal URL uses the preserved local Host and Origin', async () => {
  const { routes, calls } = setup();
  const req = new Request('http://dsh.internal/api/finder-reference/resolve', {
    method: 'POST', headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' }, body: '{}',
  });
  const response = await routes[1].fetch(req);
  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
});

test('bridged requests retain the local authority and origin fences', async () => {
  const { routes, calls } = setup();
  const base = { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' };
  const rejected = [
    { host: '' }, { host: 'evil.invalid:3080' }, { host: '127.0.0.1.evil.invalid' },
    { host: '127.1:3080' }, { host: '127.0.0.1:99999' }, { host: 'localhost@evil.invalid' },
    { host: '127.0.0.1:3080/path' }, { host: '127.0.0.1:3080,evil.invalid' },
    { origin: 'http://127.0.0.1:3081' }, { origin: 'http://localhost:3080' },
    { origin: 'http://127.0.0.1:3080/path' }, { origin: 'http://user@127.0.0.1:3080' },
    { origin: '' }, { origin: 'null' }, { origin: 'ftp://127.0.0.1:3080' },
    { 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': '' },
    { host: 'evil.invalid', 'x-forwarded-host': '127.0.0.1:3080' },
  ];
  for (const change of rejected) {
    const req = new Request('http://dsh.internal/api/finder-reference/resolve', { method: 'POST', headers: { ...base, ...change }, body: '{}' });
    assert.equal((await routes[1].fetch(req)).status, 403, JSON.stringify(change));
  }
  assert.equal(calls.length, 0);
  for (const host of ['localhost:3080', '[::1]:3080', '127.0.0.1:80']) {
    const origin = new URL(`http://${host}`).origin;
    const req = new Request('http://dsh.internal/api/finder-reference/resolve', { method: 'POST', headers: { ...base, host, origin }, body: '{}' });
    assert.equal((await routes[1].fetch(req)).status, 200);
  }
});

test('bridge placeholder alone and remote-enabled bridge never authorize native work', async () => {
  for (const options of [{}, { remoteAllowed: true }]) {
    const { routes, calls } = setup(options);
    const headers = options.remoteAllowed ? {host: '127.0.0.1:3080'} : {'x-forwarded-host': '127.0.0.1:3080'};
    const req = new Request('http://dsh.internal/api/finder-reference/resolve', { method: 'POST', headers: {...headers, origin: 'http://127.0.0.1:3080', 'sec-fetch-site': 'same-origin'}, body: '{}' });
    assert.equal((await routes[1].fetch(req)).status, 403);
    assert.equal(calls.length, 0);
  }
});

test('same-origin request reaches only its fixed operation', async () => {
  const { routes, calls } = setup();
  const response = await routes[1].fetch(request());
  assert.equal(response.status, 200); assert.equal(calls[0][0], 'resolve');
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('reject cross origin, absent origin, cross site and untrusted host before native work', async () => {
  const { routes, calls } = setup();
  for (const headers of [ { origin: 'https://evil.invalid' }, { origin: 'null' }, { origin: '' }, { 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': '' } ]) {
    assert.equal((await routes[1].fetch(request('resolve', { headers }))).status, 403);
  }
  const untrusted = new Request('http://evil.invalid/api/finder-reference/resolve', { method: 'POST', body: '{}' });
  assert.equal((await routes[1].fetch(untrusted)).status, 403);
  assert.equal(calls.length, 0);
});

test('remote-enabled deployments cannot read this Mac drag board', async () => {
  const { routes, calls } = setup({ remoteAllowed: true });
  assert.equal((await routes[1].fetch(request())).status, 403); assert.equal(calls.length, 0);
});

test('status never reads clipboard and does not disclose filesystem paths', async () => {
  const { routes, calls } = setup();
  const response = await routes[0].fetch(new Request('http://127.0.0.1:3080/api/finder-reference/status'));
  assert.deepEqual(await response.json(), { version: '0.1.0', nativeAvailable: true, mode: 'original-reference-confirmation' });
  assert.equal(calls.length, 0);
});

test('reject content-type, malformed JSON and oversized body before protocol', async () => {
  const { routes, calls } = setup();
  for (const options of [{ headers: { 'content-type': 'text/plain' } }, { body: '{bad' }, { body: JSON.stringify('x'.repeat(65536)) }]) {
    assert.equal((await routes[1].fetch(request('resolve', options))).status, 400);
  }
  assert.equal(calls.length, 0);
});

test('native and filesystem errors never disclose paths or stderr', async () => {
  const failure = new Error('secret path /Users/private and stderr');
  const { routes } = setup({ failure });
  assert.deepEqual(await (await routes[1].fetch(request())).json(), { error: 'REQUEST_FAILED' });
  failure.code = 'FILE_CHANGED';
  assert.deepEqual(await (await routes[1].fetch(request())).json(), { error: 'FILE_CHANGED' });
});

test('reject incorrect path, method and query string', async () => {
  const { routes, calls } = setup();
  for (const url of ['http://127.0.0.1:3080/api/finder-reference/confirm', 'http://127.0.0.1:3080/api/finder-reference/resolve?path=/etc/passwd']) {
    assert.equal((await routes[1].fetch(new Request(url, { method: 'POST', body: '{}' }))).status, 400);
  }
  assert.equal((await routes[1].fetch(new Request('http://127.0.0.1:3080/api/finder-reference/resolve'))).status, 400);
  assert.equal(calls.length, 0);
});
