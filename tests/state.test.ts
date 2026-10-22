import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, applyCommand, createTab, visibleTabs, archiveIdle, restoreState, serializeState, recordVisit } from '../src/core/state';
import type { BrowserState, BrowserCommand, Tab } from '../src/shared/types';

const NOW = 1_770_000_000_000;
const HOUR = 3_600_000;
const send = (s: BrowserState, command: BrowserCommand, now = NOW) => applyCommand(s, command, now);
function fixture(): BrowserState {
  const s = initialState();
  s.profiles.push({ id: 'work-profile', name: 'Work' });
  s.spaces.push(
    { id: 'research', profileId: 'default', name: 'Research', color: '#ffcc00', icon: 'R' },
    { id: 'work', profileId: 'work-profile', name: 'Work', color: '#00aaff', icon: 'W' },
  );
  return s;
}
function add(s: BrowserState, url: string, kind: Tab['kind'] = 'today', space = 'personal', now = NOW) {
  s.activeSpaceId = space;
  return createTab(s, url, kind, now);
}
function assertOwnerInvariant(s: BrowserState) {
  for (const tab of s.tabs) {
    assert.ok(s.spaces.some(space => space.id === tab.spaceId && space.profileId === tab.profileId), `Tab ${tab.id} must belong to a Space in its own Profile`);
  }
}

test('favorites are shared by same-profile Spaces; pinned and Today tabs stay in their Space', () => {
  const s = fixture();
  const favorite = add(s, 'https://favorite.example', 'favorite');
  const pinned = add(s, 'https://pinned.example', 'pinned');
  const today = add(s, 'https://today.example');
  const research = add(s, 'https://research.example', 'today', 'research');
  const work = add(s, 'https://work.example', 'favorite', 'work');
  assert.deepEqual(new Set(visibleTabs(s, 'personal').map(t => t.id)), new Set([favorite.id, pinned.id, today.id]));
  assert.deepEqual(new Set(visibleTabs(s, 'research').map(t => t.id)), new Set([favorite.id, research.id]));
  assert.deepEqual(visibleTabs(s, 'work').map(t => t.id), [work.id]);
  assert.deepEqual(visibleTabs(s, 'missing'), []);
});

test('moving a tab across Profiles is rejected without modifying the source state', () => {
  const s = fixture();
  const tab = add(s, 'https://private.example');
  const before = structuredClone(s);
  assert.throws(() => send(s, { type: 'tab:move', id: tab.id, spaceId: 'work' }));
  assert.deepEqual(s, before);
  const moved = send(s, { type: 'tab:move', id: tab.id, spaceId: 'research' });
  assert.equal(moved.tabs[0].spaceId, 'research');
  assert.equal(moved.tabs[0].profileId, 'default');
});

test('switching to a tab in another Profile clears the previous split pane', () => {
  const s = fixture();
  const first = add(s, 'https://first.example');
  const second = add(s, 'https://second.example');
  const work = add(s, 'https://work.example', 'today', 'work');
  s.activeSpaceId = 'personal'; s.activeTabId = first.id; s.splitTabId = second.id;
  const switched = send(s, { type: 'tab:activate', id: work.id });
  assert.equal(switched.activeSpaceId, 'work');
  assert.equal(switched.activeTabId, work.id);
  assert.equal(switched.splitTabId, null, 'a prior-profile pane must not stay visible after context changes');
});

for (const type of ['tab:pin', 'tab:favorite'] as const) {
  test(`${type} on a stale tab ID cannot reassign it to another Profile's Space`, () => {
    const s = fixture();
    const tab = add(s, 'https://private.example');
    s.activeSpaceId = 'work'; s.activeTabId = null;
    let result: BrowserState;
    try { result = send(s, { type, id: tab.id }); }
    catch { assertOwnerInvariant(s); return; }
    assertOwnerInvariant(result);
    assert.equal(result.tabs.find(t => t.id === tab.id)!.profileId, 'default');
  });
}

test('saved URL survives navigation and reset restores it; reducer leaves input unchanged', () => {
  const s = fixture();
  const tab = add(s, 'https://example.com/start', 'pinned');
  const navigated = send(s, { type: 'navigate', url: 'https://example.com/other' });
  assert.equal(s.tabs[0].url, 'https://example.com/start');
  assert.equal(navigated.tabs[0].savedUrl, 'https://example.com/start');
  const reset = send(navigated, { type: 'tab:reset', id: tab.id });
  assert.equal(reset.tabs[0].url, 'https://example.com/start');
});

