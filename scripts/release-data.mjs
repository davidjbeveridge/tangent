import assert from 'node:assert/strict';

export const manualPlatforms = ['macos-arm64', 'macos-x64', 'windows-x64', 'linux-x64'];
const targets = {
  'macos-arm64': { os: 'mac', platform: 'darwin', architecture: 'arm64', extensions: ['dmg', 'zip'] },
  'macos-x64': { os: 'mac', platform: 'darwin', architecture: 'x64', extensions: ['dmg', 'zip'] },
  'windows-x64': { os: 'win', platform: 'win32', architecture: 'x64', extensions: ['exe'] },
  'linux-x64': { os: 'linux', platform: 'linux', architecture: 'x64', artifactArchitecture: 'x86_64', extensions: ['AppImage'] },
};

export function manualAssetNames(platform, version) {
  const target = targets[platform];
  assert(target, 'Unexpected manual release platform');
  return target.extensions.map(extension => `Tangent-${version}-${target.os}-${target.artifactArchitecture ?? target.architecture}.${extension}`).sort();
}

export function verifyPackagedSmoke(smoke, platform, version, runtime, files) {
  const target = targets[platform];
  assert(target, 'Unexpected packaged smoke platform');
  assert.equal(smoke?.schemaVersion, 1, 'Missing packaged smoke report');
  assert.equal(smoke.passed, true, 'Packaged smoke checks must pass');
  assert.equal(smoke.version, version);
  assert.equal(smoke.electron, runtime.electron);
  assert.equal(smoke.chromium, runtime.chromium);
  assert.equal(smoke.platform, target.platform);
  assert.equal(smoke.architecture, target.architecture);
  assert.equal(runtime.platform, target.platform);
  assert.equal(runtime.architecture, target.architecture);
  assert(Array.isArray(smoke.formats), 'Packaged smoke formats are missing');
  assert.deepEqual(files.map(file => file.name).sort(), manualAssetNames(platform, version), 'Missing or unexpected installer');
  assert.deepEqual(smoke.formats.map(format => format.name).sort(), manualAssetNames(platform, version), 'Every delivered format must be smoke checked');
  for (const format of smoke.formats) {
    assert.equal(format.verified, true, 'Delivered format verification failed');
    assert.equal(format.sha256, files.find(file => file.name === format.name)?.sha256,
      'Installer differs from the package that passed smoke checks');
  }
}
