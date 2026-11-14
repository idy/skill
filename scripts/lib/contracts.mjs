import { createHash } from 'node:crypto';

export const SCHEMA_VERSION = 1;
export const AI_REVIEW_PROTOCOL = 'visual-acceptance-2';
export const DEFAULT_POLICY = Object.freeze({ revision: 'policy-1', maxRepairRounds: 2, captureRetries: 1, maxMinutes: 30, maxImages: 80 });
export const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
export const canonical = value => JSON.stringify(sort(value));
function sort(value) {
  if (Array.isArray(value)) return value.map(sort);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, sort(value[k])]));
  return value;
}
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const identity = (prefix, value) => `${prefix}-${sha256(canonical(value)).slice(0, 32)}`;
export const cellIdFor = cell => `cell-${sha256(canonical([cell.scenarioId, cell.stateId, cell.deviceId, cell.orientation, cell.variantId])).slice(0, 24)}`;
export function check(condition, message) { if (!condition) throw new Error(message); }
export function object(v, name) { check(v && typeof v === 'object' && !Array.isArray(v), `${name}: expected object`); return v; }
export function text(v, name, allowEmpty = false) { check(typeof v === 'string' && v.length <= 16000 && (allowEmpty || v.trim().length > 0), `${name}: expected ${allowEmpty ? '' : 'nonempty '}string (max 16000)`); return v; }
export function id(v, name = 'id') { check(typeof v === 'string' && ID_PATTERN.test(v), `${name}: invalid stable ID`); return v; }
export function list(v, name) { check(Array.isArray(v) && v.length <= 10000, `${name}: expected array (max 10000)`); return v; }
export function time(v, name) { check(typeof v === 'string' && Number.isFinite(Date.parse(v)) && /T.*(?:Z|[+-]\d\d:\d\d)$/.test(v), `${name}: expected ISO timestamp with timezone`); return v; }
export function choice(v, values, name) { check(values.includes(v), `${name}: expected ${values.join('|')}`); return v; }
export function policy(input = {}) {
  const value = { ...DEFAULT_POLICY, ...object(input, 'policy') }; id(value.revision, 'policy.revision');
  for (const k of ['maxRepairRounds', 'captureRetries', 'maxImages']) check(Number.isSafeInteger(value[k]) && value[k] >= 0, `policy.${k}: expected nonnegative integer`);
  check(Number.isFinite(value.maxMinutes) && value.maxMinutes > 0, 'policy.maxMinutes: expected positive number');
  return value;
}
export function validateProject(input) {
  object(input, 'project input'); check(input.schemaVersion === 1, 'Unsupported schemaVersion');
  id(input.project?.id, 'project.id'); text(input.project.name, 'project.name');
  const spec = structuredClone(object(input.spec, 'spec')); id(spec.revision, 'spec.revision');
  for (const key of ['scenarios', 'states', 'devices', 'variants']) {
    list(spec[key], `spec.${key}`); check(spec[key].length > 0, `spec.${key}: empty`);
    const ids = new Set(); for (const item of spec[key]) { id(item.id, `${key}.id`); text(item.label, `${key}.label`); check(!ids.has(item.id), `Duplicate ${key} ID`); ids.add(item.id); }
  }
  for (const state of spec.states) {
    choice(state.kind, ['state', 'transition'], 'state.kind');
    if (state.kind === 'transition') for (const key of ['fromStateId', 'toStateId']) check(spec.states.some(s => s.id === state[key] && s.kind === 'state'), `${key}: unknown stable state`);
  }
  const seen = new Set();
  spec.cells = list(spec.cells, 'spec.cells').map(cell => {
    for (const [key, table] of [['scenarioId','scenarios'], ['stateId','states'], ['deviceId','devices'], ['variantId','variants']]) check(spec[table].some(s => s.id === cell[key]), `Unknown cell.${key}`);
    choice(cell.orientation, ['portrait','landscape','unspecified'], 'cell.orientation');
    list(cell.checkpoints, 'cell.checkpoints').forEach(s => text(s, 'checkpoint'));
    check(cell.checkpoints.length > 0, 'Cell needs explicit checkpoints');
    const stableId = cellIdFor(cell); check(!cell.id || cell.id === stableId, 'Cell ID does not match stable tuple');
    check(!seen.has(stableId), 'Duplicate cell'); seen.add(stableId);
    return { ...cell, id: stableId };
  });
  check(spec.cells.length > 0, 'Spec needs cells');
  return { schemaVersion: 1, project: structuredClone(input.project), spec, policy: policy(input.policy) };
}
export function validateFeedback(batch, { projectId, sourceId, specByRev, captureById }) {
  object(batch, 'feedback'); check(batch.schemaVersion === 1, 'Unsupported feedback schemaVersion');
  id(batch.batchId, 'batchId'); id(batch.sourceId, 'sourceId'); check(batch.projectId === projectId, 'Feedback project mismatch');
  if (sourceId) check(batch.sourceId === sourceId, 'Feedback source mismatch');
  time(batch.submittedAt, 'submittedAt');
  check(list(batch.edits, 'edits').length > 0 && batch.edits.length <= 1000, 'Batch needs 1..1000 edits');
  const seen = new Set();
  for (const edit of batch.edits) {
    id(edit.cellId, 'cellId'); id(edit.specRev, 'specRev');
    const referencedSpec = specByRev.get(edit.specRev);
    check(referencedSpec?.cells.some(c => c.id === edit.cellId), 'Unknown feedback cell in referenced spec');
    check(!seen.has(edit.cellId), 'Duplicate cell in feedback batch'); seen.add(edit.cellId);
    choice(edit.verdict, ['pass','question','fail'], 'verdict'); text(edit.comment, 'comment', edit.verdict === 'pass'); text(edit.reviewer, 'reviewer'); id(edit.specRev, 'specRev');
    if (edit.captureId === null) { check(edit.buildId === null && edit.runtimeId === null, 'Missing evidence must have null build/runtime'); }
    else {
      const capture = captureById.get(id(edit.captureId, 'captureId')); check(capture && capture.cellId === edit.cellId, 'Unknown feedback capture/cell');
      for (const key of ['buildId', 'runtimeId', 'specRev']) check(edit[key] === capture[key], `Feedback ${key} mismatch`);
    }
  }
  return structuredClone(batch);
}
export function staleReasons(record, capture, target, policyRev, isAI = false) {
  const reasons = [];
  if (!capture || record.captureId !== capture.id) reasons.push('capture changed or missing');
  for (const key of ['buildId','runtimeId','specRev']) if (record[key] !== target?.[key]) reasons.push(`${key} changed`);
  if (isAI && record.policyRev !== policyRev) reasons.push('review policy changed');
  if (isAI && record.reviewProtocol !== AI_REVIEW_PROTOCOL) reasons.push('image review protocol changed; inspect images again');
  if (capture && record.imageSetHash && record.imageSetHash !== imageSetHash(capture)) reasons.push('image set changed');
  return reasons;
}
export const imageSetHash = capture => sha256(canonical(capture.assets.filter(a => a.kind !== 'video').map(a => [a.id, a.sha256])));
