import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { BrowserCommand, BrowserState } from '../src/shared/types';

// Only this disposable root-owned CI/container test needs --no-sandbox. The
// application and all normal launch/build scripts retain Chromium sandboxing.
let server: Server;
let origin: string;
let browser: ElectronApplication;
let shell: Page;
let userData: string;
const temporaryProfiles: string[] = [];

const fixture = (name: string) => `<!doctype html><html><head><meta charset="utf-8"><title>${name}</title><style>body{font:18px system-ui;padding:45px;background:#f7f4ed;color:#26323b}a,button{margin-right:18px}input{padding:9px;font:inherit}</style></head><body><h1>${name}</h1><p>A deterministic local page for browser verification.</p><a id="next" href="/two">Next page</a><a id="popup" href="/child" target="_blank">Open child</a><input id="draft" placeholder="A note that should stay"><button id="increment" onclick="window.counter=(window.counter||0)+1">Count</button><form id="post-form" action="/posted" method="POST" target="_blank" rel="opener"><input name="proof" value="retained-post"><button id="post" type="submit">POST to new tab</button></form><script>window.counter=0;window.fixtureReady=true;</script></body></html>`;

test.beforeAll(async () => {
  server = createServer((request, response) => {
    const path = new URL(request.url || '/', 'http://localhost').pathname;
    if (path === '/posted') {
      let body = ''; request.on('data', d => { body += String(d); });
      request.on('end', () => { response.setHeader('Content-Type', 'text/html'); response.end(`<!doctype html><title>Posted form</title><h1>Posted form</h1><pre id="body">${body.replace(/[<>&]/g, '')}</pre><p id="method">${request.method}</p>`); }); return;
    }
    response.setHeader('Content-Type', 'text/html');
    const names: Record<string, string> = { '/one': 'Page One', '/two': 'Page Two', '/three': 'Page Three', '/profile': 'Profile Page', '/peek': 'Peek Page', '/source': 'Popup Source', '/child': 'Child Page' };
    response.end(fixture(names[path] || 'Fixture Home'));
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Fixture server did not bind.');
  origin = `http://127.0.0.1:${address.port}`;
});
async function launch(profile: string) {
  browser = await electron.launch({
    chromiumSandbox: true,
    args: [...(process.getuid?.() === 0 ? ['--no-sandbox'] : []), '.'], cwd: resolve('.'),
    env: { ...process.env, DISPLAY: process.env.DISPLAY || ':93', TANGENT_USER_DATA: profile }, timeout: 30_000,
  });
  shell = await browser.firstWindow();
  await shell.waitForURL('tangent://app/index.html');
  await expect(shell.locator('.brand')).toBeVisible();
  await shell.waitForFunction(() => typeof window.tangent?.dispatch === 'function');
}
test.beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), 'tangent-e2e-')); temporaryProfiles.push(userData);
  await launch(userData);
});
test.afterEach(async () => { if (browser) await browser.close().catch(() => {}); });
test.afterAll(async () => { await new Promise<void>(r => server.close(() => r())); for (const path of temporaryProfiles) await rm(path, { recursive: true, force: true }); });
const state = () => shell.evaluate(() => window.tangent.getState());
const dispatch = (command: BrowserCommand) => shell.evaluate(command => window.tangent.dispatch(command), command);
async function openUI(path: string) {
  await shell.locator('.sidebar-search').click();
  await shell.locator('#palette-input').fill(`${origin}${path}`);
  await shell.locator('#palette-input').press('Enter');
  await expect.poll(async () => (await state()).tabs.some(t => t.url === `${origin}${path}` && !t.loading)).toBeTruthy();
  const id=await contentId(path);await expect.poll(()=>js(id,'document.readyState')).toBe('complete');
}
async function contentId(path: string): Promise<number> {
  let id = 0;
  await expect.poll(async () => {
    id = await browser.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(w => w.getURL() === url)?.id || 0, `${origin}${path}`);
    return id;
  }).toBeGreaterThan(0); return id;
}
async function js<T = unknown>(id: number, code: string): Promise<T> {
  return browser.evaluate(({ webContents }, { id, code }) => {
    const wc = webContents.fromId(id); if (!wc) throw new Error(`Missing webContents ${id}`);
    return wc.executeJavaScript(code, true);
  }, { id, code }) as Promise<T>;
}
async function screenshot(name: string) {
  const base64 = await browser.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].capturePage()).toPNG().toString('base64'));
  await mkdir('test-results', { recursive: true }); await writeFile(join('test-results', name), Buffer.from(base64, 'base64'));
  // Optional compositor evidence on the dedicated Xvfb display; capturePage
  // intentionally captures the shell webContents, excluding native child views.
  if(process.env.TANGENT_CAPTURE_X11==='1') execFileSync('import',['-display',process.env.DISPLAY||':93','-window','root',join('test-results',name.replace('.png','-desktop.png'))]);
}

