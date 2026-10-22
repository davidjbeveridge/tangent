import assert from 'node:assert/strict';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

for (const name of ['electron', 'electron-builder', 'electron-updater']) {
  const section = name === 'electron-updater' ? 'dependencies' : 'devDependencies';
  const pinned = manifest[section]?.[name];
  assert(stableVersion.test(pinned), `${name} must use an exact stable version, without a range or tag`);
  assert.equal(lock.packages?.['']?.[section]?.[name], pinned, `${name}: root lockfile pin differs`);
  const resolved = lock.packages?.[`node_modules/${name}`];
  assert.equal(resolved?.version, pinned, `${name}: lockfile resolved version differs`);
  assert(resolved.integrity?.startsWith('sha512-'), `${name}: lockfile integrity is missing`);
  assert.equal(require(`${name}/package.json`).version, pinned, `${name}: installed version differs; run npm ci`);
}

// Probe the bundled runtime: the host Node and a separate Chrome prove nothing
// about the Chromium that the packaged browser will actually use.
const probe = spawnSync(require('electron'), ['-e', 'process.stdout.write(JSON.stringify(process.versions))'], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  encoding: 'utf8', timeout: 30_000, windowsHide: true,
});
assert.ifError(probe.error);
assert.equal(probe.status, 0, `Electron runtime probe failed: ${probe.stderr}`);
const versions = JSON.parse(probe.stdout);
assert.equal(versions.electron, manifest.devDependencies.electron, 'Electron executable does not match the pinned package');
assert(/^\d+\.\d+\.\d+\.\d+$/.test(versions.chrome), 'Bundled Chromium version is missing');
const record = {
  application: manifest.version,
  electron: versions.electron,
  chromium: versions.chrome,
  node: versions.node,
  platform: process.platform,
  architecture: process.arch,
};
console.log(JSON.stringify(record, null, 2));
if (process.argv[2] === '--output' && process.argv[3]) {
  writeFileSync(process.argv[3], `${JSON.stringify(record, null, 2)}\n`);
} else {
  assert.equal(process.argv.length, 2, 'Usage: node scripts/check-runtime.mjs [--output FILE]');
}
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `### Bundled runtime (${record.platform}/${record.architecture})\n\n` +
    `| Component | Version |\n| --- | --- |\n| Tangent | ${record.application} |\n` +
    `| Electron | ${record.electron} |\n| Chromium | ${record.chromium} |\n| Node | ${record.node} |\n\n`);
}
