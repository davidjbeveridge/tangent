import { app, BrowserWindow, WebContentsView, ipcMain, Menu, protocol, session, dialog, shell, nativeTheme, type Session, type WebContents, type IpcMainInvokeEvent, type DownloadItem } from 'electron';
import { readFileSync, writeFileSync, statSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { BrowserState, BrowserCommand, Tab, Shortcut } from '../shared/types';
import { activeSpace, applyCommand, archiveIdle, createTab, recordVisit, restoreState, serializeState } from '../core/state';
import { isNavigableUrl } from '../core/urls';
import { validateCommand } from '../core/commands';
import { SessionStorage } from './storage';
import { UpdateController, createUpdateDriver, loadUpdatePolicy } from './updates';
import { enforcePackagedSandbox } from './sandbox';

try {
  enforcePackagedSandbox(app);
} catch (error) {
  const message = error instanceof Error ? error.message : 'Tangent requires Chromium sandboxing.';
  console.error(message);
  dialog.showErrorBox('Tangent could not start safely', message);
  app.exit(1);
}

const UI_URL = 'tangent://app/index.html';
const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'";
protocol.registerSchemesAsPrivileged([{ scheme: 'tangent', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
if (process.env.TANGENT_USER_DATA) {
  const profileDirectory = resolve(process.env.TANGENT_USER_DATA);
  mkdirSync(profileDirectory, { recursive: true, mode: 0o700 });
  app.setPath('userData', profileDirectory);
}
app.setName('Tangent');
const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();
let win: BrowserWindow | null = null;
let state: BrowserState;
let storage: SessionStorage;
let updates: UpdateController;
let overlayOpen = false;
let closing = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
const views = new Map<string, WebContentsView>();
let peekView: WebContentsView | null = null;
let peekUrl = '';
let detachPeekEvents: (() => void) | null = null;
const configuredSessions = new Set<Session>();
const downloadItems = new Map<string, DownloadItem>();
const pendingPermissions = new Set<string>();
const intentionallyClosed = new WeakSet<WebContents>();
function saveSession() { try { storage.save(state); } catch (error) { console.error('Session save failed:', error); } }

function sendState(persist = true) {
  if (win && !win.isDestroyed()) win.webContents.send('tangent:state', state);
  if (persist && !closing) {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(saveSession, 220);
  }
}
function shortcut(value: Shortcut) { if (win && !win.isDestroyed()) { win.webContents.focus(); win.webContents.send('tangent:shortcut', value); } }
function focusedTabId(): string | null { return state.focusedTabId ?? state.activeTabId; }
function currentView(): WebContentsView | undefined { const id = focusedTabId(); return state.peek ? peekView ?? undefined : id ? views.get(id) : undefined; }
function assertShell(event: IpcMainInvokeEvent) {
  if (!win || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame || event.senderFrame.url !== UI_URL) throw new Error('Untrusted IPC sender.');
}

function profileSession(profileId: string): Session {
  const ses = session.fromPartition(`persist:tangent-profile-${profileId}`);
  if (configuredSessions.has(ses)) return ses;
  configuredSessions.add(ses);
  const grants = new Set<string>();
  const allowed = new Set(['media', 'geolocation', 'notifications', 'clipboard-read', 'fullscreen', 'pointerLock']);
  const originOf = (url: string) => { try { return new URL(url).origin; } catch { return ''; } };
  ses.setPermissionCheckHandler((wc, permission, requestingOrigin, details) => {
    if (!wc || wc.isDestroyed()) return false;
    const origin = originOf(requestingOrigin);
    if (!origin || origin !== originOf(wc.getURL())) return false;
    const mediaType = permission === 'media' ? String(details.mediaType ?? 'unknown') : '';
    return grants.has(`${origin}|${permission}|${mediaType}`);
  });
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    if (!win || win.isDestroyed() || wc.isDestroyed() || !allowed.has(permission)) { callback(false); return; }
    const origin = originOf(details.requestingUrl ?? wc.getURL());
    if (!origin || origin === 'null' || origin !== originOf(wc.getURL()) || (!origin.startsWith('https:') && !/^http:\/\/(localhost|127\.0\.0\.1)(:|$)/.test(origin))) { callback(false); return; }
    const mediaTypes = 'mediaTypes' in details && Array.isArray(details.mediaTypes) ? details.mediaTypes : [];
    const keys = permission === 'media' ? mediaTypes.map(t => `${origin}|media|${t}`) : [`${origin}|${permission}|`];
    if (!keys.length) { callback(false); return; }
    if (keys.every(k => grants.has(k))) { callback(true); return; }
    const pendingKey = `${profileId}|${origin}|${permission}`;
    if (pendingPermissions.has(pendingKey)) { callback(false); return; }
    pendingPermissions.add(pendingKey);
    const label = permission === 'media' ? mediaTypes.join(' and ') : permission;
    void dialog.showMessageBox(win, { type: 'question', title: 'Site permission', message: `${origin} requests ${label}`, detail: 'Allow for this browser session? Permissions are reset when Tangent quits.', buttons: ['Block', 'Allow'], defaultId: 0, cancelId: 0, noLink: true }).then(result => {
      const approved = result.response === 1 && !wc.isDestroyed() && originOf(wc.getURL()) === origin;
      if (approved) keys.forEach(k => grants.add(k)); callback(approved);
    }).catch(() => callback(false)).finally(() => pendingPermissions.delete(pendingKey));
  });
  ses.on('will-download', (_event, item) => {
    const id = randomUUID();
    downloadItems.set(id, item);
    const entry = { id, name: item.getFilename(), receivedBytes: 0, totalBytes: item.getTotalBytes(), status: 'progressing' as const };
    state.downloads.unshift(entry); state.downloads = state.downloads.slice(0, 100); sendState(false);
    item.on('updated', (_event, status) => {
      const record = state.downloads.find(d => d.id === id); if (!record) return;
      record.receivedBytes = item.getReceivedBytes(); record.totalBytes = item.getTotalBytes(); record.status = status === 'interrupted' ? 'interrupted' : 'progressing'; sendState(false);
    });
    item.once('done', (_event, status) => {
      const record = state.downloads.find(d => d.id === id); if (record) { record.status = status; record.receivedBytes = item.getReceivedBytes(); if (status === 'completed') record.path = item.getSavePath(); }
      downloadItems.delete(id); sendState(false);
    });
  });
  return ses;
}

function updateTab(id: string, patch: Partial<Tab>, persist = false) { const t = state.tabs.find(t => t.id === id); if (t) { Object.assign(t, patch); if ('error' in patch) layout(); sendState(persist); } }
function installShortcuts(wc: WebContents) {
  wc.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const key = input.key.toLowerCase(), mod = process.platform === 'darwin' ? input.meta : input.control;
    if (mod && ['l', 't', 'w', 'r', 'f', 'b', '\\', ',', 'y'].includes(key)) {
      event.preventDefault();
      if (key === 'l') shortcut('address');
      if (key === 't' && !input.shift) shortcut('new-tab');
      if (key === 't' && input.shift) { const recent = state.archives.find(a => a.profileId === activeSpace(state).profileId); if (recent) void execute({ type: 'archive:restore', id: recent.id }); }
      if (key === 'w') { if (state.peek) void execute({ type: 'peek:close' }); else if (focusedTabId()) void execute({ type: 'tab:close', id: focusedTabId()! }); }
      if (key === 'r') void execute({ type: 'reload' });
      if (key === 'f') shortcut('find');
      if (key === 'b') void execute({ type: 'sidebar:toggle' });
      if (key === '\\') void execute({ type: 'split:toggle' });
      if (key === ',') shortcut('settings');
      if (key === 'y') shortcut('archive');
    }
    if (key === 'escape' && state.peek) { event.preventDefault(); void execute({ type: 'peek:close' }); }
    if (mod && /^[1-9]$/.test(key)) { const space = state.spaces[Number(key) - 1]; if (space) { event.preventDefault(); void execute({ type: 'space:activate', id: space.id }); } }
  });
}

