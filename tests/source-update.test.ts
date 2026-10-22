import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile, rm, lstat, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
// The CLI is plain ESM so it can run before installing project dependencies.
// @ts-expect-error The standalone JavaScript CLI intentionally has no declaration file.
import { updateSource } from '../scripts/update.mjs';
const exec = promisify(execFile);
async function git(cwd: string, ...args: string[]) {
  return (await exec('git', ['-c','core.hooksPath=/dev/null','-c','user.name=Tangent Update Fixture','-c','user.email=tangent-fixture@example.invalid',...args],{cwd,encoding:'utf8'})).stdout.trim();
}
async function marker(root: string, value: string) {
  for (const name of ['node_modules','dist']) { await mkdir(join(root,name),{recursive:true}); await writeFile(join(root,name,'version-marker'),value); }
}
async function readMarker(root: string,name='node_modules'){return readFile(join(root,name,'version-marker'),'utf8');}
async function missing(path:string){try{await lstat(path);return false;}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return true;throw error;}}
async function fixture() {
  const base=await mkdtemp(join(tmpdir(),'tangent-source-update-'));const remote=join(base,'remote.git'),seed=join(base,'seed'),live=join(base,'live');
  await git(base,'init','--bare',remote);await git(base,'clone',remote,seed);await git(seed,'switch','-c','main');
  await writeFile(join(seed,'.gitignore'),'.tangent-update/\nnode_modules/\ndist/\nlocal-only.txt\n');await writeFile(join(seed,'app.txt'),'old source');
  await git(seed,'add','.');await git(seed,'commit','-m','Initial fixture');await git(seed,'push','origin','main');await git(remote,'symbolic-ref','HEAD','refs/heads/main');
  await git(base,'clone',remote,live);await marker(live,'old runtime');const before=await git(live,'rev-parse','HEAD');
  async function advance(){await writeFile(join(seed,'app.txt'),'new source');await git(seed,'add','app.txt');await git(seed,'commit','-m','New tested version');await git(seed,'push','origin','main');return git(seed,'rev-parse','HEAD');}
  const options={projectRoot:live,repositoryURL:remote,yes:true,log:()=>{},checkRunner:async(stage:string)=>marker(stage,'new runtime')};
  return {base,remote,seed,live,before,advance,options,cleanup:()=>rm(base,{recursive:true,force:true})};
}

test('source updater check-only reports incoming commits without building or changing runtime', async()=>{
  const f=await fixture();try{
    const after=await f.advance();let calls=0;
    const result=await updateSource({...f.options,checkOnly:true,checkRunner:async()=>{calls++;}});
    assert.equal(result.status,'available');assert.equal(result.after,after);assert.match(result.commits,/New tested version/);assert.equal(calls,0);
    assert.equal(await git(f.live,'rev-parse','HEAD'),f.before);assert.equal(await readMarker(f.live),'old runtime');
    assert.equal(await missing(join(f.live,'.tangent-update','lock')),true);
  }finally{await f.cleanup();}
});

test('source updater fast-forwards only after testing and transfers the tested runtime with recovery backups', async()=>{
  const f=await fixture();try{
    const after=await f.advance();let stagedPath='';
    const result=await updateSource({...f.options,checkRunner:async(stage:string)=>{
      stagedPath=stage;assert.equal(await git(f.live,'rev-parse','HEAD'),f.before);assert.equal(await readMarker(f.live),'old runtime');
      assert.equal(await git(stage,'rev-parse','HEAD'),after);await marker(stage,'new runtime');
    }});
    assert.equal(result.status,'updated');assert.equal(await git(f.live,'rev-parse','HEAD'),after);assert.equal(await readFile(join(f.live,'app.txt'),'utf8'),'new source');
    assert.equal(await readMarker(f.live),'new runtime');assert.equal(await readMarker(f.live,'dist'),'new runtime');
    assert.equal(await readMarker(result.runtimeBackup),'old runtime');assert.equal(await readMarker(result.runtimeBackup,'dist'),'old runtime');
    assert.equal(await git(f.live,'rev-parse',result.backupBranch),f.before);assert.equal(await git(f.live,'status','--porcelain'), '');
    assert.equal(await missing(stagedPath),true);assert.equal(await missing(join(f.live,'.tangent-update','lock')),true);
    assert.equal(await git(f.live,'for-each-ref','--format=%(refname)','refs/tangent-update'),'');
  }finally{await f.cleanup();}
});

