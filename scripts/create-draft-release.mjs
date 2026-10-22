import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { manualPlatforms, verifyPackagedSmoke } from './release-data.mjs';

const mode = process.argv[2];
assert(['manual', 'signed'].includes(mode), 'Use manual or signed');
assert.equal(process.env.GITHUB_REPOSITORY, 'davidjbeveridge/tangent');
const repository = 'davidjbeveridge/tangent';
const explicitBoolean = name => {
  const value = process.env[name] || 'false';
  assert(['true', 'false'].includes(value), `${name} must be an explicit boolean`);
  return value === 'true';
};
const publish = explicitBoolean('RELEASE_PUBLISH');
const allowTagCreation = explicitBoolean('RELEASE_ALLOW_TAG_CREATION');
if (publish || allowTagCreation) {
  assert.equal(mode, 'manual', 'The signed workflow remains draft-only');
  assert.equal(process.env.GITHUB_REF, 'refs/heads/main', 'Release requests must originate on main');
}
const sha = process.env.RELEASE_SHA ?? '';
const tag = process.env.RELEASE_TAG ?? '';
assert(/^[a-f0-9]{40}$/.test(sha), 'Missing immutable release commit');
assert(/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag), 'Invalid stable tag');
const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
assert.equal(manifest.name, 'tangent-browser');
assert.equal(tag, `v${manifest.version}`, 'Version changed during release');
assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), sha);
const expected = mode === 'manual' ? manualPlatforms : ['macos-universal', 'windows-x64'];
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
  if (mode === 'manual') {
    verifyPackagedSmoke(proof.packagedSmoke, platform, manifest.version, proof.runtime, proof.files);
  }
  if (buildInfo.length > 0) assert.equal(proof.runtime.chromium, buildInfo[0].runtime.chromium, 'Mixed Chromium runtimes');
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
  requestCommit: process.env.RELEASE_REQUEST_SHA || undefined,
  testedPlatforms: ['linux-x64', 'windows-x64', 'macos-arm64', 'macos-x64'], builds: buildInfo,
}, null, 2) + '\n');
filenames.add('BUILDINFO.json');
const sums = [...filenames].sort().map(name =>
  `${createHash('sha256').update(readFileSync(join('draft-assets', name))).digest('hex')}  ${name}`);
writeFileSync('draft-assets/SHA256SUMS', sums.join('\n') + '\n');
filenames.add('SHA256SUMS');

const installation = mode === 'manual'
  ? 'These installers use manual installation and replacement. macOS uses ad hoc signing without Developer ID or notarization; Windows and Linux have no verified publisher signature. In-app automatic updates are disabled. SHA256SUMS checks download integrity; it is not a publisher signature.'
  : 'macOS is signed and notarized; Windows uses Authenticode. Signed installations can check for and install updates with your approval.';
const notesPath = `docs/releases/${tag}.md`;
assert(!publish || existsSync(notesPath), 'Public releases require versioned release notes');
const notes = existsSync(notesPath) ? readFileSync(notesPath, 'utf8').trim() : `# Tangent ${manifest.version}\n\n${installation}`;
assert(notes.length > 0, 'Release notes are empty');
const packagedEvidence = mode === 'manual'
  ? 'The delivered macOS DMG/ZIP, Windows NSIS installer, and Linux AppImage passed native packaged checks. The checks launched the packaged app with the Chromium sandbox enabled, opened fixture web content, and verified workspace and cookie persistence across a restart. Linux was tested on Ubuntu 22.04 x64; macOS on Apple Silicon and Intel macOS 15; Windows on Windows Server 2025 x64. BUILDINFO.json contains the per-platform reports and installer hashes.\n\n'
  : 'Platform signatures, notarization, updater policy, and update payload hashes passed the signing gates. A complete installed-version-to-new-version update still requires a maintainer test before publishing this draft.\n\n';
writeFileSync('release-notes.md', notes + '\n\n## Build and validation evidence\n\n' +
  `Built from commit [\`${sha}\`](https://github.com/${repository}/commit/${sha}). Electron ${buildInfo[0].runtime.electron}; Chromium ${buildInfo[0].runtime.chromium}.\n\n` +
  'Unit, build, and real Electron browser tests passed on Linux, Windows, and Apple Silicon/Intel macOS before packaging. ' +
  packagedEvidence +
  'These checks do not certify every website, GPU, OS release, Gatekeeper or SmartScreen prompt, or an upgrade from every previous profile version.\n\n' +
  '[Installation and update instructions](https://github.com/davidjbeveridge/tangent#readme) · ' +
  `[Release process and verification](https://github.com/${repository}/blob/${sha}/docs/RELEASING.md)\n`);