test('idle archive exempts active, split, audible, pinned and favorite tabs', () => {
  const s = fixture();
  const stale = add(s, 'https://stale.example', 'today', 'personal', NOW - 13 * HOUR);
  const pinned = add(s, 'https://pinned.example', 'pinned', 'personal', NOW - 99 * HOUR);
  const favorite = add(s, 'https://favorite.example', 'favorite', 'personal', NOW - 99 * HOUR);
  const audible = add(s, 'https://audio.example', 'today', 'personal', NOW - 13 * HOUR); audible.audible = true;
  const split = add(s, 'https://split.example', 'today', 'personal', NOW - 13 * HOUR);
  const active = add(s, 'https://active.example', 'today', 'personal', NOW - 13 * HOUR);
  const recent = add(s, 'https://recent.example', 'today', 'personal', NOW - 11 * HOUR);
  s.activeTabId = active.id; s.splitTabId = split.id;
  assert.equal(archiveIdle(s, NOW), 1);
  assert.deepEqual(new Set(s.tabs.map(t => t.id)), new Set([pinned.id, favorite.id, audible.id, split.id, active.id, recent.id]));
  assert.equal(s.archives[0].url, stale.url);
  assert.equal(s.archives[0].reason, 'idle');
});

test('reactivating an old tab resets inactivity so leaving it does not immediately archive it', () => {
  const s = fixture();
  const old = add(s, 'https://old.example', 'today', 'personal', NOW - 15 * HOUR);
  const other = add(s, 'https://other.example');
  let next = send(s, { type: 'tab:activate', id: old.id });
  next = send(next, { type: 'tab:activate', id: other.id }, NOW + 1000);
  assert.equal(archiveIdle(next, NOW + 2 * HOUR), 0);
  assert.equal(next.tabs.find(t => t.id === old.id)!.lastActiveAt, NOW);
});

test('archive restore returns to the recorded Profile even when its old Space was deleted', () => {
  const s = fixture();
  s.spaces = s.spaces.filter(space => space.id !== 'work');
  s.archives.push({ id: 'old-work', profileId: 'work-profile', spaceId: 'deleted-work', url: 'https://work.example/private', title: 'Work document', archivedAt: NOW - HOUR, reason: 'closed' });
  s.peek = { url: 'https://personal.example', title: 'Personal', loading: false };
  const restored = send(s, { type: 'archive:restore', id: 'old-work' });
  assert.equal(restored.tabs.at(-1)!.profileId, 'work-profile');
  assert.equal(restored.spaces.find(space => space.id === restored.activeSpaceId)!.profileId, 'work-profile');
  assert.equal(restored.tabs.at(-1)!.title, 'Work document');
  assert.equal(restored.archives.length, 0);
  assert.equal(restored.peek, null, 'a previous-profile preview must not follow restoration into another Profile');
  assertOwnerInvariant(restored);
});

test('clearing archive and history affects only the current Profile', () => {
  const s = fixture();
  s.archives = ['default', 'work-profile'].map(profileId => ({ id: profileId, profileId, spaceId: 'personal', title: profileId, url: 'https://example.com', archivedAt: NOW, reason: 'closed' }));
  s.history = ['default', 'work-profile'].map(profileId => ({ profileId, title: profileId, url: 'https://example.com', visitedAt: NOW }));
  const next = send(send(s, { type: 'archive:clear' }), { type: 'history:clear' });
  assert.deepEqual(next.archives.map(a => a.profileId), ['work-profile']);
  assert.deepEqual(next.history.map(h => h.profileId), ['work-profile']);
});

test('same URL history entries remain independent by Profile', () => {
  const s = fixture();
  const personal = add(s, 'https://same.example');
  const work = add(s, 'https://same.example', 'today', 'work');
  recordVisit(s, personal, NOW); recordVisit(s, work, NOW + 1); recordVisit(s, personal, NOW + 2);
  assert.equal(s.history.length, 2);
  assert.deepEqual(s.history.map(h => h.profileId), ['default', 'work-profile']);
});

test('split focus preserves pane placement and closing split retains both tabs', () => {
  const s = fixture();
  const first = add(s, 'https://first.example'); const second = add(s, 'https://second.example');
  s.activeTabId = first.id;
  const split = send(s, { type: 'split:toggle', id: second.id });
  const focus = send(split, { type: 'tab:activate', id: second.id });
  assert.equal(focus.activeTabId, first.id); assert.equal(focus.splitTabId, second.id); assert.equal(focus.focusedTabId, second.id);
  const closed = send(focus, { type: 'split:close' });
  assert.equal(closed.splitTabId, null); assert.equal(closed.tabs.length, 2);
});

