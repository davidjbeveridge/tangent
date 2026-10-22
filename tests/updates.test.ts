import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serializeToYaml } from 'builder-util';
import {
  UpdateController, UPDATE_FEED, SOURCE_UPDATE_MESSAGE, STARTUP_CHECK_DELAY_MS, UPDATE_CHECK_INTERVAL_MS,
  validateUpdatePolicy, loadUpdatePolicy, isExpectedMacSignature, isNewerStableVersion, verifyWindowsSignature,
  type UpdateCheck, type UpdateControllerOptions, type UpdateDriver, type UpdateEvent, type UpdatePolicy, type UpdateSchedule,
} from '../src/main/updates';

const publisher = 'CN=Tangent Test Publisher, O=Tangent Test Publisher, L=Seattle, S=Washington, C=US';
const policy: UpdatePolicy = { ...UPDATE_FEED, schemaVersion: 1, enabled: true, platform: 'win32', publisherName: [publisher] };
const manifest = { ...UPDATE_FEED, publisherName: [publisher], updaterCacheDirName: 'tangent-browser-updater' };
const checked: UpdateCheck = { isUpdateAvailable: true, updateInfo: { version: '0.2.0' } };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
class FakeDriver implements UpdateDriver {
  checks = 0;
  downloads = 0;
  installs = 0;
  listener?: (event: UpdateEvent) => void;
  check: () => Promise<UpdateCheck | null> = async () => checked;
  download: () => Promise<void> = async () => { this.emit({ type: 'progress', percent: 70 }); this.emit({ type: 'downloaded', version: '0.2.0' }); };
  checkForUpdates() { this.checks++; return this.check(); }
  downloadUpdate() { this.downloads++; return this.download(); }
  quitAndInstall() { this.installs++; }
  subscribe(listener: (event: UpdateEvent) => void) { this.listener = listener; return () => { this.listener = undefined; }; }
  emit(event: UpdateEvent) { this.listener?.(event); }
}
function fixture(extra: Partial<UpdateControllerOptions> = {}) {
  const driver = new FakeDriver();
  let prompts = 0, saves = 0;
  const controller = new UpdateController({
    gate: { enabled: true, policy }, driver, currentVersion: '0.1.0', electronVersion: '45.0.0', chromiumVersion: '154.0.1.2',
    confirmRestart: async () => { prompts++; return true; }, saveBeforeInstall: () => { saves++; }, now: () => 12345,
    ...extra,
  });
  return { controller, driver, get prompts() { return prompts; }, get saves() { return saves; } };
}
async function ready(f: ReturnType<typeof fixture>) { await f.controller.checkForUpdates(); await f.controller.downloadUpdate(); }

test('only packaged signed Mac/Windows policy can enable the fixed stable feed', () => {
  assert.equal(validateUpdatePolicy(false, 'win32', policy, manifest).enabled, false);
  assert.equal(validateUpdatePolicy(true, 'linux', policy, manifest).enabled, false);
  assert.equal(validateUpdatePolicy(true, 'win32', undefined, manifest).enabled, false);
  assert.equal(validateUpdatePolicy(true, 'win32', policy, undefined).enabled, false);
  assert.equal(validateUpdatePolicy(true, 'win32', policy, manifest).enabled, true);
  assert.equal(validateUpdatePolicy(true, 'win32', policy, { ...manifest, publisherName: publisher }).enabled, true);
  for (const patch of [{ provider: 'generic' }, { owner: 'elsewhere' }, { repo: 'other' }, { channel: 'beta' }]) {
    assert.equal(validateUpdatePolicy(true, 'win32', { ...policy, ...patch }, manifest).enabled, false);
    assert.equal(validateUpdatePolicy(true, 'win32', policy, { ...manifest, ...patch }).enabled, false);
  }
  for (const patch of [{ host: 'example.com' }, { protocol: 'http' }, { private: true }, { token: 'token' }, { requestHeaders: {} }]) {
    assert.equal(validateUpdatePolicy(true, 'win32', policy, { ...manifest, ...patch }).enabled, false);
  }
  for (const names of [undefined, [], ['Tangent Test Publisher'], ['CN=Tangent Test Publisher'], [`${publisher}, OU=Unexpected`]]) {
    assert.equal(validateUpdatePolicy(true, 'win32', policy, { ...manifest, publisherName: names }).enabled, false);
  }
  const mac = { ...policy, platform: 'darwin', publisherName: undefined, macTeamId: 'A1B2C3D4E5' };
  assert.equal(validateUpdatePolicy(true, 'darwin', mac, UPDATE_FEED).enabled, true);
  assert.equal(validateUpdatePolicy(true, 'darwin', { ...mac, macTeamId: '-' }, UPDATE_FEED).enabled, false);
});

