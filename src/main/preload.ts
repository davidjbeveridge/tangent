import { contextBridge, ipcRenderer } from 'electron';
import { version } from '../../package.json';
import type { TangentBridge, BrowserState, Shortcut, UpdateState } from '../shared/types';

const bridge: TangentBridge = {
  getState: () => ipcRenderer.invoke('tangent:get-state'),
  dispatch: command => ipcRenderer.invoke('tangent:command', command),
  onState: callback => {
    const handler = (_event: unknown, state: BrowserState) => callback(state);
    ipcRenderer.on('tangent:state', handler);
    return () => ipcRenderer.removeListener('tangent:state', handler);
  },
  onShortcut: callback => {
    const handler = (_event: unknown, shortcut: Shortcut) => callback(shortcut);
    ipcRenderer.on('tangent:shortcut', handler);
    return () => ipcRenderer.removeListener('tangent:shortcut', handler);
  },
  getUpdateState: () => ipcRenderer.invoke('tangent:update-state'),
  checkForUpdates: () => ipcRenderer.invoke('tangent:update-check'),
  downloadUpdate: () => ipcRenderer.invoke('tangent:update-download'),
  installUpdate: () => ipcRenderer.invoke('tangent:update-install'),
  openReleases: () => ipcRenderer.invoke('tangent:open-releases'),
  onUpdateState: callback => {
    const handler = (_event: unknown, state: UpdateState) => callback(state);
    ipcRenderer.on('tangent:update-state', handler);
    return () => ipcRenderer.removeListener('tangent:update-state', handler);
  },
  platform: process.platform,
  version,
};
contextBridge.exposeInMainWorld('tangent', bridge);
