import type { SourceReference } from '../../../../contracts/sources';

export interface AttachmentVersion {
  mediaId: string;
  originalVersionId: string;
  filename: string;
  mediaType: string;
  byteLength: number;
  sha256: string;
}
export interface ParseLimits {
  maxBytes: number;
  maxFragments: number;
  maxFragmentChars: number;
}
export interface AttachmentSegment {
  excerpt: string;
  location: { kind: 'document'; paragraph: string; page?: number };
}
export interface AttachmentFragment extends SourceReference {
  excerpt: string;
  location: AttachmentSegment['location'];
}
export interface ParsedAttachment {
  status: 'parsed';
  parseVersionId: string;
  originalVersionId: string;
  sha256: string;
  parserVersion: string;
  fragments: AttachmentFragment[];
}
export type ParseFailureReason =
  | 'empty'
  | 'invalid_content'
  | 'integrity'
  | 'resource_limit'
  | 'dependency_unavailable'
  | 'processing_failed'
  | 'cancelled';
export type AttachmentParseOutcome =
  | ParsedAttachment
  | { status: 'unsupported'; reason: 'format' | 'scanned'; message: string }
  | { status: 'failed'; reason: ParseFailureReason; message: string };
/** Implementations decode bytes only. No URL, identity, authorization or model output. */
export interface AttachmentDecoder {
  version: string;
  decode(
    bytes: Uint8Array,
    options: { signal?: AbortSignal; limits: ParseLimits },
  ): Promise<unknown>;
}
export interface ParseAttachmentInput {
  version: AttachmentVersion;
  content: AsyncIterable<Uint8Array>;
  limits: ParseLimits;
  decoders?: Partial<Record<'docx' | 'pdf', AttachmentDecoder>>;
  signal?: AbortSignal;
}
