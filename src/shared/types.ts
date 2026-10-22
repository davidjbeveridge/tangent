export type TabKind = 'today' | 'pinned' | 'favorite';
export interface Profile { id: string; name: string }
export interface Space { id: string; profileId: string; name: string; color: string; icon: string }
export interface Tab {
  id: string; spaceId: string; profileId: string; title: string; url: string;
  savedUrl: string; kind: TabKind; createdAt: number; lastActiveAt: number;
  loading?: boolean; canGoBack?: boolean; canGoForward?: boolean; audible?: boolean;
  muted?: boolean; error?: string; favicon?: string; customTitle?: string;
}
export interface ArchivedTab {
  id: string; spaceId: string; profileId: string; title: string; url: string;
  archivedAt: number; reason: 'closed' | 'idle';
}
export interface HistoryEntry { url: string; title: string; profileId: string; visitedAt: number }
export interface DownloadEntry {
  id: string; name: string; receivedBytes: number; totalBytes: number;
  status: 'progressing' | 'completed' | 'cancelled' | 'interrupted'; path?: string;
}
export interface Settings {
  archiveAfterHours: number; searchEngine: 'duckduckgo' | 'google';
  sidebarWidth: number; theme: 'light' | 'dark' | 'system';
}
export interface PeekState { url: string; title: string; loading: boolean }
export interface BrowserState {
  version: 1; profiles: Profile[]; spaces: Space[]; tabs: Tab[];
  activeSpaceId: string; activeTabId: string | null; splitTabId: string | null; focusedTabId: string | null;
  splitRatio: number; sidebarHidden: boolean; archives: ArchivedTab[];
  history: HistoryEntry[]; settings: Settings; downloads: DownloadEntry[];
  peek: PeekState | null;
}
export type BrowserCommand =
  | { type: 'tab:new'; url?: string; kind?: TabKind }
  | { type: 'tab:activate' | 'tab:close' | 'tab:remove' | 'tab:pin' | 'tab:favorite' | 'tab:reset' | 'tab:mute'; id: string }
  | { type: 'tab:rename'; id: string; title: string }
  | { type: 'tab:move'; id: string; spaceId: string }
  | { type: 'tab:reorder'; id: string; beforeId: string }
  | { type: 'navigate'; url: string }
  | { type: 'back' | 'forward' | 'reload' | 'stop' | 'sidebar:toggle' | 'split:close' | 'peek:close' | 'peek:promote' | 'archive:clear' | 'archive:run' | 'history:clear' | 'data:export' | 'data:import' | 'devtools' }
  | { type: 'space:create'; name: string; color?: string; icon?: string; profileId?: string }
  | { type: 'space:activate' | 'space:delete'; id: string }
  | { type: 'space:update'; id: string; name?: string; color?: string; icon?: string }
  | { type: 'profile:create'; name: string }
  | { type: 'split:toggle'; id?: string }
  | { type: 'split:ratio'; ratio: number }
  | { type: 'peek:open'; url: string }
  | { type: 'archive:restore'; id: string }
  | { type: 'settings:update'; patch: Partial<Settings> }
  | { type: 'overlay'; open: boolean }
  | { type: 'find'; text: string; forward?: boolean; next?: boolean }
  | { type: 'find:stop' }
  | { type: 'download:show' | 'download:cancel'; id: string }
  | { type: 'window:minimize' | 'window:maximize' | 'window:close' };

export type Shortcut = 'new-tab' | 'address' | 'archive' | 'settings' | 'find';
export type UpdateStatus = 'unsupported' | 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error';
export interface UpdateState {
  status: UpdateStatus;
  currentVersion: string;
  electronVersion: string;
  chromiumVersion: string;
  availableVersion?: string;
  progress?: number;
  message: string;
  canCheck: boolean;
  canDownload: boolean;
  canInstall: boolean;
  lastCheckedAt?: number;
}
export interface TangentBridge {
  getState(): Promise<BrowserState>;
  dispatch(command: BrowserCommand): Promise<BrowserState>;
  onState(callback: (state: BrowserState) => void): () => void;
  onShortcut(callback: (shortcut: Shortcut) => void): () => void;
  getUpdateState(): Promise<UpdateState>;
  checkForUpdates(): Promise<UpdateState>;
  downloadUpdate(): Promise<UpdateState>;
  installUpdate(): Promise<UpdateState>;
  openReleases(): Promise<void>;
  onUpdateState(callback: (state: UpdateState) => void): () => void;
  platform: string;
  version: string;
}
declare global { interface Window { tangent: TangentBridge } }
