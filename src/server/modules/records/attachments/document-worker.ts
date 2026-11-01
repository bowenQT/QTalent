import { parentPort, workerData } from 'node:worker_threads';
import { decodeDocumentMessage } from './document-dispatch';
if (!parentPort) throw new Error('Document decoder requires a worker');
const port = parentPort;
void decodeDocumentMessage(workerData)
  .then((result) => port.postMessage(result))
  .catch(() =>
    port.postMessage({ status: 'failed', reason: 'processing_failed' }),
  );
