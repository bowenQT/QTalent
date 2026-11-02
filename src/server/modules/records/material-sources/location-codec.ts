import { z } from 'zod';
import {
  materialSourceLocationSchema,
  sourceLocationSchema,
  type MaterialSourceLocation,
  type SourceLocation,
} from '../../../../contracts/sources';

export type CanonicalSourceLocation = SourceLocation | MaterialSourceLocation;

export class MaterialLocationError extends Error {
  readonly code = 'invalid_location';

  constructor() {
    super('invalid_location');
    this.name = 'MaterialLocationError';
  }
}

const canonicalLocationSchema = z.union([
  sourceLocationSchema,
  materialSourceLocationSchema,
]);

/** Shape validation only; text bounds and access require the versioned source. */
export function parseCanonicalLocation(
  input: unknown,
): CanonicalSourceLocation {
  try {
    return canonicalLocationSchema.parse(input);
  } catch {
    // Neither contract diagnostics nor input values cross this boundary.
    throw new MaterialLocationError();
  }
}

export function encodeCanonicalLocation(input: unknown): string {
  // Strict schemas rebuild objects (including nested ranges) in schema key order.
  return JSON.stringify(parseCanonicalLocation(input));
}

export function decodeCanonicalLocation(
  encoded: string,
): CanonicalSourceLocation {
  try {
    return parseCanonicalLocation(JSON.parse(encoded));
  } catch {
    throw new MaterialLocationError();
  }
}
