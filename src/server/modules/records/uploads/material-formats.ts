import { MEDIA_FORMATS } from '../../../../contracts/media';

/** Formats the material intake accepts: the record attachment formats plus MP4
 * video and PNG/JPEG images. Record attachment requests keep the narrower
 * `uploadRequestSchema` gate, so they never match the added entries.
 */
export const MATERIAL_FORMATS = [
  ...MEDIA_FORMATS,
  { purpose: 'video', extension: 'mp4', mediaTypes: ['video/mp4'] },
  { purpose: 'image', extension: 'png', mediaTypes: ['image/png'] },
  { purpose: 'image', extension: 'jpg', mediaTypes: ['image/jpeg'] },
  { purpose: 'image', extension: 'jpeg', mediaTypes: ['image/jpeg'] },
] as const;

export type MaterialFormat = (typeof MATERIAL_FORMATS)[number];

export function materialFormatFor(request: {
  purpose: string;
  filename: string;
}): MaterialFormat | undefined {
  return MATERIAL_FORMATS.find(
    (format) =>
      request.purpose === format.purpose &&
      request.filename.toLowerCase().endsWith(`.${format.extension}`),
  );
}

/** The declared extension and media type both belong to one supported format. */
export function isSupportedMaterial(request: {
  purpose: string;
  filename: string;
  declaredMediaType: string;
}): boolean {
  const format = materialFormatFor(request);
  return (
    format !== undefined &&
    (format.mediaTypes as readonly string[]).includes(
      request.declaredMediaType.toLowerCase(),
    )
  );
}
