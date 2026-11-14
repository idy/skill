import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec=promisify(execFile);

test('CLI runs through package bin symlinks and emits JSON errors for invalid commands',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'visual-acceptance-cli-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const path=join(directory,'visual-acceptance.mjs');await symlink(resolve('scripts/visual-acceptance.mjs'),path);
  const {stdout}=await exec(process.execPath,[path,'help']);assert.match(JSON.parse(stdout).commands,/capture/);
  await assert.rejects(exec(process.execPath,[path,'unknown-command']),error=>error.code===1 && JSON.parse(error.stderr).error.includes('Unknown command'));
});
