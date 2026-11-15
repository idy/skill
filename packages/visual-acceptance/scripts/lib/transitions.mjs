// Structural evidence eligibility only: these checks cannot establish that an agent perceived pixels.
// Identical samples can be real waiting. They are retained, but a wholly unchanged sample set
// cannot by itself establish a visible transition, even when IDs/timestamps differ.
export function transitionFindings(capture, row) {
  const blockers = [], limitations = [];
  if (row?.kind !== 'transition') return { blockers, limitations };
  const t = capture.transition;
  if (!t) return { blockers: ['Transition metadata missing or state unreachable; cannot verify start/end or temporal evidence'], limitations };
  if (t.fromStateId !== row.fromStateId || t.toStateId !== row.toStateId) blockers.push('Transition start/end state mismatch');
  const start = Date.parse(t.startedAt), end = Date.parse(t.endedAt), duration = end - start;
  const zoned = value => typeof value === 'string' && /T.*(?:Z|[+-]\d\d:\d\d)$/.test(value);
  if (!zoned(t.startedAt) || !zoned(t.endedAt) || !Number.isFinite(start) || !Number.isFinite(end) || duration <= 0) return { blockers: [...blockers, 'Transition needs a valid increasing start/end interval'], limitations };
  const frames = capture.assets.filter(a => a.kind === 'frame');
  const ordered = frames.length >= 3 && frames.every((a, i) => Number.isFinite(a.offsetMs) && a.offsetMs >= 0 && Number.isFinite(Date.parse(a.capturedAt)) && (!i || (a.offsetMs > frames[i - 1].offsetMs && Date.parse(a.capturedAt) > Date.parse(frames[i - 1].capturedAt))));
  if (!ordered) blockers.push('Transition needs at least start, intermediate and end frames in strictly increasing time order');
  if (frames.some(a => Math.abs(Date.parse(a.capturedAt) - start - a.offsetMs) > 1 || a.offsetMs > duration || Date.parse(a.capturedAt) < start || Date.parse(a.capturedAt) > end)) blockers.push('Transition frame offsets/timestamps must agree within 1ms and stay inside the interval');
  const startFrame = frames.find(a => a.id === t.startEvidenceAssetId), endFrame = frames.find(a => a.id === t.endEvidenceAssetId);
  if (!startFrame || startFrame !== frames[0] || startFrame.offsetMs !== 0 || Date.parse(startFrame.capturedAt) !== start) blockers.push('Transition needs explicit first-frame start evidence at startedAt/offset 0');
  if (!endFrame || endFrame !== frames.at(-1) || Math.abs(endFrame.offsetMs - duration) > 1 || Math.abs(Date.parse(endFrame.capturedAt) - end) > 1) blockers.push('Transition needs explicit last-frame end evidence covering endedAt');
  const trigger = Number.isSafeInteger(t.triggerActionIndex) && t.triggerActionIndex >= 0 ? capture.actions[t.triggerActionIndex] : null;
  const triggerTime = trigger ? Date.parse(trigger.at) : NaN;
  if (!Number.isFinite(triggerTime) || triggerTime < start || triggerTime >= end) blockers.push('Transition triggerActionIndex must reference a real action inside the transition interval before its end');
  else if (!frames.some(a => Date.parse(a.capturedAt) > triggerTime && Date.parse(a.capturedAt) < end)) blockers.push('Transition needs an intermediate frame after the trigger and before end-state evidence');
  for (const [stateId, asset, label] of [[row.fromStateId, startFrame, 'start'], [row.toStateId, endFrame, 'end']]) {
    if (!asset || !capture.assertions.some(a => a.stateId === stateId && a.result === 'pass' && a.basis === 'visual' && a.evidenceAssetIds.includes(asset.id))) blockers.push(`Transition ${label} state needs a visual assertion with stateId and its endpoint asset reference`);
  }
  if (frames.some(a => !/^[a-f0-9]{64}$/.test(a.pixelSha256 ?? ''))) blockers.push('Transition frames require verified decoded pixel fingerprints; unavailable or corrupt images cannot establish visible change');
  else if (frames.length && new Set(frames.map(a => a.pixelSha256)).size < 2) blockers.push('All representative frames have identical pixels; visible transition evidence is insufficient. Real waiting may repeat frames, but needs an observed change or additional usable temporal evidence before approval');
  const gaps = frames.slice(1).map((a, i) => a.offsetMs - frames[i].offsetMs);
  limitations.push(`Sampled transition frames only (${frames.length} frames, largest gap ${gaps.length ? Math.max(...gaps) : 0}ms); unobserved gaps cannot establish continuous smoothness`);
  if (capture.assets.some(a => a.kind === 'video')) limitations.push('Video retained for temporal review; core checks its signature, not playback, frame rate or smoothness');
  return { blockers, limitations };
}
