#!/usr/bin/env node
// Verify the distributed manual installers, not `electron .` or an unpacked build.
// Windows installation is restricted to disposable CI. Every browser profile,
// extraction directory, mount, and installation used here belongs to this run.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { _electron as electron, expect } from '@playwright/test';

const execute = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const help = 'Usage: node scripts/check-packaged.mjs [--release-dir DIR] [--output FILE]\n\nChecks native manual installers from release/ in temporary locations.\nRequires a graphical desktop (Linux: xvfb-run), a normal non-root account,\nand a disposable CI runner for Windows installation. Never disables sandboxing.\n';
if (args.includes('--help')) { console.log(help); process.exit(0); }
let releaseDirectory = join(root, 'release');
let output;
for (let i = 0; i < args.length; i++) {
  assert(['--release-dir', '--output'].includes(args[i]) && args[i + 1] && !args[i + 1].startsWith('--'), help);
  if (args[i] === '--release-dir') releaseDirectory = resolve(args[++i]);
  else output = resolve(args[++i]);
}
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
if (output) await rm(output, { force: true }); // A failed rerun must not leave a stale passing report.
const temporary = await mkdtemp(join(tmpdir(), 'tangent-package-smoke-'));
const profile = join(temporary, 'profile');
await mkdir(profile);
const environment = { ...process.env, TANGENT_USER_DATA: profile };
delete environment.ELECTRON_RUN_AS_NODE;
let browser;
let shell;
let server;
let mountedVolume;
let windowsInstall;
let diagnostics = '';
let report;
const formats = [];
const checks = {};
const digest = data => createHash('sha256').update(data).digest('hex');
const fileDigest = async path => digest(await readFile(path));
const exists = async path => { try { await stat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
async function command(file, parameters, options = {}) {
  try { return await execute(file, parameters, { cwd: root, env: environment, timeout: 120_000, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8', windowsHide: true, ...options }); }
  catch (error) { throw new Error(`${basename(file)} failed: ${String(error.stderr || error.message).trim()}`); }
}
async function artifact(extension) {
  const platform = { darwin: 'mac', win32: 'win', linux: 'linux' }[process.platform];
  assert(platform, `Unsupported smoke-test platform: ${process.platform}`);
  const artifactArchitecture = process.platform === 'linux' && process.arch === 'x64' ? 'x86_64' : process.arch;
  const name = `Tangent-${manifest.version}-${platform}-${artifactArchitecture}.${extension}`;
  const path = join(releaseDirectory, name);
  assert((await stat(path)).isFile(), `Missing packaged artifact: ${path}`);
  formats.push({ name, sha256: await fileDigest(path), verification: [] });
  return path;
}
async function licenses(resources) {
  const pairs = [
    ['licenses/Tangent-LICENSE.txt', 'LICENSE'],
    ['licenses/THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES.md'],
    ['licenses/electron/LICENSE', 'node_modules/electron/dist/LICENSE'],
    ['licenses/electron/LICENSES.chromium.html', 'node_modules/electron/dist/LICENSES.chromium.html'],
  ];
  for (const [packaged, original] of pairs) {
    const content = await readFile(join(resources, packaged));
    assert(content.length > 100, `Empty packaged notice: ${packaged}`);
    assert.equal(digest(content), await fileDigest(join(root, original)), `Packaged notice differs from the checked release: ${packaged}`);
  }
  assert(!await exists(join(resources, 'update-policy.json')), 'Manual packages must not carry a signed updater policy');
  assert(!await exists(join(resources, 'app-update.yml')), 'Manual packages must not carry an automatic update feed');
}
async function preparePackage() {
  if (process.platform === 'darwin') {
    const zip = await artifact('zip');
    const dmg = await artifact('dmg');
    const zipDirectory = join(temporary, 'zip'); await mkdir(zipDirectory);
    await command('/usr/bin/ditto', ['-x', '-k', zip, zipDirectory]);
    const zipBundle = join(zipDirectory, 'Tangent.app');
    const volume = join(temporary, 'dmg-volume'); await mkdir(volume);
    await command('/usr/bin/hdiutil', ['attach', '-nobrowse', '-readonly', '-mountpoint', volume, dmg]);
    mountedVolume = volume;
    const dmgBundle = join(temporary, 'Tangent.app');
    await command('/usr/bin/ditto', [join(volume, 'Tangent.app'), dmgBundle]);
    await command('/usr/bin/hdiutil', ['detach', volume]); mountedVolume = undefined;
    for (const bundle of [zipBundle, dmgBundle]) {
      // Ad-hoc signatures establish package integrity, not a trusted publisher.
      await command('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle]);
      await licenses(join(bundle, 'Contents', 'Resources'));
    }
    for (const relative of [
      'Contents/Resources/app.asar', 'Contents/MacOS/Tangent', 'Contents/Info.plist',
      'Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework',
    ]) assert.equal(await fileDigest(join(zipBundle, relative)), await fileDigest(join(dmgBundle, relative)), `DMG and ZIP differ: ${relative}`);
    formats[0].verification.push('ZIP extracted', 'ad-hoc signature integrity', 'licenses', 'code and runtime match DMG');
    formats[1].verification.push('DMG mounted read-only and app copied', 'ad-hoc signature integrity', 'licenses', 'native launch and restart');
    checks.macArchiveConsistency = true;
    return { launcher: join(dmgBundle, 'Contents', 'MacOS', 'Tangent'), executable: join(dmgBundle, 'Contents', 'MacOS', 'Tangent'), resources: join(dmgBundle, 'Contents', 'Resources') };
  }
  if (process.platform === 'win32') {
    assert.equal(process.env.CI, 'true', 'NSIS smoke installation is allowed only in a disposable CI runner, never a user installation');
    const installer = await artifact('exe');
    windowsInstall = join(temporary, 'installed');
    // NSIS requires /D last, with the remainder of the command line unquoted.
    // Parameters are fixed; the destination is a generated temporary path.
    await command(installer, ['/S', '/currentuser', `/D=${windowsInstall}`], { windowsVerbatimArguments: true });
    const executable = join(windowsInstall, 'Tangent.exe');
    assert(await exists(executable), 'NSIS did not install Tangent into the requested temporary location');
    formats[0].verification.push('per-user silent NSIS install into temporary directory', 'native launch and restart', 'uninstall');
    return { launcher: executable, executable, resources: join(windowsInstall, 'resources') };
  }
  assert.equal(process.platform, 'linux');
  const appImage = await artifact('AppImage');
  const extract = join(temporary, 'appimage'); await mkdir(extract);
  await command(appImage, ['--appimage-extract'], { cwd: extract });
  const appDirectory = join(extract, 'squashfs-root');
  const launcher = join(appDirectory, 'AppRun');
  const desktopNames = (await readdir(appDirectory)).filter(name => name.endsWith('.desktop'));
  assert.equal(desktopNames.length, 1, 'Expected exactly one AppImage desktop entry');
  assert.equal(await fileDigest(launcher), await fileDigest(join(root, 'build', 'AppRun')), 'AppImage did not retain the reviewed sandbox-preserving AppRun');
  const desktop = await readFile(join(appDirectory, desktopNames[0]), 'utf8');
  const execLines = desktop.split(/\r?\n/).filter(line => line.startsWith('Exec='));
  assert(execLines.length > 0, 'AppImage desktop entry has no launcher');
  assert(execLines.every(line => !/--(?:no-sandbox|disable-setuid-sandbox|disable-seccomp-filter-sandbox|disable-gpu-sandbox)\b/.test(line)), 'AppImage desktop entry disables Chromium sandboxing');
  environment.APPDIR = appDirectory;
  formats[0].verification.push('AppImage extracted', 'actual AppRun launcher', 'no sandbox-disabling launcher flags', 'native launch and restart');
  checks.appImageLauncherPolicy = true;
  return { launcher, executable: join(appDirectory, 'tangent-browser'), resources: join(appDirectory, 'resources') };
}
async function launch(packaged) {
  // No --no-sandbox fallback. Hosted native runners validate the real policy.
  browser = await electron.launch({ executablePath: packaged.launcher, args: [], chromiumSandbox: true, cwd: temporary, env: environment, timeout: 45_000 });
  browser.process().stderr?.on('data', data => { diagnostics = (diagnostics + String(data)).slice(-16_000); });
  shell = await browser.firstWindow();
  shell.setDefaultTimeout(15_000);
  await shell.waitForURL('tangent://app/index.html');
  await expect(shell.locator('.brand')).toHaveText('Tangent');
  await expect(shell).toHaveTitle('Tangent');
  return browser.evaluate(({ app }) => ({
    packaged: app.isPackaged, appPath: app.getAppPath(), name: app.getName(), version: app.getVersion(),
    executable: process.execPath, resources: process.resourcesPath, profile: app.getPath('userData'),
    electron: process.versions.electron, chromium: process.versions.chrome, node: process.versions.node,
    architecture: process.arch, platform: process.platform,
    disabledSandbox: ['no-sandbox', 'disable-setuid-sandbox', 'disable-seccomp-filter-sandbox', 'disable-gpu-sandbox'].filter(flag => app.commandLine.hasSwitch(flag)),
  }));
}
async function contentId(url) {
  let id;
  await expect.poll(async () => {
    id = await browser.evaluate(({ webContents }, target) => webContents.getAllWebContents().find(wc => wc.getURL() === target)?.id, url);
    return id || 0;
  }, { timeout: 20_000 }).toBeGreaterThan(0);
  return id;
}
async function pageScript(id, code) {
  return browser.evaluate(({ webContents }, input) => {
    const content = webContents.fromId(input.id);
    if (!content) throw new Error('Packaged browser content disappeared');
    return content.executeJavaScript(input.code, true);
  }, { id, code });
}
async function verifyContentSandbox(id) {
  const state = await browser.evaluate(({ app, webContents }, id) => {
    const content = webContents.fromId(id);
    if (!content) throw new Error('Missing renderer for sandbox inspection');
    const pid = content.getOSProcessId();
    const preferences = content.getLastWebPreferences();
    const metric = app.getAppMetrics().find(entry => entry.pid === pid);
    return { pid, preferences: { sandbox: preferences.sandbox, nodeIntegration: preferences.nodeIntegration, contextIsolation: preferences.contextIsolation },
      metrics: metric ? { sandboxed: metric.sandboxed, integrityLevel: metric.integrityLevel } : undefined };
  }, id);
  assert.equal(state.preferences.sandbox, true); assert.equal(state.preferences.nodeIntegration, false); assert.equal(state.preferences.contextIsolation, true);
  if (process.platform === 'linux') {
    const status = await readFile(`/proc/${state.pid}/status`, 'utf8');
    assert(/^NoNewPrivs:\s+1$/m.test(status), 'Linux renderer did not set no_new_privs');
    assert(/^Seccomp:\s+2$/m.test(status), 'Linux renderer has no seccomp filtering');
    return { method: 'renderer /proc status and Electron preferences', noNewPrivileges: true, seccompFilter: true };
  }
  assert.equal(state.metrics?.sandboxed, true, 'Electron reports that the remote renderer is not sandboxed at OS level');
  return { method: 'Electron process metrics', sandboxed: true, ...(state.metrics.integrityLevel ? { integrityLevel: state.metrics.integrityLevel } : {}) };
}
async function closeBrowser() {
  if (!browser) return;
  const current = browser; browser = undefined;
  await current.close();
}
try {
  console.log(`Verifying distributed Tangent ${manifest.version} packages for ${process.platform}/${process.arch}…`);
  const packaged = await preparePackage();
  await licenses(packaged.resources); checks.bundledLicenses = true; checks.noAutomaticUpdateConfiguration = true;
  assert(process.getuid?.() !== 0, 'Packaged launch requires a normal non-root account. This check never disables Chromium sandboxing; use the hosted native CI result in a root-only container.');
  server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end('<!doctype html><meta charset="utf-8"><title>Packaged browser fixture</title><h1>Packaged browser fixture</h1><p>This local page is served only during native package verification.</p>');
  });
  await new Promise((accept, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', accept); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const url = `${origin}/persist`;
  const runtime = await launch(packaged);
  assert.equal(runtime.packaged, true, 'Smoke test accidentally launched a source build');
  assert.equal(await realpath(runtime.executable), await realpath(packaged.executable), 'Unexpected runtime executable');
  assert.equal(await realpath(runtime.appPath), await realpath(join(packaged.resources, 'app.asar')), 'Application code was not loaded from the delivered ASAR');
  assert.equal(await realpath(runtime.resources), await realpath(packaged.resources));
  assert.equal(await realpath(runtime.profile), await realpath(profile));
  assert.equal(runtime.name, 'Tangent'); assert.equal(runtime.version, manifest.version);
  assert.equal(runtime.electron, manifest.devDependencies.electron);
  assert.equal(runtime.architecture, process.arch); assert.equal(runtime.platform, process.platform);
  assert(/^\d+\.\d+\.\d+\.\d+$/.test(runtime.chromium));
  assert.deepEqual(runtime.disabledSandbox, [], 'The packaged launcher disabled Chromium sandboxing');
  checks.packagedRuntime = true; checks.nativeSandboxPolicy = true;
  await shell.getByRole('button', { name: 'Settings', exact: true }).click();
  const update = await shell.evaluate(() => window.tangent.getUpdateState());
  assert.equal(update.status, 'unsupported'); assert.equal(update.canCheck, false); assert.equal(update.canDownload, false); assert.equal(update.canInstall, false);
  assert(!update.message.includes('source builds'), 'Packaged updater was incorrectly classified as a source build');
  assert.equal(update.currentVersion, runtime.version); assert.equal(update.electronVersion, runtime.electron); assert.equal(update.chromiumVersion, runtime.chromium);
  await expect(shell.locator('#update-status')).toHaveText('Update Tangent manually');
  await expect(shell.locator('#update-message')).toHaveText(update.message);
  await expect(shell.locator('[data-version="tangent"]')).toHaveText(runtime.version);
  await expect(shell.locator('[data-version="electron"]')).toHaveText(runtime.electron);
  await expect(shell.locator('[data-version="chromium"]')).toHaveText(runtime.chromium);
  await expect(shell.getByRole('button', { name: 'Open releases', exact: true })).toBeEnabled();
  await expect(shell.getByRole('button', { name: 'Check for updates', exact: true })).toBeDisabled();
  await expect(shell.getByRole('button', { name: 'Download update', exact: true })).toHaveCount(0);
  await expect(shell.getByRole('button', { name: 'Restart and install', exact: true })).toHaveCount(0);
  await shell.getByRole('button', { name: 'Done', exact: true }).click();
  checks.manualUpdateUI = true;
  await shell.getByRole('button', { name: 'New space', exact: true }).click();
  await shell.locator('#space-name').fill('Release verification');
  await shell.getByRole('button', { name: 'Create space', exact: true }).click();
  await shell.locator('.sidebar-search').click();
  await shell.locator('#palette-input').fill(url); await shell.locator('#palette-input').press('Enter');
  const id = await contentId(url);
  await expect.poll(() => pageScript(id, 'document.readyState')).toBe('complete');
  const rendererSandbox = await verifyContentSandbox(id);
  assert.deepEqual(await pageScript(id, '({require:typeof window.require,process:typeof window.process,bridge:typeof window.tangent})'), { require: 'undefined', process: 'undefined', bridge: 'undefined' });
  await pageScript(id, "document.cookie='tangent-package-proof=retained; Max-Age=604800; SameSite=Lax; path=/'; localStorage.setItem('tangent-package-proof','retained'); true");
  await shell.locator('.tab-row').first().click({ button: 'right' });
  await shell.getByRole('button', { name: 'Pin tab', exact: true }).click();
  const before = await shell.evaluate(() => window.tangent.getState());
  const saved = before.tabs.find(tab => tab.url === url);
  assert.equal(saved?.kind, 'pinned');
  checks.realWebContent = true; checks.remotePrivilegeIsolation = true;
  // Normal app shutdown is responsible for persistence; this test deliberately
  // does not call cookies.flushStore or flushStorageData on the app's behalf.
  await closeBrowser();
  const persisted = JSON.parse(await readFile(join(profile, 'session.json'), 'utf8'));
  assert(persisted.tabs.some(tab => tab.id === saved.id && tab.kind === 'pinned' && tab.url === url));
  const secondRuntime = await launch(packaged);
  assert.equal(secondRuntime.version, runtime.version); assert.equal(secondRuntime.packaged, true); assert.deepEqual(secondRuntime.disabledSandbox, []);
  const restored = await shell.evaluate(() => window.tangent.getState());
  assert(restored.spaces.some(space => space.name === 'Release verification' && space.id === before.activeSpaceId));
  assert(restored.tabs.some(tab => tab.id === saved.id && tab.kind === 'pinned' && tab.url === url));
  await expect(shell.locator('.tab-row').filter({ hasText: 'Packaged browser fixture' })).toBeVisible();
  const restoredContent = await contentId(url);
  await expect.poll(() => pageScript(restoredContent, 'document.readyState')).toBe('complete');
  assert((await pageScript(restoredContent, 'document.cookie')).includes('tangent-package-proof=retained'), 'Persistent cookie was lost during normal restart');
  assert.equal(await pageScript(restoredContent, "localStorage.getItem('tangent-package-proof')"), 'retained', 'Website localStorage was lost during normal restart');
  checks.sessionRestart = true; checks.profileStorageRestart = true;
  await closeBrowser();
  report = { schemaVersion: 1, passed: true, version: runtime.version, electron: runtime.electron, chromium: runtime.chromium,
    node: runtime.node, platform: runtime.platform, architecture: runtime.architecture,
    formats: formats.map(format => ({ ...format, verified: true })), checks, rendererSandbox,
    executableSha256: await fileDigest(packaged.executable), appAsarSha256: await fileDigest(join(packaged.resources, 'app.asar')),
    verifiedAt: new Date().toISOString() };
} catch (error) {
  console.error(`Packaged verification failed: ${error.message}`);
  if (diagnostics) console.error(`Packaged runtime diagnostics:\n${diagnostics}`);
  throw error;
} finally {
  const cleanupErrors = [];
  const clean = async action => { try { await action(); } catch (error) { cleanupErrors.push(error); } };
  await clean(closeBrowser);
  if (server) await clean(() => new Promise((accept, reject) => server.close(error => error ? reject(error) : accept())));
  if (mountedVolume) await clean(() => command('/usr/bin/hdiutil', ['detach', mountedVolume]));
  if (windowsInstall) await clean(async () => {
      const uninstaller = join(windowsInstall, 'Uninstall Tangent.exe');
      if (report) assert(await exists(uninstaller), 'NSIS did not install its uninstaller');
      if (await exists(uninstaller)) {
        await command(uninstaller, ['/S', '/currentuser', `_?=${windowsInstall}`], { windowsVerbatimArguments: true });
        assert(!await exists(join(windowsInstall, 'Tangent.exe')), 'NSIS uninstall left the browser executable installed');
        checks.windowsUninstall = true;
      }
    });
  await clean(() => rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
  if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'Temporary package verification cleanup failed');
}
if (output) { await mkdir(dirname(output), { recursive: true }); await writeFile(output, `${JSON.stringify(report, null, 2)}\n`); }
console.log(JSON.stringify(report, null, 2));
