import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { execFileSync } from 'node:child_process';

const mode = process.argv[2];
assert(['manual', 'signed'].includes(mode), 'Use manual or signed');
assert.equal(process.env.GITHUB_REPOSITORY, 'davidjbeveridge/tangent');
const sha = process.env.RELEASE_SHA ?? '';
const tag = process.env.RELEASE_TAG ?? '';
assert(/^[a-f0-9]{40}$/.test(sha), 'Missing immutable release commit');
assert(/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag), 'Invalid stable tag');
const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
assert.equal(tag, `v${manifest.version}`, 'Version changed during release');
assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), sha);
const expected = mode === 'manual'
  ? ['macos-arm64', 'macos-x64', 'windows-x64', 'linux-x64']
  : ['macos-universal', 'windows-x64'];
const prefix = mode === 'manual' ? 'tangent-manual-' : 'tangent-signed-';
const buildInfo = [];
const filenames = new Set();
mkdirSync('draft-assets', { recursive: false });

for (const platform of expected) {
  const directory = join('artifacts', `${prefix}${platform}`);
  const proofName = `build-${platform}.json`;
  const proof = JSON.parse(readFileSync(join(directory, proofName), 'utf8'));
  assert.equal(proof.schemaVersion, 1);
  assert.equal(proof.mode, mode);
  assert.equal(proof.platform, platform);
  assert.equal(proof.commit, sha, 'Artifact came from a different commit');
  assert.equal(proof.version, manifest.version, 'Artifact version differs');
  assert.equal(proof.runtime.electron, manifest.devDependencies.electron);
  assert.equal(proof.runtime.application, manifest.version);
  assert(/^\d+\.\d+\.\d+\.\d+$/.test(proof.runtime.chromium));
  assert(Array.isArray(proof.files) && proof.files.length > 0);
  const listed = new Set([proofName]);
  for (const file of proof.files) {
    assert.equal(basename(file.name), file.name);
    assert(/^[A-Za-z0-9][A-Za-z0-9._-]*\.(dmg|zip|exe|AppImage|blockmap|yml)$/.test(file.name));
    if (mode === 'manual') assert(!/\.(yml|blockmap)$/.test(file.name), 'Unsigned update metadata is forbidden');
    assert(!filenames.has(file.name), `Duplicate artifact: ${file.name}`);
    const source = join(directory, file.name);
    assert(lstatSync(source).isFile(), 'Symlink or non-file artifact rejected');
    const data = readFileSync(source);
    assert.equal(data.length, file.size);
    assert.equal(createHash('sha256').update(data).digest('hex'), file.sha256, 'Artifact checksum differs');
    copyFileSync(source, join('draft-assets', file.name));
    filenames.add(file.name);
    listed.add(file.name);
  }
  assert.deepEqual(new Set(readdirSync(directory)), listed, 'Unexpected release files');
  buildInfo.push(proof);
}
writeFileSync('draft-assets/BUILDINFO.json', JSON.stringify({
  schemaVersion: 1, version: manifest.version, commit: sha, mode,
  testedPlatforms: ['linux-x64', 'windows-x64', 'macos-arm64', 'macos-x64'], builds: buildInfo,
}, null, 2) + '\n');
filenames.add('BUILDINFO.json');
const sums = [...filenames].sort().map(name =>
  `${createHash('sha256').update(readFileSync(join('draft-assets', name))).digest('hex')}  ${name}`);
writeFileSync('draft-assets/SHA256SUMS', sums.join('\n') + '\n');
filenames.add('SHA256SUMS');

// Re-resolve the remote tag after all build jobs. An updated tag must never
// silently attach binaries from another commit to the same release name.
const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8' }).trim();
let ref = JSON.parse(gh('api', `repos/davidjbeveridge/tangent/git/ref/tags/${tag}`)).object;
let depth = 0;
while (ref.type === 'tag' && depth++ < 8) {
  assert(/^[a-f0-9]{40}$/.test(ref.sha));
  ref = JSON.parse(gh('api', `repos/davidjbeveridge/tangent/git/tags/${ref.sha}`)).object;
}
assert.equal(ref.type, 'commit');
assert.equal(ref.sha, sha, 'Remote tag changed while artifacts were built');
const installation = mode === 'manual'
  ? 'These are unsigned installers for manual installation and replacement. In-app automatic updates are disabled. SHA256SUMS checks download integrity; it is not a publisher signature.'
  : 'macOS is signed and notarized; Windows uses Authenticode. Signed installations can check for and install updates with your approval.';
writeFileSync('release-notes.md', `## Tangent ${manifest.version}\n\n${installation}\n\n` +
  `Built from commit \`${sha}\`. Electron ${buildInfo[0].runtime.electron}; Chromium ${buildInfo[0].runtime.chromium}.\n\n` +
  'Unit, build, and real Electron browser tests passed on Linux, Windows, and Apple Silicon/Intel macOS before packaging. These checks do not cover every website, device, or operating system release.\n\n' +
  '[Installation and update instructions](https://github.com/davidjbeveridge/tangent#readme) · ' +
  '[Release process and verification](https://github.com/davidjbeveridge/tangent/blob/main/docs/RELEASING.md)\n\n' +
  'Maintainer: complete installation, replacement, and retained-profile smoke tests before publishing this draft.\n');
const assets = [...filenames].sort().map(name => join('draft-assets', name));
console.log(gh('release', 'create', tag, '--repo', 'davidjbeveridge/tangent', '--verify-tag', '--draft',
  '--target', sha, '--title', `Tangent ${manifest.version}`, '--notes-file', 'release-notes.md', ...assets));
