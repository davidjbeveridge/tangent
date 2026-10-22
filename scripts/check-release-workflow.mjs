import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Run on the Linux CI runner. Disposable Git repositories and a local gh stub
// test release gates without credentials, networking, or a real publication.
assert.equal(process.platform, 'linux', 'Run these release-helper fixtures on Linux');
const source = fileURLToPath(new URL('.', import.meta.url));
let passed = 0;
function fixture(test) {
  const directory = mkdtempSync(join(tmpdir(), 'tangent-release-fixture-'));
  try {
    const git = (...args) => execFileSync('git', args, { cwd: directory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    writeFileSync(join(directory, 'package.json'), JSON.stringify({ name: 'tangent-browser', version: '0.1.0', devDependencies: { electron: '45.0.0' } }));
    git('init', '-q', '-b', 'main');
    git('config', 'user.name', 'Tangent release fixture');
    git('config', 'user.email', 'release-fixture@localhost');
    git('add', 'package.json'); git('commit', '-qm', 'Fixture');
    const sha = git('rev-parse', 'HEAD');
    git('update-ref', 'refs/remotes/origin/main', sha);
    const environment = { ...process.env, GITHUB_REPOSITORY: 'davidjbeveridge/tangent', GITHUB_REF: 'refs/heads/main',
      RELEASE_SHA: sha, RELEASE_TAG: 'v0.1.0', GITHUB_OUTPUT: join(directory, 'outputs'), GH_TOKEN: 'LOCAL-STUB-ONLY' };
    const run = (script, args = [], extra = {}) => spawnSync(process.execPath, [join(source, script), ...args], {
      cwd: directory, encoding: 'utf8', env: { ...environment, ...extra }, timeout: 20_000,
    });
    test({ directory, git, sha, run, environment });
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
fixture(({ directory, git, sha, run }) => {
  git('tag', '-a', 'v0.1.0', '-m', 'Fixture');
  const result = run('verify-release-ref.mjs');
  assert.equal(result.status, 0, result.stderr);
  assert(readFileSync(join(directory, 'outputs'), 'utf8').includes(`sha=${sha}`));
  passed++;
});
fixture(({ run }) => {
  const result = run('verify-release-ref.mjs', [], { RELEASE_TAG: 'v0.1.0; touch INVALID' });
  assert.notEqual(result.status, 0);
  assert(result.stderr.includes('Use a stable tag'));
  passed++;
});
fixture(({ git, run }) => {
  git('tag', 'v0.2.0');
  const result = run('verify-release-ref.mjs', [], { RELEASE_TAG: 'v0.2.0' });
  assert.notEqual(result.status, 0);
  assert(result.stderr.includes('Tag and package.json version differ'));
  passed++;
});
fixture(({ directory, git, run }) => {
  git('checkout', '-qb', 'unmerged');
  writeFileSync(join(directory, 'unmerged.txt'), 'not main');
  git('add', 'unmerged.txt'); git('commit', '-qm', 'Unmerged'); git('tag', 'v0.1.0');
  assert.notEqual(run('verify-release-ref.mjs').status, 0);
  passed++;
});
for (const marker of [false, 'update-policy.json', 'app-update.yml']) fixture(({ directory, run }) => {
  mkdirSync(join(directory, 'release/linux-unpacked/resources'), { recursive: true });
  writeFileSync(join(directory, 'release/Tangent-0.1.0-linux-x64.AppImage'), 'fixture');
  writeFileSync(join(directory, 'runtime-versions.json'), JSON.stringify({ application: '0.1.0', electron: '45.0.0', chromium: '156.0.8078.48', node: '24.22.0', platform: 'linux', architecture: 'x64' }));
  if (marker) writeFileSync(join(directory, 'release/linux-unpacked/resources', marker), '{}');
  const result = run('stage-release.mjs', ['manual'], { RELEASE_PLATFORM: 'linux-x64' });
  if (marker) { assert.notEqual(result.status, 0); assert(result.stderr.includes('Manual builds must not')); }
  else { assert.equal(result.status, 0, result.stderr); assert(existsSync(join(directory, 'release-upload/build-linux-x64.json'))); }
  passed++;
});
for (const failure of ['none', 'tampered', 'moved-tag', 'extra-file', 'wrong-commit']) fixture(({ directory, sha, run, environment }) => {
  const log = join(directory, 'gh-log');
  const bin = join(directory, 'fixture-bin'); mkdirSync(bin);
  writeFileSync(join(bin, 'gh'), `#!/usr/bin/env node
const fs = require('node:fs');
fs.appendFileSync(process.env.GH_LOG, JSON.stringify(process.argv.slice(2)) + '\\n');
if (process.argv[2] === 'api') process.stdout.write(JSON.stringify({ object: { type: 'commit', sha: process.env.MOCK_TAG_SHA || process.env.RELEASE_SHA } }));
else if (process.argv[2] === 'release' && process.argv[3] === 'create') process.stdout.write('https://example.invalid/local-fixture-draft');
else process.exit(77);
`, { mode: 0o755 });
  for (const platform of ['macos-arm64', 'macos-x64', 'windows-x64', 'linux-x64']) {
    const folder = join(directory, 'artifacts', `tangent-manual-${platform}`); mkdirSync(folder, { recursive: true });
    const extensions = platform.startsWith('macos') ? ['dmg', 'zip'] : [platform.startsWith('windows') ? 'exe' : 'AppImage'];
    const files = extensions.map(ext => {
      const name = `Tangent-0.1.0-${platform}.${ext}`; const data = `Fixture ${platform} ${ext}`;
      writeFileSync(join(folder, name), data);
      return { name, size: Buffer.byteLength(data), sha256: createHash('sha256').update(data).digest('hex') };
    });
    writeFileSync(join(folder, `build-${platform}.json`), JSON.stringify({ schemaVersion: 1, mode: 'manual', platform,
      commit: failure === 'wrong-commit' && platform === 'linux-x64' ? 'b'.repeat(40) : sha,
      version: '0.1.0', runtime: { application: '0.1.0', electron: '45.0.0', chromium: '156.0.8078.48' }, files }));
    if (failure === 'tampered' && platform === 'linux-x64') writeFileSync(join(folder, files[0].name), 'tampered');
    if (failure === 'extra-file' && platform === 'linux-x64') writeFileSync(join(folder, 'latest-linux.yml'), 'untrusted metadata');
  }
  const result = run('create-draft-release.mjs', ['manual'], {
    PATH: `${bin}:${environment.PATH}`, GH_LOG: log, MOCK_TAG_SHA: failure === 'moved-tag' ? 'a'.repeat(40) : sha,
  });
  const calls = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [];
  const releases = calls.filter(args => args[0] === 'release');
  if (failure === 'none') {
    assert.equal(result.status, 0, result.stderr); assert.equal(releases.length, 1);
    assert(releases[0].includes('--draft')); assert(releases[0].includes('--verify-tag'));
    const sums = readFileSync(join(directory, 'draft-assets/SHA256SUMS'), 'utf8').trim().split('\n');
    assert.equal(sums.length, 7, 'Six installers plus BUILDINFO');
  } else { assert.notEqual(result.status, 0); assert.equal(releases.length, 0, 'Invalid input reached release creation'); }
  passed++;
});
console.log(`${passed} release-helper fixtures passed. All GitHub calls were replaced by a local stub; no network or release creation occurred.`);
