#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { EvidenceStore } from './lib/store.mjs';
import { startReviewServer } from './lib/server.mjs';
import { check } from './lib/contracts.mjs';

export async function main(argv = process.argv.slice(2)) {
  const command = argv[0];
  const { values } = parseArgs({ args:argv.slice(1), strict:true, options:{ store:{type:'string',default:'.visual-acceptance'},input:{type:'string'},out:{type:'string'},repo:{type:'string',default:'.'},related:{type:'string',multiple:true,default:[]},port:{type:'string',default:'0'},help:{type:'boolean',default:false} } });
  if (!command || command === 'help' || values.help) return { commands:'init | spec | source | build | runtime | target | capture | status | export | serve | feedback-import | run-start | run-step', usage:'visual-acceptance <command> --store .visual-acceptance [--input input.json] [--out review-directory] [--repo . --related path] [--port 0]', contract:'docs/contracts.md' };
  const store = new EvidenceStore(values.store);
  async function input() { check(values.input,'--input required'); return JSON.parse(await readFile(resolve(values.input),'utf8')); }
  switch (command) {
    case 'init': return store.init(await input());
    case 'spec': return store.setSpec(await input());
    case 'source': return store.snapshotSource(values.repo,values.related);
    case 'build': { const data = await input(); if (data.artifact?.path) data.artifact.path = resolve(dirname(resolve(values.input)),data.artifact.path); return store.addBuild(data); }
    case 'runtime': return store.addRuntime(await input());
    case 'target': return store.setTarget(await input());
    case 'capture': { const data = await input(); for (const a of data.assets ?? []) a.path = resolve(dirname(resolve(values.input)),a.path); return store.addCapture(data); }
    case 'status': { const data = await store.reviewData(), state = await store.state(); const run = state.activeRunId ? await store.currentRun(state) : null; return {project:data.project,target:data.target,summary:data.summary,cells:data.cells.map(c=>({id:c.id,status:c.status,staleReasons:c.staleReasons,blockers:c.blockers})),run}; }
    case 'export': check(values.out,'--out required'); return store.export(values.out);
    case 'feedback-import': return store.importFeedback(await input());
    case 'run-start': return store.startRun();
    case 'run-step': return store.stepRun(await input());
    case 'serve': {
      const server = await startReviewServer(store,{port:Number(values.port)});
      process.stdout.write(JSON.stringify({url:server.url,sourceId:server.sourceId,note:'CLI server persists explicit batches; Pi follow-up requires extension server or feedback import tool'})+'\n');
      let closing = false;
      const close = async()=> { if (closing) return; closing=true; await server.close(); };
      process.once('SIGINT',()=>void close()); process.once('SIGTERM',()=>void close());
      return undefined;
    }
    default: throw new Error(`Unknown command: ${command}`);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().then(result=>{ if(result !== undefined) process.stdout.write(JSON.stringify(result,null,2)+'\n'); }).catch(error=>{ process.stderr.write(JSON.stringify({error:error.message})+'\n'); process.exitCode=1; });