test('source updater rejects tracked edits and untracked files before staging', async()=>{
  const f=await fixture();try{
    await f.advance();let calls=0;const options={...f.options,checkRunner:async()=>{calls++;}};
    await writeFile(join(f.live,'app.txt'),'user work');await assert.rejects(updateSource(options),/local or untracked changes/);
    await git(f.live,'restore','app.txt');await writeFile(join(f.live,'untracked-note'),'do not delete');await assert.rejects(updateSource(options),/local or untracked changes/);
    assert.equal(calls,0);assert.equal(await readFile(join(f.live,'untracked-note'),'utf8'),'do not delete');assert.equal(await readMarker(f.live),'old runtime');
  }finally{await f.cleanup();}
});

test('source updater refuses a diverged local main without discarding its commit', async()=>{
  const f=await fixture();try{
    await f.advance();await writeFile(join(f.live,'local.txt'),'local work');await git(f.live,'add','local.txt');await git(f.live,'commit','-m','Local-only commit');const local=await git(f.live,'rev-parse','HEAD');
    await assert.rejects(updateSource(f.options),/non-fast-forward/);assert.equal(await git(f.live,'rev-parse','HEAD'),local);assert.equal(await readMarker(f.live),'old runtime');
    assert.equal(await missing(join(f.live,'.tangent-update','lock')),true);
  }finally{await f.cleanup();}
});

test('failed staged checks leave source and both runtime directories untouched', async()=>{
  const f=await fixture();try{
    await f.advance();let stagedPath='';
    await assert.rejects(updateSource({...f.options,checkRunner:async(stage:string)=>{stagedPath=stage;await marker(stage,'unverified runtime');throw new Error('Fixture E2E failed');}}),/Fixture E2E failed/);
    assert.equal(await git(f.live,'rev-parse','HEAD'),f.before);assert.equal(await readMarker(f.live),'old runtime');assert.equal(await readMarker(f.live,'dist'),'old runtime');
    assert.equal(await missing(stagedPath),true);assert.equal(await missing(join(f.live,'.tangent-update','lock')),true);
  }finally{await f.cleanup();}
});

test('source updater rechecks the live working tree after staged verification',async()=>{
  const f=await fixture();try{
    await f.advance();
    await assert.rejects(updateSource({...f.options,checkRunner:async(stage:string)=>{await marker(stage,'new runtime');await writeFile(join(f.live,'app.txt'),'concurrent user edit');}}),/local or untracked changes/);
    assert.equal(await readFile(join(f.live,'app.txt'),'utf8'),'concurrent user edit');assert.equal(await git(f.live,'rev-parse','HEAD'),f.before);assert.equal(await readMarker(f.live),'old runtime');
  }finally{await f.cleanup();}
});

test('staged verification cannot silently switch to a different clean source revision',async()=>{
  const f=await fixture();try{
    await f.advance();
    await assert.rejects(updateSource({...f.options,checkRunner:async(stage:string)=>{await git(stage,'switch','--detach',f.before);await marker(stage,'wrong revision runtime');}}),/changed the source revision/);
    assert.equal(await git(f.live,'rev-parse','HEAD'),f.before);assert.equal(await readMarker(f.live),'old runtime');assert.equal(await readMarker(f.live,'dist'),'old runtime');
  }finally{await f.cleanup();}
});

