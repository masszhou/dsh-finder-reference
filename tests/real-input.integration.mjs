// Offline model integration: real SessionInputShell/Lexical reference nodes,
// mock Host replies, no DOM rendering, live session, submission, or file access.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { SessionInputShell } from '/Users/zhiliangzhou/devel/deepseek-harness/packages/client/ui-conversation/src/client/input/facade.ts';
import { createDropController, formatMention } from '../src/client-core.mjs';

async function main() {
  let sent = 0;
  const input = new SessionInputShell({
    actx: {},
    defaultSink: async () => { sent++; throw new Error('Submission is forbidden in this fixture.'); },
    commandAttachments: { serialize: async () => [], release() {}, unsupportedNotice: () => 'unsupported' },
  });
  const paths = ['/fixture/plain.txt', '/fixture/space name.txt', "/fixture/中文's.txt"];
  const views = [];
  const controller = createDropController({
    sessionId: 'offline-session', clientNonce: 'offline-client',
    valid: () => true, input: () => input, capture: () => input.actions.captureInsertion(),
    show: view => views.push(view),
    request: async operation => {
      if (operation === 'resolve') return {ticket: 'a'.repeat(48), expiresAt: Date.now() + 60000, paths};
      if (operation === 'confirm') return {paths};
      return {cancelled: true};
    },
  });
  try {
    input.setDraft('Preserved draft ');
    const original = input.draftSnapshot.text;
    await controller.drop(paths.map(path => ({name: path.split('/').at(-1), size: 1, lastModified: 1})));
    assert.equal(views.at(-1).phase, 'preview');
    assert.equal(input.draftSnapshot.text, original);
    assert.equal(input.draftSnapshot.references.length, 0);
    // This calls only the offline controller; it is not a real human approval.
    await controller.confirm(true);
    assert.equal(views.at(-1).phase, 'done', JSON.stringify(views.at(-1)));
    assert.equal(input.draftSnapshot.references.length, paths.length);
    assert.equal(input.draftSnapshot.text, original + paths.map(formatMention).join(' ') + ' ');
    for (const [i, ref] of input.draftSnapshot.references.entries()) {
      assert.equal(ref.source, 'reference');
      assert.equal(ref.ref, formatMention(paths[i]));
      assert.equal(ref.appearance, 'file');
    }
    await controller.drop(paths.map(path => ({name: path.split('/').at(-1), size: 1, lastModified: 1})));
    input.setDraft('New edits');
    await controller.confirm(true);
    assert.equal(views.at(-1).code, 'DRAFT_CHANGED');
    assert.equal(input.draftSnapshot.text, 'New edits');
    assert.equal(input.draftSnapshot.references.length, 0);
    assert.equal(sent, 0);
    const result = {scope: 'real SessionInputShell/Lexical model, mock Host; no live page or pasteboard', passed: true, checks: ['preview preserves draft', 'three native reference nodes in order', 'space/Unicode/apostrophe paths', 'changed draft rejects insertion', 'no message submission']};
    await writeFile('tests/artifacts/real-input.integration.json', JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(result));
  } finally { controller.dispose(); input.dispose(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