test('cannot split with a tab in a hidden Space or different Profile', () => {
  const s = fixture(); const personal = add(s, 'https://personal.example');
  const other = add(s, 'https://other.example', 'today', 'work');
  s.activeSpaceId = 'personal'; s.activeTabId = personal.id;
  assert.throws(() => send(s, { type: 'split:toggle', id: other.id }));
});

test('Peek promotion creates a tab in the current Profile without changing parent URL', () => {
  const s = fixture(); const parent = add(s, 'https://parent.example', 'pinned', 'work');
  const preview = send(s, { type: 'peek:open', url: 'https://preview.example/article' });
  const promoted = send(preview, { type: 'peek:promote' });
  assert.equal(promoted.peek, null);
  assert.equal(promoted.tabs.find(t => t.id === parent.id)!.url, parent.url);
  assert.equal(promoted.tabs.at(-1)!.profileId, 'work-profile');
  assert.equal(promoted.tabs.at(-1)!.url, 'https://preview.example/article');
});

test('persisted session strips runtime content and does not restore a transient Peek', () => {
  const s = fixture(); const tab = add(s, 'https://example.com', 'pinned');
  Object.assign(tab, { loading: true, audible: true, error: 'transient', favicon: 'https://tracking.example/icon', canGoBack: true });
  s.peek = { url: 'https://preview.example', title: 'Preview', loading: true };
  s.downloads = [{ id: 'download', name: 'private.pdf', receivedBytes: 12, totalBytes: 12, status: 'completed', path: '/private/path' }];
  const saved = serializeState(s);
  assert.ok(!saved.includes('/private/path')); assert.ok(!saved.includes('tracking.example'));
  const restored = restoreState(JSON.parse(saved));
  assert.equal(restored.peek, null); assert.deepEqual(restored.downloads, []);
  assert.equal(restored.tabs[0].kind, 'pinned'); assert.equal(restored.tabs[0].loading, undefined);
});

test('hostile imported session discards unsafe URLs, cross-profile owners and injected properties', () => {
  const s = fixture(); const safe = add(s, 'https://safe.example');
  const input = JSON.parse(serializeState(s));
  input.tabs.push({ ...safe, id: 'unsafe', url: 'javascript:process.exit()' });
  input.tabs.push({ ...safe, id: 'mismatch', profileId: 'work-profile' });
  input.tabs.push({ ...safe, id: '../traversal', url: 'https://safe.example' });
  input.tabs.push({ ...safe, id: safe.id, url: 'https://duplicate.example' });
  input.tabs[0].savedUrl = 'file:///etc/passwd';
  input.tabs[0].preload = '/malicious'; input.tabs[0].nodeIntegration = true;
  input.spaces[0].color = 'url(https://tracking.example)';
  input.profiles.push({ id: '../../escape', name: 'Bad' });
  input.settings = { archiveAfterHours: -1, searchEngine: 'javascript:evil', sidebarWidth: Infinity, theme: 'bad', nodeIntegration: true };
  input.splitTabId = 'mismatch'; input.activeTabId = 'unsafe';
  input.peek = { url: 'file:///etc/passwd', title: 'Bad', loading: true };
  input.arbitrary = { run: '/bin/sh' };
  const restored = restoreState(input);
  assert.equal(restored.tabs.length, 1); assert.equal(restored.tabs[0].id, safe.id);
  assert.equal(restored.tabs[0].savedUrl, safe.url); assert.equal(restored.splitTabId, null);
  assert.equal(restored.profiles.length, 2); assert.equal(restored.spaces[0].color, '#a99be1');
  assert.equal(restored.settings.archiveAfterHours, 12); assert.equal(restored.settings.searchEngine, 'duckduckgo');
  assert.equal((restored.tabs[0] as any).preload, undefined); assert.equal((restored as any).arbitrary, undefined);
  assert.equal((restored.settings as any).nodeIntegration, undefined); assert.equal(restored.peek, null);
  assertOwnerInvariant(restored);
});

