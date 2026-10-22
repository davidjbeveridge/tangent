import { randomUUID } from 'node:crypto';
import type { BrowserState, BrowserCommand, Tab, TabKind, Space } from '../shared/types';
import { displayTitle, normalizeInput, isNavigableUrl } from './urls';

const uid = () => randomUUID();
export const DEFAULT_SETTINGS = { archiveAfterHours: 12, searchEngine: 'duckduckgo' as const, sidebarWidth: 244, theme: 'dark' as const };
export function initialState(): BrowserState {
  return {
    version: 1, profiles: [{ id: 'default', name: 'Personal' }],
    spaces: [{ id: 'personal', profileId: 'default', name: 'Personal', color: '#a99be1', icon: '✳' }],
    tabs: [], activeSpaceId: 'personal', activeTabId: null, splitTabId: null, focusedTabId: null,
    splitRatio: 0.5, sidebarHidden: false, archives: [], history: [],
    settings: { ...DEFAULT_SETTINGS }, downloads: [], peek: null,
  };
}
export const activeSpace = (s: BrowserState): Space => s.spaces.find(x => x.id === s.activeSpaceId) ?? s.spaces[0];
export function visibleTabs(s: BrowserState, spaceId = s.activeSpaceId): Tab[] {
  const space = s.spaces.find(x => x.id === spaceId);
  return space ? s.tabs.filter(t => t.profileId === space.profileId && (t.kind === 'favorite' || t.spaceId === spaceId)) : [];
}
export function createTab(s: BrowserState, input = 'about:blank', kind: TabKind = 'today', now = Date.now()): Tab {
  const space = activeSpace(s), url = normalizeInput(input, s.settings.searchEngine);
  const tab: Tab = { id: uid(), spaceId: space.id, profileId: space.profileId, url, savedUrl: url, title: displayTitle(url), kind, createdAt: now, lastActiveAt: now };
  s.tabs.push(tab); s.activeTabId = tab.id; s.focusedTabId = tab.id; return tab;
}
function selectFallback(s: BrowserState) {
  const visible = visibleTabs(s);
  if (!visible.some(t => t.id === s.activeTabId)) s.activeTabId = visible.at(-1)?.id ?? null;
  if (!visible.some(t => t.id === s.splitTabId) || s.splitTabId === s.activeTabId) s.splitTabId = null;
  if (s.focusedTabId !== s.activeTabId && s.focusedTabId !== s.splitTabId) s.focusedTabId = s.activeTabId;
}
function archiveTab(s: BrowserState, tab: Tab, reason: 'closed' | 'idle', now: number) {
  if (tab.url !== 'about:blank') s.archives.unshift({ id: uid(), spaceId: tab.spaceId, profileId: tab.profileId, title: tab.title, url: tab.url, archivedAt: now, reason });
  s.tabs = s.tabs.filter(t => t.id !== tab.id);
  if (s.activeTabId === tab.id && s.splitTabId) { s.activeTabId = s.splitTabId; s.focusedTabId = s.splitTabId; s.splitTabId = null; }
  else if (s.splitTabId === tab.id) { s.splitTabId = null; s.focusedTabId = s.activeTabId; }
  s.archives = s.archives.slice(0, 2000);
  selectFallback(s);
}
export function archiveIdle(s: BrowserState, now = Date.now()): number {
  const threshold = s.settings.archiveAfterHours * 3600000;
  if (!threshold) return 0;
  const idle = s.tabs.filter(t => t.kind === 'today' && t.id !== s.activeTabId && t.id !== s.splitTabId && !t.audible && now - t.lastActiveAt >= threshold);
  for (const tab of idle) archiveTab(s, tab, 'idle', now);
  return idle.length;
}
export function applyCommand(state: BrowserState, command: BrowserCommand, now = Date.now()): BrowserState {
  const s = structuredClone(state);
  const byId = (id: string) => { const tab = s.tabs.find(t => t.id === id); if (!tab) throw new Error('Tab no longer exists.'); return tab; };
  switch (command.type) {
    case 'tab:new': createTab(s, command.url, command.kind, now); s.peek = null; break;
    case 'tab:activate': {
      const tab = byId(command.id);
      if (!visibleTabs(s).some(t => t.id === tab.id)) { s.activeSpaceId = tab.spaceId; s.splitTabId = null; }
      if (s.splitTabId !== tab.id) s.activeTabId = tab.id;
      s.focusedTabId = tab.id; tab.lastActiveAt = now; s.peek = null; break;
    }
    case 'tab:close': {
      const t = byId(command.id);
      if (t.kind === 'today') archiveTab(s, t, 'closed', now);
      else {
        t.url = t.savedUrl; t.loading = false; t.audible = false; t.error = undefined;
        if (s.splitTabId === t.id) s.splitTabId = null;
        if (s.activeTabId === t.id) { s.activeTabId = s.splitTabId ?? visibleTabs(s).filter(x => x.id !== t.id).at(-1)?.id ?? null; s.splitTabId = null; }
        if (s.focusedTabId === t.id) s.focusedTabId = s.activeTabId;
      }
      break;
    }
    case 'tab:remove': archiveTab(s, byId(command.id), 'closed', now); break;
    case 'tab:pin': { const t = byId(command.id); if (t.profileId !== activeSpace(s).profileId) throw new Error('Tab belongs to another Profile.'); t.kind = t.kind === 'pinned' ? 'today' : 'pinned'; t.spaceId = s.activeSpaceId; t.savedUrl = t.url; break; }
    case 'tab:favorite': { const t = byId(command.id); if (t.profileId !== activeSpace(s).profileId) throw new Error('Tab belongs to another Profile.'); t.kind = t.kind === 'favorite' ? 'today' : 'favorite'; t.spaceId = s.activeSpaceId; t.savedUrl = t.url; break; }
    case 'tab:rename': { const t = byId(command.id); t.customTitle = command.title.trim().slice(0, 200) || undefined; if (t.customTitle) t.title = t.customTitle; break; }
    case 'tab:reset': { const t = byId(command.id); t.url = t.savedUrl; t.error = undefined; break; }
    case 'tab:mute': { const t = byId(command.id); t.muted = !t.muted; break; }
    case 'tab:move': {
      const t = byId(command.id), space = s.spaces.find(x => x.id === command.spaceId);
      if (!space) throw new Error('Space no longer exists.');
      if (t.profileId !== space.profileId) throw new Error('Tabs can move only between Spaces using the same Profile. Open the address in the other Profile instead.');
      t.spaceId = space.id; if (t.kind === 'favorite') t.kind = 'pinned'; selectFallback(s); break;
    }
    case 'tab:reorder': {
      const t = byId(command.id), target = byId(command.beforeId);
      if (t.id === target.id) break;
      if (t.kind !== target.kind || t.profileId !== target.profileId || (t.kind !== 'favorite' && t.spaceId !== target.spaceId)) break;
      s.tabs = s.tabs.filter(x => x.id !== t.id); s.tabs.splice(s.tabs.findIndex(x => x.id === target.id), 0, t); break;
    }
    case 'navigate': {
      const url = normalizeInput(command.url, s.settings.searchEngine);
      const focus = s.focusedTabId === s.activeTabId || s.focusedTabId === s.splitTabId ? s.focusedTabId : s.activeTabId;
      const t = s.tabs.find(x => x.id === focus) ?? createTab(s, url, 'today', now);
      t.url = url; t.lastActiveAt = now; t.error = undefined; s.peek = null; break;
    }
    case 'space:create': {
      const profileId = command.profileId ?? activeSpace(s).profileId;
      if (!s.profiles.some(p => p.id === profileId)) throw new Error('Profile no longer exists.');
      const space = { id: uid(), profileId, name: command.name.trim().slice(0, 40) || 'New Space', color: command.color ?? '#a99be1', icon: (command.icon ?? '◌').slice(0, 8) };
      s.spaces.push(space); s.activeSpaceId = space.id; s.activeTabId = null; s.focusedTabId = null; s.splitTabId = null; s.peek = null; break;
    }
    case 'space:activate': {
      if (!s.spaces.some(x => x.id === command.id)) throw new Error('Space no longer exists.');
      s.activeSpaceId = command.id; s.activeTabId = null; s.splitTabId = null; s.peek = null; selectFallback(s);
      s.focusedTabId = s.activeTabId; const tab = s.tabs.find(t => t.id === s.activeTabId); if (tab) tab.lastActiveAt = now; break;
    }
    case 'space:update': {
      const space = s.spaces.find(x => x.id === command.id); if (!space) throw new Error('Space no longer exists.');
      if (command.name?.trim()) space.name = command.name.trim().slice(0, 40);
      if (command.color) space.color = command.color;
      if (command.icon) space.icon = command.icon.slice(0, 8); break;
    }
    case 'space:delete': {
      if (s.spaces.length === 1) throw new Error('Keep at least one Space.');
      const target = s.spaces.find(x => x.id === command.id); if (!target) break;
      let replacement = s.spaces.find(x => x.id !== target.id && x.profileId === target.profileId);
      if (!replacement && s.tabs.some(t => t.spaceId === target.id && t.kind === 'favorite')) throw new Error('Move or unpin this Profile’s Favorites before deleting its last Space.');
      for (const t of [...s.tabs].filter(t => t.spaceId === target.id)) {
        if (t.kind === 'favorite' && replacement) t.spaceId = replacement.id; else archiveTab(s, t, 'closed', now);
      }
      s.spaces = s.spaces.filter(x => x.id !== target.id);
      if (s.activeSpaceId === target.id) s.activeSpaceId = s.spaces[0].id;
      s.peek = null; selectFallback(s); break;
    }
    case 'profile:create': s.profiles.push({ id: uid(), name: command.name.trim().slice(0, 40) || 'New Profile' }); break;
    case 'sidebar:toggle': s.sidebarHidden = !s.sidebarHidden; break;
    case 'split:toggle': {
      if (s.splitTabId && !command.id) { s.splitTabId = null; break; }
      let target = command.id ? byId(command.id) : visibleTabs(s).find(t => t.id !== s.activeTabId);
      if (target && !visibleTabs(s).some(t => t.id === target!.id)) throw new Error('Split tabs must be visible in the current Space.');
      if (!s.activeTabId) createTab(s, 'about:blank', 'today', now);
      if (!target) { const active = s.activeTabId; target = createTab(s, 'about:blank', 'today', now); s.activeTabId = active; }
      if (target.id !== s.activeTabId) s.splitTabId = target.id; s.peek = null; break;
    }
    case 'split:close': s.splitTabId = null; break;
    case 'split:ratio': s.splitRatio = Math.min(0.75, Math.max(0.25, command.ratio)); break;
    case 'peek:open': s.peek = { url: normalizeInput(command.url, s.settings.searchEngine), title: displayTitle(command.url), loading: true }; break;
    case 'peek:close': s.peek = null; break;
    case 'peek:promote': if (s.peek) { createTab(s, s.peek.url, 'today', now); s.peek = null; } break;
    case 'archive:restore': {
      const item = s.archives.find(x => x.id === command.id); if (!item) break;
      let space = s.spaces.find(x => x.id === item.spaceId && x.profileId === item.profileId) ?? s.spaces.find(x => x.profileId === item.profileId);
      if (!space) { space = { id: uid(), name: 'Restored', profileId: item.profileId, color: '#a99be1', icon: '↺' }; s.spaces.push(space); }
      s.activeSpaceId = space.id; const t = createTab(s, item.url, 'today', now); t.title = item.title;
      s.archives = s.archives.filter(x => x.id !== item.id); s.splitTabId = null; s.peek = null; break;
    }
    case 'archive:clear': s.archives = s.archives.filter(a => a.profileId !== activeSpace(s).profileId); break;
    case 'archive:run': archiveIdle(s, now); break;
    case 'history:clear': s.history = s.history.filter(h => h.profileId !== activeSpace(s).profileId); break;
    case 'settings:update': s.settings = { ...s.settings, ...command.patch }; break;
  }
  if (!s.focusedTabId || (s.focusedTabId !== s.activeTabId && s.focusedTabId !== s.splitTabId)) s.focusedTabId = s.activeTabId;
  return s;
}

