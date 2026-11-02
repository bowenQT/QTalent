export function sourceKey(reference: {
  fragmentId: string;
  originalVersionId: string;
}): string {
  return JSON.stringify([reference.fragmentId, reference.originalVersionId]);
}
