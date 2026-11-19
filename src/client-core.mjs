// Browser-only core. No file contents, upload APIs, or private editor access.
export function formatMention(path) {
  if (typeof path !== 'string' || !path.startsWith('/') || path === '/' ||
      path.length > 8192 || /["\u0000-\u001f\u007f-\u009f]/u.test(path) ||
      path.split('/').some(part => part === '.' || part === '..')) throw new Error('INVALID_PATH');
  return /\s/u.test(path) ? `@"${path}"` : `@${path}`;
}

export function fileMetadata(transfer) {
  const items = Array.from(transfer?.items ?? []).filter(item => item.kind === 'file');
  if (items.some(item => item.webkitGetAsEntry?.()?.isDirectory === true)) throw new Error('DIRECTORY_UNSUPPORTED');
  const files = Array.from(transfer?.files ?? []);
  if (!files.length || files.length > 32) throw new Error('INVALID_FILES');
  return files.map(file => ({ name: file.name, size: file.size, lastModified: file.lastModified }));
}

export function isExternalFileDrag(event, isInternal = () => false) {
  const types = Array.from(event.dataTransfer?.types ?? []);
  if (!types.includes('Files')) return false;
  // A MIME label alone is forgeable; only the active DSH transfer owner can exempt it.
  try { return !isInternal(event.dataTransfer); } catch { return true; }
}

// Install before the native document-bubble uploader; failures remain closed.
export function installDropGuard(target, targets, report, isInternal) {
  const dispatch = event => {
    if (!isExternalFileDrag(event, isInternal)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const owners = [...targets].filter(owner => owner.contains(event.target));
    const owner = owners.length === 1 ? owners[0] : undefined;
    if (event.type === 'dragover' && event.dataTransfer) event.dataTransfer.dropEffect = owner ? 'link' : 'none';
    if (event.type !== 'drop') return;
    if (!event.isTrusted) { report('UNTRUSTED_DROP'); return; }
    if (!owner) { report('DROP_IN_COMPOSER'); return; }
    try { owner.drop(fileMetadata(event.dataTransfer)); }
    catch (error) { owner.error(error?.message ?? 'INVALID_FILES'); }
  };
  const names = ['dragenter', 'dragover', 'dragleave', 'drop'];
  names.forEach(name => target.addEventListener(name, dispatch, true));
  return () => names.forEach(name => target.removeEventListener(name, dispatch, true));
}

export function createDropController({ sessionId, clientNonce, capture, input, valid, request, show, now = Date.now }) {
  let disposed = false;
  let pending;
  let active;
  let sequence = 0;
  const publish = view => { if (!disposed) show(view); };
  const cancelTicket = candidate => {
    if (candidate?.ticket) void request('cancel', { sessionId, clientNonce, ticket: candidate.ticket }).catch(() => {});
  };
  function cancel() {
    sequence++;
    active?.abort(); active = undefined;
    cancelTicket(pending); pending = undefined;
    publish({ phase: 'idle' });
  }
  function error(code) { publish({ phase: 'error', code }); }
  async function drop(files) {
    if (disposed) return;
    cancel();
    if (!valid()) { error('SESSION_CHANGED'); return; }
    if (typeof capture !== 'function') { error('INCOMPATIBLE_RUNTIME'); return; }
    const span = capture();
    const state = input().state.getSnapshot();
    if (!['plain', 'claimed'].includes(state.phase)) { error('INPUT_BUSY'); return; }
    if (!span || !Number.isSafeInteger(span.start) || !Number.isSafeInteger(span.end) || span.start < 0 || span.end < span.start || span.draftRev !== state.draftRev) {
      error('INCOMPATIBLE_RUNTIME'); return;
    }
    // Never replace a user's selected draft text merely because they dropped files.
    const insertion = { start: span.end, end: span.end, draftRev: span.draftRev };
    const serial = sequence;
    const abort = new AbortController(); active = abort;
    publish({ phase: 'resolving' });
    try {
      const result = await request('resolve', { sessionId, clientNonce, files }, abort.signal);
      if (disposed || serial !== sequence || !valid()) { cancelTicket(result); return; }
      if (!result || typeof result.ticket !== 'string' || !Number.isFinite(result.expiresAt) || !Array.isArray(result.paths) || result.paths.length !== files.length) {
        cancelTicket(result); throw new Error('INVALID_RESPONSE');
      }
      result.paths.forEach(formatMention);
      pending = { ...result, span: insertion };
      publish({ phase: 'preview', paths: result.paths, expiresAt: result.expiresAt });
    } catch (cause) {
      if (serial === sequence && !disposed) error(cause?.code ?? cause?.message ?? 'RESOLVE_FAILED');
    } finally { if (active === abort) active = undefined; }
  }
  async function confirm(trusted) {
    if (disposed || !pending || active || trusted !== true) return;
    const candidate = pending;
    if (!valid()) { cancel(); error('SESSION_CHANGED'); return; }
    if (now() >= candidate.expiresAt) { cancel(); error('EXPIRED'); return; }
    if (input().state.getSnapshot().draftRev !== candidate.span.draftRev) { cancel(); error('DRAFT_CHANGED'); return; }
    const serial = sequence;
    const abort = new AbortController(); active = abort;
    publish({ phase: 'confirming', paths: candidate.paths });
    let inserted = 0;
    try {
      const result = await request('confirm', { sessionId, clientNonce, ticket: candidate.ticket }, abort.signal);
      if (disposed || serial !== sequence || !valid()) return;
      pending = undefined;
      if (!Array.isArray(result?.paths) || result.paths.length !== candidate.paths.length || result.paths.some((path, i) => path !== candidate.paths[i])) throw new Error('INVALID_RESPONSE');
      const facade = input();
      if (facade.state.getSnapshot().draftRev !== candidate.span.draftRev) throw new Error('DRAFT_CHANGED');
      let span = candidate.span;
      for (const path of result.paths) {
        const mention = formatMention(path);
        if (!facade.insertReference({ source: 'reference', ref: mention, label: path.split('/').at(-1), appearance: 'file', clipboardText: mention }, span)) throw new Error('INSERT_REJECTED');
        inserted++;
        span = capture();
      }
      publish({ phase: 'done', count: inserted });
      facade.focus();
    } catch (cause) {
      if (!disposed && serial === sequence) {
        cancelTicket(candidate); pending = undefined;
        publish({ phase: 'error', code: cause?.code ?? cause?.message ?? 'CONFIRM_FAILED', inserted });
      }
    } finally { if (active === abort) active = undefined; }
  }
  return {
    drop, confirm, cancel, error,
    dispose() { cancel(); disposed = true; },
  };
}