test('imported archive and history reject private protocols and unknown Profiles', () => {
  const s = fixture(); const base = { id: 'good', profileId: 'default', spaceId: 'personal', title: 'Good', url: 'https://example.com', archivedAt: NOW, visitedAt: NOW, reason: 'closed' };
  const input = { ...s, archives: [base, { ...base, id: 'file', url: 'file:///etc/passwd' }, { ...base, id: 'unknown', profileId: 'missing' }], history: [base, { ...base, url: 'data:text/html,bad' }, { ...base, profileId: 'missing' }] };
  const restored = restoreState(input);
  assert.equal(restored.archives.length, 1); assert.equal(restored.history.length, 1);
});

test('incompatible or identity-free session data is rejected rather than silently overwriting it', () => {
  for (const bad of [null, [], {}, { ...initialState(), version: 999 }, { ...initialState(), profiles: [] }, { ...initialState(), spaces: [] }]) {
    assert.throws(() => restoreState(bad));
  }
});

for (const kind of ['pinned', 'favorite'] as const) {
  test(`closing a ${kind} page preserves its saved tab; explicit removal archives it`, () => {
    const s = fixture(); const saved = add(s, 'https://saved.example/start', kind);
    const other = add(s, 'https://other.example');
    s.activeTabId = saved.id; saved.url = 'https://saved.example/temporary';
    const closed = send(s, { type: 'tab:close', id: saved.id });
    assert.equal(closed.tabs.find(t => t.id === saved.id)!.url, 'https://saved.example/start');
    assert.equal(closed.tabs.find(t => t.id === saved.id)!.kind, kind);
    assert.equal(closed.activeTabId, other.id); assert.equal(closed.archives.length, 0);
    const removed = send(closed, { type: 'tab:remove', id: saved.id });
    assert.ok(!removed.tabs.some(t => t.id === saved.id));
    assert.equal(removed.archives[0].url, 'https://saved.example/start');
  });
}

test('navigation targets the focused right pane without changing the left pane or split layout', () => {
  const s = fixture(); const left = add(s, 'https://left.example'); const right = add(s, 'https://right.example');
  s.activeTabId = left.id; s.splitTabId = right.id; s.focusedTabId = right.id;
  const navigated = send(s, { type: 'navigate', url: 'https://right.example/next' });
  assert.equal(navigated.tabs.find(t => t.id === left.id)!.url, 'https://left.example/');
  assert.equal(navigated.tabs.find(t => t.id === right.id)!.url, 'https://right.example/next');
  assert.equal(navigated.activeTabId, left.id); assert.equal(navigated.splitTabId, right.id);
  assert.equal(navigated.focusedTabId, right.id);
  const closed = send(navigated, { type: 'split:close' });
  assert.equal(closed.focusedTabId, left.id);
});

test('archiving background-profile tabs cannot change the active Profile or current pane', () => {
  const s = fixture(); add(s, 'https://old-personal.example', 'today', 'personal', NOW - 15 * HOUR);
  const work = add(s, 'https://work.example', 'today', 'work');
  const archived = send(s, { type: 'archive:run' });
  assert.equal(archived.activeSpaceId, 'work'); assert.equal(archived.activeTabId, work.id);
  assert.equal(archived.focusedTabId, work.id);
  assert.equal(archived.archives[0].profileId, 'default');
  assertOwnerInvariant(archived);
});

test('restoring hostile stale pane IDs cannot focus a tab in a different Profile', () => {
  const s = fixture(); const personal = add(s, 'https://personal.example'); const work = add(s, 'https://work.example', 'today', 'work');
  s.activeSpaceId = 'personal'; s.activeTabId = personal.id; s.splitTabId = work.id; s.focusedTabId = work.id;
  const restored = restoreState(JSON.parse(serializeState(s)));
  assert.equal(restored.activeSpaceId, 'personal'); assert.equal(restored.activeTabId, personal.id);
  assert.equal(restored.splitTabId, null); assert.equal(restored.focusedTabId, personal.id);
});

test('closing one split pane promotes the surviving pane instead of opening an unrelated background tab', () => {
  const s = fixture(); const left = add(s, 'https://left.example'); const right = add(s, 'https://right.example');
  add(s, 'https://background.example');
  s.activeTabId = left.id; s.splitTabId = right.id; s.focusedTabId = left.id;
  const closed = send(s, { type: 'tab:close', id: left.id });
  assert.equal(closed.activeTabId, right.id); assert.equal(closed.splitTabId, null);
  assert.equal(closed.focusedTabId, right.id);
  assert.equal(closed.archives[0].url, 'https://left.example/');
});
