// This fixture uses the real Cordis lifecycle and SlotRegistry, not the browser
// fixture's hand-written service registry. It never connects to the running Host.
import { Context } from '/Users/zhiliangzhou/devel/deepseek-harness/vendor/cordis/lib/index.js';
import { SlotRegistry } from '/Users/zhiliangzhou/devel/deepseek-harness/packages/client/ui-renderer/src/client/registry.ts';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import vm from 'node:vm';

const ctx = new Context();
const listeners = new Map();
let captured;
const windowFixture = {
  addEventListener(name, handler, capture) { assert.equal(capture, true); listeners.set(name, handler); },
  removeEventListener(name) { listeners.delete(name); },
  alert() { throw new Error('No user drops are allowed in activation fixture.'); },
  __ModuleLoader__: { load(module) { captured = module.factory(() => ({ createElement: () => null })); } },
};
const bundle = await readFile('lib/client.js', 'utf8');
vm.runInNewContext(bundle, { window: windowFixture, crypto: globalThis.crypto, AbortSignal, AbortController, Set, Map, Date, Object, console });
assert.equal(typeof captured?.apply, 'function');
const platform = await ctx.plugin({ name: 'fixture-platform', apply(scope) {
  const registry = new SlotRegistry(scope);
  const values = new Map();
  scope.reflect.provide('locale', { register(ns, tables) { values.set(ns, tables.zh); return () => values.delete(ns); }, bind(ns) { return key => values.get(ns)?.[key] ?? key; } });
  scope.reflect.provide('sessions', { binding() { return undefined; } });
  scope.reflect.provide('conversation', { input: { for() { throw new Error('Not used during activation.'); } } });
  scope.reflect.provide('fileDrag', { read() { return undefined; } });
  registry.register({ name: 'root', children: { 'conversation.input.dock': { kind: 'list', scope: 'session' }, 'conversation.composer.dock': { kind: 'list', scope: 'session' } } }, () => null);
  registry.register({ name: 'conversation.input.dock', id: 'goal', order: 10 }, () => null);
} });
const plugin = await ctx.plugin(captured);
const entries = ctx.get('slots').entries('conversation.input.dock');
assert.deepEqual(entries.map(entry => entry.options.id), ['goal', 'finder-reference'], 'The hint must occupy the full-width slot after Goal.');
assert.equal(entries[1].locale, 'finder-reference');
assert.equal(ctx.get('slots').entries('conversation.composer.dock').length, 0, 'The footer must no longer contain the plugin.');
assert.equal(listeners.size, 4, 'The real plugin lifecycle must install the capture guard.');
await plugin.dispose();
assert.deepEqual(ctx.get('slots').entries('conversation.input.dock').map(entry => entry.options.id), ['goal'], 'Unloading must remove only our dock entry.');
assert.equal(listeners.size, 0, 'Unloading must remove every capture listener.');
await platform.dispose();
const result = { scope: 'real Cordis and SlotRegistry, stubbed Session/Locale services; no live page or pasteboard', checks: ['activate', 'register-dock', 'install-guard', 'dispose-dock', 'dispose-guard'], passed: true };
await writeFile('tests/artifacts/activation-fixture.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
