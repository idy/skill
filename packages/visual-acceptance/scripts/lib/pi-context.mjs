import { check } from './contracts.mjs';

export function eligibleImageReceiptIds(sessionManager) {
  check(typeof sessionManager.buildSessionProjection === 'function', 'Pi must expose its effective session projection; deliver images again in a supported host');
  const ids = new Set();
  for (const entry of sessionManager.buildSessionProjection().entries) {
    const raw = entry.sourceEntry.type === 'message' ? entry.sourceEntry.message : null;
    if (raw?.role !== 'toolResult' || raw.toolName !== 'visual_acceptance_image' || raw.isError || !raw.details?.receipt) continue;
    const supplied = raw.content.filter(c => c.type === 'image');
    // Context edits retain raw metadata. Require the effective tool-result contribution to
    // still contain the very image supplied by that result, not merely its old receipt.
    if (entry.messages.some(message => message.role === 'toolResult' && message.toolName === raw.toolName && !message.isError && message.details?.receipt?.id === raw.details.receipt.id && Array.isArray(message.content) && message.content.some(c => c.type === 'image' && supplied.some(original => c.mimeType === original.mimeType && c.data === original.data)))) ids.add(raw.details.receipt.id);
  }
  return ids;
}
