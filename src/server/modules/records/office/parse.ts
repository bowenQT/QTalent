import { createHash } from 'node:crypto';
import {
  OfficeParser,
  type OfficeContentNode,
  type OfficeError,
  type OfficeIssue,
} from 'officeparser';
import { readSpreadsheet } from './spreadsheet';
import { packageMetadata } from './package';
import { presentationPages } from './presentation';
import {
  officeLocationContractSha,
  OfficeParseError,
  type OfficeFragment,
  type ParsedOffice,
} from './types';
export const officeLimits = {
  maxInputBytes: 8 * 1024 * 1024,
  maxUncompressedBytes: 32 * 1024 * 1024,
  maxZipEntries: 1024,
  maxTableCells: 20_000,
  maxXmlElements: 200_000,
  maxRepeatedContent: 2_000_000,
  maxRawContentLength: 96 * 1024 * 1024,
  maxTextChars: 2_000_000,
} as const;
function text(node: OfficeContentNode): string {
  if (['image', 'chart', 'drawing', 'comment'].includes(node.type)) return '';
  if (node.children?.length)
    return node.children
      .map(text)
      .filter((t) => t !== '')
      .join(
        ['paragraph', 'heading'].includes(node.type)
          ? ''
          : node.type === 'row'
            ? '\t'
            : '\n',
      );
  return typeof node.text === 'string' ? node.text : '';
}
function presentation(
  slides: OfficeContentNode[],
  pages: number,
): OfficeFragment[] {
  const fragments: OfficeFragment[] = [];
  const seen = new Set<number>();
  for (const slide of slides) {
    const page =
      slide.type === 'slide' ? slide.metadata?.slideNumber : undefined;
    if (
      typeof page !== 'number' ||
      !Number.isInteger(page) ||
      page < 1 ||
      page > pages ||
      seen.has(page)
    )
      throw new OfficeParseError('invalid_document', 'slide_identity');
    seen.add(page);
    const location = { kind: 'presentation' as const, slide: page };
    const body = text(slide);
    if (body.trim())
      fragments.push({ kind: 'slide_text', text: body, location });
    for (const note of slide.notes ?? []) {
      if (
        !note.metadata ||
        !('slideNumber' in note.metadata) ||
        note.metadata.slideNumber !== page
      )
        throw new OfficeParseError('invalid_document', 'note_slide_mismatch');
      const value = text(note);
      if (value.trim())
        fragments.push({ kind: 'speaker_notes', text: value, location });
    }
  }
  return fragments;
}
/** Raw source facts only. Storage, current authorization and arrangement are caller responsibilities. */
export async function parseOfficeBytes(input: {
  format: 'pptx' | 'xlsx';
  bytes: Uint8Array;
  signal?: AbortSignal;
}): Promise<ParsedOffice> {
  if (!input || !['pptx', 'xlsx'].includes(input.format))
    throw new OfficeParseError('unsupported_format', 'only_pptx_and_xlsx');
  if (!(input.bytes instanceof Uint8Array) || input.bytes.byteLength === 0)
    throw new OfficeParseError('invalid_document', 'empty_or_nonbinary');
  if (input.bytes.byteLength > officeLimits.maxInputBytes)
    throw new OfficeParseError('limit_exceeded', 'input_size');
  if (input.signal?.aborted) throw new OfficeParseError('cancelled', 'aborted');
  // Legacy/encrypted OLE containers and non-ZIP content are unsupported.
  if (input.bytes[0] !== 0x50 || input.bytes[1] !== 0x4b)
    throw new OfficeParseError('unsupported_format', 'not_an_ooxml_zip');
  const warnings: OfficeIssue[] = [];
  try {
    const metadata = packageMetadata(input.bytes, officeLimits);
    const pages = input.format === 'pptx' ? presentationPages(metadata) : 0;
    const ast = await OfficeParser.parseOffice(input.bytes, {
      fileType: input.format,
      allowRemoteAssets: false,
      extractAttachments: false,
      ocr: false,
      ignoreNotes: false,
      ignoreComments: true,
      ignoreSlideMasters: true,
      ignorePageGeometry: true,
      includeRawContent: input.format === 'xlsx',
      abortSignal: input.signal,
      decompressionLimits: {
        maxUncompressedBytes: officeLimits.maxUncompressedBytes,
        maxZipEntries: officeLimits.maxZipEntries,
        maxTableCells: officeLimits.maxTableCells,
        maxXmlElements: officeLimits.maxXmlElements,
        maxRepeatedContent: officeLimits.maxRepeatedContent,
        maxRawContentLength: officeLimits.maxRawContentLength,
      },
      onWarning: (issue) => warnings.push(issue),
    });
    if (warnings.length) {
      const code = warnings[0].code;
      throw new OfficeParseError(
        code.includes('LIMIT') || code.includes('SIZE')
          ? 'limit_exceeded'
          : 'unsupported_content',
        code,
      );
    }
    if (ast.type !== input.format)
      throw new OfficeParseError('invalid_document', 'format_mismatch');
    const fragments =
      input.format === 'pptx'
        ? presentation(ast.content, pages)
        : readSpreadsheet(metadata, ast.content, officeLimits.maxTableCells);
    if (!fragments.length)
      throw new OfficeParseError(
        'unsupported_content',
        'no_extractable_content',
      );
    if (
      fragments.reduce((sum, part) => sum + (part.text?.length ?? 0), 0) >
      officeLimits.maxTextChars
    )
      throw new OfficeParseError('limit_exceeded', 'text_size');
    return {
      format: input.format,
      inputSha256: createHash('sha256').update(input.bytes).digest('hex'),
      locationContractSha: officeLocationContractSha,
      attribution: 'unresolved',
      fragments,
    };
  } catch (error) {
    if (error instanceof OfficeParseError) throw error;
    if (input.signal?.aborted)
      throw new OfficeParseError('cancelled', 'aborted');
    const code =
      error instanceof Error
        ? (error as OfficeError).officeIssue?.code
        : undefined;
    throw new OfficeParseError(
      code?.includes('LIMIT') || code?.includes('SIZE')
        ? 'limit_exceeded'
        : 'invalid_document',
      code ?? 'malformed_or_unsupported_package',
    );
  }
}