// All validation above is local and complete before the first write. Remote
// calls are restricted to this repository, this tag, and the resulting release.
const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).trim();
const api = (...args) => JSON.parse(gh('api', ...args));
const releases = () => {
  const pages = api(`repos/${repository}/releases?per_page=100`, '--paginate', '--slurp');
  assert(Array.isArray(pages) && pages.every(Array.isArray), 'Unexpected releases response');
  return pages.flat().filter(release => release.tag_name === tag);
};
const remoteTag = () => {
  const refs = api(`repos/${repository}/git/matching-refs/tags/${tag}`);
  assert(Array.isArray(refs), 'Unable to inspect release tags');
  const exact = refs.filter(ref => ref.ref === `refs/tags/${tag}`);
  assert(exact.length <= 1, 'Ambiguous release tag');
  if (!exact.length) return null;
  let ref = exact[0].object;
  let depth = 0;
  while (ref.type === 'tag' && depth++ < 8) {
    assert(/^[a-f0-9]{40}$/.test(ref.sha));
    ref = api(`repos/${repository}/git/tags/${ref.sha}`).object;
  }
  assert.equal(ref.type, 'commit', 'Release tag must resolve to a commit');
  assert.equal(ref.sha, sha, 'Remote tag changed while artifacts were built; tags are never moved');
  return ref.sha;
};
assert.equal(releases().length, 0, 'A release already exists; it will not be overwritten');
if (!remoteTag()) {
  assert(allowTagCreation, 'Release tag is missing');
  api(`repos/${repository}/git/refs`, '--method', 'POST', '-f', `ref=refs/tags/${tag}`, '-f', `sha=${sha}`);
}
assert.equal(remoteTag(), sha, 'Release tag creation was not confirmed');
const assets = [...filenames].sort().map(name => join('draft-assets', name));
console.log(gh('release', 'create', tag, '--repo', repository, '--verify-tag', '--draft',
  '--target', sha, '--title', `Tangent ${manifest.version}`, '--notes-file', 'release-notes.md', ...assets));

const created = releases();
assert.equal(created.length, 1, 'The created draft could not be confirmed');
const release = created[0];
assert(Number.isSafeInteger(release.id) && release.id > 0, 'Invalid release ID');
assert.equal(release.draft, true, 'Uploads must remain unpublished until verified');
assert.equal(release.prerelease, false);
assert.equal(release.target_commitish, sha);
const verifyUploads = () => {
  const pages = api(`repos/${repository}/releases/${release.id}/assets?per_page=100`, '--paginate', '--slurp');
  assert(Array.isArray(pages) && pages.every(Array.isArray), 'Unexpected release assets response');
  const uploaded = pages.flat();
  assert.deepEqual(uploaded.map(asset => asset.name).sort(), [...filenames].sort(), 'Uploaded asset inventory differs');
  for (const asset of uploaded) {
    const data = readFileSync(join('draft-assets', asset.name));
    assert.equal(asset.state, 'uploaded', 'An upload is incomplete');
    assert.equal(asset.size, data.length, 'Uploaded asset size differs');
    assert.equal(asset.digest, `sha256:${createHash('sha256').update(data).digest('hex')}`, 'Uploaded asset checksum differs or is unavailable');
  }
};
verifyUploads();
assert.equal(remoteTag(), sha, 'Release tag disappeared before publication');
if (publish) {
  const published = api(`repos/${repository}/releases/${release.id}`, '--method', 'PATCH', '-F', 'draft=false', '-f', 'make_latest=true');
  assert.equal(published.id, release.id);
  assert.equal(published.tag_name, tag);
  assert.equal(published.draft, false, 'Publication was not confirmed');
  verifyUploads();
  assert.equal(remoteTag(), sha);
  console.log(`Published ${tag} after source, native installer, and uploaded-checksum gates: https://github.com/${repository}/releases/tag/${tag}`);
} else {
  console.log(`Verified draft ${tag} is ready for maintainer review. Publication was not requested.`);
}
