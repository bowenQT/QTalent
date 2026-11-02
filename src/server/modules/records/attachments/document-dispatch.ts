import {
  documentMessageSchema,
  documentOutcomeSchema,
  DocumentFault,
  type DocumentOutcome,
} from './document-protocol';
export async function decodeDocumentMessage(
  message: unknown,
): Promise<DocumentOutcome> {
  const input = documentMessageSchema.parse(message);
  if (input.bytes.byteLength > input.limits.maxBytes)
    return { status: 'failed', reason: 'resource_limit' };
  try {
    const output =
      input.format === 'docx'
        ? await (await import('./docx-decoder')).decodeDocx(input)
        : await (await import('./pdf-decoder')).decodePdf(input);
    return documentOutcomeSchema.parse(output);
  } catch (error) {
    return {
      status: 'failed',
      reason: error instanceof DocumentFault ? error.reason : 'invalid_content',
    };
  }
}
