import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

assert.equal(process.env.GITHUB_REPOSITORY, 'davidjbeveridge/tangent', 'Official releases must run in the upstream repository');
assert.equal(process.env.GITHUB_REF, 'refs/heads/main', 'Dispatch the release workflow from main');
const tag = process.env.RELEASE_TAG ?? '';
assert(/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag), 'Use a stable tag such as v0.1.0');
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const sha = git('rev-parse', '--verify', `refs/tags/${tag}^{commit}`);
assert(/^[0-9a-f]{40}$/.test(sha), 'Tag does not resolve to a commit');
// fetch-depth: 0 in the workflow supplies origin/main and all tags.
git('merge-base', '--is-ancestor', sha, 'origin/main');
const manifest = JSON.parse(git('show', `${sha}:package.json`));
assert.equal(tag, `v${manifest.version}`, 'Tag and package.json version differ');
assert.equal(manifest.name, 'tangent-browser', 'Unexpected package');
assert(process.env.GITHUB_OUTPUT, 'GITHUB_OUTPUT is required');
appendFileSync(process.env.GITHUB_OUTPUT, `sha=${sha}\nversion=${manifest.version}\ntag=${tag}\n`);
console.log(`Release candidate ${tag} resolves to main ancestor ${sha}. Tests run next.`);
