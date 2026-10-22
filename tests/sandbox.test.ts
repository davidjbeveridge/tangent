import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, statSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { enforcePackagedSandbox } from '../src/main/sandbox';

const afterPack = require('../scripts/after-pack.cjs') as (context: {
  appOutDir: string; electronPlatformName: string; packager: { executableName: string };
}) => Promise<void>;

test('packaged browser forces global sandboxing and rejects disabling flags before enabling it', () => {
  for (const flag of ['no-sandbox', 'disable-gpu-sandbox', 'disable-setuid-sandbox', 'disable-seccomp-filter-sandbox']) {
    let enabled = false;
    assert.throws(() => enforcePackagedSandbox({ isPackaged: true, commandLine: { hasSwitch: name => name === flag }, enableSandbox: () => { enabled = true; } }), /cannot start.*sandbox disabled/);
    assert.equal(enabled, false);
  }
  let enabled = false;
  enforcePackagedSandbox({ isPackaged: true, commandLine: { hasSwitch: () => false }, enableSandbox: () => { enabled = true; } });
  assert.equal(enabled, true);
  enabled = false;
  enforcePackagedSandbox({ isPackaged: false, commandLine: { hasSwitch: () => true }, enableSandbox: () => { enabled = true; } });
  assert.equal(enabled, false, 'disposable source tests retain their explicit test-only configuration');
});

test('afterPack replaces the Linux launcher only and refuses a mismatched executable', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'tangent-launcher-'));
  try {
    const context = { appOutDir: directory, electronPlatformName: 'darwin', packager: { executableName: 'Tangent' } };
    await afterPack(context);
    assert.equal(existsSync(join(directory, 'AppRun')), false);
    await assert.rejects(afterPack({ ...context, electronPlatformName: 'linux' }), /requires the tangent-browser/);
    await afterPack({ ...context, electronPlatformName: 'linux', packager: { executableName: 'tangent-browser' } });
    assert.equal(readFileSync(join(directory, 'AppRun'), 'utf8'), readFileSync('build/AppRun', 'utf8'));
    if (process.platform !== 'win32') assert.equal(statSync(join(directory, 'AppRun')).mode & 0o777, 0o755);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('delivered launcher preserves arguments, rejects sandbox bypass, and reports startup failures', { skip: process.platform !== 'linux' }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'tangent launcher '));
  const output = join(directory, 'arguments');
  try {
    await afterPack({ appOutDir: directory, electronPlatformName: 'linux', packager: { executableName: 'tangent-browser' } });
    writeFileSync(join(directory, 'tangent-browser'), '#!/bin/sh\nprintf "%s\\n" "$@" > "$TANGENT_ARGUMENTS"\nexit "${TANGENT_TEST_EXIT:-0}"\n', { mode: 0o755 });
    const launch = (args: string[], extraEnv: Record<string, string> = {}) => spawnSync(join(directory, 'AppRun'), args, { env: { ...process.env, APPDIR: '/wrong/inherited/path', TANGENT_ARGUMENTS: output, ...extraEnv }, encoding: 'utf8' });
    const expected = ['https://example.test/a b?q=$literal', '--inspect=0'];
    assert.equal(launch(expected).status, 0);
    assert.equal(readFileSync(output, 'utf8'), expected.join('\n') + '\n', 'no sandbox-disabling argument is inserted');
    for (const argument of ['--no-sandbox', '--no-sandbox=true', '--disable-gpu-sandbox', '--disable-setuid-sandbox', '--disable-seccomp-filter-sandbox=false']) {
      writeFileSync(output, 'not launched');
      const blocked = launch([argument]);
      assert.equal(blocked.status, 1); assert.match(blocked.stderr, /cannot start.*sandbox disabled/);
      assert.equal(readFileSync(output, 'utf8'), 'not launched');
    }
    const failed = launch([], { TANGENT_TEST_EXIT: '42' });
    assert.equal(failed.status, 42); assert.match(failed.stderr, /working Chromium user-namespace sandbox/);
    assert.match(failed.stderr, /will not disable the sandbox automatically/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
