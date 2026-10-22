import assert from 'node:assert/strict';
import { appendFileSync, readFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';

assert.equal(process.env.GITHUB_REPOSITORY, 'davidjbeveridge/tangent', 'Release requests belong to the upstream repository');
assert.equal(process.env.GITHUB_REF, 'refs/heads/main', 'Release requests must run from main');
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const head = git('rev-parse', 'HEAD');
assert.equal(head, process.env.GITHUB_SHA, 'The checkout must match the requesting workflow commit');
const stable = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
let request;
if (process.env.GITHUB_EVENT_NAME === 'push') {
  request = JSON.parse(readFileSync('.github/release-request.json', 'utf8'));
  assert(request && typeof request === 'object' && !Array.isArray(request), 'Release request must be an object');
  const allowed = new Set(['schemaVersion', 'version', 'tag', 'commit', 'publish']);
  assert(Object.keys(request).every(key => allowed.has(key)), 'Unexpected release request field');
  assert.equal(request.schemaVersion, 1, 'Unsupported release request schema');
} else {
  assert.equal(process.env.GITHUB_EVENT_NAME, 'workflow_dispatch', 'Unsupported release trigger');
  const tag = process.env.RELEASE_TAG ?? '';
  assert(/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag), 'Use a stable tag such as v0.1.0');
  const publish = process.env.RELEASE_PUBLISH || 'false';
  assert(['true', 'false'].includes(publish), 'Publish must be an explicit boolean');
  const commit = process.env.RELEASE_SOURCE_SHA || git('rev-parse', '--verify', `refs/tags/${tag}^{commit}`);
  request = { schemaVersion: 1, version: tag.slice(1), tag, commit, publish: publish === 'true' };
}
assert(typeof request.version === 'string' && stable.test(request.version), 'A stable version is required');
assert.equal(request.tag, `v${request.version}`, 'Version and tag differ');
assert(typeof request.commit === 'string' && /^[a-f0-9]{40}$/.test(request.commit), 'Use an immutable 40-character source commit');
assert(request.publish === undefined || typeof request.publish === 'boolean', 'Publish must be a JSON boolean');
const publish = request.publish === true;
assert.equal(git('rev-parse', '--verify', `${request.commit}^{commit}`), request.commit);
git('merge-base', '--is-ancestor', request.commit, head);
git('merge-base', '--is-ancestor', request.commit, 'origin/main');
const manifest = JSON.parse(git('show', `${request.commit}:package.json`));
assert.equal(manifest.name, 'tangent-browser', 'Unexpected package');
assert.equal(manifest.version, request.version, 'Source package version differs from the request');
if (publish) {
  assert(git('show', `${request.commit}:docs/releases/${request.tag}.md`).length > 0,
    'Public releases require versioned release notes in the source commit');
}
const tagExists = spawnSync('git', ['show-ref', '--verify', '--quiet', `refs/tags/${request.tag}`]);
assert.ifError(tagExists.error);
assert([0, 1].includes(tagExists.status), 'Unable to inspect the existing release tag');
if (tagExists.status === 0) {
  assert.equal(git('rev-parse', `refs/tags/${request.tag}^{commit}`), request.commit, 'Existing tag points at a different commit; tags are never moved');
}
assert(process.env.GITHUB_OUTPUT, 'GITHUB_OUTPUT is required');
appendFileSync(process.env.GITHUB_OUTPUT,
  `sha=${request.commit}\nversion=${request.version}\ntag=${request.tag}\npublish=${publish}\nrequest-sha=${head}\n`);
console.log(`${publish ? 'Public' : 'Draft'} release requested for ${request.tag} at ${request.commit}. Build and installer gates run before any tag or release is written.`);
