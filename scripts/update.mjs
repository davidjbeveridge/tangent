#!/usr/bin/env node
/** Tested, whole-application source updates. CLI trust target is fixed below. */
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';

export const REPOSITORY_URL = 'https://github.com/davidjbeveridge/tangent.git';
const exec = promisify(execFile);
const scriptRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runtimeNames = ['node_modules', 'dist'];

async function command(file, args, cwd, allowFailure = false) {
  try { const result = await exec(file, args, { cwd, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }); return { code: 0, stdout: result.stdout.trim(), stderr: result.stderr.trim() }; }
  catch (error) {
    if (allowFailure && typeof error.code === 'number') return { code: error.code, stdout: String(error.stdout || '').trim(), stderr: String(error.stderr || '').trim() };
    throw new Error(`${file} ${args[0]} failed: ${String(error.stderr || error.message).trim()}`);
  }
}
const git = (cwd, args, allowFailure = false) => command('git', args, cwd, allowFailure);
async function info(path) { try { return await lstat(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
async function directory(path, required = false) {
  const stat = await info(path);
  if (!stat) { if (required) throw new Error(`Required directory is missing: ${path}`); return false; }
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Refusing a symlink or non-directory runtime path: ${path}`);
  return true;
}
function expectedOrigin(actual, expected) {
  if (expected !== REPOSITORY_URL) return actual === expected; // Injection only for imported fixture tests.
  return [REPOSITORY_URL, REPOSITORY_URL.replace(/\.git$/, ''), 'git@github.com:davidjbeveridge/tangent.git', 'ssh://git@github.com/davidjbeveridge/tangent.git'].includes(actual);
}
async function inspectCheckout(root, repositoryURL, expectedHead) {
  const top = (await git(root, ['rev-parse', '--show-toplevel'])).stdout;
  if (await realpath(top) !== root) throw new Error('Run the updater from the Tangent repository root.');
  const branch = (await git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD'], true)).stdout;
  if (branch !== 'main') throw new Error('Source updates require the main branch. Switch to main first.');
  const origin = (await git(root, ['config', '--get-all', 'remote.origin.url'], true)).stdout;
  if (!expectedOrigin(origin, repositoryURL)) throw new Error(`Refusing an unexpected origin. Expected ${repositoryURL}.`);
  // Reject transport rewriting of the trusted HTTPS URL, including local config.
  const rewrites = (await git(root, ['config', '--get-regexp', '^url\\..*\\.insteadof$'], true)).stdout;
  if (rewrites.split('\n').filter(Boolean).some(line => { const prefix = line.slice(line.indexOf(' ') + 1); return prefix && repositoryURL.startsWith(prefix); })) throw new Error('A Git insteadOf rule rewrites the update source. Remove that rule before updating.');
  for (const name of runtimeNames) await directory(join(root, name));
  const dirty = (await git(root, ['status', '--porcelain=v1', '--untracked-files=all'])).stdout;
  if (dirty) throw new Error('The working tree has local or untracked changes. Commit or move them before updating.');
  const head = (await git(root, ['rev-parse', '--verify', 'HEAD'])).stdout;
  if (expectedHead && head !== expectedHead) throw new Error('HEAD changed while the update was being tested. Nothing will be installed.');
  return head;
}
function stream(file, args, cwd, windowsShell = false) {
  return new Promise((accept, reject) => {
    const child = spawn(file, args, { cwd, stdio: 'inherit', shell: windowsShell });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? accept() : reject(new Error(`${file} ${args.join(' ')} failed (${signal || code}).`)));
  });
}
export async function runStagedChecks(stage) {
  const npm = (args) => stream('npm', args, stage, process.platform === 'win32');
  await npm(['ci']);
  await npm(['run', 'check']);
  if (process.platform === 'linux' && !process.env.DISPLAY) await stream('xvfb-run', ['-a', 'npm', 'run', 'test:e2e'], stage);
  else await npm(['run', 'test:e2e']);
}
async function confirmClosed() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('No interactive terminal. Quit Tangent, then rerun with --yes to acknowledge it is closed.');
  const input = createInterface({ input: process.stdin, output: process.stdout });
  try { return (await input.question('Quit Tangent completely. Type yes to install this tested update: ')).trim().toLowerCase() === 'yes'; }
  finally { input.close(); }
}

/** repositoryURL/checkRunner/projectRoot are test seams; the CLI never overrides them. */
export async function updateSource(options = {}) {
  const { projectRoot = scriptRoot, repositoryURL = REPOSITORY_URL, checkRunner = runStagedChecks, checkOnly = false, yes = false, confirm = confirmClosed, log = console.log } = options;
  const root = await realpath(projectRoot);
  const before = await inspectCheckout(root, repositoryURL);
  const stagingRoot = join(root, '.tangent-update');
  await directory(stagingRoot);
  if ((await git(root, ['check-ignore', '--quiet', '.tangent-update/'], true)).code !== 0) throw new Error('The repository must ignore /.tangent-update/ before the updater can run.');
  await mkdir(stagingRoot, { recursive: true, mode: 0o700 });
  if (await realpath(stagingRoot) !== stagingRoot) throw new Error('Refusing a linked update staging directory.');
  const lock = join(stagingRoot, 'lock');
  try { await mkdir(lock, { mode: 0o700 }); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('Another update is active, or a previous update left .tangent-update/lock. Inspect it before removing it.'); throw error; }
  const token = randomUUID();
  const id = `${new Date().toISOString().replace(/[^0-9]/g, '')}-${token.slice(0, 8)}`;
  const runRoot = join(stagingRoot, id), stage = join(runRoot, 'stage'), backup = join(runRoot, 'runtime-backup');
  const ref = `refs/tangent-update/${id}`;
  let target = '', worktreeAdded = false, installed = false, preserveRecovery = false;
  let backupBranch = '';
  const swaps = [];
  try {
    await writeFile(join(lock, 'owner.json'), JSON.stringify({ token, pid: process.pid, startedAt: new Date().toISOString(), before }, null, 2), { flag: 'wx', mode: 0o600 });
    log('Fetching Tangent main from the fixed project repository…');
    await git(root, ['fetch', '--no-tags', '--no-recurse-submodules', '--no-write-fetch-head', repositoryURL, `refs/heads/main:${ref}`]);
    target = (await git(root, ['rev-parse', '--verify', `${ref}^{commit}`])).stdout;
    if ((await git(root, ['merge-base', '--is-ancestor', before, target], true)).code !== 0) throw new Error('Local main has commits not contained in remote main. Refusing a non-fast-forward update.');
    if (target === before) { log('No newer Tangent source revision is available.'); return { status: 'current', before, after: before }; }
    const commits = (await git(root, ['log', '--format=%h %s', `${before}..${target}`])).stdout;
    log(`Tangent ${before.slice(0, 12)} → ${target.slice(0, 12)}\n${commits}`);
    if (checkOnly) return { status: 'available', before, after: target, commits };
    if (!yes && confirm === confirmClosed && (!process.stdin.isTTY || !process.stdout.isTTY)) throw new Error('Quit Tangent and rerun with --yes, or use an interactive terminal. Tests are never skipped.');
    const trackedRuntime = (await git(root, ['ls-tree', '--name-only', target, '--', ...runtimeNames, '.tangent-update'])).stdout;
    if (trackedRuntime) throw new Error('The fetched revision tracks runtime/staging paths. Refusing to overwrite them.');
    await mkdir(runRoot, { mode: 0o700 });
    try { await git(root, ['worktree', 'add', '--detach', stage, target]); }
    finally { worktreeAdded = !!await info(join(stage, '.git')); }
    if ((await git(stage, ['check-ignore', '--quiet', '.tangent-update/'], true)).code !== 0) throw new Error('The fetched revision does not ignore the updater staging directory.');
    log('Installing dependencies and running all checks in an isolated worktree…');
    await checkRunner(stage);
    if ((await git(stage, ['rev-parse', '--verify', 'HEAD'])).stdout !== target) throw new Error('The staged checks changed the source revision. Refusing this build.');
    for (const name of runtimeNames) await directory(join(stage, name), true);
    if ((await git(stage, ['status', '--porcelain=v1', '--untracked-files=all'])).stdout) throw new Error('The staged checks changed tracked source or left untracked files. Refusing this build.');
    if (!yes && !await confirm()) { log('Update cancelled. Current checkout and runtime were not changed.'); return { status: 'cancelled', before, after: before }; }
    await inspectCheckout(root, repositoryURL, before);
    // Runtime directories move only after the tested revision and current checkout
    // pass validation. Source fast-forward is last, so a failed merge can restore
    // the previous runtime without resetting or discarding source edits.
    backupBranch = `backup/tangent-update/${id}`;
    await git(root, ['branch', backupBranch, before]);
    await mkdir(backup, { mode: 0o700 });
    await writeFile(join(runRoot, 'recovery.json'), JSON.stringify({ before, target, backupBranch, runtimeBackup: backup, stage, createdAt: new Date().toISOString() }, null, 2), { flag: 'wx', mode: 0o600 });
    for (const name of runtimeNames) {
      const live = join(root, name), staged = join(stage, name), previous = join(backup, name);
      const existed = await directory(live); await directory(staged, true);
      const record = { live, staged, previous, oldMoved: false, newMoved: false }; swaps.push(record);
      if (existed) { await rename(live, previous); record.oldMoved = true; }
      await rename(staged, live); record.newMoved = true;
    }
    await inspectCheckout(root, repositoryURL, before);
    await git(root, ['merge', '--ff-only', '--no-edit', '--no-autostash', '--no-overwrite-ignore', target]);
    installed = true;
    log(`Updated Tangent to ${target.slice(0, 12)}. No browser was launched.\nPrevious source: ${backupBranch}\nPrevious runtime: ${backup}\nRecovery: git switch -c tangent-recovery-${id} ${backupBranch}\nThen restore the saved runtime directories or run npm ci && npm run build.`);
    return { status: 'updated', before, after: target, backupBranch, runtimeBackup: backup };
  } catch (error) {
    if (!installed && swaps.length) {
      const liveHead = (await git(root, ['rev-parse', 'HEAD'], true)).stdout;
      if (liveHead !== before) {
        preserveRecovery = true;
        throw new Error(`${error.message}\nHEAD changed during installation. Runtime backups and staging were retained for recovery: ${runRoot}\nPrevious source: ${backupBranch}. No hard reset was performed.`);
      }
      try {
        for (const record of [...swaps].reverse()) {
          if (record.newMoved) await rename(record.live, record.staged);
          if (record.oldMoved) await rename(record.previous, record.live);
        }
      } catch (rollbackError) {
        preserveRecovery = true;
        throw new Error(`${error.message}\nRuntime rollback also failed: ${rollbackError.message}\nKeep ${runRoot} and recover from ${backupBranch}.`);
      }
    }
    throw error;
  } finally {
    if (!preserveRecovery) {
      if (worktreeAdded) {
        try {
          const cleanup = await git(root, ['worktree', 'remove', '--force', stage], true);
          if (cleanup.code !== 0) { preserveRecovery = true; log(`Staging cleanup needs attention: ${cleanup.stderr}. Retained ${runRoot}.`); }
        } catch (error) { preserveRecovery = true; log(`Staging cleanup needs attention: ${error.message}. Retained ${runRoot}.`); }
      }
      if (!preserveRecovery && !installed) await rm(runRoot, { recursive: true, force: true }).catch(error => log(`Staging cleanup needs attention: ${error.message}`));
    }
    if (target) await git(root, ['update-ref', '-d', ref, target], true).catch(() => {});
    try { const owner = JSON.parse(await readFile(join(lock, 'owner.json'), 'utf8')); if (owner.token === token) await rm(lock, { recursive: true }); }
    catch (error) { log(`Inspect the updater lock before retrying: ${lock} (${error.message})`); }
  }
}

const help = `Tangent source updater\n\nUsage: npm run update -- [--check] [--yes]\n\n  --check  Fetch and list a fast-forward update; do not build or install it.\n  --yes    Confirm Tangent is fully quit; all safety checks/tests still run.\n  --help   Show this help.\n\nUpdates fixed ${REPOSITORY_URL} main only. Requires a clean main checkout.\nRuns npm ci, npm run check, and Electron E2E in an isolated worktree first.\nInstall is a whole-app update including Electron/Chromium. No auto-launch.\nPrevious source/runtime are retained under a backup branch/.tangent-update.\nQuit Tangent before installation; do not edit this checkout during an update.\nWorktrees isolate files, not execution permissions. Trusted project build scripts\nrun with your account permissions. This script does not touch browser profiles.\n`;
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some(arg => !['--check', '--yes', '--help'].includes(arg))) { console.error('Unknown option. Use --help.'); process.exitCode = 1; }
  else if (args.includes('--help')) console.log(help);
  else updateSource({ checkOnly: args.includes('--check'), yes: args.includes('--yes') }).catch(error => { console.error(`Update stopped: ${error.message}`); process.exitCode = 1; });
}