test('UI navigation, remote privilege isolation, URL policy, archive and restart', async () => {
  await expect(shell.locator('.brand')).toHaveText('Tangent');
  await expect(shell).toHaveTitle('Tangent');
  await shell.getByRole('button',{name:'Settings',exact:true}).click();
  await expect(shell.locator('#update-status')).toHaveText('Update Tangent manually');
  await expect(shell.locator('#update-status')).toBeVisible();
  const updates=await shell.evaluate(()=>window.tangent.getUpdateState());
  expect(updates.status).toBe('unsupported');
  expect(updates.canCheck).toBe(false);expect(updates.canDownload).toBe(false);expect(updates.canInstall).toBe(false);
  expect(updates.message.length).toBeGreaterThan(10);
  await expect(shell.locator('#update-message')).toHaveText(updates.message);
  const versions=await browser.evaluate(()=>({electron:process.versions.electron,chromium:process.versions.chrome}));
  await expect(shell.locator('[data-version="tangent"]')).toHaveText(updates.currentVersion);
  await expect(shell.locator('[data-version="electron"]')).toHaveText(versions.electron!);
  await expect(shell.locator('[data-version="chromium"]')).toHaveText(versions.chromium!);
  await expect(shell.getByRole('button',{name:'Check for updates',exact:true})).toBeDisabled();
  await expect(shell.getByRole('button',{name:'Open releases',exact:true})).toBeEnabled();
  await expect(shell.locator('.update-manual-note')).toContainText('npm run update');
  await expect(shell.getByRole('button',{name:'Download update',exact:true})).toHaveCount(0);
  await expect(shell.getByRole('button',{name:'Restart and install',exact:true})).toHaveCount(0);
  await screenshot('tangent-settings.png');
  await shell.getByRole('button',{name:'Done',exact:true}).click();
  await screenshot('tangent-home.png');
  await openUI('/one');
  const pageId = await contentId('/one');
  expect(await js(pageId, `({require:typeof window.require,process:typeof window.process,bridge:typeof window.tangent})`)).toEqual({ require:'undefined',process:'undefined',bridge:'undefined' });
  await js(pageId, `document.querySelector('#next').click(); true`);
  await expect.poll(async () => (await state()).tabs.some(t=>t.url===`${origin}/two`&&t.title==='Page Two')).toBeTruthy();
  await shell.getByRole('button', { name:'Back', exact:true }).click();
  await expect.poll(async () => (await state()).tabs.some(t=>t.url===`${origin}/one`)).toBeTruthy();
  await shell.getByRole('button', { name:'Forward', exact:true }).click();
  await expect.poll(async () => (await state()).tabs.some(t=>t.url===`${origin}/two`)).toBeTruthy();
  const before = (await state()).tabs.length;
  for (const url of ['javascript:alert(1)','file:///etc/passwd','tangent://app/index.html','data:text/html,unsafe']) {
    expect(await shell.evaluate(async url => { try { await window.tangent.dispatch({type:'navigate',url}); return false; } catch { return true; } },url)).toBe(true);
  }
  expect((await state()).tabs.length).toBe(before);
  await shell.locator('.tab-row').first().click({button:'right'});
  await shell.getByRole('button', {name:'Pin tab',exact:true}).click();
  const pinned=(await state()).tabs[0];expect(pinned.kind).toBe('pinned');
  await shell.locator('.tab-row').first().click({button:'right'});
  await shell.getByRole('button',{name:'Rename tab',exact:true}).click();
  await shell.locator('#tab-title').fill('Research keeper');
  await shell.getByRole('button',{name:'Save name',exact:true}).click();
  await openUI('/three');
  const fresh=(await state()).activeTabId!;
  await shell.locator(`[data-tab-id="${fresh}"] .tab-close`).click();
  await expect.poll(async () => (await state()).archives.some(a=>a.url===`${origin}/three`)).toBeTruthy();
  await screenshot('tangent-browsing.png');
  await browser.close(); await launch(userData);
  expect((await state()).tabs.some(t=>t.kind==='pinned'&&t.title==='Research keeper')).toBe(true);
  expect((await state()).archives.some(t=>t.url===`${origin}/three`)).toBe(true);
  await shell.getByRole('button',{name:'Archived tabs',exact:true}).click();
  await shell.locator('.open-history').filter({hasText:'Page Three'}).click();
  await expect.poll(async () => (await state()).tabs.some(t=>t.url===`${origin}/three`)).toBeTruthy();
});

