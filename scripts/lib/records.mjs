import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { id, check, canonical, sha256 } from './contracts.mjs';

export const RECORD_KINDS = Object.freeze(['specs','sources','builds','runtimes','captures','aiReviews','receipts','feedback','runs','runEvents']);
const directory = (root,kind) => { check(RECORD_KINDS.includes(kind),'Unknown record kind'); return join(root,kind); };
const legacyName = recordId => `${id(recordId).replaceAll(':','_')}.json`;
// Fixed-length lowercase names also distinguish case on case-insensitive file
// systems and avoid reserved/long platform filenames. Full IDs stay in JSON.
export const recordPath = (root,kind,recordId) => join(directory(root,kind),'records-v2',`${sha256(id(recordId))}.json`);
const legacyPath = (root,kind,recordId) => join(directory(root,kind),legacyName(recordId));
const optional = async path => {
  try { return JSON.parse(await readFile(path,'utf8')); }
  catch(error) { if(error.code==='ENOENT') return undefined; throw error; }
};
const exact = (value,recordId) => { check(value?.id===recordId,`Record ID mismatch: requested ${recordId}, found ${value?.id}`); return value; };

export async function readRecord(root,kind,recordId) {
  const current=await optional(recordPath(root,kind,recordId));
  const old=await optional(legacyPath(root,kind,recordId));
  if(current!==undefined) {
    exact(current,recordId);
    // A different legacy ID can occupy its old lossy alias; it has no bearing
    // on this exact v2 identity. Two copies of the SAME ID must agree.
    if(old?.id===recordId) check(canonical(current)===canonical(old),`Conflicting record copies: ${kind}/${recordId}`);
    return current;
  }
  if(old!==undefined) return exact(old,recordId);
  const error=new Error(`Unknown record: ${kind}/${recordId}`); error.code='ENOENT'; throw error;
}

export async function writeRecord(root,kind,value) {
  const path=recordPath(root,kind,value.id),current=await optional(path),old=await optional(legacyPath(root,kind,value.id));
  if(current!==undefined) {
    exact(current,value.id);
    if(old?.id===value.id) check(canonical(current)===canonical(old),`Conflicting record copies: ${kind}/${value.id}`);
    check(canonical(current)===canonical(value),`Immutable ${kind}/${value.id} already exists with different content`);
    return value;
  }
  if(old?.id===value.id) {
    check(canonical(old)===canonical(value),`Immutable ${kind}/${value.id} already exists with different content`);
    return value; // Preserve an existing legacy document, byte-for-byte.
  }
  await mkdir(join(directory(root,kind),'records-v2'),{recursive:true,mode:0o700});
  try { await writeFile(path,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600}); }
  catch(error) {
    if(error.code!=='EEXIST') throw error;
    check(canonical(await readRecord(root,kind,value.id))===canonical(value),`Immutable ${kind}/${value.id} already exists with different content`);
  }
  return value;
}

export async function listRecords(root,kind) {
  const dir=directory(root,kind),ids=new Set();
  for(const [path,modern] of [[dir,false],[join(dir,'records-v2'),true]]) {
    const entries=await readdir(path,{withFileTypes:true}).catch(error=>{if(error.code==='ENOENT')return [];throw error;});
    for(const entry of entries) {
      if(!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const value=JSON.parse(await readFile(join(path,entry.name),'utf8')); id(value.id);
      check(entry.name===(modern?`${sha256(value.id)}.json`:legacyName(value.id)),`Record filename/ID mismatch: ${kind}/${entry.name}`);
      ids.add(value.id);
    }
  }
  // Both layouts may contain the same identity. Count it once and reject any
  // conflicting copies, especially for run events that charge retry budgets.
  return Promise.all([...ids].map(recordId=>readRecord(root,kind,recordId)));
}
