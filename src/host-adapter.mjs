import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const executable = fileURLToPath(new URL('../bin/drag-snapshot', import.meta.url));
const PREFIX = '/api/finder-reference/';
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

function localAuthority(request, url) {
  // DSH's authenticated HTTP bridge uses this fixed internal URL and preserves
  // the original Host header. Never treat the placeholder as a public authority,
  // and never use Forwarded/X-Forwarded-* to authorize native access.
  const bridged = url.origin === 'http://dsh.internal';
  if (!bridged && (!['http:', 'https:'].includes(url.protocol) || !LOOPBACK.has(url.hostname))) return null;
  const host = request.headers.get('host') ?? (bridged ? '' : url.host);
  if (!/^(?:127\.0\.0\.1|localhost|\[::1\])(?::[0-9]{1,5})?$/.test(host)) return null;
  try {
    const publicUrl = new URL(`${bridged ? 'http:' : url.protocol}//${host}`);
    if (!bridged && publicUrl.origin !== url.origin) return null;
    return host;
  } catch { return null; }
}

function sameOrigin(request, url, authority) {
  try {
    const value = request.headers.get('origin');
    const origin = new URL(value);
    if (!['http:', 'https:'].includes(origin.protocol) || value !== origin.origin) return false;
    if (new URL(`${origin.protocol}//${authority}`).origin !== origin.origin) return false;
    // For bridged requests DSH has already validated the HTTP(S) Host/Origin
    // pair before authentication and route dispatch.
    return url.origin === 'http://dsh.internal' || origin.origin === url.origin;
  } catch { return false; }
}

export async function nativeSnapshot(signal) {
  const result = await exec(executable, ['snapshot'], {
    timeout: 3000, maxBuffer: 512 * 1024, encoding: 'utf8', signal,
    windowsHide: true, shell: false,
  });
  return JSON.parse(result.stdout);
}

export async function nativeAvailable() {
  if (process.platform !== 'darwin') return false;
  try { await access(executable, constants.X_OK); return true; } catch { return false; }
}

function response(status, value) {
  return new Response(JSON.stringify(value), {
    status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}

async function readJson(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) throw new Error('INVALID_REQUEST');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('INVALID_REQUEST');
  const chunks = []; let total = 0;
  try {
    for (;;) {
      request.signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 65536) throw new Error('INVALID_REQUEST');
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export function createRoutes(protocol, { remoteAllowed = false, available = nativeAvailable } = {}) {
  const build = (name, methods) => ({
    path: PREFIX + name, methods, requestBody: 'buffered',
    async fetch(request) {
      // DSH Connection admits only authenticated owner Peers before this route.
      // Keep the native capability restricted to a local, same-origin browser.
      const url = new URL(request.url);
      const authority = localAuthority(request, url);
      if (remoteAllowed || authority === null) return response(403, { error: 'LOCAL_ONLY' });
      if (!methods.includes(request.method) || url.pathname !== PREFIX + name || url.search) return response(400, { error: 'INVALID_REQUEST' });
      if (name === 'status') return response(200, { version: '0.1.0', nativeAvailable: await available(), mode: 'original-reference-confirmation' });
      if (!sameOrigin(request, url, authority) || request.headers.get('sec-fetch-site') !== 'same-origin') return response(403, { error: 'ORIGIN_REJECTED' });
      try {
        const payload = await readJson(request);
        request.signal.throwIfAborted();
        const result = await protocol[name](payload, request.signal);
        return response(200, result);
      } catch (error) {
        // Protocol codes are public identifiers; never return subprocess stderr,
        // filesystem errors, or a snapshot that did not match the browser batch.
        const code = typeof error?.code === 'string' && /^[A-Z_]{2,48}$/.test(error.code) ? error.code : 'REQUEST_FAILED';
        return response(400, { error: code });
      }
    },
  });
  return [build('status', ['GET']), ...['resolve', 'confirm', 'cancel'].map(name => build(name, ['POST']))];
}
