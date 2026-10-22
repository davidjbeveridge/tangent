import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { execFileSync } from 'node:child_process';

const mode = process.argv[2];
assert(['manual', 'signed'].includes(mode), 'Use manual or signed');
const platform = process.env.RELEASE_PLATFORM;
const platforms = mode === 'manual'
  ? ['macos-arm64', 'macos-x64', 'windows-x64', 'linux-x64']
  : ['macos-universal', 'windows-x64'];
assert(platforms.includes(platform), 'Unexpected release platform');
const sha = process.env.RELEASE_SHA ?? '';
assert(/^[a-f0-9]{40}$/.test(sha), 'An immutable release commit is required');
assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), sha, 'Wrong checkout');
const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
const runtime = JSON.parse(readFileSync('runtime-versions.json', 'utf8'));
assert.equal(runtime.application, manifest.version);
assert.equal(runtime.electron, manifest.devDependencies.electron);
assert.equal(runtime.platform, process.platform);

if (mode === 'signed') {
  // This verifies OS signatures and the embedded update policy before staging.
  await import('./verify-signed-artifacts.mjs');
} else {
  const resources = platform.startsWith('macos')
    ? `release/mac${platform === 'macos-arm64' ? '-arm64' : ''}/Tangent.app/Contents/Resources`
    : platform === 'windows-x64' ? 'release/win-unpacked/resources' : 'release/linux-unpacked/resources';
  assert(existsSync(resources), 'Unpacked application resources are missing');
  assert(!existsSync(join(resources, 'update-policy.json')), 'Manual builds must not enable the signed updater');
  assert(!existsSync(join(resources, 'app-update.yml')), 'Manual builds must not contain an update feed');
}

const extensions = platform.startsWith('macos') ? ['.dmg', '.zip']
  : platform === 'windows-x64' ? ['.exe'] : ['.AppImage'];
const names = readdirSync('release').filter(name => extensions.some(ext => name.endsWith(ext)));
for (const ext of extensions) {
  assert.equal(names.filter(name => name.endsWith(ext)).length, 1, `Expected exactly one ${ext} artifact`);
}
if (mode === 'signed') {
  names.push(platform.startsWith('macos') ? 'latest-mac.yml' : 'latest.yml');
  names.push(...readdirSync('release').filter(name => name.endsWith('.blockmap')));
}
mkdirSync('release-upload', { recursive: false });
const files = names.sort().map(name => {
  assert.equal(basename(name), name);
  assert(/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name), `Unsafe artifact filename: ${name}`);
  const source = join('release', name);
  assert(lstatSync(source).isFile(), `Expected regular artifact: ${name}`);
  const data = readFileSync(source);
  copyFileSync(source, join('release-upload', name));
  return { name, size: data.length, sha256: createHash('sha256').update(data).digest('hex') };
});
writeFileSync(`release-upload/build-${platform}.json`, JSON.stringify({
  schemaVersion: 1, mode, platform, commit: sha, version: manifest.version, runtime, files,
}, null, 2) + '\n');
console.log(`Verified ${mode} inventory for ${platform}: ${files.map(file => file.name).join(', ')}`);
