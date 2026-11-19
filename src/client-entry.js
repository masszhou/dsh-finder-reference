// Built inside the DSH module factory; React is a platform external.
const h = React.createElement;
const NS = 'finder-reference';
const zh = {
  badge: 'Finder 原文件引用 · 不上传', resolving: '正在核对原文件路径…',
  preview: '确认 Finder 原文件', warning: '仅限浏览器与 DSH 在同一台 Mac。请核对下面每个完整路径。文件名、大小和修改时间只能检查一致性，不能证明它就是你拖动的原文件。',
  confirm: '确认这些原文件并引用', cancel: '取消', confirming: '正在确认…',
  error: '未完成引用；没有上传文件。',
  partial: '已插入的引用数量：', retry: '请检查后重新拖入。',
  DROP_IN_COMPOSER: '请先打开 Session，再把 Finder 文件拖入输入框。',
  INCOMPATIBLE_RUNTIME: '当前 DSH 缺少所需的公开输入接口。',
  DRAFT_CHANGED: '草稿已变化。插件保留了你的修改，请重新拖入。',
  INPUT_BUSY: '输入框正在提交，请等待后重新拖入。',
  SESSION_CHANGED: 'Session 已变化。请在目标 Session 重新拖入。',
  DIRECTORY_UNSUPPORTED: '此版本只支持普通文件，不支持文件夹。',
  EXPIRED: '路径确认已过期，请重新拖入。',
  INVALID_FILES: '一次请拖入 1–32 个普通文件。',
  UNTRUSTED_DROP: '插件拒绝合成拖拽事件。',
  STATUS_FAILED: '原路径服务不可用。插件已阻止拖拽上传。',
};
const en = {
  badge: 'Finder original references · no uploads', resolving: 'Checking original file paths…',
  preview: 'Confirm Finder originals', warning: 'Use only when this browser and DSH run on the same Mac. Check every full path below. Names, sizes and modification times check consistency, not the identity of the file you dragged.',
  confirm: 'Confirm and reference these originals', cancel: 'Cancel', confirming: 'Confirming…',
  error: 'Reference not completed. No files uploaded.',
  partial: 'References already inserted:', retry: 'Check the files and drag them again.',
  DROP_IN_COMPOSER: 'Open a Session and drop Finder files into its composer.',
  INCOMPATIBLE_RUNTIME: 'This DSH runtime lacks the required public input API.',
  DRAFT_CHANGED: 'The draft changed. Your edits are preserved; drag the files again.',
  INPUT_BUSY: 'The composer is submitting. Try again after it finishes.',
  SESSION_CHANGED: 'The Session changed. Drop into the intended Session again.',
  DIRECTORY_UNSUPPORTED: 'This version supports regular files, not folders.',
  EXPIRED: 'Confirmation expired. Drag the files again.',
  INVALID_FILES: 'Drop between 1 and 32 regular files.',
  UNTRUSTED_DROP: 'Synthetic drop events are rejected.',
  STATUS_FAILED: 'The original-path service is unavailable. Drop uploads are blocked.',
};

const panelStyle = {
  color: 'var(--dsw-alias-label-primary, inherit)',
  background: 'var(--dsw-alias-surface-2, Canvas)',
  border: '1px solid var(--dsw-alias-border-default, currentColor)',
  borderRadius: 10, padding: 12, marginBlock: 8, fontSize: 13,
  maxWidth: '100%', boxSizing: 'border-box', overflowWrap: 'anywhere', textAlign: 'start',
};
const buttonStyle = { font: 'inherit', padding: '5px 10px', marginInlineEnd: 8, cursor: 'pointer' };