export function recordVisit(s: BrowserState, tab: Tab, now = Date.now()) {
  if (!isNavigableUrl(tab.url) || tab.url === 'about:blank') return;
  s.history = [{ url: tab.url, title: tab.title, profileId: tab.profileId, visitedAt: now }, ...s.history.filter(h => h.url !== tab.url || h.profileId !== tab.profileId)].slice(0, 3000);
}

/** Parse disk/import data from scratch; never spread arbitrary objects into live state. */
export function restoreState(input: unknown): BrowserState {
  const base = initialState();
  if (!input || typeof input !== 'object') throw new Error('Invalid session file.');
  const v = input as Record<string, unknown>;
  if (v.version !== 1 || !Array.isArray(v.profiles) || !Array.isArray(v.spaces) || !Array.isArray(v.tabs)) throw new Error('Unsupported session format.');
  const text = (x: unknown, max = 200): string => typeof x === 'string' ? x.slice(0, max) : '';
  const validId = (x: unknown): x is string => typeof x === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(x);
  const unique = <T extends {id: string}>(items: T[]) => items.filter((x,i) => items.findIndex(y => y.id === x.id) === i);
  base.profiles = unique(v.profiles.slice(0, 100).filter(p => p && validId(p.id)).map(p => ({ id: p.id, name: text(p.name, 40) || 'Profile' })));
  if (!base.profiles.length) throw new Error('Session has no valid Profiles.');
  base.spaces = unique(v.spaces.slice(0, 100).filter(s => s && validId(s.id) && base.profiles.some(p => p.id === s.profileId)).map(s => ({ id: s.id, profileId: s.profileId, name: text(s.name, 40) || 'Space', color: /^#[a-f\d]{6}$/i.test(s.color) ? s.color : '#a99be1', icon: text(s.icon, 8) || '◌' })));
  if (!base.spaces.length) throw new Error('Session has no valid Spaces.');
  const timestamp = (x: unknown) => typeof x === 'number' && Number.isFinite(x) && x > 0 ? Math.min(x, Date.now()) : Date.now();
  base.tabs = unique(v.tabs.slice(0, 2000).filter(t => t && validId(t.id) && isNavigableUrl(t.url) && base.spaces.some(s => s.id === t.spaceId && s.profileId === t.profileId)).map(t => ({
    id: t.id, spaceId: t.spaceId, profileId: t.profileId, title: text(t.title) || displayTitle(t.url), url: t.url,
    savedUrl: isNavigableUrl(t.savedUrl) ? t.savedUrl : t.url,
    kind: (['today', 'pinned', 'favorite'].includes(t.kind) ? t.kind : 'today') as TabKind,
    createdAt: timestamp(t.createdAt), lastActiveAt: timestamp(t.lastActiveAt), muted: t.muted === true, ...(text(t.customTitle) ? { customTitle: text(t.customTitle) } : {}),
  })));
  base.activeSpaceId = base.spaces.some(s => s.id === v.activeSpaceId) ? v.activeSpaceId as string : base.spaces[0].id;
  base.activeTabId = typeof v.activeTabId === 'string' ? v.activeTabId : null;
  base.splitTabId = typeof v.splitTabId === 'string' ? v.splitTabId : null;
  base.focusedTabId = typeof v.focusedTabId === 'string' ? v.focusedTabId : base.activeTabId;
  base.splitRatio = typeof v.splitRatio === 'number' && Number.isFinite(v.splitRatio) ? Math.min(.75, Math.max(.25, v.splitRatio)) : .5;
  base.sidebarHidden = v.sidebarHidden === true;
  if (Array.isArray(v.archives)) base.archives = unique(v.archives.slice(0, 2000).filter(a => a && validId(a.id) && validId(a.spaceId) && isNavigableUrl(a.url) && base.profiles.some(p => p.id === a.profileId)).map(a => ({ id: a.id, spaceId: a.spaceId, profileId: a.profileId, url: a.url, title: text(a.title), archivedAt: timestamp(a.archivedAt), reason: a.reason === 'idle' ? 'idle' as const : 'closed' as const })));
  if (Array.isArray(v.history)) base.history = v.history.slice(0, 3000).filter(h => h && isNavigableUrl(h.url) && base.profiles.some(p => p.id === h.profileId)).map(h => ({ url: h.url, title: text(h.title), profileId: h.profileId, visitedAt: timestamp(h.visitedAt) }));
  if (v.settings && typeof v.settings === 'object') {
    const st = v.settings as Record<string, unknown>;
    if (typeof st.archiveAfterHours === 'number' && [0, 12, 24, 48, 168, 720].includes(st.archiveAfterHours)) base.settings.archiveAfterHours = st.archiveAfterHours;
    if (st.searchEngine === 'google' || st.searchEngine === 'duckduckgo') base.settings.searchEngine = st.searchEngine;
    if (typeof st.sidebarWidth === 'number' && Number.isFinite(st.sidebarWidth)) base.settings.sidebarWidth = Math.min(360, Math.max(220, st.sidebarWidth));
    if (st.theme === 'dark' || st.theme === 'light' || st.theme === 'system') base.settings.theme = st.theme;
  }
  selectFallback(base); return base;
}

export function serializeState(s: BrowserState): string {
  return JSON.stringify({ ...s, peek: null, downloads: [], tabs: s.tabs.map(({ loading, canGoBack, canGoForward, audible, error, favicon, ...tab }) => tab) }, null, 2);
}
