import type { BrowserCommand, BrowserState, Shortcut, Tab, UpdateState } from '../shared/types';

const icons: Record<string, string> = {
  tangent: '<path d="M12 2v20M3.34 7l17.32 10M3.34 17L20.66 7"/><path d="m8 3 4 5 4-5M8 21l4-5 4 5M2 10l6 2-6 2M22 10l-6 2 6 2"/>',
  search: '<circle cx="10.8" cy="10.8" r="6.3"/><path d="m16 16 4.5 4.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  back: '<path d="m14 6-6 6 6 6"/>',
  forward: '<path d="m10 6 6 6-6 6"/>',
  reload: '<path d="M20 10a8 8 0 1 0-1 8M20 4v6h-6"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  globe: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  sidebar: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/>',
  split: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M12 4v16"/>',
  archive: '<path d="M4 8v12h16V8M3 4h18v4H3zM10 12h4"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 15v5h16v-5"/>',
  settings: '<path d="m9.5 3-.5 3-2 .8-2.5-1.2-2 3.5 2.2 1.8v2.2l-2.2 1.8 2 3.5L7 17.2l2 .8.5 3h5l.5-3 2-.8 2.5 1.2 2-3.5-2.2-1.8v-2.2l2.2-1.8-2-3.5L17 6.8 15 6l-.5-3z"/><circle cx="12" cy="12" r="3"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  pin: '<path d="m8 3 8 0-1 6 3 3v2H6v-2l3-3-1-6M12 14v7"/>',
  star: '<path d="m12 3 2.8 5.8 6.4 1-4.6 4.5 1.1 6.3-5.7-3-5.7 3 1.1-6.3-4.6-4.5 6.4-1z"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2"/>',
  user: '<circle cx="12" cy="8" r="3"/><path d="M5 21v-3a7 7 0 0 1 14 0v3"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  arrowup: '<path d="M12 19V5m-5 5 5-5 5 5"/>',
  arrowdown: '<path d="M12 5v14m-5-5 5 5 5-5"/>',
  rename: '<path d="m15 4 5 5M4 15 15 4a3.5 3.5 0 0 1 5 5L9 20l-6 1z"/>',
  move: '<path d="M4 5h6l2 2h8v13H4zM9 13h7m-3-3 3 3-3 3"/>',
  peek: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7"/><circle cx="12" cy="12" r="3"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  mute: '<path d="M11 5 6 9H3v6h3l5 4V5m5 4 5 6m0-6-5 6"/>',
  volume: '<path d="m11 5-5 4H3v6h3l5 4V5m4 3a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  file: '<path d="M14 3H5v18h14V8zM14 3v5h5M8 13h8M8 17h5"/>',
  minimize: '<path d="M5 12h14"/>',
  maximize: '<rect x="5" y="5" width="14" height="14" rx="1"/>',
  leaf: '<path d="M20 3C8 2 2 8 5 15s15 7 15-12ZM5 20l10-11"/>',
};
const icon = (name: string, css = '') => `<svg ${css ? `class="${css}"` : ''} viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.globe}</svg>`;
const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const app = document.querySelector<HTMLDivElement>('#app')!;
const overlay = document.querySelector<HTMLDivElement>('#overlay-root')!;
const findRoot = document.querySelector<HTMLDivElement>('#find-root')!;
let state: BrowserState;
let updateState: UpdateState | null = null;
let updateLoadError = '';
let updateActionPending = false;
let modal = '';
let modalId = '';
let paletteMode: 'new' | 'navigate' = 'new';
let paletteQuery = '';
let paletteIndex = 0;
let paletteItems: { title: string; subtitle: string; icon: string; action: () => Promise<void> }[] = [];
let listQuery = '';
let selectedColor = '#9180b8';
let lastFocus: HTMLElement | null = null;
let toastTimer: ReturnType<typeof setTimeout>;
let draggingId = '';
let findOpen = false;
let overlayEpoch = 0;
const mod = window.tangent?.platform === 'darwin' ? '⌘' : 'Ctrl';
const shortcut = (key: string) => `<kbd>${mod}${mod === 'Ctrl' ? '+' : ''}${key}</kbd>`;
const colors = ['#9180b8', '#6e9a8c', '#ba8b73', '#7b9cb8', '#ba7d97', '#b2a271'];
const currentSpace = () => state.spaces.find(s => s.id === state.activeSpaceId)!;
const currentTab = () => state.tabs.find(t => t.id === (state.focusedTabId ?? state.activeTabId));
const activeProfile = () => currentSpace()?.profileId;
const domain = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, '') || 'New tab'; } catch { return url; } };
const symbol = (tab: Tab) => tab.url === 'about:blank' ? '✦' : (domain(tab.url)[0] || '↗').toUpperCase();
const bytes = (value: number) => value >= 1048576 ? `${(value / 1048576).toFixed(1)} MB` : `${Math.ceil(value / 1024)} KB`;
const date = (value: number) => new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const button = (name: string, title: string, action: string, extra = '') => `<button class="icon-button" title="${esc(title)}" aria-label="${esc(title)}" data-action="${action}" ${extra}>${icon(name)}</button>`;