test('a refused fast-forward restores the prior runtime and preserves ignored local files',async()=>{
  const f=await fixture();try{
    await f.advance();await writeFile(join(f.seed,'local-only.txt'),'incoming repository file');
    await git(f.seed,'add','--force','local-only.txt');await git(f.seed,'commit','-m','Track formerly ignored path');await git(f.seed,'push','origin','main');
    await writeFile(join(f.live,'local-only.txt'),'private local file');
    assert.equal(await git(f.live,'status','--porcelain'),'');
    await assert.rejects(updateSource(f.options),/would be overwritten by merge/);
    assert.equal(await git(f.live,'rev-parse','HEAD'),f.before);assert.equal(await readMarker(f.live),'old runtime');assert.equal(await readMarker(f.live,'dist'),'old runtime');
    assert.equal(await readFile(join(f.live,'local-only.txt'),'utf8'),'private local file');assert.equal(await missing(join(f.live,'.tangent-update','lock')),true);
  }finally{await f.cleanup();}
});

test('configured Git signature verification is honored and a rejected merge restores runtime',async()=>{
  const f=await fixture();try{
    await f.advance();await git(f.live,'config','merge.verifySignatures','true');
    await assert.rejects(updateSource(f.options),/does not have a GPG signature/);
    assert.equal(await git(f.live,'config','--get','merge.verifySignatures'),'true');
    assert.equal(await git(f.live,'rev-parse','HEAD'),f.before);assert.equal(await readMarker(f.live),'old runtime');assert.equal(await readMarker(f.live,'dist'),'old runtime');
    assert.equal(await missing(join(f.live,'.tangent-update','lock')),true);
  }finally{await f.cleanup();}
});

test('source updater rejects symlinked live and staged runtime directories',async()=>{
  const f=await fixture();try{
    await f.advance();const external=join(f.base,'outside');await mkdir(external);await writeFile(join(external,'do-not-touch'),'safe');
    await rm(join(f.live,'node_modules'),{recursive:true});await symlink(external,join(f.live,'node_modules'),process.platform==='win32'?'junction':'dir');
    await assert.rejects(updateSource(f.options),/symlink or non-directory/);assert.equal(await readFile(join(external,'do-not-touch'),'utf8'),'safe');
    await rm(join(f.live,'node_modules'));await marker(f.live,'old runtime');
    await assert.rejects(updateSource({...f.options,checkRunner:async(stage:string)=>{await symlink(external,join(stage,'node_modules'),process.platform==='win32'?'junction':'dir');await mkdir(join(stage,'dist'));}}),/symlink or non-directory/);
    assert.equal(await readMarker(f.live),'old runtime');assert.equal(await readFile(join(external,'do-not-touch'),'utf8'),'safe');
  }finally{await f.cleanup();}
});

test('the update lock prevents a second concurrent update',async()=>{
  const f=await fixture();let resume!:()=>void;
  try{
    await f.advance();const pause=new Promise<void>(resolve=>{resume=resolve;});let entered!:()=>void;const ready=new Promise<void>(resolve=>{entered=resolve;});
    const first=updateSource({...f.options,checkRunner:async(stage:string)=>{entered();await pause;await marker(stage,'new runtime');}});
    await ready;await assert.rejects(updateSource(f.options),/Another update is active/);resume();assert.equal((await first).status,'updated');
  }finally{resume?.();await f.cleanup();}
});

test('interactive cancellation keeps the existing source and runtime',async()=>{
  const f=await fixture();try{
    await f.advance();const result=await updateSource({...f.options,yes:false,confirm:async()=>false});
    assert.equal(result.status,'cancelled');assert.equal(await git(f.live,'rev-parse','HEAD'),f.before);assert.equal(await readMarker(f.live),'old runtime');
  }finally{await f.cleanup();}
});

test('wrong origin and non-main checkouts are refused',async()=>{
  const f=await fixture();try{
    await git(f.live,'remote','set-url','origin',join(f.base,'unexpected.git'));await assert.rejects(updateSource(f.options),/unexpected origin/);
    await git(f.live,'remote','set-url','origin',f.remote);await git(f.live,'switch','-c','feature');await assert.rejects(updateSource(f.options),/require the main branch/);
  }finally{await f.cleanup();}
});
