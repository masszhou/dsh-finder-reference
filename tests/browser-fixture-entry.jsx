import React from 'react';
import { createRoot } from 'react-dom/client';
import inputCss from '/Users/zhiliangzhou/devel/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/InputBar.module.css';
import columnCss from '/Users/zhiliangzhou/devel/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/ConversationRoot.module.css';
import goalCss from '/Users/zhiliangzhou/devel/deepseek-harness/packages/client/ui-goal/src/client/GoalBar.module.css';

import chatCss from '/Users/zhiliangzhou/devel/deepseek-harness/packages/client/ui-chat/src/client/chat/ChatView.module.css';

// Reuse production width rules; the reading column is narrower than the card.
const column = document.getElementById('fixture-session');
column.className = columnCss.body;
document.getElementById('fixture-transcript').className = chatCss.scroll;
column.querySelector('[data-reading-column]').className = chatCss.column;
document.getElementById('fixture-input-bar').className = inputCss.root;
column.querySelector('[data-composer-card]').className = inputCss.card;
column.querySelector('[data-composer-dock]').className = inputCss.dock;
document.getElementById('fixture-goal').className = goalCss.dock;
column.querySelector('[data-goal]').className = goalCss.bar;
const objective = document.createElement('span');
objective.dataset.goalObjective = '';
objective.className = goalCss.objective;
objective.textContent = 'Goal objective (fixture)';
column.querySelector('[data-goal]').replaceChildren(objective);
const widthObserver = new ResizeObserver(() => column.style.setProperty('--dsh-conversation-column-width', `${column.clientWidth}px`));
widthObserver.observe(column);
column.style.setProperty('--dsh-conversation-column-width', `${column.clientWidth}px`);
window.fixtureLayout = { embedded(enabled) { column.classList.toggle(columnCss.embeddedBody, enabled); } };

const language = new URLSearchParams(location.search).get('lang') === 'en' ? 'en' : 'zh';
const effects = [];
let registration;
const listeners = new Map();
let state = { draftRev: 1, phase: 'plain' };
let caret = 0;
const binding = { ctx: {} };
const inserted = [];
window.fixture = { inserted, nativeUploadDrops: 0, notices: [], applyError: null };
const input = {
  state: { getSnapshot: () => state },
  insertReference(ref, span) {
    if (span.draftRev !== state.draftRev) return false;
    inserted.push({ ref, span }); state = { ...state, draftRev: state.draftRev + 1 }; caret += 2;
    const chip = document.createElement('span'); chip.dataset.fixtureChip = ''; chip.textContent = ref.label;
    document.querySelector('[contenteditable]').append(chip, document.createTextNode(' '));
    return true;
  },
  focus() { document.querySelector('[contenteditable]').focus(); },
};
const inputActions = { captureInsertion: () => ({ start: caret, end: caret, draftRev: state.draftRev }) };
const services = {
  locale: { register(ns, values) { listeners.set(ns, values[language]); return () => listeners.delete(ns); }, bind(ns) { return key => listeners.get(ns)?.[key] ?? key; } },
  sessions: { binding: () => binding },
  conversation: { input: { for: () => input } },
  fileDrag: { read: () => undefined },
  slots: {
    inject(name, fn) { fn(); },
    register(spec, Component) { registration = {spec, Component}; return () => {}; },
  },
};
const ctx = { get: name => services[name], effect: fn => { const dispose=fn(); if (dispose) effects.push(dispose); } };
window.__ModuleLoader__ = { load({factory}) {
  try {
    const plugin = factory(id => { if (id==='react') return React; throw new Error(id); });
    plugin.apply(ctx);
    const {spec,Component} = registration;
    if (spec.name !== 'conversation.input.dock' || spec.order !== 20) throw new Error('Expected full-width dock after Goal.');
    createRoot(document.getElementById('fixture-dock')).render(<Component {...spec.inject('fixture-session')} inputActions={inputActions} t={services.locale.bind('finder-reference')} />);
  } catch(error) { window.fixture.applyError=String(error.stack); }
}};
document.addEventListener('drop', event => { if (event.dataTransfer?.types.includes('Files')) window.fixture.nativeUploadDrops++; });
window.fixture.edit = () => { state = {...state, draftRev:state.draftRev+1}; };
window.fixture.dispose = () => { effects.reverse().forEach(fn => fn()); };
