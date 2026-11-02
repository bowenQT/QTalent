'use client';
import { useMemo, useRef } from 'react';
import type { InterviewImportPreview } from '@/contracts/interview-import';
import { InterviewImport } from '@/features/interview-import/InterviewImport';
import type { InterviewImportPorts } from '@/features/interview-import/ports';
import { confirmInterviewImportRowAction } from '@/server/actions/interview-import';

/**
 * The stored preview with its row actions. Each change carries the revision of the row
 * as last read or saved, so a row changed elsewhere comes back as a conflict.
 * Filling in an unread item and sending a row to review are not connected yet.
 */
export function LiveImport({ preview }: { preview: InterviewImportPreview }) {
  const revisions = useRef(new Map(Object.entries(preview.revisions)));
  const ports = useMemo<InterviewImportPorts>(
    () => ({
      async confirm(batchId, rowId, ok) {
        const result = await confirmInterviewImportRowAction({
          batchId,
          rowId,
          expectedRevision: revisions.current.get(rowId) ?? 0,
          ok,
        });
        if (result.status !== 'ok')
          return { status: 'conflict', message: result.message };
        revisions.current.set(rowId, result.revision);
        return { status: 'ok', row: result.row };
      },
      fill: async () => ({
        status: 'not_connected',
        message: '补录还没接通，这一行先保持原样',
      }),
      sendToReview: async () => ({
        status: 'not_connected',
        message: '放进待核对还没接通，这一行先保持原样',
      }),
    }),
    [],
  );
  return <InterviewImport batch={preview.batch} ports={ports} />;
}