test('policy loading fails closed on absent, invalid and oversized resources', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tangent-update-policy-'));
  try {
    assert.equal(loadUpdatePolicy(false, 'win32', '/does-not-exist').enabled, false);
    assert.equal(loadUpdatePolicy(true, 'win32', directory).enabled, false);
    writeFileSync(join(directory, 'update-policy.json'), JSON.stringify(policy));
    writeFileSync(join(directory, 'app-update.yml'), JSON.stringify(manifest)); // JSON is also YAML.
    assert.equal(loadUpdatePolicy(true, 'win32', directory).enabled, true);
    writeFileSync(join(directory, 'app-update.yml'), 'provider: github\nprovider: generic');
    assert.equal(loadUpdatePolicy(true, 'win32', directory).enabled, false);
    writeFileSync(join(directory, 'update-policy.json'), ' '.repeat(65537));
    assert.equal(loadUpdatePolicy(true, 'win32', directory).enabled, false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('packaged policies accept the actual builder YAML serializer on Windows and macOS', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tangent-builder-yaml-'));
  try {
    // Builder/updater retain their YAML 4 dependency; the application uses YAML 5.
    // Exercise their real serializer, including the publisher-name sequence.
    const cases = [
      { platform: 'win32', policy, manifest },
      { platform: 'darwin', policy: { ...UPDATE_FEED, schemaVersion: 1, enabled: true, platform: 'darwin', macTeamId: 'A1B2C3D4E5' },
        manifest: { ...UPDATE_FEED, updaterCacheDirName: 'tangent-browser-updater' } },
    ];
    for (const sample of cases) {
      writeFileSync(join(directory, 'update-policy.json'), JSON.stringify(sample.policy));
      const yaml = serializeToYaml(sample.manifest);
      assert.match(yaml, /^provider: github/m);
      writeFileSync(join(directory, 'app-update.yml'), `\uFEFF---\n${yaml}`);
      const gate = loadUpdatePolicy(true, sample.platform, directory);
      assert.equal(gate.enabled, true, sample.platform);
      if (gate.enabled) assert.deepEqual(gate.policy, sample.policy);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('packaged YAML rejects graphs, excessive nesting and ambiguous merge overrides', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tangent-bounded-yaml-'));
  try {
    writeFileSync(join(directory, 'update-policy.json'), JSON.stringify(policy));
    const valid = serializeToYaml(manifest);
    const invalid = [
      '',
      `${valid}\n---\n${valid}`, // Never select one document from a stream silently.
      `${valid}\nextra: &loop [*loop]\n`,
      `${valid}\nanchor: &shared value\nextra: *shared\n`,
      `${valid}\nextra: ${'['.repeat(17)}value${']'.repeat(17)}\n`,
      `${valid}\n<<: {host: unexpected.example}\n`, // YAML 4 would merge this; YAML 5 treats it as data.
      `${valid}\nextra: !!js/function 'function () {}'\n`,
      `${valid}\n# ${'é'.repeat(33_000)}\n`, // The file limit is bytes, not JavaScript string length.
    ];
    for (const source of invalid) {
      writeFileSync(join(directory, 'app-update.yml'), source);
      assert.equal(loadUpdatePolicy(true, 'win32', directory).enabled, false, source.slice(0, 200));
    }
    writeFileSync(join(directory, 'app-update.yml'), valid);
    assert.equal(loadUpdatePolicy(true, 'win32', directory).enabled, true, 'Rejected configuration must not poison the next load');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('mac signing identity rejects ad hoc, different team and substring matches', () => {
  assert.equal(isExpectedMacSignature('Authority=Developer ID Application: Test\nTeamIdentifier=A1B2C3D4E5\n', 'A1B2C3D4E5'), true);
  assert.equal(isExpectedMacSignature('Signature=adhoc\nTeamIdentifier=A1B2C3D4E5\n', 'A1B2C3D4E5'), false);
  assert.equal(isExpectedMacSignature('Authority=Developer ID Application: Test\nTeamIdentifier=OTHER12345\n', 'A1B2C3D4E5'), false);
  assert.equal(isExpectedMacSignature('Authority=Developer ID Application: Test\nTeamIdentifier=A1B2C3D4E50\n', 'A1B2C3D4E5'), false);
});

test('Windows verification fails closed on warnings, errors, mismatches, exceptions and missing identities', async () => {
  assert.equal(await verifyWindowsSignature([publisher], 'update.exe', async () => null), null);
  assert.notEqual(await verifyWindowsSignature([publisher], 'update.exe', async (_names, _file, logger) => { logger.warn('Ignoring signature validation'); return null; }), null);
  assert.notEqual(await verifyWindowsSignature([publisher], 'update.exe', async (_names, _file, logger) => { logger.error('Cannot execute verifier'); return null; }), null);
  assert.notEqual(await verifyWindowsSignature([publisher], 'update.exe', async () => 'Wrong signer'), null);
  assert.notEqual(await verifyWindowsSignature([publisher], 'update.exe', async () => { throw new Error('PowerShell missing'); }), null);
  let called = false;
  assert.notEqual(await verifyWindowsSignature([], 'update.exe', async () => { called = true; return null; }), null);
  assert.notEqual(await verifyWindowsSignature(['CN=Only CN'], 'update.exe', async () => { called = true; return null; }), null);
  assert.equal(called, false);
});

test('versions permit only strictly newer stable releases', () => {
  assert.equal(isNewerStableVersion('0.9.0', '0.10.0'), true);
  assert.equal(isNewerStableVersion('1.0.0', '1.0.1+build.1'), true);
  for (const version of ['0.9.9', '1.0.0', '1.0.0+different', '2.0.0-beta.1', 'v2.0.0', '01.0.0', 'Infinity', null, {}]) assert.equal(isNewerStableVersion('1.0.0', version), false);
});

test('unsupported builds cannot check, download, restart or schedule even with an injected driver', async () => {
  const calls: string[] = [];
  const f = fixture({ gate: { enabled: false, message: SOURCE_UPDATE_MESSAGE }, schedule: { once: () => { calls.push('once'); return () => {}; }, every: () => { calls.push('every'); return () => {}; } } });
  f.controller.startAutomaticChecks();
  for (const action of [() => f.controller.checkForUpdates(), () => f.controller.downloadUpdate(), () => f.controller.installUpdate()]) {
    const state = await action();
    assert.equal(state.status, 'unsupported'); assert.equal(state.message, SOURCE_UPDATE_MESSAGE);
    assert.equal(state.canCheck, false); assert.equal(state.canDownload, false); assert.equal(state.canInstall, false);
  }
  assert.equal(f.driver.checks + f.driver.downloads + f.driver.installs + f.prompts + f.saves, 0);
  assert.deepEqual(calls, []);
});

test('check is reentrant and never starts downloads automatically', async () => {
  const pending = deferred<UpdateCheck>();
  const f = fixture(); f.driver.check = () => pending.promise;
  const first = f.controller.checkForUpdates(), second = f.controller.checkForUpdates();
  assert.equal(first, second);
  assert.equal(f.controller.getState().status, 'checking');
  assert.equal(f.controller.getState().canCheck, false);
  await f.controller.downloadUpdate(); await f.controller.installUpdate();
  assert.equal(f.driver.checks, 1); assert.equal(f.driver.downloads, 0); assert.equal(f.driver.installs, 0);
  pending.resolve(checked);
  const result = await first;
  assert.equal(result.status, 'available'); assert.equal(result.availableVersion, '0.2.0');
  assert.equal(result.lastCheckedAt, 12345); assert.equal(result.canDownload, true); assert.equal(result.canInstall, false);
});

test('no-release and no-newer-release are distinct from network/configuration failures', async () => {
  const f = fixture();
  f.driver.check = async () => { throw Object.assign(new Error('No versions'), { code: 'ERR_UPDATER_NO_PUBLISHED_VERSIONS' }); };
  assert.match((await f.controller.checkForUpdates()).message, /No stable release has been published/);
  f.driver.check = async () => ({ isUpdateAvailable: false, updateInfo: { version: '0.1.0' } });
  assert.equal((await f.controller.checkForUpdates()).status, 'idle');
  f.driver.check = async () => { throw Object.assign(new Error('404'), { code: 'ERR_UPDATER_LATEST_VERSION_NOT_FOUND' }); };
  assert.equal((await f.controller.checkForUpdates()).status, 'error');
  f.driver.check = async () => null;
  assert.equal((await f.controller.checkForUpdates()).status, 'error');
  f.driver.check = async () => checked;
  assert.equal((await f.controller.checkForUpdates()).status, 'available');
});

test('downgrade and prerelease responses never become downloadable', async () => {
  const f = fixture();
  for (const version of ['0.0.9', '0.1.0', '0.2.0-beta.1', 'not-a-version']) {
    f.driver.check = async () => ({ isUpdateAvailable: true, updateInfo: { version } });
    const state = await f.controller.checkForUpdates();
    assert.equal(state.status, 'error'); assert.equal(state.canDownload, false);
  }
});

test('download is reentrant, validates completion and never permits restart before its promise resolves', async () => {
  const pending = deferred<void>(); const f = fixture();
  await f.controller.checkForUpdates(); f.driver.download = () => pending.promise;
  const first = f.controller.downloadUpdate(), second = f.controller.downloadUpdate();
  assert.equal(first, second); await Promise.resolve();
  f.driver.emit({ type: 'progress', percent: 150 }); assert.equal(f.controller.getState().progress, 100);
  f.driver.emit({ type: 'progress', percent: -10 }); assert.equal(f.controller.getState().progress, 0);
  f.driver.emit({ type: 'progress', percent: NaN }); assert.equal(f.controller.getState().progress, 0);
  f.driver.emit({ type: 'downloaded', version: '0.2.0' });
  assert.equal(f.controller.getState().canInstall, false); // Windows cache signature recheck may still be pending.
  await f.controller.installUpdate(); assert.equal(f.prompts, 0);
  pending.resolve();
  assert.equal((await first).canInstall, true);
  assert.equal(f.driver.downloads, 1); assert.equal(f.driver.installs, 0);
  await f.controller.checkForUpdates(); assert.equal(f.driver.checks, 1); // Preserve the ready update.
});

test('incorrect or incomplete downloaded files cannot reach restart', async () => {
  for (const downloadedVersion of ['0.3.0', '0.1.0', undefined]) {
    const f = fixture(); await f.controller.checkForUpdates();
    f.driver.download = async () => { if (downloadedVersion) f.driver.emit({ type: 'downloaded', version: downloadedVersion }); };
    assert.equal((await f.controller.downloadUpdate()).status, 'error');
    await f.controller.installUpdate(); assert.equal(f.driver.installs, 0); assert.equal(f.prompts, 0);
  }
});

test('signature failure after a downloaded event invalidates the update', async () => {
  const f = fixture(); await f.controller.checkForUpdates();
  f.driver.download = async () => { f.driver.emit({ type: 'downloaded', version: '0.2.0' }); throw Object.assign(new Error('Bad cached signature'), { code: 'ERR_UPDATER_INVALID_SIGNATURE' }); };
  const result = await f.controller.downloadUpdate();
  assert.equal(result.status, 'error'); assert.match(result.message, /could not be verified/);
  await f.controller.installUpdate(); assert.equal(f.driver.installs, 0);
});

test('restart requires explicit confirmation and successful persistence in that order', async () => {
  const order: string[] = [];
  const f = fixture({ confirmRestart: async () => { order.push('confirm'); return true; }, saveBeforeInstall: async () => { order.push('save'); } });
  f.driver.quitAndInstall = () => { order.push('install'); f.driver.installs++; };
  await f.controller.installUpdate(); assert.deepEqual(order, []);
  await ready(f);
  const result = await f.controller.installUpdate();
  assert.deepEqual(order, ['confirm', 'save', 'install']);
  assert.equal(result.canInstall, false); assert.equal(result.canCheck, false);
  await f.controller.installUpdate(); assert.equal(f.driver.installs, 1);
});

test('cancelling restart preserves a ready update without saving or installing', async () => {
  const f = fixture({ confirmRestart: async () => false }); await ready(f);
  const result = await f.controller.installUpdate();
  assert.equal(result.status, 'downloaded'); assert.equal(result.canInstall, true);
  assert.equal(f.driver.installs, 0); assert.equal(f.saves, 0);
});

test('failed persistence prevents restart and reports a recoverable error', async () => {
  const f = fixture({ saveBeforeInstall: () => { throw new Error('Disk full'); } }); await ready(f);
  const result = await f.controller.installUpdate();
  assert.equal(result.status, 'error'); assert.equal(result.canCheck, true); assert.equal(f.driver.installs, 0);
});

test('restart prompts coalesce and asynchronous updater errors revoke confirmation', async () => {
  const approval = deferred<boolean>();
  const f = fixture({ confirmRestart: () => approval.promise }); await ready(f);
  const first = f.controller.installUpdate(), second = f.controller.installUpdate();
  assert.equal(first, second); await Promise.resolve();
  f.driver.emit({ type: 'error', error: new Error('Invalid signature') }); approval.resolve(true);
  assert.equal((await first).status, 'error'); assert.equal(f.driver.installs, 0); assert.equal(f.saves, 0);
});

test('automatic checks use startup and six-hour schedule only once, and stop on dispose', async () => {
  const scheduled: Array<{ delay: number; callback: () => void; stopped: boolean }> = [];
  const add = (callback: () => void, delay: number) => { const item = { callback, delay, stopped: false }; scheduled.push(item); return () => { item.stopped = true; }; };
  const timers: UpdateSchedule = { once: add, every: add };
  const f = fixture({ schedule: timers }); f.controller.startAutomaticChecks(); f.controller.startAutomaticChecks();
  assert.deepEqual(scheduled.map(t => t.delay), [STARTUP_CHECK_DELAY_MS, UPDATE_CHECK_INTERVAL_MS]);
  scheduled[0].callback(); await f.controller.checkForUpdates(); assert.equal(f.driver.checks, 1);
  f.controller.dispose(); assert.equal(scheduled.every(t => t.stopped), true); assert.equal(f.driver.listener, undefined);
  scheduled[1].callback(); await f.controller.checkForUpdates(); assert.equal(f.driver.checks, 1);
});

test('closing during an in-flight check prevents late UI state and further actions', async () => {
  const pending = deferred<UpdateCheck>(); let notifications = 0;
  const f = fixture({ onState: () => { notifications++; } }); f.driver.check = () => pending.promise;
  const check = f.controller.checkForUpdates(); f.controller.dispose(); const before = notifications;
  pending.resolve(checked); const result = await check;
  assert.equal(notifications, before); assert.equal(result.canDownload, false); assert.equal(result.canCheck, false);
});
