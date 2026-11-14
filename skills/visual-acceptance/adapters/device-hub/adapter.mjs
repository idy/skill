import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { performance } from 'node:perf_hooks';
import { StdioMCP } from './mcp.mjs';

const exec = promisify(execFile);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
export const VERSION = '1.0';
export const APPLE_TOOLS = Object.freeze({ start: 'DeviceInteractionStartSession', observe: 'DeviceInteractionSynthesize', end: 'DeviceInteractionEndSession' });

export function pngDimensions(bytes) {
  if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('Device Hub screenshot is not a PNG');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}
export function hitPoint(hierarchy, label) {
  const lines = hierarchy.split('\n').filter(line => line.includes('Button,') && line.includes(`label: '${label}'`));
  if (lines.length !== 1) throw new Error(`Expected one visible button named ${label}; found ${lines.length}`);
  const hit = lines[0].match(/hitPoint: \{(-?[\d.]+), (-?[\d.]+)\}/);
  if (!hit) throw new Error(`No hitPoint for ${label}`);
  return { x: Number(hit[1]), y: Number(hit[2]) };
}
export function validatePlan(plan) {
  for (const key of ['id', 'cellId', 'sourceSnapshotId', 'buildId', 'runtimeId', 'specRev']) if (typeof plan[key] !== 'string' || !plan[key]) throw new Error(`Missing ${key}`);
  if (!plan.device?.id || !plan.device?.os || !plan.app?.id) throw new Error('Explicit device ID, OS, and app ID are required');
  if (!['portrait', 'landscape'].includes(plan.device.orientation)) throw new Error('Explicit orientation is required');
  if (!Array.isArray(plan.expectedTexts) || !plan.expectedTexts.length) throw new Error('expectedTexts must establish the requested state');
  if (plan.transition && (!plan.transition.fromStateId || !plan.transition.toStateId || !plan.transition.trigger?.tap || !plan.transition.fromExpectedTexts?.length)) throw new Error('Transition requires from/to state, starting assertions, and trigger tap');
}
async function runArgv(argv) {
  if (!Array.isArray(argv) || !argv.length || argv.some(s => typeof s !== 'string')) throw new Error('Preparation command must be argv, never shell text');
  await exec(argv[0], argv.slice(1), { timeout: 60000, maxBuffer: 1024 * 1024 });
}

/** Returns core capture input. Hierarchy establishes reachability, never a visual verdict.
 * Injection exists for isolated protocol tests; production uses the verified Apple bridge. */
