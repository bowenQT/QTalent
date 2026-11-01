import { copy } from './copy';

/** 「原话」折叠区：照原型显示用户提交的原文，不加标记。 */
export function RawInput({ text }: { text: string }) {
  return (
    <details className="n-event__raw">
      <summary>{copy.sbi.rawSummary}</summary>
      <p>{text}</p>
    </details>
  );
}