function FinderDock(props) {
  const anchor = React.useRef(null);
  const controller = React.useRef(null);
  const [view, setView] = React.useState({ phase: 'idle' });
  React.useEffect(() => {
    controller.current = props.attach(anchor.current, props.inputActions, setView);
    return () => { controller.current?.dispose(); controller.current = null; };
  }, [props.attach, props.inputActions]);
  const t = props.t;
  const children = [h('span', { key: 'badge', style: { opacity: 0.8 } }, t('badge'))];
  if (view.phase === 'resolving') children.push(h('div', { key: 'busy', role: 'status' }, t('resolving')));
  if (view.phase === 'preview' || view.phase === 'confirming') {
    children.push(h('section', { key: 'preview', style: panelStyle, 'aria-label': t('preview'), 'data-finder-preview': '' },
      h('strong', null, t('preview')),
      h('p', null, t('warning')),
      h('ul', null, view.paths.map(path => h('li', { key: path, style: { userSelect: 'text', whiteSpace: 'pre-wrap' } }, path))),
      h('button', { type: 'button', style: buttonStyle, disabled: view.phase === 'confirming', onClick: event => void controller.current?.confirm(event.nativeEvent.isTrusted) }, t(view.phase === 'confirming' ? 'confirming' : 'confirm')),
      h('button', { type: 'button', style: buttonStyle, onClick: () => controller.current?.cancel() }, t('cancel')),
    ));
  }
  if (view.phase === 'error') children.push(h('div', { key: 'error', role: 'alert', style: panelStyle },
    h('div', null, t('error')),
    h('div', null, Object.hasOwn(zh, view.code) ? t(view.code) : `${t('retry')} (${String(view.code).replace(/[^A-Z_]/g, '').slice(0, 48)})`),
    view.inserted ? h('div', null, `${t('partial')} ${view.inserted}`) : null,
  ));
  // Mirror ChatView's scroll padding and reading-column cap, not InputBar.
  // Keep both layers so percentage caps resolve in the same content box.
  return h('div', { 'data-finder-row': '', style: {
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    width: '100%', minWidth: 0, boxSizing: 'border-box',
    paddingInline: 'calc(var(--dsh-composer-side-clearance, 16px) + 16px)',
  } }, h('div', { ref: anchor, 'data-finder-reference': '', style: {
    width: '100%', maxWidth: 'var(--dsh-chat-content-width, 100%)',
    minWidth: 0, boxSizing: 'border-box',
    // Match GoalBar's objective text for every state and inherited control.
    fontSize: 13, lineHeight: '20px', fontFamily: 'inherit',
  } }, ...children));
}

export const inject = ['slots', 'sessions', 'conversation', 'locale', 'fileDrag'];
export function apply(ctx) {
  const slots = ctx.get('slots');
  const sessions = ctx.get('sessions');
  const conversation = ctx.get('conversation');
  const locale = ctx.get('locale');
  const targets = new Set();
  const clientNonce = crypto.randomUUID();
  ctx.effect(() => locale.register(NS, { zh, en }), 'finder-reference: locales');
  const t = locale.bind(NS);
  const request = async (operation, payload, signal) => {
    const abort = signal ? AbortSignal.any([signal, AbortSignal.timeout(6000)]) : AbortSignal.timeout(6000);
    const response = await fetch(`/api/finder-reference/${operation}`, {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), signal: abort,
    });
    const result = await response.json();
    if (!response.ok || result.error) { const error = new Error('REQUEST_FAILED'); error.code = result.error ?? 'REQUEST_FAILED'; throw error; }
    return result;
  };
  // The guard remains installed even if the native helper or composer API is unavailable.
  ctx.effect(() => installDropGuard(window, targets, code => {
    if (targets.size) for (const target of targets) target.error(code);
    else window.alert(t('DROP_IN_COMPOSER'));
  }, transfer => ctx.get('fileDrag').read(transfer) !== undefined), 'finder-reference: no-upload guard');
  // Full-width composer rows: Goal uses order 10; keep our panel below it.
  slots.inject('conversation.input.dock', () => slots.register({
    name: 'conversation.input.dock', id: NS, order: 20, locale: NS,
    inject: sessionId => ({
      attach: (node, actions, show) => {
        const binding = sessions.binding(sessionId);
        // The upper dock and InputBar share this Session's stable composer seat.
        // Refuse an ambiguous seat instead of targeting another editor.
        const seat = node?.closest('[data-conversation-region="composer"]');
        const cards = seat?.querySelectorAll('[data-composer-card]');
        const card = cards?.length === 1 ? cards[0] : undefined;
        const controller = createDropController({
          sessionId, clientNonce, show, request,
          capture: typeof actions?.captureInsertion === 'function' ? () => actions.captureInsertion() : undefined,
          input: () => conversation.input.for(binding.ctx),
          valid: () => !!binding && sessions.binding(sessionId) === binding && !!card?.isConnected && !!node?.isConnected,
        });
        const owner = {
          contains: target => !!card?.contains(target),
          drop: files => { void controller.drop(files).catch(() => controller.error('RESOLVE_FAILED')); },
          error: controller.error,
        };
        targets.add(owner);
        if (!card || typeof actions?.captureInsertion !== 'function') controller.error('INCOMPATIBLE_RUNTIME');
        return { ...controller, dispose: () => { targets.delete(owner); controller.dispose(); } };
      },
    }),
  }, FinderDock));
}
