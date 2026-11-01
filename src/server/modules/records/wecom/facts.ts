import { z } from 'zod';
const id = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[^\s\u0000-\u001f\u007f]+$/u);
export const wecomArchivedMediaSchema = z.strictObject({
  partIndex: z.number().int().min(0).max(19),
  kind: z.enum(['image', 'file']),
  uploadId: id,
  originalVersionId: id,
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export const wecomArchivedMediaListSchema = z
  .array(wecomArchivedMediaSchema)
  .max(20)
  .refine(
    (refs) => new Set(refs.map((ref) => ref.partIndex)).size === refs.length,
  );
export type WecomArchivedMedia = z.infer<typeof wecomArchivedMediaSchema>;