function toast(message: string) {
  const node = document.querySelector('#toast')!;
  node.textContent = message;
  node.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('visible'), 4200);
}
async function dispatch(command: BrowserCommand): Promise<boolean> {
  try {
    state = await window.tangent.dispatch(command);
    render();
    return true;
  } catch (error) { toast(error instanceof Error ? error.message : String(error)); return false; }
}
function updateSection() {
  const u = updateState;
  const versions = [
    ['Tangent', u?.currentVersion || window.tangent.version],
    ['Electron', u?.electronVersion || 'Unavailable'],
    ['Chromium', u?.chromiumVersion || 'Unavailable'],
  ];
  const titles: Record<UpdateState['status'], string> = {
    unsupported: 'Update Tangent manually',
    idle: u?.lastCheckedAt ? 'No newer Tangent release found' : 'Ready to check for updates',
    checking: 'Checking for updates…',
    available: `Tangent ${u?.availableVersion || 'update'} is available`,
    downloading: 'Downloading update…',
    downloaded: 'Update ready to install',
    error: 'Update could not be completed',
  };
  const status = updateLoadError ? 'Update status unavailable' : u ? titles[u.status] : 'Loading update status…';
  const message = updateLoadError || u?.message || 'Reading the installed browser version.';
  const progress = Math.max(0, Math.min(100, u?.progress || 0));
  return `<h3>About Tangent</h3><div class="version-grid" aria-label="Installed browser versions">${versions.map(([name, version]) => `<div><span>${name}</span><strong data-version="${name.toLowerCase()}">${esc(version)}</strong></div>`).join('')}</div><p class="update-explanation">Tangent updates include its Chromium engine. The browser and engine are updated together.</p><div class="update-status-card" data-update-status="${u?.status || 'loading'}"><strong id="update-status" role="status" aria-live="polite">${esc(status)}</strong><p id="update-message">${esc(message)}</p>${u?.status === 'downloading' ? `<div class="update-progress" role="progressbar" aria-label="Update download" aria-valuenow="${Math.round(progress)}" aria-valuemin="0" aria-valuemax="100"><span data-update-progress="${progress}"></span></div><small>${Math.round(progress)}% downloaded</small>` : ''}${u?.lastCheckedAt ? `<small>Last checked ${esc(new Date(u.lastCheckedAt).toLocaleString())}</small>` : ''}</div><div class="setting-actions update-actions"><button class="${u?.status === 'unsupported' ? 'primary-button' : 'secondary-button'}" data-action="updates-releases">${icon('arrow')}Open releases</button><button class="secondary-button" data-action="updates-check" ${!u?.canCheck || updateActionPending ? 'disabled' : ''}>${icon('reload')}Check for updates</button>${u?.canDownload || u?.status === 'downloading' ? `<button class="primary-button" data-action="updates-download" ${!u.canDownload || updateActionPending ? 'disabled' : ''}>${icon('download')}${u.status === 'downloading' ? 'Downloading…' : 'Download update'}</button>` : ''}${u?.canInstall ? `<button class="primary-button" data-action="updates-install" ${updateActionPending ? 'disabled' : ''}>${icon('reload')}Restart and install</button>` : ''}</div>${u?.status === 'unsupported' ? '<p class="update-manual-note"><strong>Downloaded app:</strong> Get the latest release, quit Tangent, and replace the installed app.<br><strong>From source:</strong> Close Tangent, then run <code>npm run update</code> in the project folder.</p>' : ''}${u?.canInstall ? '<p class="update-restart-note">Install when you’re ready. Tangent will ask before restarting; save anything you have typed into web pages first.</p>' : ''}`;
}
function refreshUpdateSection() {
  const section = overlay.querySelector<HTMLElement>('#update-section');
  if (!section) return;
  const focusAction = document.activeElement instanceof HTMLElement && section.contains(document.activeElement) ? document.activeElement.dataset.action : undefined;
  section.innerHTML = updateSection();
  const progress = section.querySelector<HTMLElement>('[data-update-progress]');
  if (progress) progress.style.width = `${progress.dataset.updateProgress}%`;
  if (focusAction) section.querySelector<HTMLButtonElement>(`[data-action="${focusAction}"]:not(:disabled)`)?.focus();
}
async function runUpdate(action: 'check' | 'download' | 'install') {
  if (updateActionPending) return;
  updateActionPending = true; refreshUpdateSection();
  try {
    updateState = await (action === 'check' ? window.tangent.checkForUpdates() : action === 'download' ? window.tangent.downloadUpdate() : window.tangent.installUpdate());
    updateLoadError = '';
  } catch (error) {
    updateLoadError = error instanceof Error ? error.message : String(error);
    toast(updateLoadError);
  } finally { updateActionPending = false; refreshUpdateSection(); }
}

