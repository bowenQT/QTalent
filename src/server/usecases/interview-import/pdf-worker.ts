import { parentPort, workerData } from 'node:worker_threads';
import { InterviewReviewPdfError } from '../../modules/records/attachments/interview-review/pdf-layout';
import { parseInterviewReviewPdf } from '../../modules/records/attachments/interview-review/parser';
import {
  pdfWorkerRequestSchema,
  pdfWorkerFailure,
  encodePdfWorkerResult,
  type PdfWorkerReply,
} from './pdf-protocol';

/** The same receiver used by the actual thread; no storage or model capability. */
export async function executePdfWorkerRequest(
  message: unknown,
): Promise<PdfWorkerReply> {
  const checked = pdfWorkerRequestSchema.safeParse(message);
  if (!checked.success) return pdfWorkerFailure('invalid_request');
  const { bytes, options, budget } = checked.data;
  if (bytes.byteLength > budget.maxInputBytes)
    return pdfWorkerFailure('resource_limit');
  try {
    return encodePdfWorkerResult(
      await parseInterviewReviewPdf(bytes, options),
      budget.maxOutputBytes,
    );
  } catch (error) {
    // Preserve the approved parser's safe resource class, never its cause/text.
    return pdfWorkerFailure(
      error instanceof InterviewReviewPdfError &&
        error.reason === 'resource_limit'
        ? 'resource_limit'
        : 'invalid_pdf',
    );
  }
}
if (parentPort) {
  const port = parentPort;
  void executePdfWorkerRequest(workerData)
    .then((reply) => {
      port.postMessage(reply, reply.status === 'result' ? [reply.payload] : []);
    })
    .catch(() => port.postMessage(pdfWorkerFailure('worker_failed')));
}
