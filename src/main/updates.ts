import { readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { load as loadYaml } from 'js-yaml';
import type { Logger } from 'electron-updater';
import { verifySignature } from 'electron-updater/out/windowsExecutableCodeSignatureVerifier';
import type { UpdateState } from '../shared/types';

export const UPDATE_FEED = Object.freeze({ provider: 'github' as const, owner: 'davidjbeveridge', repo: 'tangent', channel: 'latest' });
export const STARTUP_CHECK_DELAY_MS = 10_000;
export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const SOURCE_UPDATE_MESSAGE = 'Automatic updates are disabled in source builds. Use Open releases or run npm run update in the project folder.';

export interface UpdatePolicy {
  schemaVersion: 1;
  enabled: true;
  provider: 'github';
  owner: 'davidjbeveridge';
  repo: 'tangent';
  channel: 'latest';
  platform: 'darwin' | 'win32';
  macTeamId?: string;
  publisherName?: string[];
}
export type UpdateGate = { enabled: false; message: string } | { enabled: true; policy: UpdatePolicy };
type Dictionary = Record<string, unknown>;
const dictionary = (value: unknown): value is Dictionary => !!value && typeof value === 'object' && !Array.isArray(value);
const unsupported = (message: string): UpdateGate => ({ enabled: false, message });

export function isFullPublisherName(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 1024 && value === value.trim() && !/[\r\n\0]/.test(value)
    && /(?:^|,)\s*CN\s*=\s*[^,]+/i.test(value)
    && /(?:^|,)\s*(?:O|OU|C|L|S|ST|SERIALNUMBER)\s*=\s*[^,]+/i.test(value);
}

/** Only build resources can select update policy. Nothing in settings or IPC enables it. */
export function validateUpdatePolicy(isPackaged: boolean, platform: string, policy: unknown, manifest: unknown): UpdateGate {
  if (!isPackaged) return unsupported(SOURCE_UPDATE_MESSAGE);
  if (platform !== 'darwin' && platform !== 'win32') return unsupported('Install a newer Tangent release manually on this platform. Automatic updates require a signed macOS or Windows installation.');
  if (!dictionary(policy) || policy.schemaVersion !== 1 || policy.enabled !== true || policy.platform !== platform) {
    return unsupported('Automatic updates are disabled in this build. Install an official signed release to enable them.');
  }
  if (!dictionary(manifest)) return unsupported('Automatic updates are disabled because the packaged update configuration is missing.');
  for (const [key, value] of Object.entries(UPDATE_FEED)) {
    if (policy[key] !== value || manifest[key] !== value) return unsupported('Automatic updates are disabled because the release feed does not match Tangent’s stable channel.');
  }
  if ((manifest.host !== undefined && manifest.host !== 'github.com') || (manifest.protocol !== undefined && manifest.protocol !== 'https')
      || manifest.private === true || manifest.token !== undefined || manifest.requestHeaders !== undefined) {
    return unsupported('Automatic updates are disabled because the release feed contains unsupported overrides.');
  }
  if (platform === 'darwin') {
    if (typeof policy.macTeamId !== 'string' || !/^[A-Z0-9]{10}$/.test(policy.macTeamId)) return unsupported('Automatic updates require a verified Developer ID signing identity.');
  } else {
    const expected = policy.publisherName;
    const configured = typeof manifest.publisherName === 'string' ? [manifest.publisherName] : manifest.publisherName;
    if (!Array.isArray(expected) || expected.length < 1 || expected.length > 4 || !expected.every(isFullPublisherName)
        || !Array.isArray(configured) || configured.length !== expected.length || !configured.every(isFullPublisherName)
        || new Set(expected).size !== expected.length || !expected.every(name => configured.includes(name))) {
      return unsupported('Automatic updates require matching full Windows publisher identities in the signed release configuration.');
    }
  }
  return { enabled: true, policy: { ...UPDATE_FEED, schemaVersion: 1, enabled: true, platform, ...(platform === 'darwin' ? { macTeamId: policy.macTeamId as string } : { publisherName: [...policy.publisherName as string[]] }) } };
}

function readSmallFile(path: string): string {
  if (statSync(path).size > 64 * 1024) throw new Error('Update policy exceeds its size limit.');
  return readFileSync(path, 'utf8');
}

export function loadUpdatePolicy(isPackaged: boolean, platform: string, resourcesPath: string): UpdateGate {
  if (!isPackaged || !['darwin', 'win32'].includes(platform)) return validateUpdatePolicy(isPackaged, platform, undefined, undefined);
  try {
    return validateUpdatePolicy(isPackaged, platform, JSON.parse(readSmallFile(join(resourcesPath, 'update-policy.json'))), loadYaml(readSmallFile(join(resourcesPath, 'app-update.yml'))));
  } catch {
    return unsupported('Automatic updates are disabled because this installation has no valid signed release configuration.');
  }
}

type WindowsVerifier = (publisherNames: string[], file: string, logger: Logger) => Promise<string | null>;
/** Pinned electron-updater 6.8.9 otherwise accepts a missing/unsupported PowerShell verifier. */
export async function verifyWindowsSignature(publisherNames: string[], file: string, verifier: WindowsVerifier = verifySignature): Promise<string | null> {
  if (!publisherNames.length || !publisherNames.every(isFullPublisherName)) return 'A full Windows publisher identity is required.';
  let warning = false;
  const logger: Logger = { info: () => {}, debug: () => {}, warn: () => { warning = true; }, error: () => { warning = true; } };
  try {
    const result = await verifier(publisherNames, file, logger);
    // Treat every diagnostic conservatively, including future skipped-verification paths.
    return warning || result !== null ? 'The Windows update signature could not be fully verified.' : null;
  } catch {
    return 'The Windows update signature could not be verified.';
  }
}

export function isExpectedMacSignature(description: string, teamId: string): boolean {
  return description.split(/\r?\n/).includes(`TeamIdentifier=${teamId}`)
    && description.split(/\r?\n/).some(line => line.startsWith('Authority=Developer ID Application:'));
}

export interface UpdateCheck {
  isUpdateAvailable: boolean;
  updateInfo: { version: string };
}
export type UpdateEvent = { type: 'progress'; percent: number } | { type: 'downloaded'; version: string } | { type: 'error'; error: unknown };
export interface UpdateDriver {
  checkForUpdates(): Promise<UpdateCheck | null>;
  downloadUpdate(): Promise<void>;
  quitAndInstall(): void;
  subscribe(listener: (event: UpdateEvent) => void): () => void;
}

/** Runtime imports remain out of unit tests, and unsigned builds never construct an updater. */
export async function createUpdateDriver(gate: UpdateGate, resourcesPath: string): Promise<{ gate: UpdateGate; driver?: UpdateDriver }> {
  if (!gate.enabled) return { gate };
  try {
    if (gate.policy.platform === 'darwin') {
      const bundle = resolve(resourcesPath, '..', '..');
      const execute = promisify(execFile);
      await execute('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle], { timeout: 30_000, maxBuffer: 1024 * 1024 });
      const metadata = await execute('/usr/bin/codesign', ['--display', '--verbose=4', bundle], { encoding: 'utf8', timeout: 10_000, maxBuffer: 1024 * 1024 });
      if (!isExpectedMacSignature(metadata.stderr, gate.policy.macTeamId!)) throw new Error('The current app is not signed by the configured Developer ID.');
    }
    const { MacUpdater, NsisUpdater } = await import('electron-updater');
    const native = gate.policy.platform === 'darwin' ? new MacUpdater({ ...UPDATE_FEED }) : new NsisUpdater({ ...UPDATE_FEED });
    native.autoDownload = false;
    native.autoInstallOnAppQuit = false;
    native.autoRunAppAfterInstall = true;
    native.forceDevUpdateConfig = false;
    native.channel = 'latest'; // Setting the channel implicitly enables downgrades upstream; reset it below.
    native.allowPrerelease = false;
    native.allowDowngrade = false;
    native.disableWebInstaller = true;
    native.disableDifferentialDownload = true;
    if (native instanceof NsisUpdater) native.verifyUpdateCodeSignature = (names, file) => verifyWindowsSignature(names, file);
    const driver: UpdateDriver = {
      checkForUpdates: () => native.checkForUpdates(),
      downloadUpdate: async () => {
        const files = await native.downloadUpdate();
        // Upstream skips the download task (and its signature check) when reusing its cache.
        if (gate.policy.platform === 'win32') {
          if (files.length !== 1 || !files[0].toLowerCase().endsWith('.exe')) throw new Error('Unexpected Windows update artifact.');
          const failure = await verifyWindowsSignature(gate.policy.publisherName!, files[0]);
          if (failure) throw Object.assign(new Error(failure), { code: 'ERR_UPDATER_INVALID_SIGNATURE' });
        }
      },
      quitAndInstall: () => native.quitAndInstall(false, true),
      subscribe: listener => {
        const progress = (info: { percent: number }) => listener({ type: 'progress', percent: info.percent });
        const downloaded = (info: { version: string }) => listener({ type: 'downloaded', version: info.version });
        const error = (value: Error) => listener({ type: 'error', error: value });
        native.on('download-progress', progress);
        native.on('update-downloaded', downloaded);
        native.on('error', error);
        return () => { native.removeListener('download-progress', progress); native.removeListener('update-downloaded', downloaded); native.removeListener('error', error); };
      },
    };
    return { gate, driver };
  } catch {
    return { gate: unsupported('Automatic updates are disabled because this installation’s signing identity or updater could not be verified.') };
  }
}

export function isNewerStableVersion(current: string, candidate: unknown): candidate is string {
  const pattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
  if (typeof candidate !== 'string' || candidate.length > 128 || current.length > 128) return false;
  const before = pattern.exec(current), after = pattern.exec(candidate);
  if (!before || !after) return false;
  for (let index = 1; index <= 3; index++) {
    const a = BigInt(before[index]), b = BigInt(after[index]);
    if (a !== b) return b > a;
  }
  return false;
}

export interface UpdateSchedule {
  once(callback: () => void, delayMs: number): () => void;
  every(callback: () => void, intervalMs: number): () => void;
}
const schedule: UpdateSchedule = {
  once: (callback, delay) => { const timer = setTimeout(callback, delay); timer.unref(); return () => clearTimeout(timer); },
  every: (callback, delay) => { const timer = setInterval(callback, delay); timer.unref(); return () => clearInterval(timer); },
};
export interface UpdateControllerOptions {
  gate: UpdateGate;
  driver?: UpdateDriver;
  currentVersion: string;
  electronVersion: string;
  chromiumVersion: string;
  confirmRestart(): Promise<boolean>;
  saveBeforeInstall(): Promise<void> | void;
  onState?(state: UpdateState): void;
  now?(): number;
  schedule?: UpdateSchedule;
}

export class UpdateController {
  private state: UpdateState;
  private readonly driver?: UpdateDriver;
  private operation: 'check' | 'download' | 'install' | null = null;
  private checkPromise?: Promise<UpdateState>;
  private downloadPromise?: Promise<UpdateState>;
  private installPromise?: Promise<UpdateState>;
  private installRequested = false;
  private disposed = false;
  private automaticStarted = false;
  private unsubscribe?: () => void;
  private stopTimers: Array<() => void> = [];
  constructor(private readonly options: UpdateControllerOptions) {
    this.driver = options.gate.enabled ? options.driver : undefined;
    this.state = {
      status: this.driver ? 'idle' : 'unsupported',
      currentVersion: options.currentVersion, electronVersion: options.electronVersion, chromiumVersion: options.chromiumVersion,
      message: this.driver ? 'Checks for signed stable Tangent releases automatically. Updates include Electron and Chromium.' : options.gate.enabled ? 'Automatic updates are unavailable in this installation.' : options.gate.message,
      canCheck: false, canDownload: false, canInstall: false,
    };
    this.unsubscribe = this.driver?.subscribe(event => this.handleEvent(event));
  }
  getState(): UpdateState {
    const ready = !!this.driver && !this.disposed && !this.operation && !this.installRequested;
    return { ...this.state, canCheck: ready && this.state.status !== 'downloaded', canDownload: ready && this.state.status === 'available', canInstall: ready && this.state.status === 'downloaded' };
  }
  private publish(patch: Partial<UpdateState> = {}) {
    this.state = { ...this.state, ...patch };
    this.options.onState?.(this.getState());
  }
  private fail(error: unknown, action: string) {
    this.installRequested = false;
    const code = dictionary(error) ? error.code : undefined;
    const message = code === 'ERR_UPDATER_INVALID_SIGNATURE' || code === 'ERR_UPDATER_CHECKSUM_MISMATCH' || code === 'ERR_UPDATER_WEB_INSTALLER_DISABLED'
      ? 'The update could not be verified and was not installed. Check for a new signed release.'
      : `${action} failed. Tangent is still running; try checking for updates again.`;
    this.publish({ status: 'error', message, progress: undefined, availableVersion: undefined });
  }
  private handleEvent(event: UpdateEvent) {
    if (this.disposed) return;
    if (event.type === 'error') { this.fail(event.error, this.installRequested || this.operation === 'install' ? 'Installing the update' : this.operation === 'download' ? 'Downloading the update' : 'Checking for updates'); return; }
    if (this.operation !== 'download' || this.state.status === 'error') return;
    if (event.type === 'progress') {
      if (Number.isFinite(event.percent)) this.publish({ progress: Math.max(0, Math.min(100, event.percent)) });
    } else if (event.version !== this.state.availableVersion || !isNewerStableVersion(this.state.currentVersion, event.version)) {
      this.fail(new Error('Downloaded version does not match the checked release.'), 'Downloading the update');
    } else {
      this.publish({ status: 'downloaded', progress: 100, message: 'Update downloaded. Restart when you are ready; the platform signature must pass before installation.' });
    }
  }
  checkForUpdates(): Promise<UpdateState> {
    if (this.checkPromise) return this.checkPromise;
    if (!this.getState().canCheck) return Promise.resolve(this.getState());
    this.operation = 'check';
    this.publish({ status: 'checking', message: 'Checking Tangent’s stable releases…', progress: undefined, availableVersion: undefined });
    this.checkPromise = Promise.resolve().then(async () => {
      try {
        const result = await this.driver!.checkForUpdates();
        if (this.disposed) return this.getState();
        if (!result) throw new Error('Updater was disabled.');
        if (this.state.status === 'error') return;
        if (result.isUpdateAvailable) {
          if (!isNewerStableVersion(this.state.currentVersion, result.updateInfo.version)) throw new Error('Only newer stable versions are permitted.');
          this.publish({ status: 'available', availableVersion: result.updateInfo.version, message: `Tangent ${result.updateInfo.version} is available. Download the complete app to update Chromium too.` });
        } else this.publish({ status: 'idle', message: 'No newer compatible stable release is available.' });
        this.publish({ lastCheckedAt: (this.options.now ?? Date.now)() });
      } catch (error) {
        if (!this.disposed) {
          if (dictionary(error) && error.code === 'ERR_UPDATER_NO_PUBLISHED_VERSIONS') this.publish({ status: 'idle', message: 'No stable release has been published yet.', lastCheckedAt: (this.options.now ?? Date.now)() });
          else this.fail(error, 'Checking for updates');
        }
      } finally { this.operation = null; this.checkPromise = undefined; if (!this.disposed) this.publish(); }
    }).then(() => this.getState());
    return this.checkPromise;
  }
  downloadUpdate(): Promise<UpdateState> {
    if (this.downloadPromise) return this.downloadPromise;
    if (!this.getState().canDownload) return Promise.resolve(this.getState());
    this.operation = 'download';
    this.publish({ status: 'downloading', progress: 0, message: 'Downloading the complete Tangent update…' });
    this.downloadPromise = Promise.resolve().then(async () => {
      try {
        await this.driver!.downloadUpdate();
        if (!this.disposed && this.state.status !== 'downloaded' && this.state.status !== 'error') throw new Error('No completed update was reported.');
      } catch (error) { if (!this.disposed) this.fail(error, 'Downloading the update'); }
      finally { this.operation = null; this.downloadPromise = undefined; if (!this.disposed) this.publish(); }
    }).then(() => this.getState());
    return this.downloadPromise;
  }
  installUpdate(): Promise<UpdateState> {
    if (this.installPromise) return this.installPromise;
    if (!this.getState().canInstall) return Promise.resolve(this.getState());
    this.operation = 'install';
    this.publish({ message: 'Confirm restart to install this update.' });
    this.installPromise = Promise.resolve().then(async () => {
      try {
        const confirmed = await this.options.confirmRestart();
        if (this.disposed || this.state.status !== 'downloaded') return;
        if (!confirmed) { this.publish({ message: 'Update downloaded. Restart when you are ready.' }); return; }
        await this.options.saveBeforeInstall();
        if (this.disposed || this.state.status !== 'downloaded') return;
        this.installRequested = true;
        this.publish({ message: 'Preparing to restart and install the update…' });
        this.driver!.quitAndInstall();
      } catch (error) { if (!this.disposed) this.fail(error, 'Preparing to restart'); }
      finally { this.operation = null; this.installPromise = undefined; if (!this.disposed) this.publish(); }
    }).then(() => this.getState());
    return this.installPromise;
  }
  startAutomaticChecks() {
    if (!this.driver || this.disposed || this.automaticStarted) return;
    this.automaticStarted = true;
    const scheduler = this.options.schedule ?? schedule;
    this.stopTimers.push(scheduler.once(() => { void this.checkForUpdates(); }, STARTUP_CHECK_DELAY_MS));
    this.stopTimers.push(scheduler.every(() => { void this.checkForUpdates(); }, UPDATE_CHECK_INTERVAL_MS));
  }
  dispose() {
    this.disposed = true;
    this.stopTimers.forEach(stop => stop()); this.stopTimers = [];
    this.unsubscribe?.(); this.unsubscribe = undefined;
  }
}