function theme() {
  const dark = state.settings.theme === 'dark' || (state.settings.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.style.setProperty('--sidebar-width', `${state.settings.sidebarWidth}px`);
  const color = currentSpace()?.color;
  document.documentElement.style.setProperty('--space-color', /^#[0-9a-f]{6}$/i.test(color || '') ? color! : '#9180b8');
}
function tabRow(tab: Tab) {
  return `<div class="tab-row ${tab.id === (state.focusedTabId ?? state.activeTabId) ? 'active' : ''} ${tab.id === state.splitTabId ? 'secondary' : ''}" draggable="true" data-tab-id="${esc(tab.id)}" role="listitem">
    <button class="tab-select" data-action="activate-tab" data-id="${esc(tab.id)}" title="${esc(tab.url)}" aria-label="Open ${esc(tab.title)}" ${tab.id === (state.focusedTabId ?? state.activeTabId) ? 'aria-current="page"' : ''}>
      <span class="tab-symbol ${tab.loading ? 'loading' : ''}">${tab.loading ? '' : esc(symbol(tab))}</span><span class="tab-title">${esc(tab.title || 'New tab')}</span>${tab.audible ? icon(tab.muted ? 'mute' : 'volume', 'tab-audio') : ''}
    </button><button class="tab-close" data-action="close-tab" data-id="${esc(tab.id)}" title="${tab.kind === 'today' ? 'Archive tab' : 'Close tab'}" aria-label="Close ${esc(tab.title)}">${icon('close')}</button>
  </div>`;
}
function render() {
  if (!state) return;
  theme();
  const space = currentSpace();
  const tab = currentTab();
  const primaryTab = state.tabs.find(t => t.id === state.activeTabId);
  const tabs = state.tabs.filter(t => t.spaceId === state.activeSpaceId && t.kind !== 'favorite');
  const favorites = state.tabs.filter(t => t.kind === 'favorite' && t.profileId === activeProfile());
  const pinned = tabs.filter(t => t.kind === 'pinned');
  const today = tabs.filter(t => t.kind === 'today');
  const empty = !primaryTab || primaryTab.url === 'about:blank';
  const addressEmpty = !tab || tab.url === 'about:blank';
  const profile = state.profiles.find(p => p.id === activeProfile());
  app.innerHTML = `<div class="shell ${window.tangent.platform === 'darwin' ? 'mac' : ''} ${state.sidebarHidden ? 'sidebar-collapsed' : ''}">
    ${!state.sidebarHidden ? `<aside class="sidebar" aria-label="Browser sidebar">
      <div class="sidebar-top"><div class="brand">${icon('tangent')}<span>Tangent</span></div>${button('sidebar', 'Hide sidebar', 'sidebar')}</div>
      <button class="sidebar-search" data-action="palette-new">${icon('search')}<span>Search anything</span>${shortcut('T')}</button>
      <div class="favorites" aria-label="Favorite tabs">${favorites.map(t => `<button class="favorite ${t.id === (state.focusedTabId ?? state.activeTabId) ? 'active' : ''}" draggable="true" data-tab-id="${esc(t.id)}" data-action="activate-tab" data-id="${esc(t.id)}" title="${esc(t.title)} · ${esc(domain(t.url))}" aria-label="Favorite ${esc(t.title)}">${esc(symbol(t))}</button>`).join('')}${favorites.length < 8 ? `<button class="favorite favorite-add" data-action="favorite-add" title="Add a favorite" aria-label="Add a favorite">${icon('plus')}</button>` : ''}</div>
      <div class="sidebar-scroll">
        <div class="space-heading"><span class="space-icon">${esc(space?.icon || '✦')}</span><strong>${esc(space?.name || 'Space')}</strong>${button('more', 'Space options', 'space-options')}</div>
        <section class="tabs-section" aria-label="Pinned tabs"><div class="section-label">PINNED <span>${pinned.length || ''}</span></div><div role="list">${pinned.map(tabRow).join('')}</div>${!pinned.length ? '<p class="empty-tabs">Right-click a tab to keep it here.</p>' : ''}</section>
        <section class="tabs-section" aria-label="Today tabs"><div class="section-label">TODAY <span>${today.length || ''}</span></div><div role="list">${today.map(tabRow).join('')}</div><button class="new-tab" data-action="palette-new">${icon('plus')}<span>New tab</span>${shortcut('T')}</button></section>
      </div>
      <div class="sidebar-bottom"><nav class="space-switcher" aria-label="Spaces">${state.spaces.map(s => `<button class="space-chip ${s.id === state.activeSpaceId ? 'active' : ''}" data-action="space-switch" data-id="${esc(s.id)}" title="${esc(s.name)}" aria-label="Switch to ${esc(s.name)}" ${s.id === state.activeSpaceId ? 'aria-current="true"' : ''}>${esc(s.icon || '✦')}</button>`).join('')}<button class="space-chip add" data-action="new-space" title="New space" aria-label="New space">+</button></nav>
      <div class="footer-tools"><span class="profile-name" title="Current profile: ${esc(profile?.name)}">${icon('user')}${esc(profile?.name || 'Default')}</span>${button('archive','Archived tabs','archive')}${button('history','History','history')}${button('settings','Settings','settings')}</div></div>
    </aside>` : ''}
    <main class="main" aria-label="Browser content"><header class="toolbar">
      ${state.sidebarHidden ? button('sidebar','Show sidebar','sidebar') : ''}
      <div class="nav-buttons">${button('back','Back','back',!tab?.canGoBack?'disabled':'')}${button('forward','Forward','forward',!tab?.canGoForward?'disabled':'')}${button(tab?.loading?'stop':'reload',tab?.loading?'Stop loading':'Reload',tab?.loading?'stop':'reload',!tab?'disabled':'')}</div>
      <button class="address" data-action="palette-address" aria-label="Address bar" title="${esc(tab?.url || 'Search or enter a URL')}">${icon(tab?.url.startsWith('https:') ? 'lock' : 'globe')}<span>${addressEmpty ? 'Search or enter a URL' : esc(domain(tab!.url))}</span>${shortcut('L')}</button>
      <div class="toolbar-actions">${button('split',state.splitTabId?'Close split view':'Split view',state.splitTabId?'split-close':'split','data-testid="split-button"')}${button('peek','Peek at a URL','peek')}${button('download','Downloads','downloads')}${button('more','Browser menu','menu')}</div>
      ${window.tangent.platform !== 'darwin' ? `<div class="window-controls">${button('minimize','Minimize','window-minimize')}${button('maximize','Maximize','window-maximize')}${button('close','Close window','window-close')}</div>` : ''}
    </header>
    <div class="content-frame">${empty ? `<section class="home" aria-label="New tab"><div class="home-content"><div class="home-mark">${icon('tangent')}</div><div class="home-eyebrow">A little room to think</div><h1>Your space. Your internet.</h1><p>Keep what matters. Let the rest go.<br>A calmer place for your next good idea.</p><button class="home-search" data-action="palette-new">${icon('search')}<span>Where would you like to go?</span>${shortcut('T')}</button><div class="home-shortcuts"><button class="home-shortcut" data-action="new-space">${icon('plus')}<span>Create a space</span></button><button class="home-shortcut" data-action="archive">${icon('archive')}<span>Revisit your tabs</span></button><button class="home-shortcut" data-action="settings">${icon('settings')}<span>Make it yours</span></button></div></div><div class="home-footer">No account required <span>·</span> Your data stays on this device <span>·</span> Open source</div></section>` : '<div class="page-placeholder" aria-hidden="true"></div>'}
    ${primaryTab?.error ? `<div class="load-error">${icon('globe')}<h2>This page couldn’t be opened</h2><p>${esc(primaryTab.error)}</p><p>${esc(primaryTab.url)}</p><button class="primary-button" data-action="reload">Try again</button></div>` : ''}</div>
    ${state.splitTabId ? '<div class="split-handle" role="separator" aria-label="Resize split view" aria-orientation="vertical" tabindex="0"></div>' : ''}
    ${state.peek ? `<div class="peek-controls"><strong>Peek</strong><span>${esc(state.peek.title || state.peek.url)}</span><button class="secondary-button" data-action="peek-promote">Open as tab ${icon('arrow')}</button>${button('close','Close Peek','peek-close')}</div>` : ''}
    </main></div>`;
  const handle = app.querySelector<HTMLElement>('.split-handle');
  if (handle) {
    const contentWidth = window.innerWidth - (state.sidebarHidden ? 0 : state.settings.sidebarWidth) - 16;
    handle.style.left = `${8 + Math.floor((contentWidth - 8) * state.splitRatio)}px`;
    handle.setAttribute('aria-valuenow', String(Math.round(state.splitRatio * 100)));
    handle.setAttribute('aria-valuemin', '25'); handle.setAttribute('aria-valuemax', '75');
    const firstWidth = Math.floor((contentWidth - 8) * state.splitRatio);
    const firstHome = app.querySelector<HTMLElement>('.content-frame > .home');
    if(firstHome){firstHome.style.width=`${firstWidth}px`;firstHome.classList.add('split-home');}
    const firstError=app.querySelector<HTMLElement>('.content-frame > .load-error');if(firstError){firstError.style.width=`${firstWidth}px`;firstError.style.right='auto';}
    const second = state.tabs.find(t=>t.id===state.splitTabId);
    if(second && (second.url==='about:blank' || second.error)){
      const pane=document.createElement('section');pane.className='split-empty';pane.style.left=`${firstWidth+8}px`;
      pane.innerHTML=second.error ? `${icon('globe')}<h2>This page couldn’t be opened</h2><p>${esc(second.error)}</p><button class="secondary-button" data-action="reload-pane" data-id="${esc(second.id)}">Try again</button>` : `${icon('split')}<h2>A second perspective</h2><p>Open a page beside the first.</p><button class="secondary-button" data-action="navigate-split" data-id="${esc(second.id)}">${icon('search')}Search or enter a URL</button>`;
      app.querySelector('.content-frame')!.append(pane);
    }
  }
}

async function openModal(kind: string, id = '') {
  const epoch = ++overlayEpoch;
  if (!modal) lastFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  modal = kind; modalId = id; listQuery = ''; app.inert = true;
  await dispatch({ type: 'overlay', open: true });
  if (epoch !== overlayEpoch || modal !== kind) return;
  renderModal(); refreshUpdateSection();
  requestAnimationFrame(() => { const target=kind==='settings' ? overlay.querySelector<HTMLButtonElement>('[data-action="modal-close"]') : overlay.querySelector<HTMLInputElement>('input:not([type=hidden]), select') || overlay.querySelector<HTMLButtonElement>('button'); target?.focus(); if(kind==='rename-tab' && target instanceof HTMLInputElement)target.select(); });
}
async function closeModal() {
  ++overlayEpoch;
  modal = ''; modalId = ''; overlay.innerHTML = ''; app.inert = false;
  await dispatch({ type: 'overlay', open: false });
  if (lastFocus?.isConnected) lastFocus.focus(); else app.querySelector<HTMLButtonElement>('.address')?.focus();
}
async function palette(mode: 'new' | 'navigate') {
  paletteMode = mode;
  paletteQuery = mode === 'navigate' && currentTab()?.url !== 'about:blank' ? currentTab()?.url || '' : '';
  paletteIndex = 0;
  await openModal('palette');
  const field = overlay.querySelector<HTMLInputElement>('#palette-input');
  field?.focus(); field?.select();
}
function frame(title: string, content: string, footer = '', css = '') {
  return `<div class="overlay" data-dismiss="true"><section class="modal ${css}" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header class="modal-header"><h2 id="modal-title">${title}</h2>${button('close','Close dialog','modal-close')}</header><div class="modal-body">${content}</div>${footer ? `<footer class="modal-footer">${footer}</footer>` : ''}</section></div>`;
}
function renderPaletteResults() {
  const q = paletteQuery.trim();
  paletteItems = [];
  if (q) {
    const isUrl = /^(https?:\/\/|localhost[:/]|[\w-]+\.[^\s]+|about:blank)/i.test(q);
    paletteItems.push({ title: isUrl ? `Go to ${q}` : `Search for “${q}”`, subtitle: paletteMode === 'navigate' ? 'Open in the current tab' : 'Open in a new tab', icon: isUrl ? 'globe' : 'search', action: async () => { await closeModal(); await dispatch(paletteMode === 'navigate' ? { type: 'navigate', url: q } : { type: 'tab:new', url: q }); } });
    state.tabs.filter(t => t.profileId === activeProfile() && `${t.title} ${t.url}`.toLowerCase().includes(q.toLowerCase())).slice(0, 7).forEach(t => paletteItems.push({ title: t.title, subtitle: `${domain(t.url)} · Switch to open tab`, icon: t.kind === 'pinned' ? 'pin' : 'globe', action: async () => { await closeModal(); await dispatch({ type: 'tab:activate', id: t.id }); } }));
    const seen = new Set(paletteItems.map(i => i.title));
    state.history.filter(h => h.profileId === activeProfile() && `${h.title} ${h.url}`.toLowerCase().includes(q.toLowerCase())).slice(0, 5).forEach(h => { if (!seen.has(h.title)) { seen.add(h.title); paletteItems.push({ title: h.title || domain(h.url), subtitle: `${domain(h.url)} · History`, icon: 'history', action: async () => { await closeModal(); await dispatch({ type: 'tab:new', url: h.url }); } }); } });
  } else {
    const commands = [
      ['New tab', 'Start with a blank page', 'plus', async () => { await closeModal(); await dispatch({ type: 'tab:new' }); }],
      ['Create a space', 'Separate projects, interests, or contexts', 'sidebar', async () => { await openModal('new-space'); }],
      ['Archived tabs', 'Find a tab you left behind', 'archive', async () => { await openModal('archive'); }],
      ['Split view', 'Put two tabs side by side', 'split', async () => { await openModal('split'); }],
      ['Settings', 'Profiles, appearance, and your data', 'settings', async () => { await openModal('settings'); }],
    ] as const;
    commands.forEach(([title, subtitle, glyph, action]) => paletteItems.push({ title, subtitle, icon: glyph, action }));
  }
  paletteIndex = Math.max(0, Math.min(paletteIndex, paletteItems.length - 1));
  const results = overlay.querySelector('#palette-results');
  if (results) results.innerHTML = `<div class="palette-label">${q ? 'Go, search, or switch' : 'Jump right in'}</div>${paletteItems.map((item, i) => `<button class="result-row ${i === paletteIndex ? 'selected' : ''}" data-action="palette-select" data-index="${i}" role="option" aria-selected="${i === paletteIndex}" id="palette-result-${i}"><span class="result-icon">${icon(item.icon)}</span><span class="result-text"><strong>${esc(item.title)}</strong><small>${esc(item.subtitle)}</small></span>${i === paletteIndex ? '<span>↵</span>' : ''}</button>`).join('')}`;
  overlay.querySelector('#palette-input')?.setAttribute('aria-activedescendant', `palette-result-${paletteIndex}`);
}
function renderModal() {
  if (!modal) return;
  if (modal === 'palette') {
    overlay.innerHTML = `<div class="overlay" data-dismiss="true"><section class="modal wide" role="dialog" aria-modal="true" aria-label="Command bar"><div class="palette-input-row">${icon('search')}<input id="palette-input" autocomplete="off" spellcheck="false" placeholder="Search, enter a URL, or switch tabs…" aria-label="Search, URL, or command" role="combobox" aria-controls="palette-results" aria-expanded="true" value="${esc(paletteQuery)}"><button data-action="modal-close" title="Close command bar"><kbd>esc</kbd></button></div><div class="palette-results" id="palette-results" role="listbox"></div><div class="palette-footer"><span><kbd>↑</kbd> <kbd>↓</kbd> to navigate</span><span><kbd>↵</kbd> to open</span><span>Tangent command bar</span></div></section></div>`;
    renderPaletteResults(); return;
  }
  if (modal === 'new-space' || modal === 'edit-space') {
    const editing = modal === 'edit-space'; const space = currentSpace();
    selectedColor = editing ? space.color : selectedColor;
    overlay.innerHTML = frame(editing ? 'Edit space' : 'A space for what matters', `<p class="modal-subtitle">Spaces organize your tabs. Profiles separate your accounts, cookies, and browsing history.</p><form id="space-form"><div class="field"><label for="space-name">Space name</label><input id="space-name" maxlength="40" placeholder="Work, Weekend, The next big thing…" required value="${editing ? esc(space.name) : ''}"></div><div class="field-row"><div class="field"><label for="space-icon">Symbol</label><input id="space-icon" maxlength="8" value="${editing ? esc(space.icon) : '✦'}" placeholder="✦"></div>${!editing ? `<div class="field"><label for="space-profile">Profile</label><select id="space-profile">${state.profiles.map(p => `<option value="${esc(p.id)}" ${p.id === activeProfile() ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}<option value="__new">Create new profile…</option></select></div>` : ''}</div><div class="field" id="new-profile-field" hidden><label for="new-profile-name">New profile name</label><input id="new-profile-name" maxlength="40" placeholder="Work account"></div><div class="field"><label>Space color</label><div class="color-choices">${colors.map(c => `<button type="button" class="color-choice ${c === selectedColor ? 'selected' : ''}" data-action="color" data-color="${c}" aria-label="${c}" aria-pressed="${c === selectedColor}"></button>`).join('')}</div></div></form>`, `<button class="secondary-button" data-action="modal-close">Cancel</button><button class="primary-button" data-action="save-space">${editing ? 'Save changes' : 'Create space'}</button>`, 'compact');
    overlay.querySelectorAll<HTMLElement>('.color-choice').forEach(el => el.style.backgroundColor = el.dataset.color!); return;
  }
  if (modal === 'space-options') {
    const s = currentSpace();
    overlay.innerHTML = frame(esc(s.name), `<p class="mini-caption">${esc(state.profiles.find(p => p.id === s.profileId)?.name)} profile</p><div class="context-actions"><button class="context-action" data-action="edit-space">${icon('rename')}Edit name and appearance</button><button class="context-action" data-action="new-space">${icon('plus')}Create another space</button>${state.spaces.length > 1 ? `<div class="context-separator"></div><button class="context-action danger" data-action="delete-space">${icon('close')}Delete this space</button><p class="mini-caption">Its ordinary tabs will be archived. Favorites belong to the profile and stay available.</p>` : ''}</div>`, '', 'compact'); return;
  }
  if (modal === 'tab-options') {
    const t = state.tabs.find(t => t.id === modalId); if (!t) { void closeModal(); return; }
    overlay.innerHTML = frame(esc(t.title), `<p class="mini-caption">${esc(t.url)}</p><div class="context-actions"><button class="context-action" data-action="tab-pin" data-id="${esc(t.id)}">${icon('pin')}${t.kind === 'pinned' ? 'Unpin tab' : 'Pin tab'}</button><button class="context-action" data-action="tab-favorite" data-id="${esc(t.id)}">${icon('star')}${t.kind === 'favorite' ? 'Remove from favorites' : 'Add to favorites'}</button><button class="context-action" data-action="tab-rename" data-id="${esc(t.id)}">${icon('rename')}Rename tab</button><button class="context-action" data-action="tab-move" data-id="${esc(t.id)}">${icon('move')}Move to space</button><button class="context-action" data-action="tab-split" data-id="${esc(t.id)}">${icon('split')}Open in split view</button><button class="context-action" data-action="tab-peek" data-id="${esc(t.id)}">${icon('peek')}Open URL in Peek</button><button class="context-action" data-action="tab-mute" data-id="${esc(t.id)}">${icon(t.muted ? 'volume' : 'mute')}${t.muted ? 'Unmute' : 'Mute'} tab</button>${t.kind !== 'today' ? `<button class="context-action" data-action="tab-reset" data-id="${esc(t.id)}">${icon('reload')}Return to saved URL</button>` : ''}<div class="context-separator"></div><button class="context-action danger" data-action="close-tab" data-id="${esc(t.id)}">${icon('close')}${t.kind === 'today' ? 'Archive tab' : 'Close page (keep saved tab)'}</button>${t.kind !== 'today' ? `<button class="context-action danger" data-action="remove-tab" data-id="${esc(t.id)}">${icon('close')}Remove saved tab</button>` : ''}</div>`, '', 'compact'); return;
  }
  if (modal === 'rename-tab') {
    const t = state.tabs.find(t => t.id === modalId);
    overlay.innerHTML = frame('Rename tab', `<form id="rename-form"><div class="field"><label for="tab-title">Tab name</label><input id="tab-title" value="${esc(t?.title)}" maxlength="180" required></div></form>`, '<button class="secondary-button" data-action="modal-close">Cancel</button><button class="primary-button" data-action="save-tab-name">Save name</button>', 'compact'); return;
  }
  if (modal === 'move-tab') {
    overlay.innerHTML = frame('Move tab to a space', `<p class="modal-subtitle">Spaces sharing the same profile keep this tab’s signed-in session.</p><div class="context-actions">${state.spaces.filter(s => s.id !== state.tabs.find(t => t.id === modalId)?.spaceId && s.profileId === state.tabs.find(t => t.id === modalId)?.profileId).map(s => `<button class="context-action" data-action="move-tab-to" data-id="${esc(s.id)}"><span>${esc(s.icon)}</span>${esc(s.name)}<small>${esc(state.profiles.find(p => p.id === s.profileId)?.name)}</small></button>`).join('') || '<div class="list-empty">Create another space first.</div>'}</div>`, '', 'compact'); return;
  }
  if (modal === 'archive' || modal === 'history') {
    const archive = modal === 'archive';
    const records = archive ? state.archives.filter(t => t.profileId === activeProfile()) : state.history.filter(h => h.profileId === activeProfile());
    const filtered = records.filter(t => `${t.title} ${t.url}`.toLowerCase().includes(listQuery.toLowerCase())).slice(0, 120);
    overlay.innerHTML = frame(`${icon(archive?'archive':'history')}${archive ? 'Archived tabs' : 'Browsing history'}`, `<p class="modal-subtitle">${archive ? 'A fresh start doesn’t have to mean goodbye. Restore a tab whenever you need it.' : 'Pages visited with this profile, stored on this device.'}</p><input id="list-search" class="list-search" placeholder="Search ${archive ? 'archived tabs' : 'history'}…" value="${esc(listQuery)}" aria-label="Search ${archive ? 'archive' : 'history'}"><div id="history-list">${filtered.map(t => `<div class="history-row"><span class="result-icon">${icon(archive?'archive':'globe')}</span><button class="open-history" data-action="${archive?'restore-tab':'open-history'}" ${archive ? `data-id="${esc((t as {id:string}).id)}"` : `data-url="${esc(t.url)}"`}><strong>${esc(t.title || domain(t.url))}</strong><small>${esc(domain(t.url))} · ${date(archive ? (t as {archivedAt:number}).archivedAt : (t as {visitedAt:number}).visitedAt)}</small></button>${icon('arrow')}</div>`).join('') || `<div class="list-empty">${icon(archive?'archive':'history')}<span>${listQuery ? 'No matching pages.' : archive ? 'Nothing archived yet.<br>Closed and idle Today tabs appear here.' : 'Your browsing history will appear here.'}</span></div>`}</div>`, `${records.length ? `<button class="secondary-button danger" data-action="${archive?'clear-archive':'clear-history'}">Clear ${archive?'archive':'history'}</button>` : ''}<button class="primary-button" data-action="modal-close">Done</button>`, 'wide'); return;
  }
  if (modal === 'split') {
    const choices = state.tabs.filter(t => t.profileId === activeProfile() && (t.kind === 'favorite' || t.spaceId === state.activeSpaceId) && t.id !== state.activeTabId);
    overlay.innerHTML = frame('Give your tabs some company', `<p class="modal-subtitle">Choose a second tab. Drag the divider to find the right balance.</p><div class="context-actions">${choices.map(t => `<button class="context-action" data-action="choose-split" data-id="${esc(t.id)}">${icon('globe')}<span>${esc(t.title)}</span><small>${esc(domain(t.url))}</small></button>`).join('')}<button class="context-action" data-action="split-new">${icon('plus')}New blank tab beside this one</button></div>`, '', 'compact'); return;
  }
  if (modal === 'peek') {
    overlay.innerHTML = frame('A quick look', `<p class="modal-subtitle">Open a page without losing your place. Keep it as a tab when you’re ready.</p><form id="peek-form"><div class="field"><label for="peek-url">URL or search</label><input id="peek-url" placeholder="https://example.com" autocomplete="off" required></div></form>`, '<button class="secondary-button" data-action="modal-close">Cancel</button><button class="primary-button" data-action="peek-submit">Open Peek</button>', 'compact'); return;
  }
  if (modal === 'favorite-add') {
    overlay.innerHTML = frame('Keep a favorite close', `<p class="modal-subtitle">Favorites are available in every space using this profile.</p><form id="favorite-form"><div class="field"><label for="favorite-url">Website URL</label><input id="favorite-url" placeholder="https://example.com" autocomplete="off" required></div></form>`, '<button class="secondary-button" data-action="modal-close">Cancel</button><button class="primary-button" data-action="favorite-submit">Add favorite</button>', 'compact'); return;
  }
  if (modal === 'downloads') {
    overlay.innerHTML = frame(`${icon('download')}Downloads`, state.downloads.map(d => `<div class="download-row"><span class="result-icon">${icon('file')}</span><div class="download-details"><strong>${esc(d.name)}</strong><small>${d.status === 'progressing' ? `${bytes(d.receivedBytes)}${d.totalBytes ? ` of ${bytes(d.totalBytes)}` : ''}` : esc(d.status)}</small>${d.status === 'progressing' ? '<div class="download-progress"><span data-progress="'+esc(d.id)+'"></span></div>' : ''}</div>${d.status === 'completed' ? button('move','Show in folder','download-show',`data-id="${esc(d.id)}"`) : d.status === 'progressing' ? button('close','Cancel download','download-cancel',`data-id="${esc(d.id)}"`) : ''}</div>`).join('') || `<div class="list-empty">${icon('download')}<span>No downloads this session.</span></div>`, '<button class="primary-button" data-action="modal-close">Done</button>');
    overlay.querySelectorAll<HTMLElement>('[data-progress]').forEach(el => { const d=state.downloads.find(d=>d.id===el.dataset.progress)!; el.style.width=`${d.totalBytes ? Math.min(100, 100*d.receivedBytes/d.totalBytes) : 20}%`; }); return;
  }
  if (modal === 'settings') {
    overlay.innerHTML = frame(`${icon('settings')}Make yourself at home`, `<section class="settings-section" id="update-section">${updateSection()}</section><section class="settings-section"><h3>Appearance and browsing</h3><div class="setting-row"><div class="setting-description"><strong>Appearance</strong><small>A little light, or a quieter dark.</small></div><select id="setting-theme" aria-label="Appearance">${['system','light','dark'].map(v=>`<option value="${v}" ${state.settings.theme===v?'selected':''}>${v[0].toUpperCase()+v.slice(1)}</option>`).join('')}</select></div><div class="setting-row"><div class="setting-description"><strong>Search engine</strong><small>Used when you type a search in the address bar.</small></div><select id="setting-search" aria-label="Search engine"><option value="duckduckgo" ${state.settings.searchEngine==='duckduckgo'?'selected':''}>DuckDuckGo</option><option value="google" ${state.settings.searchEngine==='google'?'selected':''}>Google</option></select></div><div class="setting-row"><div class="setting-description"><strong>Archive idle tabs</strong><small>Pinned tabs and favorites stay put.</small></div><select id="setting-archive" aria-label="Archive idle tabs">${[[0,'Never'],[12,'After 12 hours'],[24,'After 1 day'],[48,'After 2 days'],[168,'After 1 week'],[720,'After 30 days']].map(([v,l])=>`<option value="${v}" ${state.settings.archiveAfterHours===v?'selected':''}>${l}</option>`).join('')}</select></div></section><section class="settings-section"><h3>Profiles</h3><p class="modal-subtitle">Separate cookies and logins. Assign a profile when creating a space.</p>${state.profiles.map(p=>`<div class="setting-row"><div class="setting-description"><strong>${esc(p.name)}</strong><small>${state.spaces.filter(s=>s.profileId===p.id).length} space(s)</small></div>${p.id===activeProfile()?'<span class="tiny-label">Current</span>':''}</div>`).join('')}<div class="setting-actions"><button class="secondary-button" data-action="new-profile">${icon('plus')}New profile</button><button class="secondary-button" data-action="new-space">${icon('sidebar')}New space</button></div></section><section class="settings-section"><h3>Your data</h3><p class="modal-subtitle">Back up spaces, tab URLs, settings, and history. Backups contain browsing history; store them somewhere private. Cookies and passwords are not included.</p><div class="setting-actions"><button class="secondary-button" data-action="export">${icon('download')}Export backup</button><button class="secondary-button" data-action="import">${icon('file')}Import backup</button><button class="secondary-button" data-action="archive-now">${icon('archive')}Archive idle tabs now</button></div></section><div class="about-note"><strong>Tangent</strong><br>An independent, open-source browser inspired by Arc’s way of organizing the web. No Arc account or cloud sync. Early development build; see the project README for compatibility and security limits.</div>`, '<button class="primary-button" data-action="modal-close">Done</button>', 'wide'); return;
  }
  if (modal === 'new-profile') {
    overlay.innerHTML = frame('A separate set of accounts', `<p class="modal-subtitle">A profile has its own cookies, logins, and favorites. Create a space with this profile to start using it.</p><form id="profile-form"><div class="field"><label for="profile-name">Profile name</label><input id="profile-name" maxlength="40" placeholder="Personal, Work…" required></div></form>`, '<button class="secondary-button" data-action="modal-close">Cancel</button><button class="primary-button" data-action="save-profile">Create profile</button>', 'compact'); return;
  }
  if (modal === 'menu') {
    overlay.innerHTML = frame('Tangent', `<div class="context-actions"><button class="context-action" data-action="palette-new">${icon('plus')}New tab<small>${mod}+T</small></button><button class="context-action" data-action="find">${icon('search')}Find in page<small>${mod}+F</small></button><button class="context-action" data-action="archive">${icon('archive')}Archived tabs</button><button class="context-action" data-action="history">${icon('history')}History</button><button class="context-action" data-action="downloads">${icon('download')}Downloads</button><div class="context-separator"></div><button class="context-action" data-action="settings">${icon('settings')}Settings</button><button class="context-action" data-action="devtools">${icon('file')}Page developer tools</button></div>`, '', 'compact'); return;
  }
}

async function action(name: string, el: HTMLElement) {
  const id = el.dataset.id || '';
  switch (name) {
    case 'modal-close': await closeModal(); break;
    case 'palette-new': await palette('new'); break;
    case 'palette-address': await palette('navigate'); break;
    case 'palette-select': await paletteItems[Number(el.dataset.index)]?.action(); break;
    case 'activate-tab': await dispatch({ type:'tab:activate', id }); break;
    case 'close-tab': if(modal)await closeModal(); await dispatch({ type:'tab:close', id }); break;
    case 'remove-tab': if(modal)await closeModal(); await dispatch({ type:'tab:remove', id }); break;
    case 'sidebar': await dispatch({type:'sidebar:toggle'}); break;
    case 'back': case 'forward': case 'reload': case 'stop': await dispatch({type:name}); break;
    case 'space-switch': await dispatch({type:'space:activate', id}); break;
    case 'new-space': selectedColor=colors[state.spaces.length%colors.length]; await openModal('new-space'); break;
    case 'space-options': await openModal('space-options'); break;
    case 'edit-space': await openModal('edit-space'); break;
    case 'color': selectedColor=el.dataset.color!; overlay.querySelectorAll('.color-choice').forEach(c=>{c.classList.toggle('selected',(c as HTMLElement).dataset.color===selectedColor);c.setAttribute('aria-pressed',String((c as HTMLElement).dataset.color===selectedColor));}); break;
    case 'save-space': {
      const name=overlay.querySelector<HTMLInputElement>('#space-name')!.value.trim();
      if(!name){toast('Give your space a name.');return;}
      const symbol=overlay.querySelector<HTMLInputElement>('#space-icon')!.value.trim()||'✦';
      if(modal==='edit-space') { if(await dispatch({type:'space:update',id:state.activeSpaceId,name,color:selectedColor,icon:symbol}))await closeModal(); return; }
      let profileId=overlay.querySelector<HTMLSelectElement>('#space-profile')!.value;
      if(profileId==='__new') {
        const profileName=overlay.querySelector<HTMLInputElement>('#new-profile-name')!.value.trim();
        if(!profileName){toast('Give the new profile a name.');return;}
        const ids=new Set(state.profiles.map(p=>p.id));
        if(!await dispatch({type:'profile:create',name:profileName}))return;
        profileId=state.profiles.find(p=>!ids.has(p.id))!.id;
      }
      if(await dispatch({type:'space:create',name,color:selectedColor,icon:symbol,profileId}))await closeModal(); break;
    }
    case 'delete-space': {const id=state.activeSpaceId;await closeModal();await dispatch({type:'space:delete',id});break;}
    case 'archive': case 'history': case 'settings': case 'downloads': case 'menu': case 'peek': case 'favorite-add': await openModal(name); break;
    case 'restore-tab': await closeModal();await dispatch({type:'archive:restore',id});break;
    case 'open-history': await closeModal();await dispatch({type:'tab:new',url:el.dataset.url!});break;
    case 'clear-archive': await dispatch({type:'archive:clear'});renderModal();break;
    case 'clear-history': await dispatch({type:'history:clear'});renderModal();break;
    case 'tab-pin': case 'tab-favorite': case 'tab-reset': case 'tab-mute': await closeModal();await dispatch({type:name.replace('-',':') as 'tab:pin'|'tab:favorite'|'tab:reset'|'tab:mute',id});break;
    case 'tab-rename': await openModal('rename-tab',id);break;
    case 'save-tab-name': {const title=overlay.querySelector<HTMLInputElement>('#tab-title')!.value.trim();if(!title)return;const tid=modalId;await closeModal();await dispatch({type:'tab:rename',id:tid,title});break;}
    case 'tab-move': await openModal('move-tab',id);break;
    case 'move-tab-to': {const tid=modalId;await closeModal();await dispatch({type:'tab:move',id:tid,spaceId:id});break;}
    case 'tab-peek': {const url=state.tabs.find(t=>t.id===id)?.url;if(url){await closeModal();await dispatch({type:'peek:open',url});}break;}
    case 'tab-split': case 'choose-split': await closeModal();await dispatch({type:'split:toggle',id});break;
    case 'split': await openModal('split');break;
    case 'split-close': await dispatch({type:'split:close'});break;
    case 'split-new': {
      await closeModal();let first=state.activeTabId;if(!first){await dispatch({type:'tab:new'});first=state.activeTabId;}
      if(!await dispatch({type:'tab:new'}))break;const second=state.activeTabId!;
      if(first){await dispatch({type:'tab:activate',id:first});await dispatch({type:'split:toggle',id:second});}break;
    }
    case 'navigate-split': await dispatch({type:'tab:activate',id});await palette('navigate');break;
    case 'reload-pane': await dispatch({type:'tab:activate',id});await dispatch({type:'reload'});break;
    case 'peek-submit': {const url=overlay.querySelector<HTMLInputElement>('#peek-url')!.value.trim();if(url){await closeModal();await dispatch({type:'peek:open',url});}break;}
    case 'peek-close': await dispatch({type:'peek:close'});break;
    case 'peek-promote': await dispatch({type:'peek:promote'});break;
    case 'favorite-submit': {const url=overlay.querySelector<HTMLInputElement>('#favorite-url')!.value.trim();if(url){await closeModal();await dispatch({type:'tab:new',url,kind:'favorite'});}break;}
    case 'updates-releases': try { await window.tangent.openReleases(); } catch (error) { toast(error instanceof Error ? error.message : String(error)); } break;
    case 'updates-check': await runUpdate('check');break;
    case 'updates-download': await runUpdate('download');break;
    case 'updates-install': await runUpdate('install');break;
    case 'export': await dispatch({type:'data:export'});break;
    case 'import': if(await dispatch({type:'data:import'}))renderModal();break;
    case 'archive-now': await dispatch({type:'archive:run'});toast('Idle tabs archived.');break;
    case 'new-profile': await openModal('new-profile');break;
    case 'save-profile': {const name=overlay.querySelector<HTMLInputElement>('#profile-name')!.value.trim();if(name&&await dispatch({type:'profile:create',name})){await openModal('settings');toast('Profile created. Assign it to a new space.');}break;}
    case 'download-show': await dispatch({type:'download:show',id});break;
    case 'download-cancel': await dispatch({type:'download:cancel',id});renderModal();break;
    case 'find': await closeModal();showFind();break;
    case 'find-close': hideFind();break;
    case 'find-prev': await find(false,true);break;
    case 'find-next': await find(true,true);break;
    case 'devtools': await closeModal();await dispatch({type:'devtools'});break;
    case 'window-minimize': await dispatch({type:'window:minimize'});break;
    case 'window-maximize': await dispatch({type:'window:maximize'});break;
    case 'window-close': await dispatch({type:'window:close'});break;
  }
}
function showFind(){findOpen=true;findRoot.innerHTML=`<div class="find-bar" role="search" aria-label="Find in page"><input id="find-text" placeholder="Find in page…" aria-label="Find in page">${button('arrowup','Previous match','find-prev')}${button('arrowdown','Next match','find-next')}${button('close','Close find','find-close')}</div>`;findRoot.querySelector<HTMLInputElement>('input')?.focus();}
function hideFind(){findOpen=false;findRoot.innerHTML='';void dispatch({type:'find:stop'});}
async function find(forward=true,next=false){await dispatch({type:'find',text:findRoot.querySelector<HTMLInputElement>('input')?.value||'',forward,next});}

// A single event boundary keeps remotely supplied titles and URLs inert text.
document.addEventListener('click', event=>{
  const target=event.target as HTMLElement;
  const el=target.closest<HTMLElement>('[data-action]');
  if(el){event.preventDefault();void action(el.dataset.action!,el);}
  else if(target.dataset.dismiss==='true')void closeModal();
});
document.addEventListener('contextmenu',event=>{const row=(event.target as HTMLElement).closest<HTMLElement>('[data-tab-id]');if(row){event.preventDefault();void openModal('tab-options',row.dataset.tabId!);}});
document.addEventListener('submit',event=>{event.preventDefault();const id=(event.target as HTMLElement).id;const actions:Record<string,string>={'space-form':'save-space','rename-form':'save-tab-name','peek-form':'peek-submit','favorite-form':'favorite-submit','profile-form':'save-profile'};if(actions[id])void action(actions[id],document.createElement('button'));});
document.addEventListener('input',event=>{
  const input=event.target as HTMLInputElement;
  if(input.id==='palette-input'){paletteQuery=input.value;paletteIndex=0;renderPaletteResults();}
  if(input.id==='list-search'){
    const pos=input.selectionStart;listQuery=input.value;renderModal();const next=overlay.querySelector<HTMLInputElement>('#list-search');next?.focus();if(pos!==null)next?.setSelectionRange(pos,pos);
  }
  if(input.id==='find-text')void find();
});
document.addEventListener('change',event=>{
  const input=event.target as HTMLSelectElement;
  if(input.id==='space-profile')overlay.querySelector<HTMLElement>('#new-profile-field')!.hidden=input.value!=='__new';
  if(input.id==='setting-theme')void dispatch({type:'settings:update',patch:{theme:input.value as 'light'|'dark'|'system'}});
  if(input.id==='setting-search')void dispatch({type:'settings:update',patch:{searchEngine:input.value as 'duckduckgo'|'google'}});
  if(input.id==='setting-archive')void dispatch({type:'settings:update',patch:{archiveAfterHours:Number(input.value)}});
});
document.addEventListener('keydown',event=>{
  if(event.key==='ContextMenu' || (event.shiftKey && event.key==='F10')){const row=(event.target as HTMLElement).closest<HTMLElement>('[data-tab-id]');if(row){event.preventDefault();void openModal('tab-options',row.dataset.tabId!);return;}}
  if(event.key==='Escape'){
    if(modal){event.preventDefault();void closeModal();}
    else if(findOpen){event.preventDefault();hideFind();}
    else if(state?.peek){event.preventDefault();void dispatch({type:'peek:close'});}
    return;
  }
  if(modal==='palette'&&['ArrowDown','ArrowUp','Enter'].includes(event.key)){
    event.preventDefault();
    if(event.key==='Enter')void paletteItems[paletteIndex]?.action();
    else{paletteIndex=(paletteIndex+(event.key==='ArrowDown'?1:-1)+paletteItems.length)%paletteItems.length;renderPaletteResults();overlay.querySelector('.result-row.selected')?.scrollIntoView({block:'nearest'});}return;
  }
  if(modal&&event.key==='Tab'){
    const focusable=[...overlay.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]')].filter(el=>!el.closest('[hidden]'));
    if(!focusable.length)return;const first=focusable[0],last=focusable[focusable.length-1];
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}return;
  }
  if((event.target as HTMLElement).id==='find-text'&&event.key==='Enter'){event.preventDefault();void find(!event.shiftKey,true);}
  if((event.target as HTMLElement).classList.contains('split-handle')&&['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();void dispatch({type:'split:ratio',ratio:Math.min(.75,Math.max(.25,state.splitRatio+(event.key==='ArrowRight' ? .05 : -.05)))});}
});
document.addEventListener('dragstart',event=>{const row=(event.target as HTMLElement).closest<HTMLElement>('[data-tab-id]');if(row){draggingId=row.dataset.tabId!;event.dataTransfer?.setData('text/plain',draggingId);if(event.dataTransfer)event.dataTransfer.effectAllowed='move';}});
document.addEventListener('dragover',event=>{const row=(event.target as HTMLElement).closest<HTMLElement>('[data-tab-id]');if(row&&draggingId&&row.dataset.tabId!==draggingId){event.preventDefault();row.classList.add('drag-target');}});
document.addEventListener('dragleave',event=>(event.target as HTMLElement).closest('[data-tab-id]')?.classList.remove('drag-target'));
document.addEventListener('drop',event=>{const row=(event.target as HTMLElement).closest<HTMLElement>('[data-tab-id]');if(row&&draggingId){event.preventDefault();void dispatch({type:'tab:reorder',id:draggingId,beforeId:row.dataset.tabId!});draggingId='';}});
document.addEventListener('dragend',()=>{draggingId='';document.querySelectorAll('.drag-target').forEach(el=>el.classList.remove('drag-target'));});
document.addEventListener('pointerdown',event=>{
  if(!(event.target as HTMLElement).classList.contains('split-handle'))return;
  event.preventDefault();const sidebar=state.sidebarHidden?0:state.settings.sidebarWidth;
  const move=(e:PointerEvent)=>{const ratio=Math.min(.75,Math.max(.25,(e.clientX-sidebar-8)/(window.innerWidth-sidebar-24)));void dispatch({type:'split:ratio',ratio});};
  const up=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);};
  window.addEventListener('pointermove',move);window.addEventListener('pointerup',up,{once:true});
});
window.addEventListener('resize',render);
matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>{if(state)theme();});
function handleShortcut(value:Shortcut){if(value==='new-tab')void palette('new');else if(value==='address')void palette('navigate');else if(value==='archive'||value==='settings')void openModal(value);else if(value==='find'){if(modal)void closeModal().then(showFind);else showFind();}}
async function init(){
  try {
    state=await window.tangent.getState();render();
    window.tangent.onState(next=>{state=next;render();if(modal==='downloads')renderModal();});
    window.tangent.onShortcut(handleShortcut);
    window.tangent.onUpdateState(next => { updateState = next; updateLoadError = ''; refreshUpdateSection(); });
    void window.tangent.getUpdateState().then(next => { updateState = next; refreshUpdateSection(); }).catch(error => { updateLoadError = error instanceof Error ? error.message : String(error); refreshUpdateSection(); });
  } catch(error){app.innerHTML='<div class="boot">Tangent could not start. Please restart the application.</div>';toast(String(error));}
}
void init();
