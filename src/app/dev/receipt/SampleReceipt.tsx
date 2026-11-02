'use client';
import { useEffect, useMemo, useState } from 'react';
import { State } from '@/components/ui/State';
import { ShellTitle } from '@/features/shell/ShellTitle';
import { ReceiptPage } from '@/features/receipt/ReceiptPage';
import type { ReceiptView } from '@/features/receipt/types';
import {
  BATCH_ID,
  sampleAccount,
  type SampleRole,
  type SampleScene,
} from './sample-data';
import { createSampleServer } from './sample-server';

/** 开发样张：在本标签页的服务端替身上走一遍回执页。 */
export function SampleReceipt({
  role,
  scene,
}: {
  role: SampleRole;
  scene: SampleScene;
}) {
  const actions = useMemo(() => createSampleServer(role, scene), [role, scene]);
  const [view, setView] = useState<ReceiptView | null>(null);
  useEffect(() => {
    let live = true;
    void actions.read(BATCH_ID).then((result) => {
      // 样张替身总能读到同一份回执
      if (live && result.status === 'success') setView(result.view);
    });
    return () => {
      live = false;
    };
  }, [actions]);
  return (
    <>
      <ShellTitle title="回执" />
      {view ? (
        <ReceiptPage
          batchId={BATCH_ID}
          initial={view}
          actions={actions}
          viewerName={sampleAccount(role).name}
        />
      ) : (
        <State kind="loading" title="正在读回执" />
      )}
    </>
  );
}
