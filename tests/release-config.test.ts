import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateUpdatePolicy, UPDATE_FEED } from '../src/main/updates';

interface PackContext { appOutDir: string; electronPlatformName: string; packager: { appInfo: { productFilename: string } } }
interface ReleaseConfig {
  appId: string;
  files: string[];
  forceCodeSigning: boolean;
  publish: Record<string, string>;
  mac: Record<string, unknown>;
  win: Record<string, unknown> & { signtoolOptions?: Record<string, unknown> };
  afterPack(context: PackContext): Promise<void>;
}
const { createReleaseConfig } = require('../scripts/release-config.cjs') as {
  createReleaseConfig(base: object, options: { env: Record<string, string | undefined>; platform: string }): ReleaseConfig;
};
const base = {
  appId: 'org.tangentbrowser.desktop', files: ['dist/**/*'], publish: null,
  mac: { identity: null, hardenedRuntime: false, icon: 'build/icon.icns' },
  win: { icon: 'build/icon.ico', signtoolOptions: { certificateSubjectName: 'Unwanted store selector' } },
};
const windowsEnv = { TANGENT_RELEASE_BUILD: '1', WIN_CSC_LINK: 'secret-base64-pfx', WIN_CSC_KEY_PASSWORD: 'secret-pfx-password', TANGENT_WINDOWS_PUBLISHER: 'CN=Tangent Test Publisher, O=Tangent Test Publisher, C=US' };
const macEnv = { TANGENT_RELEASE_BUILD: '1', CSC_LINK: 'secret-base64-p12', CSC_KEY_PASSWORD: 'secret-p12-password', APPLE_ID: 'private@example.test', APPLE_APP_SPECIFIC_PASSWORD: 'secret-apple-password', APPLE_TEAM_ID: 'A1B2C3D4E5', TANGENT_MAC_IDENTITY: 'Developer ID Application: Test Publisher (A1B2C3D4E5)' };

test('signed packaging is explicit, platform-limited and refuses missing credentials without exposing their values', () => {
  assert.throws(() => createReleaseConfig(base, { env: {}, platform: 'darwin' }), /TANGENT_RELEASE_BUILD=1/);
  assert.throws(() => createReleaseConfig(base, { env: macEnv, platform: 'linux' }), /macOS and Windows only/);
  for (const [platform, source] of [['darwin', macEnv], ['win32', windowsEnv]] as const) {
    for (const name of Object.keys(source)) {
      const env: Record<string, string | undefined> = { ...source, [name]: '  ' };
      assert.throws(() => createReleaseConfig(base, { env, platform }), error => {
        assert(error instanceof Error); assert(error.message.includes(name));
        assert(!error.message.includes('secret-')); return true;
      });
    }
  }
});

test('mac releases require matching Developer ID and team, force signing and notarization', () => {
  const config = createReleaseConfig(base, { env: macEnv, platform: 'darwin' });
  assert.equal(config.appId, base.appId); assert.deepEqual(config.files, base.files);
  assert.equal(config.forceCodeSigning, true); assert.equal(config.mac.identity, macEnv.TANGENT_MAC_IDENTITY);
  assert.equal(config.mac.hardenedRuntime, true); assert.equal(config.mac.notarize, true); assert.equal(config.mac.icon, 'build/icon.icns');
  assert.deepEqual(config.mac.target, ['dmg', 'zip']);
  assert.deepEqual(config.publish, { ...UPDATE_FEED, releaseType: 'draft' });
  for (const identity of ['-', 'Test Publisher', 'Developer ID Application: Test Publisher (OTHER12345)', `${macEnv.TANGENT_MAC_IDENTITY}\n`]) {
    assert.throws(() => createReleaseConfig(base, { env: { ...macEnv, TANGENT_MAC_IDENTITY: identity }, platform: 'darwin' }), /Developer ID Application/);
  }
  assert.throws(() => createReleaseConfig(base, { env: { ...macEnv, APPLE_TEAM_ID: 'invalid' }, platform: 'darwin' }), /ten-character/);
  for (const secret of [macEnv.CSC_LINK, macEnv.CSC_KEY_PASSWORD, macEnv.APPLE_ID, macEnv.APPLE_APP_SPECIFIC_PASSWORD]) assert(!JSON.stringify(config).includes(secret));
  assert.equal(base.mac.identity, null); assert.equal(base.mac.hardenedRuntime, false); assert.equal(base.publish, null);
});

test('Windows releases require a full publisher DN and use the certificate export instead of store selection', () => {
  const config = createReleaseConfig(base, { env: windowsEnv, platform: 'win32' });
  assert.equal(config.forceCodeSigning, true); assert.equal(config.win.verifyUpdateCodeSignature, true);
  assert.deepEqual(config.win.target, ['nsis']); assert.equal(config.win.icon, 'build/icon.ico');
  assert.deepEqual(config.win.signtoolOptions, { publisherName: [windowsEnv.TANGENT_WINDOWS_PUBLISHER], signingHashAlgorithms: ['sha256'] });
  assert.deepEqual(config.publish, { ...UPDATE_FEED, releaseType: 'draft' });
  for (const name of ['Publisher', 'CN=Publisher', `CN=Publisher, O=Publisher\n`]) {
    assert.throws(() => createReleaseConfig(base, { env: { ...windowsEnv, TANGENT_WINDOWS_PUBLISHER: name }, platform: 'win32' }), /complete certificate subject/);
  }
  for (const secret of [windowsEnv.WIN_CSC_LINK, windowsEnv.WIN_CSC_KEY_PASSWORD]) assert(!JSON.stringify(config).includes(secret));
});

test('afterPack writes only the public runtime policy, and its schema matches the updater gate', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'tangent-release-config-'));
  try {
    for (const [platform, env] of [['darwin', macEnv], ['win32', windowsEnv]] as const) {
      const appOutDir = join(directory, platform);
      const config = createReleaseConfig(base, { env, platform });
      const context = { appOutDir, electronPlatformName: platform, packager: { appInfo: { productFilename: 'Tangent' } } };
      await config.afterPack(context);
      const resources = platform === 'darwin' ? join(appOutDir, 'Tangent.app', 'Contents', 'Resources') : join(appOutDir, 'resources');
      const raw = readFileSync(join(resources, 'update-policy.json'), 'utf8');
      const marker = JSON.parse(raw);
      assert.deepEqual(Object.keys(marker).sort(), ['schemaVersion', 'enabled', 'provider', 'owner', 'repo', 'channel', 'platform', platform === 'darwin' ? 'macTeamId' : 'publisherName'].sort());
      const feed = { ...UPDATE_FEED, ...(platform === 'win32' ? { publisherName: [windowsEnv.TANGENT_WINDOWS_PUBLISHER] } : {}) };
      assert.equal(validateUpdatePolicy(true, platform, marker, feed).enabled, true);
      assert(!raw.includes('secret-')); assert(!raw.includes('private@example.test'));
      // A universal macOS build invokes afterPack again after merging its bundles.
      await config.afterPack(context);
      assert.equal(readFileSync(join(resources, 'update-policy.json'), 'utf8'), raw);
      await assert.rejects(config.afterPack({ ...context, electronPlatformName: 'linux' }), /differs/);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