function sourceTab(wc: WebContents): Tab | undefined {
  for (const [id, view] of views) if (view.webContents === wc) return state.tabs.find(t => t.id === id);
  return undefined;
}
function selectSource(wc: WebContents, profileId: string): string | null {
  const tab = sourceTab(wc);
  const space = tab ? (tab.kind === 'favorite' && activeSpace(state).profileId === profileId ? activeSpace(state) : state.spaces.find(s => s.id === tab.spaceId)) : state.spaces.find(s => s.id === state.activeSpaceId && s.profileId === profileId) ?? state.spaces.find(s => s.profileId === profileId);
  if (!space) return null;
  if (state.activeSpaceId !== space.id) state = applyCommand(state, { type: 'space:activate', id: space.id });
  if (tab) state = applyCommand(state, { type: 'tab:activate', id: tab.id });
  return tab?.id ?? null;
}
function secureContent(wc: WebContents, profileId: string) {
  wc.on('will-navigate', (event, url) => { if (!isNavigableUrl(url)) event.preventDefault(); });
  wc.on('will-redirect', (event, url) => { if (!isNavigableUrl(url)) event.preventDefault(); });
  wc.on('will-attach-webview', event => event.preventDefault());
  const popupTimes: number[] = [];
  wc.setWindowOpenHandler(details => {
    const owner = sourceTab(wc);
    const visibleSource = wc === peekView?.webContents || owner?.id === state.activeTabId || owner?.id === state.splitTabId;
    const now = Date.now(); while (popupTimes.length && now - popupTimes[0] > 10000) popupTimes.shift();
    if (!isNavigableUrl(details.url) || !visibleSource || overlayOpen || popupTimes.length >= 5 || state.tabs.length >= 2000) return { action: 'deny' };
    popupTimes.push(now);
    return {
      action: 'allow', outlivesOpener: true,
      overrideBrowserWindowOptions: { webPreferences: { session: profileSession(profileId), nodeIntegration: false, nodeIntegrationInSubFrames: false, nodeIntegrationInWorker: false, contextIsolation: true, sandbox: true, webviewTag: false } },
      createWindow: options => {
        // Preserve Chromium's opener, referrer and POST handling, with the source Profile.
        if (wc === peekView?.webContents) promotePeek();
        selectSource(wc, profileId);
        const previous = state.activeTabId;
        const previousFocus = state.focusedTabId;
        const tab = createTab(state, details.url);
        const view = makeView(profileId, options);
        attachTabView(tab, view, false);
        if (details.disposition === 'background-tab') { state.activeTabId = previous; state.focusedTabId = previousFocus; }
        state.peek = null; reconcileViews(); sendState();
        return view.webContents;
      },
    };
  });
  wc.on('context-menu', (_event, params) => {
    const template: Electron.MenuItemConstructorOptions[] = [];
    if (isNavigableUrl(params.linkURL)) {
      template.push({ label: 'Open link in new tab', click: () => { selectSource(wc, profileId); void execute({ type: 'tab:new', url: params.linkURL }); } },
        { label: 'Peek at link', click: () => { selectSource(wc, profileId); void execute({ type: 'peek:open', url: params.linkURL }); } },
        { label: 'Open link in split', click: async () => {
          const previous = selectSource(wc, profileId) ?? state.activeTabId;
          await execute({ type: 'tab:new', url: params.linkURL });
          const next = state.activeTabId;
          if (previous && next) { await execute({ type: 'tab:activate', id: previous }); await execute({ type: 'split:toggle', id: next }); }
        } }, { type: 'separator' });
    }
    if (params.isEditable) template.push({ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' });
    else if (params.selectionText) template.push({ role: 'copy' });
    template.push({ label: 'Back', enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() }, { label: 'Reload', click: () => wc.reload() }, { label: 'Inspect', click: () => wc.inspectElement(params.x, params.y) });
    if (win) Menu.buildFromTemplate(template).popup({ window: win });
  });
  installShortcuts(wc);
}

function makeView(profileId: string, options?: Electron.BrowserWindowConstructorOptions): WebContentsView {
  const view = new WebContentsView({ ...options, webPreferences: { ...options?.webPreferences, session: profileSession(profileId), preload: undefined, nodeIntegration: false, nodeIntegrationInSubFrames: false, nodeIntegrationInWorker: false, contextIsolation: true, sandbox: true, webSecurity: true, allowRunningInsecureContent: false, webviewTag: false, navigateOnDragDrop: false, spellcheck: true } });
  view.setBackgroundColor('#ffffff'); secureContent(view.webContents, profileId); return view;
}
function ensureTabView(tab: Tab): WebContentsView {
  const existing = views.get(tab.id); if (existing) return existing;
  return attachTabView(tab, makeView(tab.profileId), true);
}
function attachTabView(tab: Tab, view: WebContentsView, load: boolean): WebContentsView {
  const wc = view.webContents;
  views.set(tab.id, view); win!.contentView.addChildView(view); view.setVisible(false);
  wc.on('did-start-loading', () => updateTab(tab.id, { loading: true, error: undefined }));
  wc.on('did-stop-loading', () => updateTab(tab.id, { loading: false, canGoBack: wc.navigationHistory.canGoBack(), canGoForward: wc.navigationHistory.canGoForward() }));
  wc.on('page-title-updated', (_event, title) => { if (title && !state.tabs.find(t => t.id === tab.id)?.customTitle) updateTab(tab.id, { title: title.slice(0, 200) }, true); });
  const navigated = (url: string) => {
    const t = state.tabs.find(t => t.id === tab.id); if (!t || !isNavigableUrl(url)) return;
    t.url = url; t.error = undefined; t.canGoBack = wc.navigationHistory.canGoBack(); t.canGoForward = wc.navigationHistory.canGoForward();
    recordVisit(state, t); sendState();
  };
  wc.on('did-navigate', (_e, url) => navigated(url));
  wc.on('did-navigate-in-page', (_e, url, isMainFrame) => { if (isMainFrame) navigated(url); });
  wc.on('media-started-playing', () => updateTab(tab.id, { audible: true }));
  wc.on('media-paused', () => updateTab(tab.id, { audible: false }));
  wc.on('did-fail-load', (_e, code, description, _url, isMainFrame) => { if (isMainFrame && code !== -3) updateTab(tab.id, { error: description, loading: false }); });
  wc.on('render-process-gone', (_e, details) => updateTab(tab.id, { error: `Page stopped (${details.reason}). Reload to recover.`, loading: false }));
  wc.on('focus', () => { const t = state.tabs.find(t => t.id === tab.id); if (t) { t.lastActiveAt = Date.now(); if ((tab.id === state.activeTabId || tab.id === state.splitTabId) && state.focusedTabId !== tab.id) { state.focusedTabId = tab.id; sendState(false); } } });
  wc.once('destroyed', () => {
    if (intentionallyClosed.has(wc)) return;
    views.delete(tab.id);
    if (!closing && state.tabs.some(t => t.id === tab.id)) {
      state = applyCommand(state, { type: 'tab:close', id: tab.id });
      if (win && !win.isDestroyed()) { try { win.contentView.removeChildView(view); } catch { /* native view already removed */ } }
      reconcileViews(); sendState();
    }
  });
  wc.setAudioMuted(tab.muted ?? false);
  if (load) void wc.loadURL(tab.url).catch(e => { if (!wc.isDestroyed()) updateTab(tab.id, { error: String(e), loading: false }); });
  return view;
}
function destroyView(view: WebContentsView) {
  intentionallyClosed.add(view.webContents);
  if (view === peekView) { detachPeekEvents?.(); detachPeekEvents = null; }
  if (win && !win.isDestroyed()) { try { win.contentView.removeChildView(view); } catch { /* already removed */ } }
  if (!view.webContents.isDestroyed()) view.webContents.close({ waitForBeforeUnload: false });
}
function reconcileViews() {
  for (const [id, view] of views) if (!state.tabs.some(t => t.id === id)) { destroyView(view); views.delete(id); }
  if (!state.peek && peekView) { destroyView(peekView); peekView = null; peekUrl = ''; }
  layout();
}
function layout() {
  if (!win || win.isDestroyed()) return;
  for (const view of views.values()) view.setVisible(false);
  peekView?.setVisible(false);
  if (overlayOpen) return;
  const [width, height] = win.getContentSize();
  const x = (state.sidebarHidden ? 0 : state.settings.sidebarWidth) + 8, y = 84;
  const w = Math.max(80, width - x - 8), h = Math.max(80, height - y - 8);
  if (state.peek) {
    if (!peekView) {
      peekView = makeView(activeSpace(state).profileId); win.contentView.addChildView(peekView);
      const contents = peekView.webContents;
      const titleUpdated = (_e: Electron.Event, title: string) => { if (state.peek) { state.peek.title = title.slice(0, 200); sendState(false); } };
      const stopped = () => { if (state.peek) { state.peek.loading = false; const url = contents.getURL(); if (isNavigableUrl(url)) { state.peek.url = url; peekUrl = url; } sendState(false); } };
      const navigated = (_e: Electron.Event, url: string) => { if (state.peek && isNavigableUrl(url)) { state.peek.url = url; peekUrl = url; sendState(false); } };
      const inPage = (_e: Electron.Event, url: string, main: boolean) => { if (main) navigated(_e, url); };
      const failed = (_e: Electron.Event, code: number, description: string, _url: string, main: boolean) => { if (main && code !== -3 && state.peek) { state.peek.title = description; state.peek.loading = false; sendState(false); } };
      contents.on('page-title-updated', titleUpdated); contents.on('did-stop-loading', stopped); contents.on('did-fail-load', failed); contents.on('did-navigate', navigated); contents.on('did-navigate-in-page', inPage);
      detachPeekEvents = () => { contents.off('page-title-updated', titleUpdated); contents.off('did-stop-loading', stopped); contents.off('did-fail-load', failed); contents.off('did-navigate', navigated); contents.off('did-navigate-in-page', inPage); };
    }
    if (peekUrl !== state.peek.url) { peekUrl = state.peek.url; void peekView.webContents.loadURL(peekUrl).catch(() => {}); }
    peekView.setBounds({ x: x + 48, y: y + 48, width: Math.max(80, w - 96), height: Math.max(80, h - 96) }); peekView.setVisible(true); return;
  }
  const ids = [state.activeTabId, state.splitTabId].filter((id): id is string => Boolean(id));
  const firstWidth = state.splitTabId ? Math.floor((w - 8) * state.splitRatio) : w;
  for (const [index, id] of ids.entries()) {
    const tab = state.tabs.find(t => t.id === id); if (!tab || tab.url === 'about:blank' || tab.error) continue;
    const view = ensureTabView(tab);
    view.setBounds({ x: index === 0 ? x : x + firstWidth + 8, y, width: index === 0 ? firstWidth : w - firstWidth - 8, height: h }); view.setVisible(true);
  }
}

function promotePeek() {
  if (!state.peek) return;
  const view = peekView, info = state.peek;
  detachPeekEvents?.(); detachPeekEvents = null; peekView = null; peekUrl = '';
  state = applyCommand(state, { type: 'peek:promote' });
  if (view && state.activeTabId) {
    const tab = state.tabs.find(t => t.id === state.activeTabId)!;
    tab.title = info.title || tab.title;
    attachTabView(tab, view, false); recordVisit(state, tab);
  }
  reconcileViews(); sendState();
}
async function execute(command: BrowserCommand): Promise<BrowserState> {
  if (!win || win.isDestroyed()) return state;
  const wc = currentView()?.webContents;
  switch (command.type) {
    case 'overlay': overlayOpen = command.open; layout(); if (command.open) win.webContents.focus(); return state;
    case 'peek:promote': promotePeek(); return state;
    case 'back': if (wc?.navigationHistory.canGoBack()) wc.navigationHistory.goBack(); return state;
    case 'forward': if (wc?.navigationHistory.canGoForward()) wc.navigationHistory.goForward(); return state;
    case 'reload': wc?.reload(); return state;
    case 'stop': wc?.stop(); return state;
    case 'find': if (command.text) wc?.findInPage(command.text, { forward: command.forward ?? true, findNext: command.next ?? false }); return state;
    case 'find:stop': wc?.stopFindInPage('clearSelection'); return state;
    case 'devtools': wc?.openDevTools({ mode: 'detach' }); return state;
    case 'window:minimize': win.minimize(); return state;
    case 'window:maximize': win.isMaximized() ? win.unmaximize() : win.maximize(); return state;
    case 'window:close': win.close(); return state;
    case 'download:show': { const d = state.downloads.find(d => d.id === command.id); if (d?.status === 'completed' && d.path) shell.showItemInFolder(d.path); return state; }
    case 'download:cancel': downloadItems.get(command.id)?.cancel(); return state;
    case 'data:export': {
      const result = await dialog.showSaveDialog(win, { title: 'Export Tangent session', defaultPath: 'tangent-session.json', filters: [{ name: 'Tangent session', extensions: ['json'] }] });
      if (!result.canceled && result.filePath) writeFileSync(result.filePath, serializeState(state), { mode: 0o600 }); return state;
    }
    case 'data:import': {
      const result = await dialog.showOpenDialog(win, { title: 'Import Tangent session', properties: ['openFile'], filters: [{ name: 'Tangent session', extensions: ['json'] }] });
      if (result.canceled || !result.filePaths[0]) return state;
      const file = result.filePaths[0]; if (statSync(file).size > 12 * 1024 * 1024) throw new Error('Session file is too large.');
      const imported = restoreState(JSON.parse(readFileSync(file, 'utf8')));
      const answer = await dialog.showMessageBox(win, { type: 'question', message: 'Replace tabs and Spaces with this session?', detail: 'Your current session will be saved as a backup. Cookies and saved logins stay on this device.', buttons: ['Cancel', 'Import'], defaultId: 0, cancelId: 0 });
      if (answer.response !== 1) return state;
      writeFileSync(`${storage.path}.before-import-${Date.now()}`, serializeState(state), { mode: 0o600 });
      for (const view of views.values()) destroyView(view); views.clear();
      if (peekView) { destroyView(peekView); peekView = null; peekUrl = ''; }
      state = imported; reconcileViews(); sendState(); return state;
    }
  }
  const oldState = state;
  state = applyCommand(state, command);
  if (command.type === 'tab:close' && oldState.tabs.find(t => t.id === command.id)?.kind !== 'today') {
    const view = views.get(command.id); if (view) { destroyView(view); views.delete(command.id); }
  }
  if (command.type === 'tab:mute') { const tab = state.tabs.find(t => t.id === command.id); views.get(command.id)?.webContents.setAudioMuted(tab?.muted ?? false); }
  if (command.type === 'navigate' || command.type === 'tab:reset') {
    const id = command.type === 'tab:reset' ? command.id : focusedTabId();
    const tab = state.tabs.find(t => t.id === id), view = id ? views.get(id) : undefined;
    if (tab && view) void view.webContents.loadURL(tab.url).catch(e => updateTab(tab.id, { error: String(e), loading: false }));
  }
  if (command.type === 'settings:update') nativeTheme.themeSource = state.settings.theme;
  if (oldState.activeSpaceId !== state.activeSpaceId || oldState.peek?.url !== state.peek?.url) {
    if (peekView) { destroyView(peekView); peekView = null; peekUrl = ''; }
  }
  reconcileViews(); sendState(); return state;
}

function installMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [];
  if (process.platform === 'darwin') template.push({ label: 'Tangent', submenu: [{ role: 'about' }, { type: 'separator' }, { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => shortcut('settings') }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] });
  template.push({ label: 'File', submenu: [{ label: 'New tab', accelerator: 'CmdOrCtrl+T', click: () => shortcut('new-tab') }, { label: 'Open location…', accelerator: 'CmdOrCtrl+L', click: () => shortcut('address') }, { label: 'Close tab', accelerator: 'CmdOrCtrl+W', click: () => { if (state.peek) void execute({ type: 'peek:close' }); else if (focusedTabId()) void execute({ type: 'tab:close', id: focusedTabId()! }); } }, { label: 'Reopen closed tab', accelerator: 'CmdOrCtrl+Shift+T', click: () => { const a = state.archives.find(a => a.profileId === activeSpace(state).profileId); if (a) void execute({ type: 'archive:restore', id: a.id }); } }, { type: 'separator' }, { label: 'Export session…', click: () => void execute({ type: 'data:export' }) }, { label: 'Import session…', click: () => void execute({ type: 'data:import' }) }, ...(process.platform !== 'darwin' ? [{ role: 'quit' as const }] : [])] });
  template.push({ role: 'editMenu' }, { label: 'View', submenu: [{ label: 'Reload page', accelerator: 'CmdOrCtrl+R', click: () => void execute({ type: 'reload' }) }, { label: 'Find in page', accelerator: 'CmdOrCtrl+F', click: () => shortcut('find') }, { label: 'Toggle sidebar', accelerator: 'CmdOrCtrl+B', click: () => void execute({ type: 'sidebar:toggle' }) }, { label: 'Toggle split', accelerator: 'CmdOrCtrl+\\', click: () => void execute({ type: 'split:toggle' }) }, { type: 'separator' }, { label: 'Zoom in', accelerator: 'CmdOrCtrl+Plus', click: () => { const wc = currentView()?.webContents; if (wc) wc.setZoomLevel(wc.getZoomLevel() + .5); } }, { label: 'Zoom out', accelerator: 'CmdOrCtrl+-', click: () => { const wc = currentView()?.webContents; if (wc) wc.setZoomLevel(wc.getZoomLevel() - .5); } }, { label: 'Actual size', accelerator: 'CmdOrCtrl+0', click: () => currentView()?.webContents.setZoomLevel(0) }, { role: 'togglefullscreen' }, { type: 'separator' }, { label: 'Page developer tools', accelerator: 'Alt+CmdOrCtrl+I', click: () => void execute({ type: 'devtools' }) }] }, { role: 'windowMenu' });
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function createWindow() {
  overlayOpen = false;
  win = new BrowserWindow({ width: 1340, height: 880, minWidth: 900, minHeight: 620, show: false, title: 'Tangent', backgroundColor: '#17151e', frame: process.platform === 'darwin', titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 17, y: 20 }, autoHideMenuBar: true, webPreferences: { preload: join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, webviewTag: false, navigateOnDragDrop: false } });
  win.webContents.on('will-navigate', (event, url) => { if (url !== UI_URL) event.preventDefault(); });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-attach-webview', event => event.preventDefault());
  installShortcuts(win.webContents);
  win.on('resize', layout);
  win.once('ready-to-show', () => { win?.show(); layout(); sendState(false); });
  win.on('close', () => {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    saveSession();
    for (const view of views.values()) destroyView(view); views.clear();
    if (peekView) destroyView(peekView); peekView = null; peekUrl = '';
  });
  win.on('closed', () => { win = null; });
  await win.loadURL(UI_URL); installMenu();
}

app.on('certificate-error', (event, _wc, _url, _error, _certificate, callback) => { event.preventDefault(); callback(false); });
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(async () => {
  if (!primaryInstance) return;
  storage = new SessionStorage(app.getPath('userData')); state = storage.load();
  const updateRuntime = await createUpdateDriver(loadUpdatePolicy(app.isPackaged, process.platform, process.resourcesPath), process.resourcesPath);
  updates = new UpdateController({
    ...updateRuntime,
    currentVersion: app.getVersion(), electronVersion: process.versions.electron, chromiumVersion: process.versions.chrome,
    onState: updateState => { if (win && !win.isDestroyed()) win.webContents.send('tangent:update-state', updateState); },
    confirmRestart: async () => {
      if (!win || win.isDestroyed() || closing) return false;
      const answer = await dialog.showMessageBox(win, {
        type: 'question', title: 'Restart Tangent to update?', message: 'Restart now and install the downloaded update?',
        detail: 'Your tabs, Spaces, and settings will be saved. Unsaved forms, in-page work, and Peek previews may be lost. Active file downloads will stop. Save your work before continuing.',
        buttons: ['Keep browsing', 'Restart and update'], defaultId: 0, cancelId: 0, noLink: true,
      });
      return answer.response === 1 && !!win && !win.isDestroyed() && !closing;
    },
    saveBeforeInstall: async () => {
      if (closing || !win || win.isDestroyed()) throw new Error('The browser is closing.');
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
      await Promise.all([...configuredSessions].map(async ses => { ses.flushStorageData(); await ses.cookies.flushStore(); }));
      // Do not use saveSession here: a write failure must prevent the restart.
      storage.save(state);
    },
  });
  archiveIdle(state); nativeTheme.themeSource = state.settings.theme;
  protocol.handle('tangent', request => {
    const url = new URL(request.url);
    const files: Record<string, string> = { '/index.html': 'text/html; charset=utf-8', '/renderer.js': 'text/javascript; charset=utf-8', '/styles.css': 'text/css; charset=utf-8' };
    if (url.host !== 'app' || request.method !== 'GET' || !Object.hasOwn(files, url.pathname)) return new Response('Not found', { status: 404 });
    return new Response(readFileSync(join(__dirname, url.pathname.slice(1))), { headers: { 'Content-Type': files[url.pathname], 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff' } });
  });
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ipcMain.handle('tangent:get-state', event => { assertShell(event); return state; });
  ipcMain.handle('tangent:command', (event, command: unknown) => { assertShell(event); return execute(validateCommand(command)); });
  ipcMain.handle('tangent:update-state', event => { assertShell(event); return updates.getState(); });
  ipcMain.handle('tangent:update-check', event => { assertShell(event); return updates.checkForUpdates(); });
  ipcMain.handle('tangent:update-download', event => { assertShell(event); return updates.downloadUpdate(); });
  ipcMain.handle('tangent:update-install', event => { assertShell(event); return updates.installUpdate(); });
  ipcMain.handle('tangent:open-releases', async event => { assertShell(event); await shell.openExternal('https://github.com/davidjbeveridge/tangent/releases'); });
  await createWindow();
  updates.startAutomaticChecks();
  if (storage.warning && win) void dialog.showMessageBox(win, { type: 'warning', message: 'Session recovery', detail: storage.warning });
  setInterval(() => {
    if (closing) return;
    if (win?.isFocused()) {
      for (const id of [state.activeTabId, state.splitTabId]) { const tab = state.tabs.find(t => t.id === id); if (tab) tab.lastActiveAt = Date.now(); }
    }
    if (archiveIdle(state)) { reconcileViews(); sendState(); }
  }, 60000).unref();
  app.on('activate', () => { if (!win) void createWindow(); });
}).catch(error => { console.error(error); app.quit(); });
app.on('before-quit', () => { closing = true; updates?.dispose(); if (saveTimer) clearTimeout(saveTimer); if (storage && state) saveSession(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
