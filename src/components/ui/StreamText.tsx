/**
 * Streamed model text, appended one paragraph at a time. The component never animates
 * characters: every segment the caller has received is shown at once, so a reduced-motion
 * viewer sees whole paragraphs and the stylesheet stops the caret from blinking.
 * Earlier paragraphs keep their DOM nodes while later ones arrive.
 */
export function StreamText({
  segments,
  streaming = false,
}: {
  segments: readonly string[];
  streaming?: boolean;
}) {
  return (
    <div aria-live="polite" aria-busy={streaming}>
      {segments.map((segment, index) => (
        <p key={index}>
          {segment}
          {streaming && index === segments.length - 1 ? (
            <span className="n-caret" aria-hidden="true" />
          ) : null}
        </p>
      ))}
    </div>
  );
}