test('Profiles isolate cookies; Spaces share a profile and its Favorites', async () => {
  await openUI('/profile');
  const firstId=await contentId('/profile');
  await js(firstId, `document.cookie='tangent-proof=personal; path=/'; document.cookie`);
  const personalTab=(await state()).activeTabId!;
  await dispatch({type:'tab:favorite',id:personalTab});
  await shell.getByRole('button',{name:'New space',exact:true}).click();
  await shell.locator('#space-name').fill('Same profile');
  await shell.getByRole('button',{name:'Create space',exact:true}).click();
  const sharedState=await state();expect(sharedState.spaces.find(s=>s.id===sharedState.activeSpaceId)?.profileId).toBe('default');
  await expect(shell.locator('.favorite[data-id]')).toHaveCount(1);
  await dispatch({type:'tab:new',url:`${origin}/one`});
  expect(await js(await contentId('/one'), 'document.cookie')).toContain('tangent-proof=personal');
  await shell.getByRole('button',{name:'New space',exact:true}).click();
  await shell.locator('#space-name').fill('Work space');
  await shell.locator('#space-profile').selectOption('__new');
  await shell.locator('#new-profile-name').fill('Work account');
  await shell.getByRole('button',{name:'Create space',exact:true}).click();
  await expect(shell.locator('.favorite[data-id]')).toHaveCount(0);
  await dispatch({type:'tab:new',url:`${origin}/two`});
  const workId=await contentId('/two');
  await expect.poll(()=>js(workId,'document.readyState')).toBe('complete');
  expect(await js(workId,'document.cookie')).not.toContain('tangent-proof');
  await js(workId, `document.cookie='tangent-proof=work; path=/'; document.cookie`);
  expect(await js(firstId,'document.cookie')).toContain('tangent-proof=personal');
  await screenshot('tangent-profiles.png');
});

test('Split panes keep positions and route toolbar actions to the focused pane', async () => {
  await openUI('/one');const first=(await state()).activeTabId!;
  await openUI('/two');const second=(await state()).activeTabId!;
  await dispatch({type:'tab:activate',id:first});
  await shell.getByRole('button',{name:'Split view',exact:true}).click();
  await shell.locator('[data-action="choose-split"]').filter({hasText:'Page Two'}).click();
  const initial=await state();expect(initial.activeTabId).toBe(first);expect(initial.splitTabId).toBe(second);
  const rightId=await contentId('/two');
  await browser.evaluate(({webContents},id)=>webContents.fromId(id)!.focus(),rightId);
  await expect.poll(async ()=>(await state()).focusedTabId).toBe(second);
  await shell.getByRole('button',{name:'Address bar',exact:true}).click();
  await shell.locator('#palette-input').fill(`${origin}/three`);await shell.locator('#palette-input').press('Enter');
  await expect.poll(async ()=>(await state()).tabs.find(t=>t.id===second)?.url).toBe(`${origin}/three`);
  expect((await state()).activeTabId).toBe(first);expect((await state()).splitTabId).toBe(second);
  expect((await state()).tabs.find(t=>t.id===first)?.url).toBe(`${origin}/one`);
  const bounds=await browser.evaluate(({BrowserWindow}, prefix)=>BrowserWindow.getAllWindows()[0].contentView.children.map(child=>{const v=child as Electron.WebContentsView;return 'webContents' in v?{url:v.webContents.getURL(),bounds:v.getBounds(),visible:v.getVisible()}:null;}).filter(v=>v?.url.startsWith(prefix)&&v.visible),origin);
  expect(bounds).toHaveLength(2);expect(bounds[0]!.bounds.width).toBeGreaterThan(150);expect(bounds[0]!.bounds.x).not.toBe(bounds[1]!.bounds.x);
  await screenshot('tangent-split.png');
});

