import { z } from 'zod';
import { OfflineError } from './errors';
const word = z
  .object({
    Id: z.number().int().nonnegative(),
    SentenceId: z.number().int().nonnegative(),
    Start: z.number().int().nonnegative(),
    End: z.number().int().nonnegative(),
    Text: z.string(),
  })
  .refine((w) => w.End >= w.Start);
const schema = z.object({
  TaskId: z.string(),
  Transcription: z.object({
    AudioInfo: z.object({ Duration: z.number().int().nonnegative() }),
    Paragraphs: z.array(
      z.object({
        ParagraphId: z.string().min(1),
        SpeakerId: z.string().optional(),
        Words: z.array(word),
      }),
    ),
  }),
});
export interface OfflineSegment {
  providerSentenceId: string;
  speakerId: string | null;
  startMs: number;
  endMs: number;
  text: string;
}
export interface OfflineTranscript {
  kind: 'offline';
  providerTaskId: string;
  durationMs: number;
  text: string;
  segments: OfflineSegment[];
}
/** Provider paragraph and sentence identifiers are local, never person IDs. */
export function parseTranscript(
  raw: unknown,
  providerTaskId: string,
): OfflineTranscript {
  const parsed = schema.safeParse(raw);
  if (!parsed.success || parsed.data.TaskId !== providerTaskId)
    throw new OfflineError('malformed_result');
  const { AudioInfo, Paragraphs } = parsed.data.Transcription;
  const segments: OfflineSegment[] = [];
  const paragraphs = new Set<string>();
  const words = new Set<number>();
  for (const p of Paragraphs) {
    if (paragraphs.has(p.ParagraphId))
      throw new OfflineError('malformed_result');
    paragraphs.add(p.ParagraphId);
    const sentences = new Map<number, OfflineSegment>();
    let previousStart = -1;
    for (const w of p.Words) {
      if (
        words.has(w.Id) ||
        w.End > AudioInfo.Duration ||
        w.Start < previousStart
      )
        throw new OfflineError('malformed_result');
      words.add(w.Id);
      previousStart = w.Start;
      const previous = sentences.get(w.SentenceId);
      if (previous) {
        previous.endMs = Math.max(previous.endMs, w.End);
        previous.text += w.Text;
      } else {
        const segment = {
          providerSentenceId: `${p.ParagraphId}:${w.SentenceId}`,
          speakerId: p.SpeakerId ?? null,
          startMs: w.Start,
          endMs: w.End,
          text: w.Text,
        };
        sentences.set(w.SentenceId, segment);
        segments.push(segment);
      }
    }
  }
  return {
    kind: 'offline',
    providerTaskId,
    durationMs: AudioInfo.Duration,
    text: segments.map((s) => s.text).join('\n'),
    segments,
  };
}
