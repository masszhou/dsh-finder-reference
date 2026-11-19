// Check public documentation pairs and local links without network access.
import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const pages = ['README.md', 'README_ch.md', ...(await readdir(path.join(root, 'docs')))
  .filter(name => name.endsWith('.md')).map(name => `docs/${name}`)];
const names = new Set(pages);
let localLinks = 0;
for (const page of pages) {
  const chinese = page.endsWith('_ch.md');
  const counterpart = chinese ? page.replace(/_ch\.md$/, '.md') : page.replace(/\.md$/, '_ch.md');
  assert.ok(names.has(counterpart), `${page}: missing translation ${counterpart}`);
  const text = await readFile(path.join(root, page), 'utf8');
  assert.ok(!/\/Users\/|\/home\/|[A-Z]:\\/.test(text), `${page}: private machine path`);
  const prose = text.replace(/```[\s\S]*?```/g, '');
  const links = [...prose.matchAll(/\[[^\]]*\]\((?:<([^>]+)>|([^\s)]+))\)/g)]
    .map(match => match[1] ?? match[2]);
  assert.ok(links.includes(path.basename(counterpart)), `${page}: missing language switch`);
  for (const href of links) {
    if (/^https?:\/\//.test(href)) continue;
    assert.ok(!/^[a-z]+:|^\//i.test(href), `${page}: unsupported public link ${href}`);
    const target = path.resolve(root, path.dirname(page), decodeURIComponent(href.split('#')[0]));
    const relative = path.relative(root, target);
    assert.ok(relative !== '..' && !relative.startsWith(`..${path.sep}`), `${page}: link leaves plugin`);
    assert.ok(!/^(tests\/artifacts|lib|bin)\//.test(relative), `${page}: link targets ignored output`);
    assert.ok((await stat(target)).isFile(), `${page}: missing file ${href}`);
    localLinks++;
  }
  if (!chinese) {
    const english = prose.replace(/\[[^\]]*\]\([^)]*\)/g, '').replaceAll('简体中文', '');
    assert.ok(!/[\u3400-\u9fff]/u.test(english), `${page}: untranslated default prose`);
  }
}
console.log(JSON.stringify({pages: pages.length, languagePairs: pages.length / 2, localLinks, passed: true}));