test('Peek promotion retains the existing page and form state', async () => {
  await openUI('/one');
  await shell.getByRole('button',{name:'Peek at a URL',exact:true}).click();
  await shell.locator('#peek-url').fill(`${origin}/peek`);await shell.getByRole('button',{name:'Open Peek',exact:true}).click();
  const peekId=await contentId('/peek');await expect.poll(()=>js(peekId,'document.readyState')).toBe('complete');
  await js(peekId, `document.querySelector('#draft').value='keep this draft'; window.counter=17; history.pushState({},'', '/peek-route'); true`);
  await expect.poll(async ()=>(await state()).peek?.url).toBe(`${origin}/peek-route`);
  await shell.locator('[data-action="peek-promote"]').click();
  await expect.poll(async ()=>(await state()).peek).toBeNull();
  expect(await contentId('/peek-route')).toBe(peekId);
  const promoted=await state();expect(promoted.tabs.find(t=>t.id===promoted.activeTabId)?.url).toBe(`${origin}/peek-route`);
  expect(await js(peekId, `({draft:document.querySelector('#draft').value,counter:window.counter})`)).toEqual({draft:'keep this draft',counter:17});
  // A popup opened from Peek must not destroy its opener during promotion.
  await dispatch({type:'peek:open',url:`${origin}/source`});
  const sourceId=await contentId('/source');await expect.poll(()=>js(sourceId,'document.readyState')).toBe('complete');
  await js(sourceId, `document.querySelector('#draft').value='peek opener survives'; window.open('/child','_blank'); true`);
  const childId=await contentId('/child');await expect.poll(()=>js(childId,'document.readyState')).toBe('complete');
  expect((await state()).peek).toBeNull();
  expect((await state()).tabs.some(t=>t.url===`${origin}/source`)).toBe(true);
  expect(await contentId('/source')).toBe(sourceId);
  expect(await js(childId, `window.opener.document.querySelector('#draft').value`)).toBe('peek opener survives');
});

test('Popup links and POST forms preserve the source session and browser boundary', async () => {
  await dispatch({type:'profile:create',name:'Popup test'});
  const profile=(await state()).profiles.find(p=>p.name==='Popup test')!;
  await dispatch({type:'space:create',name:'Popup space',profileId:profile.id});
  await openUI('/source');const sourceId=await contentId('/source');
  await js(sourceId, `document.cookie='popup-proof=source; path=/'; document.querySelector('#popup').click(); true`);
  const childId=await contentId('/child');await expect.poll(()=>js(childId,'document.readyState')).toBe('complete');
  expect(await js(childId,'document.cookie')).toContain('popup-proof=source');
  expect(await js(childId,'typeof window.require')).toBe('undefined');
  expect((await state()).tabs.find(t=>t.url===`${origin}/child`)?.profileId).toBe(profile.id);
  const sourceTab=(await state()).tabs.find(t=>t.url===`${origin}/source`)!;
  await dispatch({type:'tab:activate',id:sourceTab.id});
  await js(sourceId, `document.querySelector('#post-form').requestSubmit(); true`);
  const postId=await contentId('/posted');await expect.poll(()=>js(postId,'document.readyState')).toBe('complete');
  expect(await js(postId,`document.querySelector('#method').textContent`)).toBe('POST');
  expect(await js(postId,`document.querySelector('#body').textContent`)).toContain('proof=retained-post');
  expect(await js(postId,'document.cookie')).toContain('popup-proof=source');
  expect(await js(postId,'window.opener !== null')).toBe(true);
  await js(postId, 'setTimeout(()=>window.close(),0);true');
  await expect.poll(async ()=>(await state()).tabs.some(t=>t.url===`${origin}/posted`)).toBe(false);
  await expect.poll(()=>browser.evaluate(({webContents},id)=>Boolean(webContents.fromId(id)),postId)).toBe(false);
});
