#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { capture } from './adapter.mjs';

export async function main(argv = process.argv.slice(2)) {
  const input = argv[argv.indexOf('--input') + 1];
  const out = argv[argv.indexOf('--out') + 1];
  if (!argv.includes('--input') || !argv.includes('--out') || !input || !out) throw new Error('Usage: node cli.mjs --input plan.json --out NEW-directory');
  const plan = JSON.parse(await readFile(resolve(input), 'utf8'));
  const result = await capture(plan, { outputDir: resolve(out), bridgeCommand: plan.bridge?.command, tools: plan.bridge?.tools });
  console.log(JSON.stringify({ status: result.status, capture: resolve(out, 'capture.json'), blockers: result.blockers }));
  if (result.status === 'blocked') process.exitCode = 2;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
