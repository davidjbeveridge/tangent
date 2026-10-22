import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { load } from 'js-yaml';

assert(['darwin', 'win32'].includes(process.platform), 'Signed releases support macOS and Windows only');
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
const run = (command, args, env = {}) => {
  const result = spawnSync(command, args, {
    encoding: 'utf8', env: { ...process.env, ...env }, windowsHide: true, timeout: 180_000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${command} verification failed: ${result.stdout}\n${result.stderr}`);
  return `${result.stdout}\n${result.stderr}`;
};
const yaml = path => load(readFileSync(path, 'utf8'));
const verifyPolicy = resources => {
  const policy = JSON.parse(readFileSync(join(resources, 'update-policy.json'), 'utf8'));
  const feed = yaml(join(resources, 'app-update.yml'));
  for (const [key, expected] of Object.entries({
    schemaVersion: 1, enabled: true, provider: 'github', owner: 'davidjbeveridge',
    repo: 'tangent', channel: 'latest', platform: process.platform,
  })) assert.equal(policy[key], expected, `Unexpected update policy: ${key}`);
  for (const key of ['provider', 'owner', 'repo', 'channel']) {
    assert.equal(feed[key], policy[key], `Unexpected update feed: ${key}`);
  }
  if (process.platform === 'darwin') {
    assert.equal(policy.macTeamId, process.env.APPLE_TEAM_ID);
  } else {
    assert.deepEqual(policy.publisherName, [process.env.TANGENT_WINDOWS_PUBLISHER]);
    assert.deepEqual(feed.publisherName, policy.publisherName);
  }
};

if (process.platform === 'darwin') {
  const team = process.env.APPLE_TEAM_ID ?? '';
  const identity = process.env.TANGENT_MAC_IDENTITY ?? '';
  assert(/^[A-Z0-9]{10}$/.test(team), 'APPLE_TEAM_ID must identify the signing team');
  assert(identity.startsWith('Developer ID Application:'), 'A Developer ID Application identity is required');
  const verifyApp = app => {
    run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app]);
    const signature = run('codesign', ['--display', '--verbose=4', app]);
    assert(signature.includes(`TeamIdentifier=${team}\n`), 'Unexpected macOS signing team');
    assert(signature.includes(`Authority=${identity}\n`), 'Unexpected macOS signing identity');
    assert(/flags=.*\bruntime\b/.test(signature), 'Hardened runtime is missing');
    run('xcrun', ['stapler', 'validate', app]);
    run('spctl', ['--assess', '--type', 'execute', '--verbose=4', app]);
    const architectures = run('lipo', ['-archs', join(app, 'Contents/MacOS/Tangent')]);
    assert(architectures.includes('x86_64') && architectures.includes('arm64'), 'A universal macOS binary is required');
    assert.equal(run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', join(app, 'Contents/Info.plist')]).trim(), version);
    verifyPolicy(join(app, 'Contents/Resources'));
  };
  verifyApp(resolve('release/mac-universal/Tangent.app'));
  const zip = readdirSync('release').filter(name => name.endsWith('.zip'));
  const dmg = readdirSync('release').filter(name => name.endsWith('.dmg'));
  assert.equal(zip.length, 1);
  assert.equal(dmg.length, 1);
  const extracted = mkdtempSync(join(tmpdir(), 'tangent-signed-zip-'));
  try {
    run('ditto', ['-x', '-k', resolve('release', zip[0]), extracted]);
    verifyApp(join(extracted, 'Tangent.app'));
  } finally {
    rmSync(extracted, { recursive: true, force: true });
  }
  const mounted = mkdtempSync(join(tmpdir(), 'tangent-signed-dmg-'));
  let attached = false;
  try {
    run('hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mounted, resolve('release', dmg[0])]);
    attached = true;
    verifyApp(join(mounted, 'Tangent.app'));
  } finally {
    if (attached) run('hdiutil', ['detach', mounted]);
    rmSync(mounted, { recursive: true, force: true });
  }
} else {
  const publisher = process.env.TANGENT_WINDOWS_PUBLISHER ?? '';
  assert(/(?:^|,)\s*CN\s*=\s*[^,]+/i.test(publisher)
    && /(?:^|,)\s*(?:O|OU|C|L|S|ST|SERIALNUMBER)\s*=\s*[^,]+/i.test(publisher), 'Use the complete Windows certificate subject DN');
  const installers = readdirSync('release').filter(name => name.endsWith('.exe'));
  assert.equal(installers.length, 1, 'Exactly one NSIS installer is required');
  for (const file of [resolve('release/win-unpacked/Tangent.exe'), resolve('release', installers[0])]) {
    run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `
      $ErrorActionPreference = 'Stop'
      $signature = Get-AuthenticodeSignature -LiteralPath $env:TANGENT_VERIFY_FILE
      if ($signature.Status -ne 'Valid') { throw "Invalid Authenticode status: $($signature.Status)" }
      if ($signature.SignerCertificate.Subject -cne $env:TANGENT_WINDOWS_PUBLISHER) { throw 'Unexpected signing publisher' }
      if (-not $signature.TimeStamperCertificate) { throw 'A trusted timestamp is required' }
    `], { TANGENT_VERIFY_FILE: file });
  }
  verifyPolicy('release/win-unpacked/resources');
}

const metadata = yaml(process.platform === 'darwin' ? 'release/latest-mac.yml' : 'release/latest.yml');
assert.equal(metadata.version, version, 'Update manifest version differs');
assert(Array.isArray(metadata.files) && metadata.files.length > 0, 'Update manifest contains no files');
for (const file of metadata.files) {
  assert.equal(basename(file.url), file.url, 'Update manifest must use a local asset filename');
  assert(/^[A-Za-z0-9][A-Za-z0-9._-]*\.(zip|dmg|exe)$/.test(file.url), 'Unexpected update artifact');
  const path = join('release', file.url);
  assert(lstatSync(path).isFile());
  const data = readFileSync(path);
  assert.equal(createHash('sha512').update(data).digest('base64'), file.sha512, 'Update manifest hash differs');
  if (file.size !== undefined) assert.equal(file.size, data.length);
}
console.log('Platform signatures, embedded update policy, and update manifest hashes verified.');
