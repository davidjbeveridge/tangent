import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, copyFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserState } from '../shared/types';
import { initialState, restoreState, serializeState } from '../core/state';

export class SessionStorage {
  readonly path: string;
  warning: string | null = null;
  constructor(directory: string) { mkdirSync(directory, { recursive: true }); this.path = join(directory, 'session.json'); }
  load(): BrowserState {
    if (!existsSync(this.path)) return initialState();
    try {
      if (statSync(this.path).size > 12 * 1024 * 1024) throw new Error('Session file exceeds size limit.');
      return restoreState(JSON.parse(readFileSync(this.path, 'utf8')));
    } catch (error) {
      const recovery = `${this.path}.recovery-${Date.now()}`;
      copyFileSync(this.path, recovery);
      this.warning = `The saved session could not be loaded. A recovery copy is at ${recovery}. ${String(error)}`;
      return initialState();
    }
  }
  save(state: BrowserState) {
    const temporary = `${this.path}.${process.pid}.tmp`;
    writeFileSync(temporary, serializeState(state), { encoding: 'utf8', mode: 0o600 });
    renameSync(temporary, this.path);
  }
}
