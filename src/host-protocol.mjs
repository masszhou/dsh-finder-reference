import { randomBytes } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { posix } from 'node:path';

const TTL_MS = 60_000;
const MAX_FILES = 32;
const MAX_TICKETS = 8;
const FORBIDDEN_TEXT = /[\p{Cc}\p{Cf}\p{Cs}"]/u;
const TOKEN = /^[a-f0-9]{48}$/;
const CODES = new Set([
  'INVALID_PAYLOAD', 'UNSUPPORTED_PLATFORM', 'DISPOSED', 'ABORTED',
  'BUSY', 'RATE_LIMITED', 'TICKET_LIMIT', 'SNAPSHOT_FAILED',
  'SNAPSHOT_INVALID', 'METADATA_MISMATCH', 'AMBIGUOUS_FILES',
  'FILE_UNAVAILABLE', 'UNSUPPORTED_FILE', 'INVALID_TICKET',
  'FILE_CHANGED', 'TOKEN_FAILURE', 'INTERNAL_ERROR',
]);

export class ProtocolError extends Error {
  constructor(code) {
    const safeCode = CODES.has(code) ? code : 'INTERNAL_ERROR';
    super(safeCode);
    this.name = 'ProtocolError';
    this.code = safeCode;
    // Even accidental stack serialization must not disclose host source paths.
    this.stack = `${this.name}: ${safeCode}`;
  }
}

function fail(code) { throw new ProtocolError(code); }
function integer(value) { return Number.isSafeInteger(value) && value >= 0; }

// Read descriptors instead of invoking untrusted getters. Copy all accepted data.
function record(value, keys, code = 'INVALID_PAYLOAD') {
  if (value === null || typeof value !== 'object') fail(code);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail(code);
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length || ownKeys.some(key => !keys.includes(key))) fail(code);
  const copy = Object.create(null);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) fail(code);
    copy[key] = descriptor.value;
  }
  return copy;
}

function list(value, code) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) fail(code);
  const length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
  if (!integer(length) || length < 1 || length > MAX_FILES) fail(code);
  if (Reflect.ownKeys(value).length !== length + 1) fail(code);
  const copy = [];
  for (let i = 0; i < length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) fail(code);
    copy.push(descriptor.value);
  }
  return copy;
}

function identity(value) {
  if (typeof value.sessionId !== 'string' || !value.sessionId.trim()
      || value.sessionId.length > 128 || FORBIDDEN_TEXT.test(value.sessionId)) fail('INVALID_PAYLOAD');
  if (typeof value.clientNonce !== 'string' || value.clientNonce.length < 16
      || value.clientNonce.length > 128 || !value.clientNonce.trim()
      || FORBIDDEN_TEXT.test(value.clientNonce)) fail('INVALID_PAYLOAD');
}

function resolveInput(payload) {
  const value = record(payload, ['sessionId', 'clientNonce', 'files']);
  identity(value);
  value.files = list(value.files, 'INVALID_PAYLOAD').map(file => {
    const item = record(file, ['name', 'size', 'lastModified']);
    if (typeof item.name !== 'string' || !item.name || item.name === '.' || item.name === '..'
        || /[/\\]/u.test(item.name) || FORBIDDEN_TEXT.test(item.name)
        || Buffer.byteLength(item.name) > 8192 || !integer(item.size)
        || !integer(item.lastModified)) fail('INVALID_PAYLOAD');
    return item;
  });
  const names = value.files.map(file => file.name.normalize('NFC'));
  if (new Set(names).size !== names.length) fail('AMBIGUOUS_FILES');
  return value;
}

function ticketInput(payload) {
  const value = record(payload, ['sessionId', 'clientNonce', 'ticket']);
  identity(value);
  if (typeof value.ticket !== 'string' || !TOKEN.test(value.ticket)) fail('INVALID_PAYLOAD');
  return value;
}

