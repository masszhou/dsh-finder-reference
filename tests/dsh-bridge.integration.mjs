// Exercise the actual checkout bridge. Authentication and native access are not
// under test: no server, browser profile, file content, or pasteboard is accessed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { bridge } from '/Users/zhiliangzhou/devel/deepseek-harness/packages/client/connection/src/http-bridge.ts';
import { isTrustedApiRequest } from '/Users/zhiliangzhou/devel/deepseek-harness/packages/client/connection/src/api-request-trust.ts';
import { createRoutes } from '../src/host-adapter.mjs';

test('real DSH Node HTTP bridge reaches local resolve without reading the pasteboard', async () => {
  let calls = 0;
  const routes = createRoutes({resolve: async () => { calls++; return { fixture: true }; }}, {remoteAllowed: false});
  const req = Readable.from([Buffer.from('{}')]);
  req.url = '/api/finder-reference/resolve';
  req.method = 'POST';
  req.headers = {host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json'};
  assert.equal(isTrustedApiRequest(req, [], '127.0.0.1'), true);
  const res = new EventEmitter();
  const chunks = [];
  res.destroyed = false;
  res.writableEnded = false;
  res.writeHead = status => { res.status = status; };
  res.write = chunk => { chunks.push(Buffer.from(chunk)); return true; };
  res.end = () => { res.writableEnded = true; };
  await bridge(req, res, {
    requestBodyMode: () => 'buffered',
    fetch: request => {
      assert.equal(new URL(request.url).origin, 'http://dsh.internal');
      return routes[1].fetch(request);
    },
  }, {});
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString()), {fixture: true});
  assert.equal(calls, 1);
});
