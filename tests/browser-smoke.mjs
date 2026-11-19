import { chromium } from '/Users/zhiliangzhou/devel/deepseek-harness/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs';
import { build } from '/Users/zhiliangzhou/devel/deepseek-harness/node_modules/.pnpm/esbuild@0.28.2/node_modules/esbuild/lib/main.js';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const artifacts = path.join(root,'tests/artifacts');
await mkdir(path.join(artifacts,'browser-tmp'),{recursive:true});
await writeFile(path.join(artifacts,'finder-probe-sample.txt'),'Harmless browser fixture.\n',{flag:'wx'}).catch(error => { if(error.code !== 'EEXIST') throw error; });
await build({entryPoints:[path.join(root,'tests/browser-fixture-entry.jsx')],outfile:path.join(artifacts,'browser-fixture.js'),bundle:true,format:'iife',platform:'browser',loader:{'.png':'dataurl'},nodePaths:['/Users/zhiliangzhou/devel/deepseek-harness/node_modules/.pnpm/react@18.3.1/node_modules','/Users/zhiliangzhou/devel/deepseek-harness/node_modules/.pnpm/react-dom@18.3.1_react@18.3.1/node_modules'],define:{'process.env.NODE_ENV':'"development"'}});
const browser = await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,downloadsPath:path.join(artifacts,'downloads'),env:{...process.env,TMPDIR:path.join(artifacts,'browser-tmp')}});
const checks=[];
const geometry=[];
try {
  const page = await browser.newPage({viewport:{width:1100,height:800}});
  const errors=[]; page.on('pageerror',error=>errors.push(error.message));
  let resolves=0, confirms=0;
  const fixturePath = path.join(artifacts,'finder-probe-sample.txt');
  const html='<!doctype html><html lang="zh"><meta charset="utf-8"><title>Isolated plugin fixture — not DSH E2E</title><style>body{font:16px system-ui;margin:40px;background:#f6f7fa} :root{--dsw-specific-input-major:white;--dsw-radius-panel:16px;--dsw-elevation-soft:0 0 0 1px #aaa;--dsw-specific-menu:#f6f7fa;--dsw-radius-md:8px;--dsw-elevation-panel:0 0 0 1px #ddd} [contenteditable]{min-height:100px;padding:12px} [data-composer-dock]{margin-top:14px} [data-fixture-chip]{background:#def;padding:4px;border-radius:5px}</style><h1>Isolated Finder plugin UI fixture</h1><p>Mock Host protocol. No real pasteboard or DSH session access.</p><aside data-conversation-region="composer" style="display:none"><div data-composer-card>Other Session</div></aside><section id="fixture-session" data-conversation-region="composer"><div id="fixture-transcript"><div data-reading-column style="outline:1px dashed #aaa">Reading area (production ChatView width)</div></div><div id="fixture-goal" style="margin-bottom:8px"><div data-goal>Goal bar (fixture)</div></div><div id="fixture-dock" style="margin-bottom:8px"></div><div id="fixture-input-bar"><div data-composer-card><div contenteditable="true" role="textbox">Existing draft </div></div><div data-composer-dock>Footer status (fixture)</div></div></section></html>';
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if (url.pathname==='/__finder-reference-fixture__') return route.fulfill({contentType:'text/html',body:html});
    if (url.pathname.startsWith('/api/finder-reference/')) {
      const op=url.pathname.split('/').at(-1); const payload=route.request().postDataJSON();
      if(op==='resolve') { resolves++; assert.equal(payload.files[0].name,'finder-probe-sample.txt'); return route.fulfill({json:{ticket:'a'.repeat(48),expiresAt:Date.now()+60000,paths:[fixturePath]}}); }
      if(op==='confirm') { confirms++; return route.fulfill({json:{paths:[fixturePath]}}); }
      if(op==='cancel') return route.fulfill({json:{cancelled:true}});
    }
    throw new Error('Unexpected network request: '+url.pathname);
  });
  await page.goto('http://127.0.0.1:3080/__finder-reference-fixture__');
  await page.addStyleTag({content:await readFile(path.join(artifacts,'browser-fixture.css'),'utf8')});
  await page.addScriptTag({content:await readFile(path.join(artifacts,'browser-fixture.js'),'utf8')});
  await page.addScriptTag({content:await readFile(path.join(root,'lib/client.js'),'utf8')});
  await page.getByText('Finder 原文件引用 · 不上传').waitFor();
  assert.equal(await page.evaluate(()=>window.fixture.applyError),null); checks.push('actual React bundle mount');
  await checkPlacement('idle');
  checks.push('idle badge aligned with reading column using production ChatView CSS');
  const cdp=await page.context().newCDPSession(page);
  async function drop() {
    const box=await page.locator('#fixture-session [data-composer-card]').boundingBox();
    const data={items:[],files:[fixturePath],dragOperationsMask:7};
    for(const type of ['dragEnter','dragOver','drop']) await cdp.send('Input.dispatchDragEvent',{type,x:box.x+60,y:box.y+40,data});
  }
  await drop(); await page.getByRole('button',{name:'确认这些原文件并引用'}).waitFor();
  async function checkPlacement(state = 'preview') {
    const goal=await page.locator('[data-goal]').boundingBox();
    const panel=await page.locator('[data-finder-reference]').boundingBox();
    const card=await page.locator('#fixture-session [data-composer-card]').boundingBox();
    assert.ok(panel.y >= goal.y + goal.height, 'Panel must follow Goal.');
    assert.ok(panel.y + panel.height <= card.y, 'Panel must precede the input card.');
    const reading=await page.locator('[data-reading-column]').boundingBox();
    assert.ok(Math.abs(panel.x-reading.x) <= 1 && Math.abs(panel.width-reading.width) <= 1, 'Panel must match reading column, not composer width.');
    assert.ok(panel.width < card.width, 'Reading-aligned panel must remain narrower than the composer.');
    assert.equal(await page.locator('[data-composer-dock] [data-finder-reference]').count(),0);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth), 'No horizontal overflow.');
    const typography = await page.evaluate(() => {
      const sample = node => { const css = getComputedStyle(node); return {size:css.fontSize, height:css.lineHeight, family:css.fontFamily}; };
      return {goal:sample(document.querySelector('[data-goal-objective]')), text:[...document.querySelectorAll('[data-finder-reference], [data-finder-reference] *')].map(sample)};
    });
    assert.equal(typography.goal.size, '13px');
    assert.equal(typography.goal.height, '20px');
    for (const actual of typography.text) assert.deepEqual(actual, typography.goal, `All plugin text must match Goal typography (${state}).`);
    geometry.push({state, typography:typography.goal, viewport: page.viewportSize(), panel: {x:panel.x,width:panel.width}, reading: {x:reading.x,width:reading.width}, card: {x:card.x,width:card.width}});
  }
  await checkPlacement();
  await page.screenshot({path:path.join(artifacts,'browser-placement.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await checkPlacement();
  await page.screenshot({path:path.join(artifacts,'browser-placement-narrow.png'),fullPage:true});
  await page.setViewportSize({width:1100,height:800});
  await page.evaluate(()=>document.getElementById('fixture-session').style.setProperty('--dsh-chat-user-width','500px'));
  await checkPlacement('custom chat width');
  assert.equal(Math.round(geometry.at(-1).card.width),532);
  assert.equal(Math.round(geometry.at(-1).reading.width),500);
  await page.evaluate(()=>document.getElementById('fixture-session').style.removeProperty('--dsh-chat-user-width'));
  await page.evaluate(()=>window.fixtureLayout.embedded(true));
  await checkPlacement('embedded percentage cap');
  await page.setViewportSize({width:390,height:844});
  await checkPlacement('embedded narrow');
  await page.evaluate(()=>window.fixtureLayout.embedded(false));
  await page.setViewportSize({width:1100,height:800});
  checks.push('production CSS: desktop/narrow/custom/embedded caps align; preview stays below Goal and above its Session composer');
  assert.equal(resolves,1); assert.equal(confirms,0);
  assert.equal(await page.evaluate(()=>window.fixture.inserted.length),0); checks.push('preview before authorization');
  await page.getByRole('button',{name:'确认这些原文件并引用'}).click();
  await page.locator('[data-finder-preview]').waitFor({state:'detached'});
  assert.equal(await page.locator('[data-finder-reference]').innerText(), 'Finder 原文件引用 · 不上传');
  assert.equal(await page.locator('[data-finder-reference] [role="status"]').count(),0);
  await checkPlacement('success');
  assert.equal(confirms,1);
  assert.equal(await page.evaluate(()=>window.fixture.inserted[0].ref.source),'reference');
  assert.equal(await page.evaluate(()=>window.fixture.nativeUploadDrops),0); checks.push('trusted click inserts chip; native uploader never receives drop');
  await drop(); await page.getByRole('button',{name:'确认这些原文件并引用'}).waitFor();
  await page.evaluate(()=>window.fixture.edit());
  await page.getByRole('button',{name:'确认这些原文件并引用'}).click();
  await page.getByText('草稿已变化。插件保留了你的修改，请重新拖入。').waitFor();
  await checkPlacement('error');
  assert.equal(confirms,1); assert.equal(await page.evaluate(()=>window.fixture.inserted.length),1); checks.push('changed draft prevents confirmation');
  await page.screenshot({path:path.join(artifacts,'browser-smoke.png'),fullPage:true});
  // The real user's screenshot is English. Do not require a Chinese badge there.
  await page.goto('http://127.0.0.1:3080/__finder-reference-fixture__?lang=en');
  await page.addStyleTag({content:await readFile(path.join(artifacts,'browser-fixture.css'),'utf8')});
  await page.addScriptTag({content:await readFile(path.join(artifacts,'browser-fixture.js'),'utf8')});
  await page.addScriptTag({content:await readFile(path.join(root,'lib/client.js'),'utf8')});
  await page.getByText('Finder original references · no uploads', {exact:true}).waitFor();
  assert.equal(await page.getByText('Finder 原文件引用 · 不上传', {exact:true}).count(),0);
  assert.equal(await page.evaluate(()=>window.fixture.applyError),null);
  checks.push('English UI renders the English badge, not the Chinese badge');
  await drop();
  await page.getByRole('button',{name:'Confirm and reference these originals',exact:true}).click();
  await page.locator('[data-finder-preview]').waitFor({state:'detached'});
  assert.equal(await page.locator('[data-finder-reference]').innerText(), 'Finder original references · no uploads');
  assert.equal(await page.getByText('Original references inserted. No copies uploaded.',{exact:true}).count(),0);
  assert.equal(await page.locator('[data-finder-reference] [role="status"]').count(),0);
  assert.equal(await page.evaluate(()=>window.fixture.inserted.length),1);
  assert.equal(await page.evaluate(()=>window.fixture.nativeUploadDrops),0);
  await checkPlacement('English silent success');
  await page.screenshot({path:path.join(artifacts,'browser-success.png'),fullPage:true});
  checks.push('Chinese and English success inserts references without any success message or empty status row');
  assert.deepEqual(errors,[]); checks.push('no browser exceptions');
  await writeFile(path.join(artifacts,'browser-smoke.json'),JSON.stringify({scope:'isolated React UI fixture with production DSH layout CSS, mock Host, CDP drag; NOT real Finder or installed DSH E2E',checks,geometry,resolves,confirms,nativeUploadDrops:await page.evaluate(()=>window.fixture.nativeUploadDrops),errors},null,2)+'\n');
  console.log(JSON.stringify({checks,resolves,confirms,scope:'fixture-only'}));
} finally {await browser.close();}