export async function capture(plan, { outputDir, bridgeCommand, tools = APPLE_TOOLS, client: injected, clock = () => new Date().toISOString() } = {}) {
  validatePlan(plan);
  const directory = resolve(outputDir);
  await mkdir(directory, { recursive: false }); // unique evidence directory; never overwrite
  const result = Object.fromEntries(['id','cellId','sourceSnapshotId','buildId','runtimeId','specRev'].map(k => [k, plan[k]]));
  Object.assign(result, { createdAt: clock(), status: 'blocked', assets: [], actions: [], assertions: [], provenance: { adapter: 'device-hub', adapterVersion: VERSION, deviceId: plan.device.id, deviceKind: plan.device.kind || 'simulator', source: 'real-app', device: plan.device, app: plan.app, fixtureDescription: plan.fixtureDescription || 'No fixture declared', captureMethod: 'Apple Device Hub MCP DeviceInteractionSynthesize (original returned PNG bytes)' }, limitations: ['Accessibility assertions establish state reachability only. Visual review of every new image is required.', 'Device Hub may return screenshots at a different scale from the simulator framebuffer; original dimensions are recorded separately.'], blockers: [] });
  const client = injected || new StdioMCP(bridgeCommand);
  let session, state, hierarchy = '', recording;
  const recordAction = (type, description, extras = {}) => result.actions.push({ at: clock(), type, description, source: 'device-hub', ...extras });
  const observe = async command => {
    const before = clock();
    state = await client.call(tools.observe, { interactSessionKey: session.interactionSessionKey, ...(plan.activateApp === false ? {} : { activationBundleId: plan.app.id }), interactionCommand: command });
    const after = clock();
    if (!state.hierarchyPath || !state.screenshotPath) throw new Error('Device Hub returned no screenshot or hierarchy');
    hierarchy = await readFile(state.hierarchyPath, 'utf8');
    if (!hierarchy.includes(`Application bundle identifier: ${plan.app.id}`)) throw new Error('Requested app is absent from the device hierarchy');
    if (['Crashed', 'Hanging', 'Disconnected', 'Stopped'].includes(state.applicationState)) throw new Error(`App state is ${state.applicationState}`);
    // NotRun may mean no Xcode debugger is attached to a simctl-launched process.
    if (state.applicationState === 'NotRun') {
      if (!/Application, pid: [1-9]\d*/.test(hierarchy)) throw new Error('No running app PID in hierarchy');
      const note = 'Device Hub reports NotRun without an Xcode launch session; app PID and bundle are present in its live hierarchy.';
      if (!result.limitations.includes(note)) result.limitations.push(note);
    }
    const orientation = hierarchy.match(/Application UI orientation: ([^\n]+)/)?.[1] || '';
    if (plan.device.orientation === 'portrait' ? !/^Portrait/.test(orientation) : !/^Landscape/.test(orientation)) throw new Error(`Requested ${plan.device.orientation}; app reports ${orientation || 'unknown'}`);
    state.observedBetween = { startedAt: before, endedAt: after };
    return state;
  };
  const assertTexts = texts => {
    for (const text of texts) {
      const present = hierarchy.includes(`label: '${text}'`);
      result.assertions.push({ description: `Live accessibility label: ${text}`, result: present ? 'pass' : 'fail', basis: 'accessibility', evidenceAssetIds: [] });
      if (!present) throw new Error(`Requested state not reached; missing live label: ${text}`);
    }
  };
  const tap = async label => {
    const { x, y } = hitPoint(hierarchy, label);
    recordAction('tap', `Tap ${label} at latest hierarchy hitPoint`, { label, x, y });
    return observe(`t ${x} ${y}`);
  };
  const save = async (path, id, kind = 'screenshot', extra = {}) => {
    const destination = join(directory, `${id}.png`);
    await copyFile(path, destination, 1);
    const dimensions = pngDimensions(await readFile(destination));
    const asset = { id, kind, path: destination, capturedAt: clock(), ...dimensions, ...extra };
    result.assets.push(asset);
    return asset;
  };
  try {
    const available = await client.initialize();
    for (const name of Object.values(tools)) if (!available.some(t => t.name === name)) throw new Error(`Bridge does not expose configured tool ${name}`);
    if (plan.workspacePath) {
      if (!available.some(t => t.name === 'XcodeOpenWorkspace')) throw new Error('Bridge cannot open the requested workspace');
      await client.call('XcodeOpenWorkspace', { path: resolve(plan.workspacePath) });
      recordAction('open-workspace', 'Open authorized app workspace in Xcode');
    }
    for (const item of plan.prepare || []) { await runArgv(item.argv); recordAction(item.type || 'prepare', item.description); }
    session = await client.call(tools.start, { deviceIdentifier: plan.device.id, sessionIdentifier: `Visual Acceptance ${plan.id} ${Date.now()}` });
    if (session.deviceUUID !== plan.device.id) throw new Error('Device Hub selected a different device; no capture accepted');
    if (plan.device.kind && (session.deviceIsSimulator ? 'simulator' : 'device') !== plan.device.kind) throw new Error('Device Hub kind differs from the requested simulator/device');
    recordAction('session', `Open ${session.deviceIsSimulator ? 'simulator' : 'device'} session`, { deviceId: session.deviceUUID });
    // First orientation command acts on the explicitly named owned test device.
    await observe(`orientation ${plan.device.orientation === 'portrait' ? 'portrait' : 'landscapeLeft'}`);
    recordAction('orientation', `Set real device orientation ${plan.device.orientation}`);
    for (const action of plan.entryActions || []) {
      if (action.tap) await tap(action.tap);
      else throw new Error('Entry actions must identify a live button by exact label');
    }
    if (plan.transition) {
      assertTexts(plan.transition.fromExpectedTexts);
      if (plan.device.kind !== 'simulator' || !plan.transition.simctlVideo) throw new Error('Transition recording needs configured simulator video capability; no current-screen substitute');
      const videoPath = join(directory, 'transition.mp4');
      const initial = await save(state.screenshotPath, 'frame-start', 'frame', { offsetMs: 0, observedBetween: state.observedBetween, captureMethod: 'Device Hub original screenshot before trigger' });
      const t0 = performance.now();
      const startedAt = initial.capturedAt;
      recording = startVideo(plan.device.id, videoPath);
      await recording.ready;
      const { x, y } = hitPoint(hierarchy, plan.transition.trigger.tap);
      recordAction('tap', `Trigger ${plan.transition.trigger.tap} at latest hierarchy hitPoint`, { x, y });
      // Video and framebuffer samples run while the real MCP tap is in flight.
      const trigger = observe(`t ${x} ${y}`);
      trigger.catch(() => {});
      const samples = plan.transition.sampleOffsetsMs || [500, 1500, 3400];
      let previous = 0;
      for (let index = 0; index < samples.length; index++) {
        const target = samples[index];
        if (!Number.isFinite(target) || target <= previous || target > 15000) throw new Error('Frame offsets must increase and stay within 15 seconds');
        await pause(Math.max(0, target - (performance.now() - t0)));
        const before = clock();
        const framePath = join(directory, `frame-${index + 1}.png`);
        await runArgv(['xcrun', 'simctl', 'io', plan.device.id, 'screenshot', framePath]);
        const after = clock();
        const offsetMs = Math.round(performance.now() - t0);
        result.assets.push({ id: `frame-${index + 1}`, kind: 'frame', path: framePath, capturedAt: after, ...pngDimensions(await readFile(framePath)), offsetMs, observedBetween: { startedAt: before, endedAt: after }, captureMethod: 'Live simctl framebuffer sample during Device Hub action; unmodified PNG' });
        previous = target;
      }
      await trigger;
      await observe('');
      assertTexts(plan.expectedTexts);
      await save(state.screenshotPath, 'frame-end', 'frame', { offsetMs: Math.round(performance.now() - t0), observedBetween: state.observedBetween, captureMethod: 'Device Hub original screenshot after ending-state assertions' });
      await recording.stop(); recording = undefined;
      const endedAt = clock();
      const { stdout: movieJSON } = await exec('xcrun', ['swift', join(dirname(fileURLToPath(import.meta.url)), 'video-info.swift'), videoPath], { timeout: 30000, maxBuffer: 1024 * 1024 });
      const movie = JSON.parse(movieJSON);
      if (!Number.isFinite(movie.durationMs) || movie.durationMs <= 0) throw new Error('Cannot read actual movie duration');
      result.assets.push({ id: 'transition-video', kind: 'video', path: videoPath, capturedAt: endedAt, mimeType: 'video/mp4', ...movie });
      result.transition = { fromStateId: plan.transition.fromStateId, toStateId: plan.transition.toStateId, startedAt, endedAt, captureMethod: 'simctl recordVideo h264 concurrent with real Device Hub tap', timing: 'host monotonic sample offsets; screenshot observedBetween brackets capture latency', frameRate: 'Recorder-controlled variable rate; nominal movie FPS recorded per asset, no measured animation smoothness verdict' };
      result.limitations.push('Sparse representative frames cannot establish animation smoothness. Video is retained; no frame pacing/runtime metrics were measured.');
    } else {
      // Bounded wait for controlled IO, always followed by a fresh observation.
      if (plan.settleMs) { if (plan.settleMs > 15000 || plan.settleMs < 0) throw new Error('settleMs outside 0..15000'); await pause(plan.settleMs); await observe(''); }
      assertTexts(plan.expectedTexts);
      await save(state.screenshotPath, 'screen', 'screenshot', { observedBetween: state.observedBetween });
    }
    if (hierarchy) await writeFile(join(directory, 'hierarchy.txt'), hierarchy, { flag: 'wx' });
    result.status = 'captured';
  } catch (error) {
    result.status = 'blocked'; result.blockers.push(error.message);
  } finally {
    if (recording) { try { await recording.stop(); } catch (error) { result.blockers.push(`Video cleanup: ${error.message}`); result.status = 'blocked'; } }
    if (session) {
      try { await client.call(tools.end, { interactionSessionKey: session.interactionSessionKey }); recordAction('cleanup', 'End Device Hub interaction session'); }
      catch (error) { result.status = 'blocked'; result.blockers.push(`Device Hub session cleanup failed: ${error.message}`); }
    }
    client.close();
  }
  await writeFile(join(directory, 'capture.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  return result;
}

function startVideo(deviceId, videoPath) {
  const child = spawn('xcrun', ['simctl', 'io', deviceId, 'recordVideo', '--codec=h264', videoPath], { stdio: ['ignore','ignore','pipe'] });
  let stderr = '', stopped = false;
  const exit = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', code => code === 0 || code === 130 ? resolve() : reject(new Error(`simctl recording exited ${code}`)));
  });
  exit.catch(() => {});
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Simulator video did not start within 15 seconds')), 15000);
    child.stderr.on('data', b => { stderr = (stderr + b.toString()).slice(-8000); if (stderr.includes('Recording started')) { clearTimeout(timer); resolve(); } });
    exit.then(() => { clearTimeout(timer); reject(new Error('Simulator video stopped before readiness')); }, e => { clearTimeout(timer); reject(e); });
  });
  return { ready, async stop() { if (!stopped) { stopped = true; child.kill('SIGINT'); } let timer; try { await Promise.race([exit, new Promise((_, reject) => { timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('Simulator video finalization timed out')); }, 15000); })]); } finally { clearTimeout(timer); } } };
}