function snapshotPaths(input) {
  const value = record(input, ['protocolVersion', 'changeCount', 'paths'], 'SNAPSHOT_INVALID');
  if (value.protocolVersion !== 1 || !integer(value.changeCount)) fail('SNAPSHOT_INVALID');
  const paths = list(value.paths, 'SNAPSHOT_INVALID');
  for (const path of paths) {
    if (typeof path !== 'string' || !path.startsWith('/') || path === '/'
        || Buffer.byteLength(path) > 8192 || FORBIDDEN_TEXT.test(path) || path.includes('\\')
        || path.slice(1).split('/').some(part => !part || part === '.' || part === '..')) {
      fail('SNAPSHOT_INVALID');
    }
  }
  if (new Set(paths).size !== paths.length) fail('SNAPSHOT_INVALID');
  const names = paths.map(path => posix.basename(path).normalize('NFC'));
  if (new Set(names).size !== names.length) fail('AMBIGUOUS_FILES');
  return paths;
}

function fingerprint(info) {
  if (!info || typeof info.isSymbolicLink !== 'function' || typeof info.isFile !== 'function'
      || info.isSymbolicLink() || !info.isFile()) fail('UNSUPPORTED_FILE');
  const result = {};
  for (const key of ['dev', 'ino', 'size', 'mtimeNs']) {
    if (typeof info[key] !== 'bigint' || info[key] < 0n) fail('FILE_UNAVAILABLE');
    result[key] = info[key];
  }
  // Native BigIntStats also supplies these stronger mutation checks.
  for (const key of ['ctimeNs', 'mode', 'nlink']) {
    if (info[key] !== undefined) {
      if (typeof info[key] !== 'bigint') fail('FILE_UNAVAILABLE');
      result[key] = info[key];
    }
  }
  return result;
}

function sameFingerprint(a, b) {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => a[key] === b[key]);
}

/**
 * Metadata is only a consistency check, never proof of file identity.
 * The adapter MUST show ALL original paths and this warning before confirm.
 * Only the user's explicit approval of those paths authorizes native @ chips.
 * snapshot(signal) is the only drag-pasteboard dependency; stat(path, options)
 * must implement lstat semantics and return BigIntStats. Neither reads contents.
 * randomToken() must return exactly 48 lowercase hexadecimal characters.
 */
