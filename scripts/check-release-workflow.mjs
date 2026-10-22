import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { manualPlatforms, manualAssetNames } from './release-data.mjs';

// Disposable Git repositories and a local gh stub exercise release gates.
// No fixture uses network access, real credentials, or GitHub publication.
assert.equal(process.platform, 'linux', 'Run these release-helper fixtures on Linux');
const source = fileURLToPath(new URL('.', import.meta.url));
const hash = data => createHash('sha256').update(data).digest('hex');
let passed = 0;
function fixture(name, test) {
  const directory = mkdtempSync(join(tmpdir(), 'tangent-release-fixture-'));
  try {
    const git = (...args) => execFileSync('git', args, { cwd: directory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    writeFileSync(join(directory, 'package.json'), JSON.stringify({ name: 'tangent-browser', version: '0.1.0', devDependencies: { electron: '45.0.0' } }));
    mkdirSync(join(directory, 'docs/releases'), { recursive: true });
    writeFileSync(join(directory, 'docs/releases/v0.1.0.md'), '# Tangent 0.1.0\n\nFixture release notes.\n');
    git('init', '-q', '-b', 'main');
    git('config', 'user.name', 'Tangent release fixture');
    git('config', 'user.email', 'release-fixture@localhost');
    git('add', '.'); git('commit', '-qm', 'Fixture');
    const sha = git('rev-parse', 'HEAD');
    git('update-ref', 'refs/remotes/origin/main', sha);
    const environment = { ...process.env, GITHUB_REPOSITORY: 'davidjbeveridge/tangent', GITHUB_REF: 'refs/heads/main',
      GITHUB_SHA: sha, GITHUB_EVENT_NAME: 'workflow_dispatch', RELEASE_SHA: sha, RELEASE_TAG: 'v0.1.0',
      RELEASE_PUBLISH: '', RELEASE_SOURCE_SHA: '', RELEASE_ALLOW_TAG_CREATION: '',
      GITHUB_OUTPUT: join(directory, 'outputs'), GH_TOKEN: 'LOCAL-STUB-ONLY' };
    const run = (script, args = [], extra = {}) => spawnSync(process.execPath, [join(source, script), ...args], {
      cwd: directory, encoding: 'utf8', env: { ...environment, ...extra }, timeout: 20_000,
    });
    const request = value => {
      mkdirSync(join(directory, '.github'), { recursive: true });
      writeFileSync(join(directory, '.github/release-request.json'), JSON.stringify(value));
      git('add', '.github/release-request.json'); git('commit', '-qm', 'Request release');
      environment.GITHUB_SHA = git('rev-parse', 'HEAD');
      environment.GITHUB_EVENT_NAME = 'push';
      git('update-ref', 'refs/remotes/origin/main', environment.GITHUB_SHA);
    };
    test({ directory, git, sha, run, environment, request });
    passed++;
  } catch (error) { error.message = `${name}: ${error.message}`; throw error; }
  finally { rmSync(directory, { recursive: true, force: true }); }
}

fixture('signed tag resolves to an immutable main commit', ({ directory, git, sha, run }) => {
  git('tag', '-a', 'v0.1.0', '-m', 'Fixture');
  const result = run('verify-release-ref.mjs');
  assert.equal(result.status, 0, result.stderr);
  assert(readFileSync(join(directory, 'outputs'), 'utf8').includes(`sha=${sha}`));
});
fixture('tag input cannot inject shell commands', ({ run }) => {
  const result = run('verify-release-ref.mjs', [], { RELEASE_TAG: 'v0.1.0; touch INVALID' });
  assert.notEqual(result.status, 0); assert(result.stderr.includes('Use a stable tag'));
});
fixture('tag version must match package version', ({ git, run }) => {
  git('tag', 'v0.2.0');
  const result = run('verify-release-ref.mjs', [], { RELEASE_TAG: 'v0.2.0' });
  assert.notEqual(result.status, 0); assert(result.stderr.includes('Tag and package.json version differ'));
});
fixture('unmerged tag is rejected', ({ directory, git, run }) => {
  git('checkout', '-qb', 'unmerged');
  writeFileSync(join(directory, 'unmerged.txt'), 'not main');
  git('add', '.'); git('commit', '-qm', 'Unmerged'); git('tag', 'v0.1.0');
  assert.notEqual(run('verify-release-ref.mjs').status, 0);
});

for (const publish of [undefined, false, true]) fixture(`request publication is explicit: ${publish}`, ({ directory, sha, run, request }) => {
  request({ schemaVersion: 1, version: '0.1.0', tag: 'v0.1.0', commit: sha, publish });
  const result = run('resolve-release-request.mjs');
  assert.equal(result.status, 0, result.stderr);
  const outputs = readFileSync(join(directory, 'outputs'), 'utf8');
  assert(outputs.includes(`sha=${sha}\n`)); assert(outputs.includes(`publish=${publish === true}\n`));
});
for (const [name, change] of Object.entries({
  'unknown request field': { command: 'anything' }, 'unsupported schema': { schemaVersion: 2 },
  'string publication flag': { publish: 'true' }, 'mutable source ref': { commit: 'main' },
  'nonexistent source commit': { commit: 'f'.repeat(40) }, 'version mismatch': { version: '0.2.0', tag: 'v0.2.0' },
  'tag mismatch': { tag: 'v0.2.0' }, 'tag injection': { tag: 'v0.1.0;echo INVALID' },
})) fixture(name, ({ sha, run, request }) => {
  request({ schemaVersion: 1, version: '0.1.0', tag: 'v0.1.0', commit: sha, ...change });
  assert.notEqual(run('resolve-release-request.mjs').status, 0);
});
for (const [name, extra] of Object.entries({
  'fork request': { GITHUB_REPOSITORY: 'somebody/tangent' },
  'non-main request': { GITHUB_REF: 'refs/heads/topic' },
  'wrong request checkout': { GITHUB_SHA: 'e'.repeat(40) },
})) fixture(name, ({ sha, run, request }) => {
  request({ schemaVersion: 1, version: '0.1.0', tag: 'v0.1.0', commit: sha });
  assert.notEqual(run('resolve-release-request.mjs', [], extra).status, 0);
});
fixture('a request cannot release unmerged code', ({ directory, git, run, request }) => {
  git('checkout', '-qb', 'unmerged');
  writeFileSync(join(directory, 'unmerged.txt'), 'not reviewed'); git('add', '.'); git('commit', '-qm', 'Unmerged');
  const other = git('rev-parse', 'HEAD'); git('checkout', '-q', 'main');
  request({ schemaVersion: 1, version: '0.1.0', tag: 'v0.1.0', commit: other });
  assert.notEqual(run('resolve-release-request.mjs').status, 0);
});
fixture('an existing local tag cannot be redirected', ({ git, sha, run, request, environment }) => {
  request({ schemaVersion: 1, version: '0.1.0', tag: 'v0.1.0', commit: sha });
  git('tag', 'v0.1.0', environment.GITHUB_SHA);
  assert.notEqual(run('resolve-release-request.mjs').status, 0);
});
fixture('publication requires committed versioned release notes', ({ directory, git, run, request }) => {
  rmSync(join(directory, 'docs/releases/v0.1.0.md')); git('add', '-A'); git('commit', '-qm', 'Remove notes');
  request({ schemaVersion: 1, version: '0.1.0', tag: 'v0.1.0', commit: git('rev-parse', 'HEAD'), publish: true });
  assert.notEqual(run('resolve-release-request.mjs').status, 0);
});
fixture('manual dispatch accepts exact source with no existing tag', ({ sha, run }) => {
  const result = run('resolve-release-request.mjs', [], { RELEASE_SOURCE_SHA: sha, RELEASE_PUBLISH: 'true' });
  assert.equal(result.status, 0, result.stderr);
});
fixture('manual dispatch can resolve existing annotated tag', ({ git, run }) => {
  git('tag', '-a', 'v0.1.0', '-m', 'Fixture');
  const result = run('resolve-release-request.mjs'); assert.equal(result.status, 0, result.stderr);
});

function runtimeFor(platform) {
  return { application: '0.1.0', electron: '45.0.0', chromium: '156.0.8078.48', node: '24.22.0',
    platform: platform.startsWith('macos') ? 'darwin' : platform.startsWith('windows') ? 'win32' : 'linux',
    architecture: platform.endsWith('arm64') ? 'arm64' : 'x64' };
}
function smokeFor(runtime, files) {
  return { schemaVersion: 1, passed: true, version: '0.1.0', electron: runtime.electron, chromium: runtime.chromium,
    platform: runtime.platform, architecture: runtime.architecture,
    formats: files.map(file => ({ name: file.name, sha256: file.sha256, verified: true })) };
}
for (const failure of ['none', 'update-policy.json', 'app-update.yml', 'missing-smoke', 'changed-after-smoke']) {
  fixture(`manual staging: ${failure}`, ({ directory, run }) => {
    const name = manualAssetNames('linux-x64', '0.1.0')[0];
    mkdirSync(join(directory, 'release/linux-unpacked/resources'), { recursive: true });
    writeFileSync(join(directory, 'release', name), 'fixture');
    const runtime = runtimeFor('linux-x64');
    writeFileSync(join(directory, 'runtime-versions.json'), JSON.stringify(runtime));
    const smoke = smokeFor(runtime, [{ name, sha256: hash('fixture') }]);
    if (failure !== 'missing-smoke') writeFileSync(join(directory, 'packaged-smoke.json'), JSON.stringify(smoke));
    if (failure.endsWith('.json') || failure.endsWith('.yml')) writeFileSync(join(directory, 'release/linux-unpacked/resources', failure), '{}');
    if (failure === 'changed-after-smoke') writeFileSync(join(directory, 'release', name), 'changed');
    const result = run('stage-release.mjs', ['manual'], { RELEASE_PLATFORM: 'linux-x64' });
    if (failure === 'none') {
      assert.equal(result.status, 0, result.stderr);
      assert(existsSync(join(directory, 'release-upload/build-linux-x64.json')));
    } else assert.notEqual(result.status, 0);
  });
}

function fakeArtifacts(directory, sha, failure) {
  for (const platform of manualPlatforms) {
    const folder = join(directory, 'artifacts', `tangent-manual-${platform}`); mkdirSync(folder, { recursive: true });
    const files = manualAssetNames(platform, '0.1.0').map(name => {
      const data = `Fixture ${name}`; writeFileSync(join(folder, name), data);
      return { name, size: Buffer.byteLength(data), sha256: hash(data) };
    });
    const runtime = runtimeFor(platform); const packagedSmoke = smokeFor(runtime, files);
    if (platform === 'linux-x64') {
      if (failure === 'tampered') writeFileSync(join(folder, files[0].name), 'tampered');
      if (failure === 'extra-file') writeFileSync(join(folder, 'latest-linux.yml'), 'untrusted metadata');
      if (failure === 'failed-smoke') packagedSmoke.passed = false;
      if (failure === 'mismatched-smoke') packagedSmoke.formats[0].sha256 = 'd'.repeat(64);
      if (failure === 'missing-installer') { rmSync(join(folder, files[0].name)); files.pop(); packagedSmoke.formats.pop(); }
    }
    writeFileSync(join(folder, `build-${platform}.json`), JSON.stringify({ schemaVersion: 1, mode: 'manual', platform,
      commit: failure === 'wrong-commit' && platform === 'linux-x64' ? 'b'.repeat(40) : sha,
      version: '0.1.0', runtime, files, packagedSmoke: failure === 'missing-smoke' && platform === 'linux-x64' ? undefined : packagedSmoke }));
  }
}
function githubStub(directory, sha, environment, failure) {
  const log = join(directory, 'gh-log'); const statePath = join(directory, 'gh-state.json');
  const bin = join(directory, 'fixture-bin'); mkdirSync(bin);
  const missingTag = ['create-tag', 'missing-tag-forbidden', 'prefix-tag'].includes(failure);
  writeFileSync(statePath, JSON.stringify({ tag: missingTag ? null : { type: failure === 'annotated-tag' ? 'tag' : 'commit',
    sha: failure === 'moved-tag' ? 'a'.repeat(40) : failure === 'annotated-tag' ? 'c'.repeat(40) : sha },
    releases: failure === 'existing-release' ? [{ id: 12, tag_name: 'v0.1.0', draft: false }] : [], assets: [] }));
  writeFileSync(join(bin, 'gh'), `#!/usr/bin/env node
const fs = require('node:fs'); const crypto = require('node:crypto'); const path = require('node:path');
const args = process.argv.slice(2); const state = JSON.parse(fs.readFileSync(process.env.GH_STATE, 'utf8'));
const endpoint = args[1]; const failure = process.env.MOCK_FAILURE;
const save = () => fs.writeFileSync(process.env.GH_STATE, JSON.stringify(state));
const result = value => process.stdout.write(JSON.stringify(value));
const option = flag => args[args.indexOf(flag) + 1];
fs.appendFileSync(process.env.GH_LOG, JSON.stringify(args) + '\\n');
if (args[0] === 'api' && endpoint.includes('/git/matching-refs/')) {
  const refs = state.tag ? [{ ref: 'refs/tags/v0.1.0', object: state.tag }] : [];
  if (failure === 'prefix-tag') refs.push({ ref: 'refs/tags/v0.1.0-other', object: { type: 'commit', sha: 'd'.repeat(40) } });
  if (failure === 'tag-moved-after-upload' && state.releases.length) refs[0].object = { type: 'commit', sha: 'a'.repeat(40) };
  result(refs);
} else if (args[0] === 'api' && endpoint.endsWith('/git/refs') && option('--method') === 'POST') {
  if (state.tag) process.exit(72);
  const fields = Object.fromEntries(args.filter(arg => /^(ref|sha)=/.test(arg)).map(arg => arg.split('=')));
  if (fields.ref !== 'refs/tags/v0.1.0' || fields.sha !== process.env.RELEASE_SHA) process.exit(73);
  state.tag = { type: 'commit', sha: fields.sha }; save(); result({ ref: fields.ref, object: state.tag });
} else if (args[0] === 'api' && endpoint.includes('/git/tags/')) {
  result({ object: { type: 'commit', sha: process.env.RELEASE_SHA } });
} else if (args[0] === 'api' && endpoint.endsWith('/releases?per_page=100')) {
  result([state.releases]);
} else if (args[0] === 'api' && endpoint.endsWith('/releases/12/assets?per_page=100')) {
  const assets = structuredClone(state.assets);
  if (failure === 'remote-digest') assets[0].digest = 'sha256:' + 'e'.repeat(64);
  if (failure === 'remote-missing-digest') delete assets[0].digest;
  if (failure === 'remote-missing-asset') assets.pop();
  if (failure === 'remote-extra-asset') assets.push({ name: 'unexpected.exe', size: 0, state: 'uploaded', digest: '' });
  if (failure === 'remote-incomplete') assets[0].state = 'starter';
  result([assets]);
} else if (args[0] === 'api' && endpoint.endsWith('/releases/12') && option('--method') === 'PATCH') {
  if (!args.includes('draft=false') || !args.includes('make_latest=true')) process.exit(74);
  state.releases[0].draft = false; save(); result(state.releases[0]);
} else if (args[0] === 'release' && args[1] === 'create') {
  if (!args.includes('--draft') || !args.includes('--verify-tag') || state.releases.length) process.exit(75);
  state.releases = [{ id: 12, tag_name: args[2], draft: true, prerelease: false, target_commitish: option('--target'), body: fs.readFileSync(option('--notes-file'), 'utf8') }];
  state.assets = args.slice(args.indexOf('--notes-file') + 2).map(file => {
    const data = fs.readFileSync(file);
    return { name: path.basename(file), size: data.length, state: 'uploaded', digest: 'sha256:' + crypto.createHash('sha256').update(data).digest('hex') };
  });
  if (failure === 'upload-failure') { state.assets.pop(); save(); process.exit(76); }
  save(); process.stdout.write('https://example.invalid/local-fixture-draft');
} else process.exit(77);
`, { mode: 0o755 });
  return { env: { PATH: `${bin}:${environment.PATH}`, GH_LOG: log, GH_STATE: statePath, MOCK_FAILURE: failure },
    calls: () => existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [],
    state: () => JSON.parse(readFileSync(statePath, 'utf8')) };
}

for (const scenario of ['draft', 'publish', 'create-tag', 'prefix-tag', 'annotated-tag', 'missing-tag-forbidden',
  'tampered', 'extra-file', 'wrong-commit', 'missing-smoke', 'failed-smoke', 'mismatched-smoke', 'missing-installer',
  'moved-tag', 'tag-moved-after-upload', 'existing-release', 'remote-digest', 'remote-missing-digest',
  'remote-missing-asset', 'remote-extra-asset', 'remote-incomplete', 'upload-failure']) {
  fixture(`release publication: ${scenario}`, ({ directory, sha, run, environment }) => {
    fakeArtifacts(directory, sha, scenario);
    const stub = githubStub(directory, sha, environment, scenario);
    const wantsPublish = scenario !== 'draft' && scenario !== 'annotated-tag';
    const result = run('create-draft-release.mjs', ['manual'], { ...stub.env,
      RELEASE_PUBLISH: wantsPublish ? 'true' : 'false',
      RELEASE_ALLOW_TAG_CREATION: scenario === 'missing-tag-forbidden' ? 'false' : 'true' });
    const calls = stub.calls(); const patches = calls.filter(args => args.includes('PATCH'));
    const creates = calls.filter(args => args[0] === 'release' && args[1] === 'create');
    const success = ['draft', 'publish', 'create-tag', 'prefix-tag', 'annotated-tag'].includes(scenario);
    if (success) {
      assert.equal(result.status, 0, result.stderr); assert.equal(creates.length, 1);
      assert.equal(patches.length, wantsPublish ? 1 : 0); assert.equal(stub.state().releases[0].draft, !wantsPublish);
      const sums = readFileSync(join(directory, 'draft-assets/SHA256SUMS'), 'utf8').trim().split('\n');
      assert.equal(sums.length, 7, 'Six installers plus BUILDINFO');
      const notes = readFileSync(join(directory, 'release-notes.md'), 'utf8');
      assert(notes.includes('Fixture release notes.')); assert(notes.includes(sha)); assert(!notes.includes('Maintainer:'));
      assert.equal(stub.state().assets.length, 8);
    } else {
      assert.notEqual(result.status, 0); assert.equal(patches.length, 0, 'Invalid release was published');
      if (['tampered', 'extra-file', 'wrong-commit', 'missing-smoke', 'failed-smoke', 'mismatched-smoke', 'missing-installer'].includes(scenario)) {
        assert.equal(calls.length, 0, 'Bad artifacts reached the GitHub API');
      }
      if (['moved-tag', 'existing-release', 'missing-tag-forbidden'].includes(scenario)) assert.equal(creates.length, 0);
    }
  });
}
console.log(`${passed} release-helper fixtures passed. All GitHub calls used a local stub; no network or release creation occurred.`);
