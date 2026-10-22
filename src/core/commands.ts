import type { BrowserCommand } from '../shared/types';

/** The privileged IPC boundary accepts data only, with bounded, typed fields. */
export function validateCommand(value: unknown): BrowserCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid command.');
  const c = value as Record<string, unknown>;
  const string = (key: string, max = 8192, optional = false) => {
    if (optional && c[key] === undefined) return;
    if (typeof c[key] !== 'string' || (c[key] as string).length > max) throw new Error(`Invalid ${key}.`);
  };
  const id = (key = 'id', optional = false) => { string(key, 80, optional); if (c[key] !== undefined && !/^[a-zA-Z0-9_-]{1,80}$/.test(c[key] as string)) throw new Error('Invalid identifier.'); };
  const color = () => { if (c.color !== undefined && (typeof c.color !== 'string' || !/^#[a-f\d]{6}$/i.test(c.color))) throw new Error('Invalid color.'); };
  const noArgs = new Set(['back', 'forward', 'reload', 'stop', 'sidebar:toggle', 'split:close', 'peek:close', 'peek:promote', 'archive:clear', 'archive:run', 'history:clear', 'data:export', 'data:import', 'devtools', 'find:stop', 'window:minimize', 'window:maximize', 'window:close']);
  if (typeof c.type !== 'string') throw new Error('Invalid command type.');
  if (noArgs.has(c.type)) return { type: c.type } as BrowserCommand;
  switch (c.type) {
    case 'tab:new': string('url', 8192, true); if (c.kind !== undefined && !['today', 'pinned', 'favorite'].includes(c.kind as string)) throw new Error('Invalid tab kind.'); break;
    case 'tab:activate': case 'tab:close': case 'tab:remove': case 'tab:pin': case 'tab:favorite': case 'tab:reset': case 'tab:mute': case 'space:activate': case 'space:delete': case 'archive:restore': case 'download:show': case 'download:cancel': id(); break;
    case 'tab:rename': id(); string('title', 200); break;
    case 'tab:move': id(); id('spaceId'); break;
    case 'tab:reorder': id(); id('beforeId'); break;
    case 'navigate': case 'peek:open': string('url'); break;
    case 'space:create': string('name', 40); string('icon', 8, true); id('profileId', true); color(); break;
    case 'space:update': id(); string('name', 40, true); string('icon', 8, true); color(); break;
    case 'profile:create': string('name', 40); break;
    case 'split:toggle': id('id', true); break;
    case 'split:ratio': if (typeof c.ratio !== 'number' || !Number.isFinite(c.ratio)) throw new Error('Invalid split ratio.'); break;
    case 'overlay': if (typeof c.open !== 'boolean') throw new Error('Invalid overlay.'); break;
    case 'find': string('text', 500); for (const k of ['forward', 'next']) if (c[k] !== undefined && typeof c[k] !== 'boolean') throw new Error('Invalid find option.'); break;
    case 'settings:update': {
      if (!c.patch || typeof c.patch !== 'object' || Array.isArray(c.patch)) throw new Error('Invalid settings.');
      const p = c.patch as Record<string, unknown>;
      if (Object.keys(p).some(k => !['archiveAfterHours', 'searchEngine', 'sidebarWidth', 'theme'].includes(k))) throw new Error('Unknown setting.');
      if (p.archiveAfterHours !== undefined && ![0, 12, 24, 48, 168, 720].includes(p.archiveAfterHours as number)) throw new Error('Invalid archive interval.');
      if (p.searchEngine !== undefined && !['duckduckgo', 'google'].includes(p.searchEngine as string)) throw new Error('Invalid search engine.');
      if (p.theme !== undefined && !['light', 'dark', 'system'].includes(p.theme as string)) throw new Error('Invalid theme.');
      if (p.sidebarWidth !== undefined && (typeof p.sidebarWidth !== 'number' || !Number.isFinite(p.sidebarWidth) || p.sidebarWidth < 220 || p.sidebarWidth > 360)) throw new Error('Invalid sidebar width.');
      break;
    }
    default: throw new Error('Unknown command.');
  }
  return c as unknown as BrowserCommand;
}
