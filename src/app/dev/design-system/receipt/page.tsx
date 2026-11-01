import { notFound } from 'next/navigation';
import { Receipt } from '@/features/receipt/Receipt';
import { receiptView } from '@/features/receipt/receipt-view';
import { sampleLookup, sampleReceipts, type SampleState } from './samples';

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * 回执样张：三份按 897 契约校验过的合成回执，`?state=processing|review|done`。
 * 真实 /receipt 在批次读取接通前只显示「待接入」。
 */
export default async function ReceiptSample({ searchParams }: Props) {
  if (process.env.NODE_ENV === 'production') notFound();
  const { state } = await searchParams;
  const key: SampleState =
    state === 'processing' || state === 'done' ? state : 'review';
  return (
    <main className="nt-body">
      <Receipt view={receiptView(sampleReceipts[key], sampleLookup)} />
    </main>
  );
}
