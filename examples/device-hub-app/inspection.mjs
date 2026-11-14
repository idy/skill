import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

/** Adds externally authored, byte-bound visual assertions after actual image
 * inspection. Never infers a state/verdict from hierarchy, filenames or timing. */
export async function attachInspection(input, observations) {
  const capture = structuredClone(input);
  const images = capture.assets.filter(asset => asset.kind !== 'video');
  for (const asset of images) {
    const sha256 = createHash('sha256').update(await readFile(asset.path)).digest('hex');
    const note = observations.find(n => n.assetId === asset.id && n.sha256 === sha256);
    if (!note || !note.comment || !Array.isArray(note.visibleText) || !note.visibleText.length || !Number.isFinite(Date.parse(note.inspectedAt)) || note.stateVisible !== true) throw new Error(`Missing actual, SHA-bound image inspection for ${capture.id}/${asset.id}`);
    capture.assertions.push({ description: `Post-capture actual-image inspection: ${note.comment}`, result: 'pass', basis: 'visual', evidenceAssetIds: [asset.id], inspectedAt: note.inspectedAt, ...(note.stateId ? { stateId: note.stateId } : {}) });
  }
  if (capture.transition) {
    const t = capture.transition;
    if (!Number.isSafeInteger(t.triggerActionIndex) || !t.startEvidenceAssetId || !t.endEvidenceAssetId) throw new Error('Legacy transition lacks explicit action/endpoint bindings; retain it blocked and collect a new capture');
    for (const [assetId,stateId] of [[t.startEvidenceAssetId,t.fromStateId],[t.endEvidenceAssetId,t.toStateId]]) {
      if (!capture.assertions.some(a => a.basis === 'visual' && a.result === 'pass' && a.stateId === stateId && a.evidenceAssetIds.includes(assetId))) throw new Error(`Endpoint ${assetId} needs an explicit inspected ${stateId} state assertion`);
    }
  }
  return capture;
}