export function createProtocol({
  snapshot,
  stat = lstat,
  now = Date.now,
  randomToken = () => randomBytes(24).toString('hex'),
  platform = 'darwin',
} = {}) {
  if ([snapshot, stat, now, randomToken].some(fn => typeof fn !== 'function')) fail('INVALID_PAYLOAD');
  const tickets = new Map();
  // Retain collision/replay history only through the original ticket TTL.
  // This is time-bounded (~240 entries at 4/s), with no paths or session data.
  // After expiry, security relies on the default unpredictable 192-bit RNG.
  const issued = new Map();
  let snapshotTimes = [];
  let busy = false;
  let disposed = false;
  let lastTime = 0;
  const disposal = new AbortController();

  function clock() {
    const time = now();
    if (!integer(time) || time > Number.MAX_SAFE_INTEGER - TTL_MS) fail('INTERNAL_ERROR');
    lastTime = Math.max(lastTime, time);
    return lastTime;
  }
  function cleanup(time) {
    for (const [token, entry] of tickets) {
      if (entry.expiresAt <= time) tickets.delete(token);
    }
    for (const [token, expiresAt] of issued) {
      if (expiresAt <= time) issued.delete(token);
    }
    snapshotTimes = snapshotTimes.filter(start => time - start < 1000);
  }
  function active(signal) {
    if (disposed) fail('DISPOSED');
    if (platform !== 'darwin') fail('UNSUPPORTED_PLATFORM');
    if (signal?.aborted) fail('ABORTED');
  }
  function safe(error) {
    return error instanceof ProtocolError ? new ProtocolError(error.code) : new ProtocolError('INTERNAL_ERROR');
  }
  async function getFingerprint(path, signal) {
    active(signal);
    let info;
    try { info = await stat(path, { bigint: true }); }
    catch { active(signal); fail('FILE_UNAVAILABLE'); }
    active(signal);
    try { return fingerprint(info); }
    catch (error) {
      if (error instanceof ProtocolError) throw error;
      fail('FILE_UNAVAILABLE');
    }
  }
  // Return promptly on abort/dispose, but keep the resolve lock until the real
  // underlying helper settles. Ignoring cancellation must not permit overlap.
  function interruptible(work, signal) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const onAbort = () => finish(new ProtocolError('ABORTED'));
      const onDispose = () => finish(new ProtocolError('DISPOSED'));
      function finish(error, value) {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', onAbort);
        disposal.signal.removeEventListener('abort', onDispose);
        if (error) reject(error); else resolve(value);
      }
      signal?.addEventListener('abort', onAbort, { once: true });
      disposal.signal.addEventListener('abort', onDispose, { once: true });
      work.then(value => finish(null, value), error => finish(safe(error)));
      if (disposed) onDispose();
      else if (signal?.aborted) onAbort();
    });
  }

  async function resolve(payload, signal) {
    let mintedTicket;
    try {
      const input = resolveInput(payload);
      active(signal);
      const time = clock();
      cleanup(time);
      if (busy) fail('BUSY');
      if (tickets.size >= MAX_TICKETS) fail('TICKET_LIMIT');
      if (snapshotTimes.length >= 4) fail('RATE_LIMITED');
      busy = true;
      snapshotTimes.push(time);
      const work = (async () => {
        try {
          let raw;
          try { raw = await snapshot(signal); }
          catch { active(signal); fail('SNAPSHOT_FAILED'); }
          active(signal);
          const paths = snapshotPaths(raw);
          if (paths.length !== input.files.length) fail('METADATA_MISMATCH');
          const byName = new Map(paths.map(path => [posix.basename(path).normalize('NFC'), path]));
          const ordered = input.files.map(file => byName.get(file.name.normalize('NFC')));
          if (ordered.some(path => path === undefined)) fail('METADATA_MISMATCH');
          const fingerprints = [];
          for (let i = 0; i < ordered.length; i++) {
            const fp = await getFingerprint(ordered[i], signal);
            const file = input.files[i];
            const difference = fp.mtimeNs / 1_000_000n - BigInt(file.lastModified);
            if (fp.size !== BigInt(file.size) || difference < -1n || difference > 1n) fail('METADATA_MISMATCH');
            fingerprints.push(fp);
          }
          active(signal);
          let ticket;
          try { ticket = randomToken(); }
          catch { fail('TOKEN_FAILURE'); }
          const issuedAt = clock();
          cleanup(issuedAt);
          if (typeof ticket !== 'string' || !TOKEN.test(ticket) || issued.has(ticket)) fail('TOKEN_FAILURE');
          const expiresAt = issuedAt + TTL_MS;
          active(signal);
          issued.set(ticket, expiresAt);
          mintedTicket = ticket;
          tickets.set(ticket, {
            sessionId: input.sessionId, clientNonce: input.clientNonce,
            paths: ordered, fingerprints, expiresAt,
          });
          return { ticket, expiresAt, paths: [...ordered] };
        } finally { busy = false; }
      })();
      const result = await interruptible(work, signal);
      active(signal);
      return result;
    } catch (error) {
      if (mintedTicket !== undefined) tickets.delete(mintedTicket);
      throw safe(error);
    }
  }

  async function confirm(payload, signal) {
    try {
      const input = ticketInput(payload);
      const entry = tickets.get(input.ticket);
      // Consume before identity, expiry, platform and signal checks.
      tickets.delete(input.ticket);
      active(signal);
      const time = clock();
      cleanup(time);
      if (!entry || entry.expiresAt <= time || entry.sessionId !== input.sessionId
          || entry.clientNonce !== input.clientNonce) fail('INVALID_TICKET');
      const work = (async () => {
        for (let i = 0; i < entry.paths.length; i++) {
          const fp = await getFingerprint(entry.paths[i], signal);
          if (!sameFingerprint(fp, entry.fingerprints[i])) fail('FILE_CHANGED');
        }
        active(signal);
        if (entry.expiresAt <= clock()) fail('INVALID_TICKET');
        return { paths: [...entry.paths] };
      })();
      const result = await interruptible(work, signal);
      active(signal);
      return result;
    } catch (error) { throw safe(error); }
  }

  function cancel(payload) {
    try {
      const input = ticketInput(payload);
      active();
      cleanup(clock());
      const entry = tickets.get(input.ticket);
      if (!entry || entry.sessionId !== input.sessionId || entry.clientNonce !== input.clientNonce) fail('INVALID_TICKET');
      tickets.delete(input.ticket);
      return { cancelled: true };
    } catch (error) { throw safe(error); }
  }

  function dispose() {
    disposed = true;
    tickets.clear();
    issued.clear();
    snapshotTimes = [];
    disposal.abort();
  }

  return { resolve, confirm, cancel, dispose };
}
